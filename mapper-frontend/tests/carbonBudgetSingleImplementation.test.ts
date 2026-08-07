/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// There have been FOUR copies of the carbon-budget depletion arithmetic: the
// engine, the timeline inset, the sidebar sparkline, and the shared helper that
// replaced two of them. Each frontend copy accumulated INCLUSIVELY where the
// engine sums exclusively, so each annotated depletion a year early — and they
// were found one at a time, months apart, by someone noticing two panels
// disagreeing.
//
// Finding them by symptom ("remaining") missed the sparkline. Finding them by
// OPERATION — anything summing `projected_emissions` — finds all of them. This
// test greps for the operation and fails on a fifth copy.
//
// Post-compute surfaces must read `remaining_budget_gt` off the SR rows
// (`budgetSeriesFromResults`); pre-compute previews call
// `utils/carbonBudget.ts`. Neither needs to accumulate inline.

const SRC = resolve(process.cwd(), 'src')

/** The one module allowed to accumulate projected_emissions. */
const CARBON_BUDGET_UTIL = 'utils/carbonBudget.ts'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Strip comments so prose ABOUT the bug doesn't count as an instance of it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the carbon-budget rule has exactly one frontend implementation', () => {
  const files = walk(SRC)

  it('finds the source tree (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => relative(SRC, f) === CARBON_BUDGET_UTIL)).toBe(true)
  })

  it('no component accumulates projected_emissions itself', () => {
    // The construct that shipped the bug, twice:
    //   cum += budget.projected_emissions[y] ?? 0
    const accumulation = /\+=\s*[A-Za-z_$][\w$]*\.projected_emissions\s*\[/
    const offenders = files.filter((f) => {
      if (relative(SRC, f) === CARBON_BUDGET_UTIL) return false
      return accumulation.test(stripComments(readFileSync(f, 'utf-8')))
    }).map((f) => relative(SRC, f))

    expect(offenders, `accumulate projected_emissions outside ${CARBON_BUDGET_UTIL}; `
      + 'call budgetDepletionYear/remainingBudgetSeries instead, or read '
      + 'remaining_budget_gt off the SR rows if a compute has already run')
      .toEqual([])
  })

  it('no component derives a depletion year by comparing a running total to the cap', () => {
    // The other half of the bug: `.find((p) => p.used >= initial_budget_gt)`.
    const capCompare = /(>=|>)\s*[A-Za-z_$][\w$]*\.initial_budget_gt/
    const offenders = files.filter((f) => {
      if (relative(SRC, f) === CARBON_BUDGET_UTIL) return false
      return capCompare.test(stripComments(readFileSync(f, 'utf-8')))
    }).map((f) => relative(SRC, f))

    expect(offenders, 'compare a cumulative total against initial_budget_gt; '
      + 'use budgetDepletionYear() so the exclusive-sum rule is applied')
      .toEqual([])
  })

  it('the sparkline calls the shared helpers', () => {
    const sidebar = readFileSync(join(SRC, 'components/aesa/ConfigSidebar.tsx'), 'utf-8')
    expect(sidebar).toContain('budgetDepletionYear(budget)')
    expect(sidebar).toContain('remainingBudgetSeries(budget)')
  })

  it('the post-compute inset still reads the engine rather than the helper', () => {
    // TimelineView must NOT be migrated onto utils/carbonBudget — once a
    // compute exists, the engine's own numbers are available and authoritative.
    const timeline = readFileSync(join(SRC, 'components/aesa/TimelineView.tsx'), 'utf-8')
    expect(timeline).toContain('remaining_budget_gt')
    expect(stripComments(timeline)).not.toContain('budgetDepletionYear')
  })
})
