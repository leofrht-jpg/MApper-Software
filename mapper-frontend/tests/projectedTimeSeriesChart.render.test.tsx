import { describe, it, expect } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { ProjectedTimeSeriesChart } from '../src/components/charts/ProjectedTimeSeriesChart'
import { useNumberFormatter } from '../src/components/charts/numberFormat'
import type { ProjectedRun } from '../src/stores/singleProductImpactStore'
import type { ArchetypeLCACalculateResult } from '../src/api/client'

// Patch 4C — ProjectedTimeSeriesChart renders one line per (iam, ssp)
// trajectory through projected per-year scores for a single active method.

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

const RUNS: ProjectedRun[] = [
  { dbName: 'remind-ssp1-2030', year: 2030, iam: 'remind', ssp: 'ssp1', result: buildResult(900) },
  { dbName: 'remind-ssp1-2040', year: 2040, iam: 'remind', ssp: 'ssp1', result: buildResult(700) },
  { dbName: 'remind-ssp2-2030', year: 2030, iam: 'remind', ssp: 'ssp2', result: buildResult(950) },
  { dbName: 'remind-ssp2-2040', year: 2040, iam: 'remind', ssp: 'ssp2', result: buildResult(820) },
]

describe('ProjectedTimeSeriesChart (Patch 4C)', () => {
  it('renders the chart and one legend chip per (iam, ssp) trajectory', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { getByTestId } = render(
      <ProjectedTimeSeriesChart
        runs={RUNS}
        activeMethodKey={METHOD_KEY}
        format={result.current}
        filenameBase="test"
      />,
    )

    expect(getByTestId('projected-time-series-chart')).toBeInTheDocument()
    expect(getByTestId('projected-time-series-legend-remind/ssp1')).toBeInTheDocument()
    expect(getByTestId('projected-time-series-legend-remind/ssp2')).toBeInTheDocument()
  })

  it('shows empty-state when there are no runs', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { getByTestId } = render(
      <ProjectedTimeSeriesChart
        runs={[]}
        activeMethodKey={METHOD_KEY}
        format={result.current}
        filenameBase="test"
      />,
    )
    expect(getByTestId('projected-time-series-empty')).toBeInTheDocument()
  })
})
