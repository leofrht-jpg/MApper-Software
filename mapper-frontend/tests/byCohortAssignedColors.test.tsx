/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useDSMSystemColors,
  buildCombinedRowColorOverrides,
} from '../src/utils/dsmCohortColors'
import { useProjectStore } from '../src/stores/projectStore'

/**
 * Regression: the "Impact over time, by cohort" chart must honour user-assigned
 * cohort colours from BOTH the primary system (CohortMapping.row_colors) and a
 * dependent subsystem (SubsystemCohortMapping.color).
 *
 * Root cause it locks: `stackByDimension` defaults to the first non-age
 * dimension (dsmStore sets it on every system load), so the chart resolves via
 * the single-dim branch of `colorForCohort` — which previously IGNORED row
 * overrides, dropping every assigned colour to the algorithmic palette. The fix
 * makes an explicit per-cohort override win in BOTH stacking modes.
 *
 * This exercises the EXACT pipeline both DSMImpactPanel (Static) and
 * ProjectedImpactPanel (Prospective) use to build `cohortColorMap`:
 *   combinedRowColors = buildCombinedRowColorOverrides(sysId, cohortRowColors, dependents)
 *   dsmColors        = useDSMSystemColors(system, stackByDimension, { rowColorOverrides: combined })
 *   m[ck]            = dsmColors.colorForCohort(ck, i)
 * The two panels build the map identically, so this covers both.
 */

const SYSTEM_ID = 'e5442abf-fa89-4804'
const FUEL = { name: 'fuel_type', is_age: false, labels: ['BEV-LFP', 'PHEV', 'ICEV-Petrol'] }
const SIZE = { name: 'size', is_age: false, labels: ['Small', 'SUV', 'Large'] }
const SYSTEM: any = {
  id: SYSTEM_ID, name: 'Fleet', dimensions: [FUEL, SIZE],
  time_horizon: { start_year: 2025, end_year: 2050 },
}

// Primary assigned colours (blue family) — persisted as CohortMapping.row_colors,
// mirrored into dsmStore.cohortRowColors. Keyed by BARE cohort key.
const PRIMARY_ROW_COLORS = { 'BEV-LFP|SUV': '#0a1b2c' }
// Dependent subsystem assigned colour (teal family) — SubsystemCohortMapping.color.
const DEPENDENT_SUBSYSTEM = {
  id: 'sub-fuel', type: 'dependent',
  cohort_mappings: { 'CNG Station|Large': { color: '#2c1b0a', archetype_id: 'arc-cng' } },
}

// When a subsystem is present the backend aggregation prefixes EVERY source
// (primary + dependents) as `<sid>::<cohort>` (dsm_lca_engine._prefix_key).
const CHART_KEY_PRIMARY = `${SYSTEM_ID}::BEV-LFP|SUV`     // assigned (blue)
const CHART_KEY_SUBSYSTEM = 'sub-fuel::CNG Station|Large' // assigned (teal)
const CHART_KEY_UNASSIGNED = `${SYSTEM_ID}::PHEV|Small`   // no assigned colour

// Mirror the panels' cohortColorMap construction exactly.
const buildByCohortMap = (
  colorForCohort: (ck: string, i?: number) => string,
  keys: string[],
) => {
  const m: Record<string, string> = {}
  keys.forEach((ck, i) => { m[ck] = colorForCohort(ck, i) })
  return m
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  useProjectStore.setState({ currentProject: 'test-proj' } as any)
})

describe('By-cohort chart honours assigned colours (both panels) — stack-by dimension SET', () => {
  // The default post-load state: stackByDimension = first non-age dim.
  const STACK_BY = 'fuel_type'

  const setup = () => {
    const combined = buildCombinedRowColorOverrides(SYSTEM_ID, PRIMARY_ROW_COLORS, [DEPENDENT_SUBSYSTEM])
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, STACK_BY, { rowColorOverrides: combined }),
    )
    return { combined, colors: result.current }
  }

  it('primary cohort with an assigned colour → chart series uses that exact hex (not a palette fallback)', () => {
    const { colors } = setup()
    const map = buildByCohortMap(colors.colorForCohort, [CHART_KEY_PRIMARY, CHART_KEY_UNASSIGNED])
    expect(map[CHART_KEY_PRIMARY]).toBe('#0a1b2c')
  })

  it('subsystem cohort with an assigned colour → chart series uses that exact hex', () => {
    const { colors } = setup()
    const map = buildByCohortMap(colors.colorForCohort, [CHART_KEY_SUBSYSTEM])
    expect(map[CHART_KEY_SUBSYSTEM]).toBe('#2c1b0a')
  })

  it('a cohort with NO assigned colour is unaffected by the overrides (deterministic per-dim/palette path)', () => {
    // Robust against palette overlap: prove the overrides touch ONLY cohorts
    // that carry an assigned colour. An unassigned cohort resolves to the SAME
    // colour with or without the override map; assigned cohorts do not.
    const combined = buildCombinedRowColorOverrides(SYSTEM_ID, PRIMARY_ROW_COLORS, [DEPENDENT_SUBSYSTEM])
    const withOv = renderHook(() => useDSMSystemColors(SYSTEM, STACK_BY, { rowColorOverrides: combined }))
    const noOv = renderHook(() => useDSMSystemColors(SYSTEM, STACK_BY, { rowColorOverrides: {} }))
    // Unassigned: identical either way (override path never reached).
    expect(withOv.result.current.colorForCohort(CHART_KEY_UNASSIGNED, 1))
      .toBe(noOv.result.current.colorForCohort(CHART_KEY_UNASSIGNED, 1))
    // Assigned: the override changes the result (would otherwise be the palette).
    expect(withOv.result.current.colorForCohort(CHART_KEY_PRIMARY)).toBe('#0a1b2c')
    expect(noOv.result.current.colorForCohort(CHART_KEY_PRIMARY)).not.toBe('#0a1b2c')
  })

  it('BOTH key formats (bare and <system_id>::prefixed) resolve to the same colour for the same primary cohort', () => {
    const { colors, combined } = setup()
    // The combined map deliberately carries both formats (do not de-duplicate).
    expect(combined['BEV-LFP|SUV']).toBe('#0a1b2c')
    expect(combined[`${SYSTEM_ID}::BEV-LFP|SUV`]).toBe('#0a1b2c')
    // Both resolve identically through colorForCohort (no-subsystem runs use the
    // bare key; with-subsystem runs use the prefixed key).
    expect(colors.colorForCohort('BEV-LFP|SUV')).toBe('#0a1b2c')
    expect(colors.colorForCohort(`${SYSTEM_ID}::BEV-LFP|SUV`)).toBe('#0a1b2c')
  })
})

describe('By-cohort chart honours assigned colours — cohort-key stacking (stackByDimension null)', () => {
  it('assigned colours still win; unassigned → deterministic palette', () => {
    const combined = buildCombinedRowColorOverrides(SYSTEM_ID, PRIMARY_ROW_COLORS, [DEPENDENT_SUBSYSTEM])
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, null, { rowColorOverrides: combined }),
    )
    expect(result.current.colorForCohort(CHART_KEY_PRIMARY)).toBe('#0a1b2c')
    expect(result.current.colorForCohort(CHART_KEY_SUBSYSTEM)).toBe('#2c1b0a')
    expect(result.current.colorForCohort(CHART_KEY_UNASSIGNED)).not.toBe('#0a1b2c')
  })
})
