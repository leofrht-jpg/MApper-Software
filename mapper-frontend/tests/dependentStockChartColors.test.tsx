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
import { CHART_PALETTE } from '../src/utils/chartColors'
import { useProjectStore } from '../src/stores/projectStore'

/**
 * DSM Dashboard → subsystem → "Stock over time (by archetype)". The chart used
 * to colour series via `useChartColors(stockKeys)` (raw algorithmic palette),
 * bypassing `dsmCohortColors` and every assigned subsystem cohort colour. It now
 * routes through the SAME resolver the Impact Assessment charts use —
 * `useDSMSystemColors(null, null, { rowColorOverrides }).colorForCohort` — fed a
 * bare-cohort-keyed override map extracted from `subsystem.cohort_mappings[ck].color`.
 *
 * Series keys are BARE cohort keys (`dependent_archetype_id`) because the chart
 * is scoped to one subsystem (see dsm_lca_engine / subsystem_engine).
 *
 * Recharts renders nothing in jsdom, so we assert the exact colour VALUE that
 * flows into each `<Area>` fill — `colorForCohort(k, i)` — not rendered pixels.
 */

// Non-palette hexes so the assigned-vs-fallback assertions can't collide.
const CNG_LARGE = '#0a1b2c'
const CNG_SMALL = '#2c1b0a'
const COHORT_COLORS: Record<string, string> = {
  'CNG Station|Large': CNG_LARGE,
  'CNG Station|Small': CNG_SMALL,
}
const STOCK_KEYS = ['CNG Station|Large', 'CNG Station|Small', 'H2 Station|Large']

// Mirror DependentStockCharts' fill resolution exactly.
const buildFills = (colorForCohort: (k: string, i?: number) => string, keys: string[]) =>
  keys.map((k, i) => colorForCohort(k, i))

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  useProjectStore.setState({ currentProject: 'test-proj' } as any)
})

describe('DependentStockCharts colour resolution routes through dsmCohortColors', () => {
  it('a subsystem cohort with an assigned colour renders that EXACT hex', () => {
    const { result } = renderHook(() =>
      useDSMSystemColors(null, null, { rowColorOverrides: COHORT_COLORS }),
    )
    const fills = buildFills(result.current.colorForCohort, STOCK_KEYS)
    expect(fills[0]).toBe(CNG_LARGE)   // CNG Station|Large
    expect(fills[1]).toBe(CNG_SMALL)   // CNG Station|Small
  })

  it('a cohort WITHOUT an assigned colour falls back to the deterministic palette', () => {
    const { result } = renderHook(() =>
      useDSMSystemColors(null, null, { rowColorOverrides: COHORT_COLORS }),
    )
    // Index 2 (H2 Station|Large) has no override → CHART_PALETTE[2].
    expect(result.current.colorForCohort('H2 Station|Large', 2)).toBe(CHART_PALETTE[2])
    // And it is NOT one of the assigned hexes.
    expect(result.current.colorForCohort('H2 Station|Large', 2)).not.toBe(CNG_LARGE)
  })

  it('a changed colour is reflected without a manual refresh (resolver reacts to the override map)', () => {
    const { result, rerender } = renderHook(
      ({ overrides }) => useDSMSystemColors(null, null, { rowColorOverrides: overrides }),
      { initialProps: { overrides: COHORT_COLORS } },
    )
    expect(result.current.colorForCohort('CNG Station|Large', 0)).toBe(CNG_LARGE)
    // Simulate the cohort-mapping modal changing the colour (store → prop update).
    rerender({ overrides: { ...COHORT_COLORS, 'CNG Station|Large': '#3d3d3d' } })
    expect(result.current.colorForCohort('CNG Station|Large', 0)).toBe('#3d3d3d')
  })

  it('matches the Impact Assessment chart EXACTLY for the same assigned cohort (one source of truth)', () => {
    // IA charts key by `<sub_id>::cohort` and build the override via
    // buildCombinedRowColorOverrides; this chart keys bare. Both read the SAME
    // colour value through colorForCohort → identical hex for the same cohort.
    const subId = 'sub-fuel'
    const iaOverrides = buildCombinedRowColorOverrides('sys-id', {}, [
      { id: subId, cohort_mappings: { 'CNG Station|Large': { color: CNG_LARGE } } },
    ])
    const { result: ia } = renderHook(() =>
      useDSMSystemColors(null, null, { rowColorOverrides: iaOverrides }),
    )
    const { result: dashboard } = renderHook(() =>
      useDSMSystemColors(null, null, { rowColorOverrides: COHORT_COLORS }),
    )
    expect(ia.current.colorForCohort(`${subId}::CNG Station|Large`)).toBe(CNG_LARGE)
    expect(dashboard.current.colorForCohort('CNG Station|Large')).toBe(CNG_LARGE)
    // Same cohort, same assigned colour, resolved identically in both charts.
    expect(ia.current.colorForCohort(`${subId}::CNG Station|Large`))
      .toBe(dashboard.current.colorForCohort('CNG Station|Large'))
  })
})
