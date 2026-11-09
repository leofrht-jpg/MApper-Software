/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ContributionAnalysisPanel } from '../src/components/lca/ContributionAnalysisPanel'
import { formatRunTime } from '../src/utils/runTime'
import type { ContributionAnalysisResult } from '../src/api/client'

// The time in the Contribution analysis header is the time of the run that produced the result. A
// result served from the backend cache says "(cached)" and keeps the original time; a time below
// 0.01 s never reads "0.00s". Synthetic result; no backend, project or database.

afterEach(cleanup)

describe('formatRunTime', () => {
  it('formats seconds, sub-second and long runs with two decimals, as before', () => {
    expect(formatRunTime(5.4321)).toBe('5.43s')
    expect(formatRunTime(0.35)).toBe('0.35s')
    expect(formatRunTime(0.012)).toBe('0.01s')
    expect(formatRunTime(153.884)).toBe('153.88s')
    expect(formatRunTime(61)).toBe('61.00s')
  })

  it('never reads 0.00s for a time that is not zero', () => {
    for (const t of [0.004, 0.003, 0.0005, 1e-6, 0.00999]) {
      const text = formatRunTime(t)
      expect(text, String(t)).toBe('<0.01s')
      expect(text).not.toContain('0.00s')
    }
  })

  it('shows nothing when no time was recorded', () => {
    for (const t of [0, -1, NaN, Infinity, null, undefined]) expect(formatRunTime(t as number)).toBeNull()
  })

  it('adds (cached) to a cached result and keeps the original time', () => {
    expect(formatRunTime(5.43, true)).toBe('5.43s (cached)')
    expect(formatRunTime(0.35, true)).toBe('0.35s (cached)')
    expect(formatRunTime(0.002, true)).toBe('<0.01s (cached)')
    expect(formatRunTime(5.43, false)).toBe('5.43s')
  })
})

const leaf = { name: 'root', key: 'db|a0', amount: 1, unit: 'kg', score: 1, unit_score: 'kg CO2-eq', percentage: 100, children: [] }
const result = (over: Partial<ContributionAnalysisResult>): ContributionAnalysisResult => ({
  target_type: 'activity', target_label: 'walk-arc', method: ['EF v3.1', 'climate change', 'GWP100'], method_unit: 'kg CO2-eq',
  score: 1, scope: 'all', year: null, compute_database: 'ecoinvent-3.10-cutoff',
  top_technosphere: { items: [], rest_amount: 0, rest_percentage: 0 },
  top_biosphere: [], biosphere_rest_amount: 0, biosphere_rest_percentage: 0,
  supply_chain_sankey: { nodes: [], links: [] }, supply_chain_tree: leaf, by_stage: [],
  cutoff: 0.005, max_depth: 6, elapsed_seconds: 0, warnings: [],
  ...over,
} as unknown as ContributionAnalysisResult)

describe('the Contribution analysis header', () => {
  it('shows the run time of a fresh result', () => {
    render(<ContributionAnalysisPanel result={result({ elapsed_seconds: 5.43 })} />)
    expect(screen.getByTestId('contribution-run-time').textContent).toBe('· 5.43s')
  })

  it('shows a sub-second time', () => {
    render(<ContributionAnalysisPanel result={result({ elapsed_seconds: 0.35 })} />)
    expect(screen.getByTestId('contribution-run-time').textContent).toBe('· 0.35s')
  })

  it('shows the original time with (cached) for a cached result', () => {
    render(<ContributionAnalysisPanel result={result({ elapsed_seconds: 153.88, cached: true })} />)
    expect(screen.getByTestId('contribution-run-time').textContent).toBe('· 153.88s (cached)')
  })

  it('never shows 0.00s for a tiny non-zero time', () => {
    render(<ContributionAnalysisPanel result={result({ elapsed_seconds: 0.003 })} />)
    const text = screen.getByTestId('contribution-run-time').textContent ?? ''
    expect(text).toBe('· <0.01s')
    expect(text).not.toContain('0.00s')
  })

  it('shows no time when none was recorded', () => {
    render(<ContributionAnalysisPanel result={result({ elapsed_seconds: 0 })} />)
    expect(screen.queryByTestId('contribution-run-time')).toBeNull()
  })
})
