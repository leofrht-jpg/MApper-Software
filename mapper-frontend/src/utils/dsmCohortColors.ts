/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo } from 'react'
import type { DimensionDef, SystemDefinition } from '../api/client'
import {
  CHART_PALETTE,
  clearLabelColor,
  colorFor,
  getStoredLabelColor,
  setLabelColor,
  useChartColors,
} from './chartColors'

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

// Patch — per-dim upload-derivation reconciliation (cross-chart color sync).
//
// The cohort-mapping upload derives per-dimension colors from the file's row
// colors (deriveDimColorsFromRowColors) and writes them via setLabelColor so
// single-dim STACKED charts (e.g. DSM Stock Composition stacked by Fuel) paint
// each fuel band with the uploaded color. The bug: the old code only ADDED
// derived colors; it never CLEARED a per-dim color that a PREVIOUS upload set
// but a NEW upload no longer derives (e.g. a fuel that became color-ambiguous,
// or whose color was removed). The stale per-dim color survived in localStorage,
// so the stacked chart kept showing the OLD color while the table (per-row
// colors) updated — the reported table/chart divergence.
//
// Reconciliation: track each upload's derived (label → color) map; on the next
// upload, clear any previously-derived label that the new upload doesn't
// re-derive — but ONLY if its stored color is still the one this module wrote
// (so a manual picker override made in between is preserved). Then apply the new
// derived colors and record the new map.
const UPLOAD_DERIVED_PREFIX = 'mapper-upload-derived-dims'

function uploadDerivedKey(scope: string | null | undefined): string {
  return `${UPLOAD_DERIVED_PREFIX}-${scope || '_global'}`
}

function readUploadDerived(scope: string | null | undefined): Record<string, string> {
  try {
    const raw = localStorage.getItem(uploadDerivedKey(scope))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeUploadDerived(scope: string | null | undefined, map: Record<string, string>): void {
  try {
    localStorage.setItem(uploadDerivedKey(scope), JSON.stringify(map))
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

/**
 * Apply a fresh per-dim derivation from a cohort-mapping upload, reconciling it
 * against the previous upload's derivation so no STALE per-dim color survives.
 *
 * - Labels the previous upload derived but this one does not are CLEARED back to
 *   the algorithm (not left on the old color) — unless their stored color was
 *   changed since (a manual picker override), which is preserved.
 * - Labels in the new derivation are applied via setLabelColor.
 *
 * Returns the number of per-dim colors applied. Call this from the upload
 * boundary INSTEAD of looping setLabelColor directly.
 */
export function reconcileUploadDerivedDimColors(
  derived: Record<string, string>,
  scope: string | null | undefined,
): number {
  const prev = readUploadDerived(scope)
  for (const [label, prevColor] of Object.entries(prev)) {
    if (label in derived) continue
    // Only clear if our previously-written color is still in place; a manual
    // pick made since (different color) must survive.
    if (getStoredLabelColor(label, scope) === prevColor) {
      clearLabelColor(label, scope)
    }
  }
  for (const [label, color] of Object.entries(derived)) {
    setLabelColor(label, color, scope)
  }
  writeUploadDerived(scope, { ...derived })
  return Object.keys(derived).length
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

/**
 * Combined per-cohort-key color overrides for Impact Assessment charts, where
 * cohort keys are subsystem-prefixed (`<id>::<cohort>`) when a subsystem is
 * linked (see `dsm_lca_engine.aggregate_subsystem_results`).
 *
 * Emits each color under BOTH the bare cohort key AND the id-prefixed key so a
 * chart resolves the same color whether it holds `BEV-LFP|Small` (no subsystem)
 * or `<system_id>::BEV-LFP|Small` (subsystem present). Subsystem cohort colors
 * (from `SubsystemCohortMapping.color`) are keyed by `<sub_id>::<cohort>`.
 * dsmCohortColors.ts stays the single source of truth for cohort coloring.
 */
export function buildCombinedRowColorOverrides(
  systemId: string | null | undefined,
  primaryRowColors: Record<string, string>,
  subsystems: ReadonlyArray<{
    id: string
    cohort_mappings?: Record<string, { color?: string | null }> | null
  }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [ck, hex] of Object.entries(primaryRowColors ?? {})) {
    if (!hex) continue
    out[ck] = hex
    if (systemId) out[`${systemId}::${ck}`] = hex
  }
  for (const sub of subsystems ?? []) {
    for (const [ck, m] of Object.entries(sub.cohort_mappings ?? {})) {
      if (m?.color) out[`${sub.id}::${ck}`] = m.color
    }
  }
  return out
}

/**
 * Combined cohort→archetype mapping counts for a subsystem list — the total
 * cohort space and how many are mapped. Mirrors `SubsystemMappingCard`'s
 * `dependentArchetypes` (cartesian cohort space ∪ rule targets ∪ saved mapping
 * keys) so the Impact Assessment summary count matches the DSM editor exactly.
 */
export function subsystemMappingCounts(
  subsystems: ReadonlyArray<{
    type?: string
    dimensions?: DimensionDef[] | null
    dependency_rules?: ReadonlyArray<{ dependent_archetype_id?: string }> | null
    cohort_mappings?: Record<string, { archetype_id?: string }> | null
  }>,
): { total: number; mapped: number } {
  let total = 0
  let mapped = 0
  for (const sub of subsystems ?? []) {
    // The store's subsystem list includes a synthesized PRIMARY entry; never
    // count it here (the caller counts primary cohorts separately) — otherwise
    // the primary's cohorts are double-counted in the denominator.
    if (sub.type === 'primary') continue
    const ids = new Set<string>()
    const nads = (sub.dimensions ?? []).filter((d) => !d.is_age)
    if (nads.length > 0) {
      let acc: string[][] = [[]]
      for (const d of nads) {
        const next: string[][] = []
        for (const row of acc) for (const l of d.labels ?? []) next.push([...row, l])
        acc = next
      }
      for (const parts of acc) ids.add(parts.join(COHORT_SEP))
    }
    for (const r of sub.dependency_rules ?? []) {
      if (r.dependent_archetype_id) ids.add(r.dependent_archetype_id)
    }
    for (const k of Object.keys(sub.cohort_mappings ?? {})) ids.add(k)
    total += ids.size
    mapped += [...ids].filter((a) => !!sub.cohort_mappings?.[a]?.archetype_id).length
  }
  return { total, mapped }
}

/**
 * Human-readable label for an Impact Assessment cohort key, which may be
 * subsystem-prefixed (`<id>::<cohort>`). The UUID prefix is ALWAYS stripped —
 * it must never reach the user. Returns the readable cohort (pipe→space) plus,
 * when resolvable, the mapped BOM-archetype name.
 *
 *   `<system_id>::BEV-LFP|SUV`  →  { label: 'BEV-LFP SUV', archetype: 'BEV-LFP SUV' }
 *   `<sub_id>::CNG Station|Default` → { label: 'CNG Station Default',
 *                                        archetype: 'Charging Infrastructure' }
 *   unmapped / unknown id → { label: '<cohort suffix>', archetype: null }
 */
export function cohortDisplayLabel(
  cohortKey: string,
  opts: {
    systemId?: string | null
    primaryMappings?: Record<string, { archetype_id?: string }> | null
    subsystems?: ReadonlyArray<{
      id: string
      cohort_mappings?: Record<string, { archetype_id?: string }> | null
    }>
    archetypeName?: (id: string) => string | undefined
  } = {},
): { label: string; archetype: string | null } {
  const { systemId, primaryMappings = {}, subsystems = [], archetypeName } = opts
  let id: string | null = null
  let rest = cohortKey
  const idx = cohortKey.indexOf('::')
  if (idx >= 0) {
    id = cohortKey.slice(0, idx)
    rest = cohortKey.slice(idx + 2)
  }
  const label = rest.split(COHORT_SEP).join(' ').trim() || rest

  let arcId: string | undefined
  if (id && subsystems.some((s) => s.id === id)) {
    arcId = subsystems.find((s) => s.id === id)?.cohort_mappings?.[rest]?.archetype_id
  } else if (!id || (systemId && id === systemId)) {
    arcId = (primaryMappings ?? {})[rest]?.archetype_id
  }
  const name = arcId && archetypeName ? archetypeName(arcId) : undefined
  return { label, archetype: name && name !== label ? name : null }
}

/**
 * Human-readable label for an Impact Assessment MATERIAL key, which may be
 * subsystem-prefixed (`<id>::<material name>`). Like cohort keys, the prefix is
 * the SUBSYSTEM/SYSTEM id added by `dsm_lca_engine.aggregate_subsystem_results`
 * (`_prefix_key`) when a subsystem is linked — NOT an archetype id. The UUID
 * prefix is ALWAYS stripped; it must never reach the user.
 *
 * Bars are per-(subsystem, material): the same material name can appear under
 * the primary system AND a dependent subsystem, so a bare strip would produce
 * two identical labels for different values. To disambiguate, a DEPENDENT
 * subsystem's materials are suffixed with the subsystem NAME; the primary
 * system's materials (and any unresolvable id) show the material name alone.
 *
 *   `<system_id>::Steel frame`        → `Steel frame`            (primary)
 *   `<sub_id>::Nozzle`                → `Nozzle · Fueling`       (dependent)
 *   `Steel frame` (no prefix, no subsystems) → `Steel frame`
 *   `<unknown_id>::Widget`            → `Widget`                 (never the UUID)
 */
export function materialDisplayLabel(
  materialKey: string,
  opts: {
    systemId?: string | null
    subsystems?: ReadonlyArray<{ id: string; name?: string | null }>
  } = {},
): { label: string; subsystem: string | null } {
  const { systemId, subsystems = [] } = opts
  const idx = materialKey.indexOf('::')
  if (idx < 0) return { label: materialKey, subsystem: null }
  const id = materialKey.slice(0, idx)
  const material = materialKey.slice(idx + 2)
  // Primary system prefix → material alone (no disambiguating suffix needed).
  if (systemId && id === systemId) return { label: material, subsystem: null }
  // Dependent subsystem → suffix with its name to keep bars distinct.
  const sub = subsystems.find((s) => s.id === id)
  if (sub && sub.name) return { label: material, subsystem: sub.name }
  // Unknown id (not primary, not a known subsystem) → material alone; the raw
  // UUID is never surfaced.
  return { label: material, subsystem: null }
}

/** Flatten `materialDisplayLabel` to a single display string (`material · sub`). */
export function materialDisplayString(
  materialKey: string,
  opts: {
    systemId?: string | null
    subsystems?: ReadonlyArray<{ id: string; name?: string | null }>
  } = {},
): string {
  const { label, subsystem } = materialDisplayLabel(materialKey, opts)
  return subsystem ? `${label} · ${subsystem}` : label
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
      // An EXPLICIT per-cohort override always wins — in BOTH cohort-key AND
      // single-dim stacking. `colorForCohort` is only ever called with full
      // cohort keys by "by-cohort" charts (Impact-over-time, ExpandedCohortChart,
      // multi-scenario facets), where each series is exactly one cohort — so a
      // per-cohort color is well-defined regardless of the Stack-by grouping.
      // The user's assigned colors (primary CohortMapping.row_colors +
      // subsystem cohort colors, both threaded in via `rowColorOverrides`) must
      // surface here; suppressing them in single-dim mode was the "chart shows
      // the default palette, not my assigned colors" bug. NOTE: this does NOT
      // affect DSM Stock Composition — that chart reads `colorMap` directly (one
      // color per merged dim band) and never calls `colorForCohort`.
      const row = rowColorOverrides[cohortKey]
      if (row) return row
      if (stackByDimension) {
        // Single-dim stacking, no per-cohort override: group under the dim
        // value so same-dim cohorts share a color (matches DSM Stock
        // Composition — Patch 4N/5AG cross-chart consistency).
        const v = groupKeyForDim(cohortKey, dims, stackByDimension)
        return colorFor(colorMap, v, fallbackIndex)
      }
      // Cohort-key stacking, no override: deterministic palette (modulo).
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
