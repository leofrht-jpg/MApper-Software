/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TimelineView } from '../src/components/aesa/TimelineView'
import type { CarbonBudgetConfig, SustainabilityRatioResult } from '../src/api/client'

// Patch X2 — "Not depleted within horizon" affirmative annotation.
//
// Before Patch X2, the chart's depletion annotation simply didn't
// render when the budget never crossed the cap — which read as a
// rendering bug when running SSP1-1.9 × 2°C/50% (the budget grows
// throughout the horizon because late-century net-negative emissions
// replenish it). Patch X2 surfaces the methodological reality
// affirmatively.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

// Minimal SR result fixture — TimelineView early-returns "No results"
// with an empty results array, which would skip the CarbonBudgetInset
// render entirely. One result is enough to clear the gate.
const MIN_RESULTS: SustainabilityRatioResult[] = [{
  year: 2030, pb_id: 'climate_change', pb_name: 'climate change',
  ef_indicator: 'climate change', impact: 1.0, allocated_sos: 1.0,
  sr: 1.0, zone: 'safe', sharing_principle: null,
  layer_factors: [], total_sharing_factor: 0,
  sharing_factor_l1: 0, sharing_factor_l2: 1,
  boundary_type: 'cumulative', confidence: 'high',
  unit: 'kg CO2-eq', impact_by_cohort: {}, method_label: '',
}]

// Helper: build a CarbonBudgetConfig with synthetic emissions.
function buildBudget(
  initial: number,
  emissionsByYear: Record<number, number>,
  ssp = 'SSP1-1.9',
): CarbonBudgetConfig {
  return {
    initial_budget_gt: initial,
    budget_source: 'IPCC AR6 — 1.5°C, 50th percentile',
    start_year: 2025,
    end_year: 2100,
    projected_emissions: emissionsByYear,
    ssp_scenario: ssp,
    provisional: true,
  }
}

describe('Patch X2 — Carbon Budget Depletion annotation', () => {
  it('renders "depleted ~YYYY" when cumulative crosses the budget', () => {
    // 100 Gt budget; 25 Gt/yr emissions → depletes at year 2029
    // (cumulative 2025-2028 = 100 first satisfies >= 100).
    const emissions: Record<number, number> = {}
    for (let y = 2025; y <= 2100; y++) emissions[y] = 25
    const budget = buildBudget(100, emissions)
    const { container } = render(
      <TimelineView results={MIN_RESULTS} carbonBudget={budget} />,
    )
    const depleted = container.querySelector(
      '[data-testid="carbon-budget-depletion-year"]',
    )
    expect(depleted).not.toBeNull()
    expect(depleted?.textContent).toContain('depleted ~')
    const notDepleted = container.querySelector(
      '[data-testid="carbon-budget-not-depleted"]',
    )
    expect(notDepleted).toBeNull()
  })

  it('renders "not depleted within horizon" when cumulative never crosses the budget', () => {
    // 1150 Gt budget; SSP1-1.9-like trajectory peaking ~380 Gt
    // cumulative then declining due to net negatives. Mimicked
    // briefly: positive for 30 years, then negative.
    const emissions: Record<number, number> = {}
    for (let y = 2025; y <= 2054; y++) emissions[y] = 12 // 30 yrs × 12 = 360
    for (let y = 2055; y <= 2100; y++) emissions[y] = -5 // 46 yrs × -5 = -230
    // Cumulative peak ~360, end-of-horizon ~130. Never crosses 1150.
    const budget = buildBudget(1150, emissions)
    const { container } = render(
      <TimelineView results={MIN_RESULTS} carbonBudget={budget} />,
    )
    const notDepleted = container.querySelector(
      '[data-testid="carbon-budget-not-depleted"]',
    )
    expect(notDepleted).not.toBeNull()
    expect(notDepleted?.textContent).toContain('not depleted within horizon')
    const depleted = container.querySelector(
      '[data-testid="carbon-budget-depletion-year"]',
    )
    expect(depleted).toBeNull()
  })

  it('"depleted ~YYYY" pins on the FIRST crossing even if budget later replenishes', () => {
    // 100 Gt budget; positive for 5 years (25 Gt/yr → cum=125 at year
    // 2029), then strongly negative (-30 Gt/yr) — formula's
    // max(0, ...) allows the budget to re-grow after replenishment.
    // The annotation should still report the FIRST depletion year.
    const emissions: Record<number, number> = {}
    for (let y = 2025; y <= 2029; y++) emissions[y] = 25
    for (let y = 2030; y <= 2100; y++) emissions[y] = -30
    const budget = buildBudget(100, emissions)
    const { container } = render(
      <TimelineView results={MIN_RESULTS} carbonBudget={budget} />,
    )
    const depleted = container.querySelector(
      '[data-testid="carbon-budget-depletion-year"]',
    )
    expect(depleted).not.toBeNull()
    // The "not depleted" affirmation must NOT show — overshoot
    // happened, replenishment doesn't erase that.
    const notDepleted = container.querySelector(
      '[data-testid="carbon-budget-not-depleted"]',
    )
    expect(notDepleted).toBeNull()
  })
})
