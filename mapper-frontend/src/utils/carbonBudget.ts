/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Carbon-budget depletion arithmetic, client-side — the ONLY copy.
 *
 * Mirrors `CarbonBudgetConfig.remaining_budget` in
 * `mapper/models/aesa_schemas.py`:
 *
 *     consumed(year)  = Σ projected_emissions[y] for y in [start_year, year)
 *     remaining(year) = max(0, initial_budget_gt − consumed(year))
 *
 * The sum is EXCLUSIVE of `year` — `remaining(Y)` is the budget at the START of
 * Y, before that year's emissions. Getting this wrong by one term is not a
 * rounding difference: it shifts the depletion year by a whole year and makes
 * two panels of the same app disagree.
 *
 * Why this exists rather than reading the engine's numbers: the AESA sidebar's
 * budget sparkline renders BEFORE any compute, live as the user changes the
 * budget option and SSP dropdowns. There are no SR rows to read
 * `remaining_budget_gt` from yet. The timeline inset, which renders after a
 * compute, correctly reads the engine (see `budgetSeriesFromResults`) and must
 * NOT be migrated onto these helpers.
 *
 * Everything that needs this arithmetic before compute calls in here. Adding a
 * second copy is what produced the bug this replaces — see
 * `tests/carbonBudgetSingleImplementation.test.ts`, which fails the build if a
 * component starts accumulating `projected_emissions` on its own again.
 */
import type { CarbonBudgetConfig } from '../api/client'

/** Years inside the budget horizon that carry a projected-emissions value,
 *  ascending. Years outside [start_year, end_year] are ignored, matching the
 *  engine, which only ever sums within its own horizon. */
export function budgetYears(budget: CarbonBudgetConfig): number[] {
  return Object.keys(budget.projected_emissions)
    .map(Number)
    .filter((y) => Number.isFinite(y) && y >= budget.start_year && y <= budget.end_year)
    .sort((a, b) => a - b)
}

/**
 * Cumulative emissions consumed BEFORE `year` — `Σ` over `[start_year, year)`.
 *
 * Exclusive of `year` itself. This is the term that was wrong: accumulating
 * inclusively (`cum += E[y]` and then reading it AT y) yields
 * `consumed(year + 1)`.
 */
export function cumulativeConsumedAt(budget: CarbonBudgetConfig, year: number): number {
  let total = 0
  for (const y of budgetYears(budget)) {
    if (y >= year) break
    total += budget.projected_emissions[y] ?? 0
  }
  return total
}

/** Global remaining budget at the START of `year`, in Gt. Clamped at 0, as the
 *  engine clamps — net-negative late-century emissions can otherwise drive a
 *  depleted budget back above zero mid-series. */
export function remainingBudgetAt(budget: CarbonBudgetConfig, year: number): number {
  return Math.max(0, budget.initial_budget_gt - cumulativeConsumedAt(budget, year))
}

/** `(year, remaining)` across the horizon — the shape a chart plots. */
export function remainingBudgetSeries(
  budget: CarbonBudgetConfig,
): Array<{ year: number; remaining: number; consumed: number }> {
  return budgetYears(budget).map((year) => {
    const consumed = cumulativeConsumedAt(budget, year)
    return { year, consumed, remaining: Math.max(0, budget.initial_budget_gt - consumed) }
  })
}

/**
 * First year the remaining budget reaches zero, or null if it never does.
 *
 * The FIRST crossing is the answer even when late-century net negatives push
 * the remaining budget back above zero afterwards: the overshoot has happened,
 * and replenishment does not un-commit the temperature exceedance.
 */
export function budgetDepletionYear(budget: CarbonBudgetConfig): number | null {
  return remainingBudgetSeries(budget).find((p) => p.remaining <= 0)?.year ?? null
}

/**
 * ── Budget basis (CO₂ vs CO₂-eq) ────────────────────────────────────────────
 *
 * Mirrors `CarbonBudgetConfig.co2e_ratio` / `with_basis_applied` in
 * `mapper/models/aesa_schemas.py`. Same reason as the depletion arithmetic
 * above: the sidebar sparkline renders BEFORE any compute, so there is no
 * engine output to read — and, as there, the fix is ONE copy that every
 * pre-compute surface calls, not a scaling expression inlined per component.
 *
 * The stored `initial_budget_gt` is always the PRE-basis CO₂ figure; the CO₂-eq
 * basis is applied at compute time. A caption that prints the stored number
 * beside a CO₂-eq basis therefore states a CO₂ magnitude and calls it the
 * budget — the frontend half of the same defect as the workbook's
 * "Initial budget (Gt CO2) = 1150" sitting next to "Remaining Budget
 * (Gt CO2e) = 1707.2".
 */

/** The usable CO₂-eq factor, or null (inert). Mirrors `co2e_ratio()`: a factor
 *  only under the CO₂-eq basis with a positive "ratio" conversion. Never
 *  fabricates. */
export function co2eRatio(budget: CarbonBudgetConfig): number | null {
  if ((budget.budget_basis ?? 'CO2') !== 'CO2e_GHG') return null
  const conv = budget.co2e_conversion
  if (conv && conv.kind === 'ratio' && conv.factor > 0) return conv.factor
  return null
}

/**
 * The budget as compute will see it: budget AND pathway scaled by the same
 * factor, or the input unchanged when the basis is CO₂ / the conversion is
 * inert.
 *
 * Because ONE factor scales both terms, `remaining(y)` scales uniformly and the
 * DEPLETION YEAR IS INVARIANT under the basis — the curve keeps its shape and
 * only its magnitude moves. That is a property of mechanism (b), not an
 * accident: see `mapper/data/aesa/co2e_ratio/README.md`, "A2".
 */
export function withBasisApplied(budget: CarbonBudgetConfig): CarbonBudgetConfig {
  const f = co2eRatio(budget)
  if (f === null) return budget
  const scaled: Record<number, number> = {}
  for (const [y, v] of Object.entries(budget.projected_emissions)) {
    scaled[Number(y)] = v * f
  }
  return { ...budget, initial_budget_gt: budget.initial_budget_gt * f, projected_emissions: scaled }
}

/** The unit a basis-applied magnitude is in — "Gt CO₂" or "Gt CO₂-eq". Any
 *  surface printing a budget magnitude labels it with this, so no caption can
 *  state a CO₂ unit over a CO₂-eq number. */
export function budgetUnitLabel(budget: CarbonBudgetConfig): string {
  return co2eRatio(budget) === null ? 'Gt CO₂' : 'Gt CO₂-eq'
}

/** A budget magnitude as a caption prints it: integers bare, converted values to
 *  1 dp. Scaling by the CO₂-eq factor turns 1150 into 1707.2350000000001, and a
 *  caption is not the place to show float noise. */
export function formatBudgetGt(gt: number): string {
  return Number.isInteger(gt) ? String(gt) : gt.toFixed(1)
}
