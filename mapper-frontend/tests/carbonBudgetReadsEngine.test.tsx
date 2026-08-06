/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  TimelineView, budgetSeriesFromResults, depletionYearFromSeries,
} from '../src/components/aesa/TimelineView'
import type { CarbonBudgetConfig, SustainabilityRatioResult } from '../src/api/client'
import fixture from './fixtures/carbonBudgetEngineSeries.json'

// The carbon-budget inset used to re-derive the remaining-budget curve in the
// frontend, accumulating INCLUSIVELY (`cum += E[y]; remaining = initial - cum`)
// where the engine's `remaining_budget(year)` sums `range(start_year, year)`,
// EXCLUDING the current year. The chart therefore drew
// `remaining_budget(year + 1)` and annotated depletion one year early.
//
// The fix is to READ `remaining_budget_gt` off the SR rows the page is already
// rendering. This suite is the assertion that would have caught the original
// bug: the chart's depletion year must equal the year the ENGINE's remaining
// budget first hits zero, on a configuration that actually depletes.
//
// The fixture is generated from the backend — `CarbonBudgetConfig.remaining_budget`,
// the same call `AESAEngine` stamps onto each cumulative row — so this is a
// genuine cross-boundary check, not the frontend agreeing with itself.

type Fx = {
  initial_budget_gt: number
  start_year: number
  end_year: number
  rows: Array<{ year: number; remaining_budget_gt: number }>
  engine_depletion_year: number | null
  pre_fix_frontend_depletion_year: number | null
}

const DEPLETING = (fixture as any)['IPCC_AR6_1p5C_50__SSP2-4.5'] as Fx
const SHIPPED_DEFAULT = (fixture as any)['IPCC_AR6_2C_50__SSP1-2.6'] as Fx

function srRows(fx: Fx): SustainabilityRatioResult[] {
  return fx.rows.map((r) => ({
    year: r.year, pb_id: 'climate_change', pb_name: 'Climate change',
    ef_indicator: 'climate change', impact: 1, allocated_sos: 1, sr: 1,
    zone: 'safe', sharing_principle: 'EpC', layer_factors: [1],
    total_sharing_factor: 1, sharing_factor_l1: 1, sharing_factor_l2: 1,
    boundary_type: 'cumulative', confidence: 'high', unit: 'kg CO2 eq',
    impact_by_cohort: {}, method_label: 'EF v3.1 › climate change',
    remaining_budget_gt: r.remaining_budget_gt,
  })) as SustainabilityRatioResult[]
}

// ── the gate ────────────────────────────────────────────────────────────────

describe('the chart depletion year equals the engine\'s', () => {
  it('1.5°C/50 × SSP2-4.5 — depletes, and the two agree', () => {
    expect(DEPLETING.engine_depletion_year).toBe(2033)  // fixture sanity
    const series = budgetSeriesFromResults(srRows(DEPLETING))
    expect(depletionYearFromSeries(series)).toBe(DEPLETING.engine_depletion_year)
  })

  it('is NOT the year the old frontend arithmetic produced', () => {
    // The bug, stated as a number: the discarded copy said 2032, the engine
    // says 2033. If someone reintroduces inclusive accumulation, this fails.
    expect(DEPLETING.pre_fix_frontend_depletion_year).toBe(2032)
    const series = budgetSeriesFromResults(srRows(DEPLETING))
    expect(depletionYearFromSeries(series))
      .not.toBe(DEPLETING.pre_fix_frontend_depletion_year)
  })

  it('the shipped default does not deplete, and neither reports one', () => {
    const series = budgetSeriesFromResults(srRows(SHIPPED_DEFAULT))
    expect(SHIPPED_DEFAULT.engine_depletion_year).toBeNull()
    expect(depletionYearFromSeries(series)).toBeNull()
  })

  it('every plotted point is the engine\'s value, not a re-derivation', () => {
    const series = budgetSeriesFromResults(srRows(DEPLETING))
    expect(series).toHaveLength(DEPLETING.rows.length)
    for (const [i, p] of series.entries()) {
      expect(p.remaining).toBe(DEPLETING.rows[i].remaining_budget_gt)
    }
  })
})

// ── series construction ─────────────────────────────────────────────────────

describe('budgetSeriesFromResults', () => {
  it('ignores flow boundaries, which carry no budget', () => {
    const rows = [
      ...srRows(DEPLETING).slice(0, 3),
      { year: 2025, pb_id: 'land_use', remaining_budget_gt: null } as any,
      { year: 2026, pb_id: 'land_use' } as any,  // field absent entirely
    ]
    const series = budgetSeriesFromResults(rows)
    expect(series).toHaveLength(3)
    expect(series[0].remaining).toBe(DEPLETING.rows[0].remaining_budget_gt)
  })

  it('sorts by year regardless of row order', () => {
    const shuffled = [...srRows(DEPLETING).slice(0, 5)].reverse()
    const years = budgetSeriesFromResults(shuffled).map((p) => p.year)
    expect(years).toEqual([...years].sort((a, b) => a - b))
  })

  it('is empty when no row carries a budget', () => {
    expect(budgetSeriesFromResults([])).toEqual([])
    expect(budgetSeriesFromResults([{ year: 2025, remaining_budget_gt: null } as any])).toEqual([])
  })
})

// ── render behaviour ────────────────────────────────────────────────────────

const BUDGET: CarbonBudgetConfig = {
  initial_budget_gt: DEPLETING.initial_budget_gt,
  start_year: DEPLETING.start_year,
  end_year: DEPLETING.end_year,
  ssp_scenario: 'SSP2-4.5',
  budget_source: 'IPCC AR6 1.5°C 50th',
  projected_emissions: {},
} as any

describe('the inset renders from the engine series', () => {
  it('shows the engine depletion year', () => {
    const { getByTestId } = render(
      <TimelineView results={srRows(DEPLETING)} carbonBudget={BUDGET} />,
    )
    expect(getByTestId('carbon-budget-depletion-year').textContent)
      .toContain(String(DEPLETING.engine_depletion_year))
  })

  it('shows the not-depleted affirmation for the shipped default', () => {
    const { getByTestId, queryByTestId } = render(
      <TimelineView results={srRows(SHIPPED_DEFAULT)} carbonBudget={BUDGET} />,
    )
    expect(queryByTestId('carbon-budget-not-depleted')).not.toBeNull()
    expect(queryByTestId('carbon-budget-depletion-year')).toBeNull()
    expect(getByTestId('carbon-budget-not-depleted').textContent)
      .toContain('not depleted')
  })

  it('draws NOTHING rather than a projection when the engine produced no series', () => {
    // A budget is configured but no cumulative boundary was mapped, so no row
    // carries remaining_budget_gt. Drawing our own curve here is exactly what
    // this patch removes — it would agree with Compute only by coincidence.
    const flowOnly = srRows(DEPLETING).map((r) => ({ ...r, remaining_budget_gt: null }))
    const { queryByTestId, getByTestId } = render(
      <TimelineView results={flowOnly as any} carbonBudget={BUDGET} />,
    )
    expect(queryByTestId('carbon-budget-no-engine-series')).not.toBeNull()
    expect(queryByTestId('carbon-budget-depletion-year')).toBeNull()
    expect(queryByTestId('carbon-budget-not-depleted')).toBeNull()
    expect(getByTestId('carbon-budget-no-engine-series').textContent)
      .toContain('no cumulative boundary')
  })
})
