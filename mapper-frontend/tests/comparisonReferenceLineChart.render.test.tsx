/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import {
  ComparisonReferenceLineChart,
  ComparisonDeltaChart,
} from '../src/components/charts/ComparisonReferenceLineChart'
import { useNumberFormatter } from '../src/components/charts/numberFormat'
import type { ProjectedRun } from '../src/stores/singleProductImpactStore'
import type { ArchetypeLCACalculateResult } from '../src/api/client'

// Patch 4C — ComparisonReferenceLineChart + ComparisonDeltaChart render
// the projected-vs-static comparison for a single active method.

const METHOD_KEY = 'IPCC|GWP100a|kg CO2-eq'

function buildResult(score: number): ArchetypeLCACalculateResult {
  return {
    archetype_id: 'a1',
    archetype_name: 'Test',
    scope: 'all',
    amount: 1,
    stage_amounts: {},
    stages_included: [],
    elapsed_seconds: 0.1,
    results: [{
      method: ['IPCC', 'GWP100a', 'kg CO2-eq'],
      method_label: 'IPCC | GWP100a | kg CO2-eq',
      score,
      unit: 'kg CO2-eq',
      contributions: [],
    }],
  }
}

const STATIC = buildResult(1000)

const RUNS: ProjectedRun[] = [
  // ssp1: starts above (worsening), ends below (improvement)
  { dbName: 'remind-ssp1-2030', year: 2030, iam: 'remind', ssp: 'ssp1', result: buildResult(1100) },
  { dbName: 'remind-ssp1-2040', year: 2040, iam: 'remind', ssp: 'ssp1', result: buildResult(800) },
  // ssp2: improving throughout
  { dbName: 'remind-ssp2-2030', year: 2030, iam: 'remind', ssp: 'ssp2', result: buildResult(950) },
  { dbName: 'remind-ssp2-2040', year: 2040, iam: 'remind', ssp: 'ssp2', result: buildResult(700) },
]

describe('ComparisonReferenceLineChart (Patch 4C)', () => {
  it('renders the reference-line chart with per-trajectory legend chips', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { getByTestId } = render(
      <ComparisonReferenceLineChart
        staticResult={STATIC}
        projectedRuns={RUNS}
        activeMethodKey={METHOD_KEY}
        format={result.current}
        filenameBase="test"
      />,
    )

    expect(getByTestId('comparison-reference-line-chart')).toBeInTheDocument()
    expect(getByTestId('comparison-refline-legend-remind/ssp1')).toBeInTheDocument()
    expect(getByTestId('comparison-refline-legend-remind/ssp2')).toBeInTheDocument()
  })

  it('renders empty-state when no runs are provided', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { getByTestId } = render(
      <ComparisonReferenceLineChart
        staticResult={STATIC}
        projectedRuns={[]}
        activeMethodKey={METHOD_KEY}
        format={result.current}
        filenameBase="test"
      />,
    )
    expect(getByTestId('comparison-reference-line-empty')).toBeInTheDocument()
  })
})

describe('ComparisonDeltaChart (Patch 4C)', () => {
  it('renders the delta chart container', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { getByTestId } = render(
      <ComparisonDeltaChart
        staticResult={STATIC}
        projectedRuns={RUNS}
        activeMethodKey={METHOD_KEY}
        format={result.current}
        filenameBase="test"
      />,
    )
    expect(getByTestId('comparison-delta-chart')).toBeInTheDocument()
  })

  it('returns null when no runs are provided', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { container } = render(
      <ComparisonDeltaChart
        staticResult={STATIC}
        projectedRuns={[]}
        activeMethodKey={METHOD_KEY}
        format={result.current}
        filenameBase="test"
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
