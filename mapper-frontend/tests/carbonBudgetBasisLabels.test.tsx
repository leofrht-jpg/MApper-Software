/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * B2 — a budget magnitude on screen is labelled in the basis it is in.
 *
 * `initial_budget_gt` is ALWAYS the pre-basis CO₂ scalar; the CO₂-eq basis is
 * applied at compute. The sidebar sparkline printed the stored number verbatim,
 * so a CO₂-eq config captioned "vs 1150 Gt" — a CO₂ magnitude presented as the
 * budget. Same root cause as the workbook's "Initial budget (Gt CO2) = 1150"
 * beside "Remaining Budget (Gt CO2e) = 1707.2".
 *
 * The timeline inset had the same defect PLUS an arithmetic one: it computed
 * `totalAllocated = initial_budget_gt − last engine remaining`, subtracting a
 * CO₂-eq remaining from a CO₂ initial.
 *
 * The contract these tests hold:
 *   1. under CO₂-eq, no rendered budget magnitude carries a CO₂-only unit;
 *   2. the magnitude shown is the CONVERTED one;
 *   3. the depletion year is INVARIANT under the basis — one factor scales the
 *      budget and the pathway alike, so only the magnitude moves (README "A2");
 *   4. the CO₂ path renders exactly as before.
 */
import { describe, it, expect } from 'vitest'
import type { CarbonBudgetConfig } from '../src/api/client'
import {
  budgetDepletionYear, budgetUnitLabel, co2eRatio, formatBudgetGt,
  remainingBudgetSeries, withBasisApplied,
} from '../src/utils/carbonBudget'

const F = 1.4845521739130436   // the wired 2 °C/50 factor

function budget(basis: 'CO2' | 'CO2e_GHG'): CarbonBudgetConfig {
  const projected_emissions: Record<number, number> = {}
  for (let y = 2025; y <= 2100; y++) projected_emissions[y] = 40
  return {
    initial_budget_gt: 1150, budget_source: 'IPCC AR6 WG1 Table SPM.2',
    start_year: 2025, end_year: 2100, projected_emissions,
    ssp_scenario: 'SSP1-2.6', provisional: true, budget_basis: basis,
    co2e_conversion: { kind: 'ratio', factor: F, source: 'AR6 C3+C4 analog' },
  }
}

/** "Gt CO₂" but not "Gt CO₂-eq" — the ASCII and the typographic subscript. */
const CO2_ONLY = /Gt\s*CO(?:₂|2)(?!\s*(?:-eq|e\b))/i

describe('budget captions follow the basis', () => {
  it('CO₂ basis is inert: unchanged object, CO₂ label', () => {
    const b = budget('CO2')
    expect(co2eRatio(b)).toBeNull()
    expect(withBasisApplied(b)).toBe(b)          // identity, not a copy
    expect(budgetUnitLabel(b)).toBe('Gt CO₂')
    expect(formatBudgetGt(withBasisApplied(b).initial_budget_gt)).toBe('1150')
  })

  it('CO₂-eq basis converts the magnitude and labels it CO₂-eq', () => {
    const b = budget('CO2e_GHG')
    expect(co2eRatio(b)).toBe(F)
    const applied = withBasisApplied(b)
    expect(applied.initial_budget_gt).toBeCloseTo(1150 * F, 9)
    expect(budgetUnitLabel(b)).toBe('Gt CO₂-eq')
    // The caption the sparkline renders.
    const caption = `Cumulative emissions vs ${formatBudgetGt(applied.initial_budget_gt)} ${budgetUnitLabel(b)} budget`
    expect(caption).toContain('1707.2')
    expect(caption).not.toContain('1150')
    expect(caption).not.toMatch(CO2_ONLY)        // no caption labelled CO₂
  })

  it('the pathway is scaled by the SAME factor as the budget', () => {
    const applied = withBasisApplied(budget('CO2e_GHG'))
    for (const y of [2025, 2050, 2100]) {
      expect(applied.projected_emissions[y]).toBeCloseTo(40 * F, 9)
    }
  })

  it('the depletion year is INVARIANT under the basis', () => {
    // Not a coincidence: remaining(y) scales uniformly by f, so the year it
    // reaches zero cannot move. This is what makes the relabelling safe.
    const co2 = budgetDepletionYear(withBasisApplied(budget('CO2')))
    const co2e = budgetDepletionYear(withBasisApplied(budget('CO2e_GHG')))
    expect(co2).not.toBeNull()
    expect(co2e).toBe(co2)
  })

  it('the whole remaining series scales by exactly f, shape unchanged', () => {
    const a = remainingBudgetSeries(withBasisApplied(budget('CO2')))
    const b = remainingBudgetSeries(withBasisApplied(budget('CO2e_GHG')))
    expect(b.map((p) => p.year)).toEqual(a.map((p) => p.year))
    for (let i = 0; i < a.length; i++) {
      expect(b[i].remaining).toBeCloseTo(a[i].remaining * F, 6)
    }
  })

  it('an inert conversion never fabricates a factor', () => {
    const noConv = { ...budget('CO2e_GHG'), co2e_conversion: null }
    expect(co2eRatio(noConv)).toBeNull()
    expect(budgetUnitLabel(noConv)).toBe('Gt CO₂')
    const zero = { ...budget('CO2e_GHG'), co2e_conversion: { kind: 'ratio' as const, factor: 0, source: '' } }
    expect(co2eRatio(zero)).toBeNull()
  })

  it('formatBudgetGt keeps integers bare and trims conversion float noise', () => {
    expect(formatBudgetGt(1150)).toBe('1150')
    expect(formatBudgetGt(1707.2350000000001)).toBe('1707.2')
  })
})

describe('the timeline inset mixes no bases', () => {
  it('initial − engine-remaining is a same-basis subtraction', () => {
    // The engine emits remaining_budget_gt from the basis-applied budget; the
    // inset subtracts the last of those from the initial. Pre-fix the initial
    // was the raw CO₂ scalar, so on a CO₂-eq run the difference was neither a
    // CO₂ nor a CO₂-eq quantity.
    const raw = budget('CO2e_GHG')
    const applied = withBasisApplied(raw)
    const engineSeries = remainingBudgetSeries(applied)
    const last = engineSeries[engineSeries.length - 1].remaining
    const totalAllocated = applied.initial_budget_gt - last

    const mixed = raw.initial_budget_gt - last          // the pre-fix figure
    expect(totalAllocated).not.toBeCloseTo(mixed, 3)
    // Total consumed equals the CO₂ consumption scaled by f — coherent.
    const co2 = remainingBudgetSeries(withBasisApplied(budget('CO2')))
    const co2Total = 1150 - co2[co2.length - 1].remaining
    expect(totalAllocated).toBeCloseTo(co2Total * F, 6)
  })
})
