/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  hasVaryingParameters, varyingCases, SensitivityCases,
} from '../src/components/impact/SensitivityCases'
import {
  MultiProductSensitivityChart, rangesFor, rangesOverlap,
} from '../src/components/charts/MultiProductSensitivityChart'

const FMT = {
  settings: { notation: 'fixed' as const, sigFigs: 3, decimals: 4 },
  setSettings: () => {},
  format: (v: number) => String(v),
}
import { tornadoRows, rangeOf } from '../src/components/charts/SensitivityRangeChart'
import type { ParameterTable } from '../src/api/client'

// ── The "nothing to vary" guard keys on overrides, not on case count ───────

const MAP_TEST = {
  // Three cases NAMED, zero parameters carrying an override. Verified by
  // compute: ICEV-Petrol returns 10 257 under Base, Optimistic AND Pessimistic.
  scenarios: ['Optimistic', 'Pessimistic'],
  parameters: {
    d_annual: { name: 'd_annual', base_value: 16425 },
    w_car: { name: 'w_car', base_value: 1486.9 },
  },
} as unknown as ParameterTable

const BATTERY = {
  scenarios: ['sa_dc50_25c', 'sa_high_soc_100', 'sa_early_repurpose_120kkm', 'sa_bess_lifetime_10y'],
  parameters: {
    ev_service_distance_km: {
      name: 'ev_service_distance_km', base_value: 160000,
      scenario_overrides: { sa_early_repurpose_120kkm: 120000 },
    },
    ev_charging_power_kw: {
      name: 'ev_charging_power_kw', base_value: 11,
      scenario_overrides: { sa_dc50_25c: 50 },
    },
    inert_param: { name: 'inert_param', base_value: 1 },
  },
} as unknown as ParameterTable

describe('the nothing-to-vary guard', () => {
  it('is false for a table with cases but no overrides', () => {
    // MAp-test is the proof that case COUNT is the wrong key.
    expect(MAP_TEST.scenarios).toHaveLength(2)
    expect(hasVaryingParameters(MAP_TEST)).toBe(false)
  })

  it('says cases exist but nothing varies, rather than offering checkboxes', () => {
    const { getByTestId, queryByTestId } = render(
      <SensitivityCases table={MAP_TEST} selected={['Base']} onToggle={() => {}} />)
    expect(queryByTestId('sensitivity-cases')).toBeNull()
    const msg = getByTestId('sensitivity-cases-none').textContent ?? ''
    expect(msg).toMatch(/2 cases defined/i)
    expect(msg).toMatch(/no parameter varies between them/i)
  })

  it('distinguishes "none defined" from "defined but inert"', () => {
    const empty = { scenarios: [], parameters: {} } as unknown as ParameterTable
    const { getByTestId } = render(
      <SensitivityCases table={empty} selected={['Base']} onToggle={() => {}} />)
    expect(getByTestId('sensitivity-cases-none').textContent)
      .toMatch(/no sensitivity cases defined/i)
  })

  it('is true when any parameter carries an override, and lists only those cases', () => {
    expect(hasVaryingParameters(BATTERY)).toBe(true)
    expect(varyingCases(BATTERY)).toEqual(['sa_dc50_25c', 'sa_early_repurpose_120kkm'])
  })

  it('renders the checklist with Base locked on', () => {
    const { getByTestId } = render(
      <SensitivityCases table={BATTERY} selected={['Base']} onToggle={() => {}} />)
    const base = getByTestId('sensitivity-cases-option-Base')
      .querySelector('input') as HTMLInputElement
    expect(base.checked).toBe(true)
    expect(base.disabled).toBe(true)     // Base is the reference; unchecking is meaningless
  })
})

// ── The two findings, on the real numbers ─────────────────────────────────

// Battery Circularity, EF v3.1 GWP100, measured.
const REAL = {
  'A - Circular EV': {
    Base: 0.084197, sa_dc50_25c: 0.083859, sa_high_soc_100: 0.084197,
    sa_cold_10c: 0.084197, sa_hot_40c: 0.084197,
    sa_early_repurpose_120kkm: 0.098647, sa_bess_lifetime_10y: 0.084197,
  },
  'A0 - Reference EV': {
    Base: 0.110615, sa_dc50_25c: 0.110277, sa_high_soc_100: 0.110615,
    sa_cold_10c: 0.110615, sa_hot_40c: 0.110615,
    sa_early_repurpose_120kkm: 0.133871, sa_bess_lifetime_10y: 0.110615,
  },
}
const CASES = ['Base', 'sa_dc50_25c', 'sa_high_soc_100', 'sa_cold_10c',
               'sa_hot_40c', 'sa_early_repurpose_120kkm', 'sa_bess_lifetime_10y']

describe('finding 1 — A vs A0 ranges do NOT overlap; the ranking is robust', () => {
  it('A stays below A0 across every selected case', () => {
    const [a, a0] = rangesFor([
      { itemId: 'a', label: 'A - Circular EV', byCase: REAL['A - Circular EV'] },
      { itemId: 'a0', label: 'A0 - Reference EV', byCase: REAL['A0 - Reference EV'] },
    ], CASES)

    expect(a.base).toBeLessThan(a0.base)          // A is lower at Base
    expect(a.hi).toBeCloseTo(0.098647, 6)         // A's worst case
    expect(a0.lo).toBeCloseTo(0.110277, 6)        // A0's best case
    // A's WORST is still better than A0's BEST, so the ordering survives the
    // whole study -- a result about the study, not the rendering.
    expect(a.hi).toBeLessThan(a0.lo)
    expect(rangesOverlap(a, a0)).toBe(false)
  })

  it('and the chart therefore raises no overlap warning', () => {
    const { queryByTestId } = render(
      <MultiProductSensitivityChart
        items={[
          { itemId: 'a', label: 'A - Circular EV', byCase: REAL['A - Circular EV'] },
          { itemId: 'a0', label: 'A0 - Reference EV', byCase: REAL['A0 - Reference EV'] },
        ]}
        cases={CASES} unit="kg CO2-Eq" methodLabel="GWP100"
        format={FMT} filenameBase="t" />)
    expect(queryByTestId('sensitivity-overlap-note')).toBeNull()
  })

  it('warns when ranges DO overlap', () => {
    // Same shape, but A0 pulled down so the ranges cross.
    const overlapping = { ...REAL['A0 - Reference EV'], Base: 0.0975, sa_dc50_25c: 0.0975 }
    const { getByTestId } = render(
      <MultiProductSensitivityChart
        items={[
          { itemId: 'a', label: 'A - Circular EV', byCase: REAL['A - Circular EV'] },
          { itemId: 'a0', label: 'A0 - Reference EV', byCase: overlapping },
        ]}
        cases={CASES} unit="kg CO2-Eq" methodLabel="GWP100"
        format={FMT} filenameBase="t" />)
    expect(getByTestId('sensitivity-overlap-note').textContent)
      .toMatch(/not robust/i)
  })

  it('reports the spread each item actually has', () => {
    const [a, a0] = rangesFor([
      { itemId: 'a', label: 'A', byCase: REAL['A - Circular EV'] },
      { itemId: 'a0', label: 'A0', byCase: REAL['A0 - Reference EV'] },
    ], CASES)
    expect((a.hi / a.base - 1) * 100).toBeCloseTo(17.16, 1)
    expect((a0.hi / a0.base - 1) * 100).toBeCloseTo(21.03, 1)
  })
})

describe('finding 2 — the tornado reads "only early repurpose matters"', () => {
  const base = REAL['A - Circular EV'].Base
  const cases = CASES.filter((c) => c !== 'Base')
    .map((c) => ({ case: c, value: (REAL['A - Circular EV'] as Record<string, number>)[c] }))

  it('draws two bars, not six, and early repurpose dominates by ~40x', () => {
    const { movers, flat } = tornadoRows(cases, base)
    // Two movers, not one: sa_dc50_25c really does move the total by -0.40%,
    // and hiding a real movement to make the headline cleaner would be worse
    // than showing it small. Four cases move nothing and are not drawn.
    expect(movers.map((m) => m.case))
      .toEqual(['sa_early_repurpose_120kkm', 'sa_dc50_25c'])
    expect(movers[0].rel * 100).toBeCloseTo(17.16, 1)
    expect(movers[1].rel * 100).toBeCloseTo(-0.40, 1)
    expect(Math.abs(movers[0].rel / movers[1].rel)).toBeGreaterThan(40)
    expect(flat).toHaveLength(4)
  })

  it('names the flat cases instead of drawing them', () => {
    const { flat } = tornadoRows(cases, base)
    expect(flat).toEqual([
      'sa_high_soc_100', 'sa_cold_10c', 'sa_hot_40c', 'sa_bess_lifetime_10y',
    ])
  })

  it('the range reflects the movers', () => {
    const r = rangeOf(cases, base)
    expect(r.hi).toBeCloseTo(0.098647, 6)
    expect(r.lo).toBeCloseTo(0.083859, 6)
  })
})
