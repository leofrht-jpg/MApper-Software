/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { useImpactStore } from '../src/stores/impactStore'

// A multi-LCI-scenario Prospective run no longer blocks the Comparison tab.
// The panel exposes an in-tab picker (comparison-lci-scenario-select) that
// chooses WHICH LCI scenario to diff Static against. Changing it re-runs the
// client-side compare() against that scenario — projectedResult (pinned to
// scenarios[0], read by the chart/AESA) is NEVER mutated.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportImpact: vi.fn() }
})

beforeEach(() => {
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (typeof window !== 'undefined') {
    const store: Record<string, string> = {}
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v) },
        removeItem: (k: string) => { delete store[k] },
        clear: () => { for (const k of Object.keys(store)) delete store[k] },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length },
      },
    })
  }
  useImpactStore.setState({
    staticResult: null, projectedResult: null, projectedMultiResult: null,
    compareScenarioIndex: null, compareResult: null, error: null,
    pairedScenarioOrder: [], pairedScenarioRuns: {}, activePairedScenario: null,
    staticDsmScenarioOrder: [], staticDsmScenarioRuns: {}, activeStaticDsmScenario: null,
    projectedDsmScenarioOrder: [], projectedDsmScenarioRuns: {}, activeProjectedDsmScenario: null,
  })
})

const METHOD = ['ef v3.1', 'climate change', 'gwp 100a']
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeResult = (total: number): any => ({
  meta: { mfa_system_id: 'sys-test', scope: 'all', mode: 'projected' },
  results: [{
    method: METHOD, method_label: 'EF v3.1 climate change', unit: 'kg CO2-eq',
    years: [
      { year: 2020, total_impact: total / 2 },
      { year: 2021, total_impact: total / 2 },
    ],
  }],
})

const STATIC_TOTAL = 100
// SSP1 → delta +10, SSP2 → +30, SSP5 → +100
const SC_TOTALS = [110, 130, 200]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scenario = (iam: string, ssp: string, total: number): any =>
  ({ scenario: { base_db: 'ei310', iam, ssp }, result: makeResult(total) })

const seedMulti = () => {
  const scenarios = [
    scenario('remind', 'SSP1-Base', SC_TOTALS[0]),
    scenario('remind', 'SSP2-Base', SC_TOTALS[1]),
    scenario('remind', 'SSP5-Base', SC_TOTALS[2]),
  ]
  useImpactStore.setState({
    staticResult: makeResult(STATIC_TOTAL),
    projectedResult: scenarios[0].result, // pinned to scenarios[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    projectedMultiResult: { result_type: 'multi_scenario_projected', task_id: 't', meta: {}, scenarios } as any,
    compareScenarioIndex: 0,
  })
}

describe('ComparisonPanel — multi-LCI scenario picker', () => {
  it('lists all scenario labels; default selection is the first', async () => {
    seedMulti()
    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { getByTestId } = render(<ComparisonPanel />)
    const select = getByTestId('comparison-lci-scenario-select') as HTMLSelectElement
    const opts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toEqual(['REMIND/SSP1-Base', 'REMIND/SSP2-Base', 'REMIND/SSP5-Base'])
    expect(select.value).toBe('0')
  })

  it('default comparison diffs against scenarios[0]; projectedResult is untouched', async () => {
    seedMulti()
    const pinnedBefore = useImpactStore.getState().projectedResult
    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    render(<ComparisonPanel />)
    await waitFor(() => {
      expect(useImpactStore.getState().compareResult?.methods[0].total_delta).toBe(10)
    })
    // projectedResult (chart/AESA slot) stays pinned to scenarios[0].
    expect(useImpactStore.getState().projectedResult).toBe(pinnedBefore)
  })

  it('changing the selection re-computes against that scenario (derived, not projectedResult)', async () => {
    seedMulti()
    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { getByTestId } = render(<ComparisonPanel />)
    await waitFor(() => {
      expect(useImpactStore.getState().compareResult?.methods[0].total_delta).toBe(10)
    })
    // Pick SSP5-Base (index 2) → delta +100.
    await act(async () => {
      fireEvent.change(getByTestId('comparison-lci-scenario-select'), { target: { value: '2' } })
    })
    await waitFor(() => {
      expect(useImpactStore.getState().compareResult?.methods[0].total_delta).toBe(100)
    })
    // projectedResult NEVER mutated by the pick.
    expect(useImpactStore.getState().projectedResult).toBe(
      useImpactStore.getState().projectedMultiResult!.scenarios[0].result,
    )
  })

  it('single-scenario run → no picker rendered, unchanged behaviour', async () => {
    useImpactStore.setState({
      staticResult: makeResult(STATIC_TOTAL),
      projectedResult: makeResult(120),
      projectedMultiResult: null,
      compareScenarioIndex: null,
    })
    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { queryByTestId } = render(<ComparisonPanel />)
    expect(queryByTestId('comparison-lci-scenario-picker')).toBeNull()
    await waitFor(() => {
      expect(useImpactStore.getState().compareResult?.methods[0].total_delta).toBe(20)
    })
  })

  it('setCompareScenarioIndex clamps to the scenarios array and clears compareResult', () => {
    seedMulti()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useImpactStore.setState({ compareResult: { mfa_system_id: 'sys-test', scope: 'all', methods: [] } as any })
    // Out-of-range index clamps to the last valid scenario (2), not past the end.
    useImpactStore.getState().setCompareScenarioIndex(99)
    expect(useImpactStore.getState().compareScenarioIndex).toBe(2)
    expect(useImpactStore.getState().compareResult).toBeNull()
  })
})
