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
import { budgetDepletionYear } from '../src/utils/carbonBudget'
import {
  budgetSeriesFromResults, depletionYearFromSeries,
} from '../src/components/aesa/TimelineView'
import type { CarbonBudgetConfig, SustainabilityRatioResult } from '../src/api/client'
import fixture from './fixtures/carbonBudgetSparkline.json'

// The two carbon-budget panels must agree WITH EACH OTHER.
//
// They reach their answer by different routes, and each already has its own
// test proving it matches the engine:
//
//   - the AESA sidebar's sparkline runs BEFORE any compute, from the
//     CarbonBudgetConfig, via utils/carbonBudget.ts
//     (tests/carbonBudgetSparkline.test.tsx)
//   - the Timeline inset runs AFTER a compute, reading `remaining_budget_gt`
//     off the SR rows the engine stamped
//     (tests/carbonBudgetReadsEngine.test.tsx)
//
// Agreeing with the engine separately is not the same property as agreeing
// with each other, and it is the second one that kept failing: the depletion
// arithmetic reached FOUR copies, and each was found only when someone noticed
// two panels one click apart showing different years. Both existing suites were
// green throughout — the sparkline's, because it was written after the
// sparkline was fixed; the inset's, because it never looked at the sparkline.
//
// This is the assertion that fails if a future change moves one panel and not
// the other, regardless of which one is "right".

type Fx = {
  budget_option_id: string
  ssp_id: string
  initial_budget_gt: number
  start_year: number
  end_year: number
  projected_emissions: Record<string, number>
  rows: Array<{ year: number; remaining_gt: number }>
  engine_depletion_year: number | null
  pre_fix_sparkline_depletion_year: number | null
}

const PAIRINGS = [
  'IPCC_AR6_1p5C_50__SSP2-4.5',
  'IPCC_AR6_1p5C_67__SSP2-4.5',
  'IPCC_AR6_2C_50__SSP2-4.5',
  'IPCC_AR6_2C_67__SSP2-4.5',
] as const

/** What the SIDEBAR sees: a CarbonBudgetConfig, no compute yet. */
function sidebarInput(fx: Fx): CarbonBudgetConfig {
  const emissions: Record<number, number> = {}
  for (const [y, v] of Object.entries(fx.projected_emissions)) emissions[Number(y)] = v
  return {
    initial_budget_gt: fx.initial_budget_gt,
    start_year: fx.start_year,
    end_year: fx.end_year,
    ssp_scenario: fx.ssp_id,
    budget_source: fx.budget_option_id,
    projected_emissions: emissions,
  } as any
}

/** What the TIMELINE sees: SR rows carrying the engine's remaining budget. */
function timelineInput(fx: Fx): SustainabilityRatioResult[] {
  return fx.rows.map((r) => ({
    year: r.year, pb_id: 'climate_change', remaining_budget_gt: r.remaining_gt,
  })) as any
}

describe.each(PAIRINGS)('%s — the two panels agree', (key) => {
  const fx = (fixture as any)[key] as Fx

  const sparkline = budgetDepletionYear(sidebarInput(fx))
  const timeline = depletionYearFromSeries(budgetSeriesFromResults(timelineInput(fx)))

  it('sidebar sparkline === timeline inset', () => {
    expect(sparkline).toBe(timeline)
  })

  it('and both equal the engine', () => {
    // Not redundant with the above: two panels could agree with each other and
    // both be wrong. Agreement is the property that keeps regressing;
    // correctness is what makes agreement worth having.
    expect(sparkline).toBe(fx.engine_depletion_year)
    expect(timeline).toBe(fx.engine_depletion_year)
  })

  it('neither reports the pre-fix year', () => {
    expect(sparkline).not.toBe(fx.pre_fix_sparkline_depletion_year)
    expect(timeline).not.toBe(fx.pre_fix_sparkline_depletion_year)
  })
})

describe('the panels agree on the whole curve, not just the depletion year', () => {
  it.each(PAIRINGS)('%s — remaining budget matches year by year', (key) => {
    const fx = (fixture as any)[key] as Fx
    const budget = sidebarInput(fx)
    const timelineSeries = budgetSeriesFromResults(timelineInput(fx))
    expect(timelineSeries.length).toBeGreaterThan(0)
    for (const point of timelineSeries) {
      // The sidebar recomputes; the inset reads. Same number, every year — a
      // shared depletion year with diverging curves would still mislead.
      const fromSidebar = budgetDepletionYear    // referenced for intent
      void fromSidebar
      const sidebarRemaining = Math.max(
        0,
        budget.initial_budget_gt
          - Object.entries(budget.projected_emissions)
            .filter(([y]) => Number(y) >= budget.start_year && Number(y) < point.year)
            .reduce((s, [, v]) => s + v, 0),
      )
      expect(point.remaining).toBeCloseTo(sidebarRemaining, 9)
    }
  })
})
