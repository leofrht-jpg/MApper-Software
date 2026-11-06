/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { SingleProductComparisonPanel } from '../src/components/impact/SingleProductComparisonPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import {
  exportSingleProductComparison, exportSingleProductProspective, exportSingleProductStatic,
  type ArchetypeLCACalculateResult,
} from '../src/api/client'
import { Button } from '../src/components/ui/Button'
import { useSessionStateStore } from '../src/stores/sessionStateStore'

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
  useSessionStateStore.getState().reset()
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

  it('export request carries the RUN\'s stage-amount meta, not the live editor (EVS40)', async () => {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    useSingleProductImpactStore.getState().setProjectedRuns([{
      dbName: 'ei310-remind-ssp2-2030', year: 2030, iam: 'remind', ssp: 'SSP2-PkBudg1150',
      result: { ...STATIC_RESULT, compute_database: 'ei310-remind-ssp2-2030' },
    }])
    // What the Static run was computed with, frozen at its compute time.
    useSingleProductImpactStore.getState().setStaticRunMeta({
      preset: 'lifetime', lifetime: 16, lifetime_param: 'lifetime_yr',
      amounts: { Manufacturing: 1, 'Use Phase': 16, Maintenance: 16, 'End of Life': 1 },
    })
    // The editor changed AFTER the run. Reading it at export time is how an
    // EVS40 export printed "Lifetime 15" beside "Use Phase 16".
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
    expect(spy.mock.calls[0][4]).toEqual({
      preset: 'lifetime', lifetime: 16, lifetime_param: 'lifetime_yr',
      amounts: { Manufacturing: 1, 'Use Phase': 16, Maintenance: 16, 'End of Life': 1 },
    })
  })
})


// The three Export buttons used to be hand-rolled <button> elements (32 px, own colours).
// They are now the standard <Button variant="secondary">, like the Export XLSX header
// button in LCA Architect. This block locks the behaviour, not the markup: the test ids,
// the click, the disabled state while exporting and the spinner. What a button LOOKS like is
// checked against a reference <Button variant="secondary"> rendered here, so a hand-rolled
// style or another variant fails it.
describe('Single-product Export buttons use the standard Button (secondary)', () => {
  const PROJECTED_RUN = {
    dbName: 'ei310-remind-ssp2-2030', year: 2030, iam: 'remind', ssp: 'SSP2-PkBudg1150',
    result: { ...STATIC_RESULT, compute_database: 'ei310-remind-ssp2-2030' },
  }

  beforeEach(() => {
    vi.mocked(exportSingleProductStatic).mockClear()
    vi.mocked(exportSingleProductProspective).mockClear()
    vi.mocked(exportSingleProductComparison).mockClear()
  })

  function referenceStyle(): string {
    const ref = render(<Button variant="secondary">x</Button>)
    const css = (ref.container.querySelector('button') as HTMLElement).style.cssText
    ref.unmount()
    return css
  }

  function seedStatic() {
    const set = useSessionStateStore.getState().setValue
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    set('singleProduct.static.arc-1.results', { Base: STATIC_RESULT })
    set('singleProduct.static.arc-1.order', ['Base'])
    set('singleProduct.static.arc-1.active', 'Base')
  }
  function seedProjected() {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    const set = useSessionStateStore.getState().setValue
    set('singleProduct.projected.arc-1.runs', [PROJECTED_RUN])
    set('singleProduct.projected.arc-1.active', 0)
  }
  function seedComparison() {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    useSingleProductImpactStore.getState().setProjectedRuns([PROJECTED_RUN])
  }

  const CASES = [
    { name: 'Static', id: 'single-product-static-export', seed: seedStatic,
      ui: () => <SingleProductStaticPanel archetypeId="arc-1" />, api: exportSingleProductStatic },
    { name: 'Projected', id: 'single-product-projected-export', seed: seedProjected,
      ui: () => <SingleProductProjectedPanel archetypeId="arc-1" />, api: exportSingleProductProspective },
    { name: 'Comparison', id: 'single-product-compare-export', seed: seedComparison,
      ui: () => <SingleProductComparisonPanel archetypeId="arc-1" />, api: exportSingleProductComparison },
  ]

  for (const c of CASES) {
    it(`${c.name}: standard secondary Button, same test id, label and title`, () => {
      c.seed()
      const reference = referenceStyle()
      const { getByTestId } = render(c.ui())
      const btn = getByTestId(c.id) as HTMLButtonElement
      expect(btn.tagName).toBe('BUTTON')
      expect(btn.type).toBe('button')
      expect(btn.style.cssText).toBe(reference)          // exactly the Button's own style, nothing added
      expect(btn.textContent).toBe('Export')
      expect(btn.title).toBe('Download Excel workbook')
      expect(btn.disabled).toBe(false)
      expect(btn.querySelector('svg')).not.toBeNull()
    })

    it(`${c.name}: click exports once; disabled with the spinner while it runs, then back`, async () => {
      c.seed()
      let finish: () => void = () => {}
      vi.mocked(c.api as never).mockImplementationOnce((() => new Promise<void>((r) => { finish = r })) as never)
      const { getByTestId } = render(c.ui())
      const btn = getByTestId(c.id) as HTMLButtonElement

      await act(async () => { fireEvent.click(btn) })
      expect(vi.mocked(c.api as never)).toHaveBeenCalledTimes(1)
      expect(btn.disabled).toBe(true)
      expect(btn.querySelector('svg.lca-spin')).not.toBeNull()        // the contribution panel's spinner
      await act(async () => { fireEvent.click(btn) })                 // a second click does nothing
      expect(vi.mocked(c.api as never)).toHaveBeenCalledTimes(1)

      await act(async () => { finish() })
      expect(btn.disabled).toBe(false)
      expect(btn.querySelector('svg.lca-spin')).toBeNull()
    })
  }
})
