import { useMemo } from 'react'
import type { DimensionDef, SystemDefinition } from '../api/client'
import { CHART_PALETTE, colorFor, useChartColors } from './chartColors'

// Patch 4N — shared cohort-color utility.
//
// The two charts that visualize DSM cohorts (DSM Dashboard's Stock
// Composition + Impact Assessment's "Impact over time, by cohort")
// previously each built their own label set and called
// ``useChartColors`` independently. Same algorithm, same palette, but
// different inputs:
//
//   - DSM Stock Composition labels: dimension VALUES (e.g. for the
//     ``fuel_type`` Stack-by, labels are ``BEV``, ``PHEV``, ``ICEV``).
//   - Impact by-cohort labels: full cohort KEYS (e.g.
//     ``BEV-LFP|Small|2028``).
//
// Different label spaces → different colors per "BEV", which broke
// users' ability to compare the two charts side-by-side. Patch 4N
// centralises the logic and aligns Impact-by-cohort coloring to
// whichever Stack-by the user has on the DSM Dashboard, so a
// ``BEV-LFP|Small|2028`` band in the Impact chart inherits the same
// fuel_type color the DSM chart uses for ``BEV-LFP``.

const COHORT_SEP = '|'

export function parseCohortKey(
  key: string,
  dims: readonly DimensionDef[],
): Record<string, string> {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return Object.fromEntries(nads.map((d, i) => [d.name, parts[i] ?? '']))
}

export function groupKeyForDim(
  cohortKey: string,
  dims: readonly DimensionDef[],
  dimName: string | null,
): string {
  if (!dimName) return cohortKey || 'all'
  const parsed = parseCohortKey(cohortKey, dims)
  return parsed[dimName] ?? 'all'
}

/**
 * Patch 4AK² — derive per-dimension color overrides from per-row
 * overrides. For each dimension value, if EVERY row whose cohort key
 * carries that value has the SAME color override, that color is
 * derived as the per-dim override.
 *
 * Returns a flat ``Record<dimValue, hex>`` because per-dim overrides
 * are keyed by dim value alone (the project-scoped color map is
 * shared across dimensions; see chartColors.useChartColors).
 *
 * Use case: Excel cohort-mapping upload where every (BEV-LFP, *) row
 * carries one color and every (HEV, *) row carries another, etc. The
 * user's intent is "BEV-LFP is blue everywhere" — derivation
 * translates that to a per-dim override at the upload boundary so
 * single-dim stacked charts (DSM Stock Composition stacked by Fuel)
 * reflect it.
 *
 * Ambiguity rule: if rows for a given dim value carry different
 * colors (e.g. BEV-LFP Small = #aaa, BEV-LFP Large = #bbb), NO per-dim
 * override is derived for that value. Per-row overrides still apply
 * in cohort-key stacked charts.
 *
 * **One-way at upload only.** Do NOT call this from the in-app per-row
 * picker — the runtime architectural separation between per-row and
 * per-dim is preserved everywhere except the import boundary.
 */
export function deriveDimColorsFromRowColors(
  rowColors: Record<string, string>,
  dims: readonly DimensionDef[],
): Record<string, string> {
  // Per dim value: collect all colors observed across rows that
  // contain that value. If exactly one color → derive. If 0 or >1 →
  // skip.
  //
  // Patch 4AK³ — empty / 'auto' values explicitly treated as
  // "no opinion" (skipped), NOT as conflict. This means a dim value
  // with `[#aaa, #aaa, '']` derives to #aaa rather than failing as
  // mixed. The backend already filters auto/empty out of row_colors
  // before persisting (see `_normalize_color`), but the defensive
  // check here covers any future caller that might pass raw values.
  const observed: Record<string, Set<string>> = {}
  for (const [ck, color] of Object.entries(rowColors)) {
    if (!color) continue
    const trimmed = color.trim()
    if (!trimmed || trimmed.toLowerCase() === 'auto') continue
    const parsed = parseCohortKey(ck, dims)
    for (const value of Object.values(parsed)) {
      if (!value) continue
      const set = observed[value] ?? new Set<string>()
      set.add(trimmed.toLowerCase())
      observed[value] = set
    }
  }
  const out: Record<string, string> = {}
  for (const [value, colors] of Object.entries(observed)) {
    if (colors.size === 1) {
      out[value] = Array.from(colors)[0]
    }
  }
  return out
}

// Builds the same label set DSM Dashboard's Stock Composition chart
// uses: union of every dimension's labels (excluding age dims). Stable
// across Stack-by changes — color assignments don't shuffle when the
// user switches between Fuel / Powertrain / Cohort.
export function buildDSMChartLabels(
  activeSystem: SystemDefinition | null,
  stackKeys: readonly string[],
): Set<string> {
  const set = new Set<string>(stackKeys)
  for (const d of activeSystem?.dimensions ?? []) {
    if (d.is_age) continue
    for (const l of d.labels ?? []) set.add(l)
  }
  return set
}

export function buildStackKeys(
  activeSystem: SystemDefinition | null,
  stackByDimension: string | null,
): string[] {
  if (!activeSystem) return []
  if (!stackByDimension) return ['all']
  const dim = activeSystem.dimensions.find((d) => d.name === stackByDimension)
  return dim?.labels ?? ['all']
}

export interface DSMSystemColors {
  /** Stack keys for the chosen stackByDimension (or `['all']` when null). */
  stackKeys: string[]
  /** Color map keyed on DSM dim values (e.g. ``BEV-LFP`` → ``#14b8a6``). */
  colorMap: Record<string, string>
  /**
   * Color a full cohort key. When ``stackByDimension`` is set, returns
   * the color of the cohort's value for that dimension (so all
   * ``BEV-LFP|*|*`` cohorts share one color when stacked by
   * ``fuel_type``). When ``stackByDimension`` is null (no DSM
   * grouping), falls back to coloring by the cohort key itself —
   * preserving per-cohort distinguishability.
   */
  colorForCohort: (cohortKey: string, fallbackIndex?: number) => string
  /**
   * Project the user's cohort-key list into the dim-value space the
   * legend should render. When ``stackByDimension`` is set, returns
   * the unique stack values present in the data (alphabetical).
   * When null, returns the cohort keys unchanged.
   */
  projectLegendLabels: (cohortKeys: readonly string[]) => string[]
}

/**
 * Hook: build a stable color map for DSM cohort visualisations,
 * aligned to the user's currently-selected Stack-by dimension. Both
 * the DSM Stock Composition chart and the Impact-by-cohort chart
 * consume this so colors agree across them.
 *
 * Patch 4AK: ``rowColorOverrides`` (per-cohort-key) layer in.
 * Resolution by ``stackByDimension`` mode:
 *
 *   - single-dim (stackByDimension non-null): use per-dimension
 *     ``colorMap`` (Patch 4AJ overrides + algorithm). Row overrides
 *     DO NOT apply here — single-dim charts must paint by dim value
 *     so all (BEV-LFP, *) cohorts share one color.
 *
 *   - cohort-key (stackByDimension null): check row override first,
 *     fall back to algorithm modulo. Row overrides ARE the primary
 *     color source in this branch.
 */
export function useDSMSystemColors(
  activeSystem: SystemDefinition | null,
  stackByDimension: string | null,
  options: { rowColorOverrides?: Record<string, string> } = {},
): DSMSystemColors {
  const rowColorOverrides = options.rowColorOverrides ?? {}
  const stackKeys = useMemo(
    () => buildStackKeys(activeSystem, stackByDimension),
    [activeSystem, stackByDimension],
  )

  const chartLabels = useMemo(
    () => buildDSMChartLabels(activeSystem, stackKeys),
    [activeSystem, stackKeys],
  )

  const colorMap = useChartColors(chartLabels)

  return useMemo<DSMSystemColors>(() => {
    const dims = activeSystem?.dimensions ?? []

    const colorForCohort = (cohortKey: string, fallbackIndex = 0): string => {
      if (stackByDimension) {
        // Single-dim stacking: per-dim colors only (Patch 4AK rule).
        // Row overrides DO NOT propagate here — they're for cohort-key
        // stacking, not for grouping a cohort under its dim value.
        const v = groupKeyForDim(cohortKey, dims, stackByDimension)
        return colorFor(colorMap, v, fallbackIndex)
      }
      // Cohort-key stacking: row override wins, then algorithm modulo.
      const row = rowColorOverrides[cohortKey]
      if (row) return row
      return CHART_PALETTE[fallbackIndex % CHART_PALETTE.length]
    }

    const projectLegendLabels = (cohortKeys: readonly string[]): string[] => {
      if (!stackByDimension) return [...cohortKeys]
      const seen = new Set<string>()
      const order: string[] = []
      for (const ck of cohortKeys) {
        const v = groupKeyForDim(ck, dims, stackByDimension)
        if (seen.has(v)) continue
        seen.add(v)
        order.push(v)
      }
      // Alphabetical so legend order matches DSM Stock Composition's
      // (which derives from the dimension's `labels` field, also
      // alphabetical-by-construction in most projects).
      order.sort((a, b) => a.localeCompare(b))
      return order
    }

    return { stackKeys, colorMap, colorForCohort, projectLegendLabels }
    // rowColorOverrides intentionally a stable reference at the call
    // site (zustand selector); listed in deps for correctness.
  }, [activeSystem, stackByDimension, stackKeys, colorMap, rowColorOverrides])
}
