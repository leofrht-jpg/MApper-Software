/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, within } from '@testing-library/react'
import { ImpactAssessment } from '../src/pages/ImpactAssessment'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useImpactStore } from '../src/stores/impactStore'

// Component wiring for the Comparison-tab gate (logic itself is locked by
// tests/compareGate.test.ts). Verifies the system TabBar renders the SPECIFIC
// caption + hover title for the store state — including that a multi-LCI-scenario
// Prospective run now ENABLES the tab (in-tab scenario picker), no longer blocks.

const seedStores = (impact: Partial<ReturnType<typeof useImpactStore.getState>>) => {
  useImpactStore.setState({
    staticResult: null, projectedResult: null, projectedMultiResult: null,
    compareResult: null, staticJob: null, projectedJob: null, error: null,
    ...impact,
  } as any)
  useDSMStore.setState({
    activeSystem: { id: 'sys-test', name: 'Test System', time_horizon: { start_year: 2020, end_year: 2030 }, dimensions: [] } as any,
    systemState: { scenarios: [{ id: 'base-1', name: 'Base', is_base: true }], active_scenario_id: 'base-1' } as any,
  })
  usePLCAStore.setState({
    databases: [{ name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030], mode: 'separate' as any, created_at: '2026-01-01' }] as any,
  })
}

const compareTab = () => {
  const { getByTestId } = render(<ImpactAssessment />)
  const sysPane = getByTestId('impact-mode-pane-system')
  return within(sysPane).getByTestId('impact-tab-compare') as HTMLButtonElement
}

beforeEach(() => {
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

describe('ImpactAssessment — Comparison tab gate wiring', () => {
  it('neither run → compare tab disabled, caption "Run both first"', () => {
    seedStores({})
    const tab = compareTab()
    expect(tab).toBeDisabled()
    expect(tab.textContent).toContain('Run both first')
  })

  it('Static only → disabled, caption names PROSPECTIVE as the gap', () => {
    seedStores({ staticResult: { results: [] } as any })
    const tab = compareTab()
    expect(tab).toBeDisabled()
    expect(tab.textContent).toContain('Run Prospective first')
    expect(tab.getAttribute('title')).toBe('Run Prospective Background first')
  })

  it('both present + Prospective is multi-LCI-scenario → ENABLED (in-tab picker), NOT blocked', () => {
    const emptyRes = { results: [], meta: {} }
    seedStores({
      staticResult: emptyRes as any,
      // projectedResult pinned to scenarios[0] (empty results → panel renders safely).
      projectedResult: emptyRes as any,
      compareScenarioIndex: 0,
      projectedMultiResult: { result_type: 'multi_scenario_projected', scenarios: [
        { scenario: { iam: 'remind', ssp: 'SSP1-Base' }, result: emptyRes },
        { scenario: { iam: 'remind', ssp: 'SSP2-Base' }, result: emptyRes },
        { scenario: { iam: 'remind', ssp: 'SSP5-Base' }, result: emptyRes },
      ] } as any,
    })
    const tab = compareTab()
    expect(tab).not.toBeDisabled()
    expect(tab.textContent).toContain('Δ static vs projected')
    expect(tab.textContent).not.toContain('Pick one LCI scenario')
    expect(tab.textContent).not.toContain('Run both first')
  })
})
