import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { SingleProductComparisonPanel } from '../src/components/impact/SingleProductComparisonPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { exportSingleProductComparison, type ArchetypeLCACalculateResult } from '../src/api/client'

// Patch 4G — Smoke tests for the Export button on each Single-product
// sub-tab Results card. Walks the rendering surface only — the
// network call itself is exercised by backend round-trip tests in
// mapper-backend/tests/test_impact_single_product_export.py.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    getMethods: vi.fn(async () => [{
      family: 'EF v3.1',
      categories: [{
        category: 'climate change',
        indicators: [{ indicator: 'GWP100', tuple: ['EF v3.1', 'climate change', 'GWP100'] }],
      }],
    }]),
    exportSingleProductStatic: vi.fn(async () => undefined),
    exportSingleProductProspective: vi.fn(async () => undefined),
    exportSingleProductComparison: vi.fn(async () => undefined),
  }
})

const STATIC_RESULT: ArchetypeLCACalculateResult = {
  archetype_id: 'arc-1',
  archetype_name: 'BEV-LFP|Small',
  scope: 'all',
  amount: 1,
  stage_amounts: { Manufacturing: 1, 'Use Phase': 15, Maintenance: 15, 'End of Life': 1 },
  stages_included: ['Manufacturing', 'Use Phase', 'Maintenance', 'End of Life'],
  results: [{
    method: ['EF v3.1', 'climate change', 'GWP100'],
    method_label: 'EF v3.1 › climate change › GWP100',
    score: 1234.5,
    unit: 'kg CO2-eq',
    contributions: [],
  }],
  elapsed_seconds: 1.0,
  compute_database: null,
  parameter_scenario: null,
  warnings: [],
  stage_breakdown: null,
}

beforeEach(() => {
  // @ts-expect-error - jsdom stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  useSingleProductImpactStore.getState().reset()
  useParameterStore.setState({ table: null, selectedScenarios: [] })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030',
      base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP2-PkBudg1150',
      year: 2030, years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any, created_at: '2026-01-01',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any,
  })
})

describe('Single-product Export buttons (Patch 4G)', () => {
  it('Static panel renders no Export button before a result exists', () => {
    const { queryByTestId } = render(<SingleProductStaticPanel archetypeId="arc-1" />)
    // Results card is gated on hasResults; with no compute run yet, the
    // Export button (which lives in the Results card actions slot) is
    // absent rather than disabled. Cleaner UX than a button that
    // appears greyed out next to "no data".
    expect(queryByTestId('single-product-static-export')).toBeNull()
  })

  it('Projected panel renders no Export button before a run exists', () => {
    const { queryByTestId } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)
    expect(queryByTestId('single-product-projected-export')).toBeNull()
  })

  it('Comparison panel renders empty-state when only one side is computed', () => {
    // Static published, but no projected runs — Comparison gates on
    // both sides and renders its empty-state (no card, no button).
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    const { queryByTestId } = render(<SingleProductComparisonPanel archetypeId="arc-1" />)
    expect(queryByTestId('single-product-compare-export')).toBeNull()
    expect(queryByTestId('single-product-compare-needs-runs')).toBeInTheDocument()
  })

  it('Comparison panel renders Export button when both sides have results', () => {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    useSingleProductImpactStore.getState().setProjectedRuns([{
      dbName: 'ei310-remind-ssp2-2030',
      year: 2030, iam: 'remind', ssp: 'SSP2-PkBudg1150',
      result: {
        ...STATIC_RESULT,
        compute_database: 'ei310-remind-ssp2-2030',
        results: [{
          ...STATIC_RESULT.results[0],
          score: 800.0,
        }],
      },
    }])
    const { getByTestId } = render(<SingleProductComparisonPanel archetypeId="arc-1" />)
    const btn = getByTestId('single-product-compare-export') as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    expect(btn.disabled).toBe(false)
  })

  it('export request carries the selected archetype stage-amount meta (Patch 5K+)', async () => {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    useSingleProductImpactStore.getState().setProjectedRuns([{
      dbName: 'ei310-remind-ssp2-2030', year: 2030, iam: 'remind', ssp: 'SSP2-PkBudg1150',
      result: { ...STATIC_RESULT, compute_database: 'ei310-remind-ssp2-2030' },
    }])
    // Selected archetype's stage amounts (preset/lifetime/amounts).
    useSingleProductImpactStore.getState().setStageAmountsForArc('arc-1', {
      preset: 'lifetime', lifetime: 15,
      amounts: { Manufacturing: 1, 'Use Phase': 15, Maintenance: 15, 'End of Life': 1 },
    })
    const { getByTestId } = render(<SingleProductComparisonPanel archetypeId="arc-1" />)
    await act(async () => {
      fireEvent.click(getByTestId('single-product-compare-export'))
    })
    const spy = vi.mocked(exportSingleProductComparison)
    expect(spy).toHaveBeenCalledTimes(1)
    // 5th arg is the StageAmountsMeta threaded from the store.
    expect(spy.mock.calls[0][4]).toEqual({
      preset: 'lifetime', lifetime: 15,
      amounts: { Manufacturing: 1, 'Use Phase': 15, Maintenance: 15, 'End of Life': 1 },
    })
  })
})
