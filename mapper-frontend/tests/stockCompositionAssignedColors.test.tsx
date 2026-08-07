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
import { useDSMSystemColors } from '../src/utils/dsmCohortColors'
import { CHART_PALETTE, setLabelColor } from '../src/utils/chartColors'
import { useProjectStore } from '../src/stores/projectStore'
import type { SystemDefinition } from '../src/api/client'

// DSM Stock Composition stacked by fuel rendered the algorithmic palette
// instead of the colors assigned in the cohort-mapping table.
//
// The component was examined twice and excluded both times, on the grounds that
// it reads `colorMap` for merged dim bands and never calls `colorForCohort`.
// That observation was correct; the inference from it was not. A band IS one
// color per dim value — but when every cohort under a dim value carries the
// same assigned color, that band's color is unambiguously determined, and
// `deriveDimColorsFromRowColors` already computes exactly that. It was only
// wired at the Excel upload boundary, so colors assigned through the in-app
// picker never reached the chart.
//
// The hook now applies that derivation read-only, per render. Precedence:
// explicit per-dim color > color derived from unambiguous per-cohort
// assignments > deterministic algorithm.

const SYSTEM: SystemDefinition = {
  id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
  dimensions: [
    { name: 'fuel', labels: ['BEV', 'HEV', 'ICEV', 'PHEV'], is_age: false },
    { name: 'size', labels: ['Small', 'Medium', 'Large'], is_age: false },
  ],
  time_horizon: { start_year: 2025, end_year: 2050 },
} as any

// The shape the cohort-mapping table produces: one color per fuel, identical
// across all three size rows. That consistency is what makes each band's color
// unambiguous.
const BEV = '#1d4ed8', HEV = '#15803d', ICEV = '#c2410c', PHEV = '#7e22ce'
const ASSIGNED: Record<string, string> = {}
for (const size of ['Small', 'Medium', 'Large']) {
  ASSIGNED[`BEV|${size}`] = BEV
  ASSIGNED[`HEV|${size}`] = HEV
  ASSIGNED[`ICEV|${size}`] = ICEV
  ASSIGNED[`PHEV|${size}`] = PHEV
}

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* noop */ }
  useProjectStore.setState({ currentProject: 'test-project' } as any)
})

// ── the reported case ───────────────────────────────────────────────────────

describe('assigned cohort colors reach the stock-composition color map', () => {
  it('stacked by fuel, each band gets its assigned color', () => {
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: ASSIGNED }),
    )
    expect(result.current.colorMap.BEV).toBe(BEV)
    expect(result.current.colorMap.HEV).toBe(HEV)
    expect(result.current.colorMap.ICEV).toBe(ICEV)
    expect(result.current.colorMap.PHEV).toBe(PHEV)
  })

  it('the bands differ from what the algorithm alone would have painted', () => {
    // The symptom was the algorithmic cycling showing instead of the families.
    // Asserting "not in CHART_PALETTE" would be weak — the palette holds 40
    // colors and a plausible blue is among them. Compare against the same hook
    // with no assignments instead: that IS the algorithmic answer.
    const { result: algo } = renderHook(() => useDSMSystemColors(SYSTEM, 'fuel', {}))
    const { result: assigned } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: ASSIGNED }),
    )
    for (const fuel of ['BEV', 'HEV', 'ICEV', 'PHEV']) {
      expect(assigned.current.colorMap[fuel]).not.toBe(algo.current.colorMap[fuel])
    }
  })

  it('a PARTIALLY assigned fuel keeps the deterministic palette', () => {
    // One size row colored out of three does not mean "the whole family is
    // that color" — it means one row is. The band derives only when every
    // cohort under it is assigned and they agree.
    const partial = { ...ASSIGNED }
    delete partial['HEV|Large']
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: partial }),
    )
    expect(CHART_PALETTE).toContain(result.current.colorMap.HEV)
    expect(result.current.colorMap.BEV).toBe(BEV)   // fully assigned, unaffected
  })

  it('a fuel with no assignment at all keeps the deterministic palette', () => {
    const partial = { ...ASSIGNED }
    for (const size of ['Small', 'Medium', 'Large']) delete partial[`PHEV|${size}`]
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: partial }),
    )
    expect(result.current.colorMap.BEV).toBe(BEV)
    expect(CHART_PALETTE).toContain(result.current.colorMap.PHEV)
  })

  it('an AMBIGUOUS fuel keeps the deterministic palette', () => {
    // Differing colors within one fuel make the band's color undefined — the
    // resolver correctly declines to guess. This is why per-fuel consistency
    // in the mapping table is load-bearing, not merely tidy.
    const ambiguous = { ...ASSIGNED, 'BEV|Large': '#000000' }
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: ambiguous }),
    )
    expect(CHART_PALETTE).toContain(result.current.colorMap.BEV)
    expect(result.current.colorMap.HEV).toBe(HEV)   // unaffected
  })

  it('no assignments at all leaves the map untouched', () => {
    const { result } = renderHook(() => useDSMSystemColors(SYSTEM, 'fuel', {}))
    for (const fuel of ['BEV', 'HEV', 'ICEV', 'PHEV']) {
      expect(CHART_PALETTE).toContain(result.current.colorMap[fuel])
    }
  })
})

// ── precedence ──────────────────────────────────────────────────────────────

describe('explicit beats inferred', () => {
  it('an explicit per-dim color wins over one derived from row assignments', () => {
    // The picker's "All {label}" mode is a statement about the dim value
    // itself; derivation is an inference from the rows.
    setLabelColor('BEV', '#ff00ff', 'test-project')
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: ASSIGNED }),
    )
    expect(result.current.colorMap.BEV).toBe('#ff00ff')
    expect(result.current.colorMap.HEV).toBe(HEV)   // still derived
  })
})

// ── cross-surface agreement — the property that keeps failing ───────────────

describe('the same cohort is the same color everywhere', () => {
  it('stock composition (colorMap) and impact charts (colorForCohort) agree', () => {
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: ASSIGNED }),
    )
    const { colorMap, colorForCohort } = result.current
    // Impact charts resolve a full cohort key; the DSM chart resolves the band.
    // Both must land on the assigned family color.
    for (const [fuel, hex] of [['BEV', BEV], ['HEV', HEV], ['ICEV', ICEV], ['PHEV', PHEV]] as const) {
      expect(colorMap[fuel]).toBe(hex)
      for (const size of ['Small', 'Medium', 'Large']) {
        expect(colorForCohort(`${fuel}|${size}`, 3)).toBe(hex)
      }
    }
  })

  it('agrees for an unassigned family too — both fall back the same way', () => {
    const partial = { ...ASSIGNED }
    for (const size of ['Small', 'Medium', 'Large']) delete partial[`PHEV|${size}`]
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: partial }),
    )
    const { colorMap, colorForCohort } = result.current
    // No assignment → the band's algorithmic color, and every cohort under it
    // resolves to that same color rather than to a per-cohort palette slot.
    expect(colorForCohort('PHEV|Small', 0)).toBe(colorMap.PHEV)
    expect(colorForCohort('PHEV|Large', 7)).toBe(colorMap.PHEV)
  })

  it('a per-cohort color still wins for that one cohort in impact charts', () => {
    // The 4AK behaviour must survive: an explicit per-cohort assignment beats
    // dim grouping in `colorForCohort`, even though the band shows the family
    // color. Only ambiguity suppresses the band color, and this fixture is
    // deliberately ambiguous for BEV.
    const mixed = { ...ASSIGNED, 'BEV|Large': '#000000' }
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel', { rowColorOverrides: mixed }),
    )
    expect(result.current.colorForCohort('BEV|Large', 0)).toBe('#000000')
    expect(result.current.colorForCohort('BEV|Small', 0)).toBe(BEV)
  })
})

// ── no stacking dimension ───────────────────────────────────────────────────

describe('cohort-key stacking is unchanged', () => {
  it('per-cohort assignments still win, and the band map is irrelevant', () => {
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, null, { rowColorOverrides: ASSIGNED }),
    )
    expect(result.current.colorForCohort('BEV|Small', 0)).toBe(BEV)
    expect(result.current.colorForCohort('unmapped|Cohort', 2))
      .toBe(CHART_PALETTE[2 % CHART_PALETTE.length])
  })
})
