/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useImpactStore } from '../src/stores/impactStore'

// Change 1: the Prospective Export button moves to the MULTI-LCI card header
// (and exports ALL scenarios). It must NOT appear in the results section in
// multi-LCI mode; clicking it exports the multi_result envelope.

const exportImpactMock = vi.fn(async () => undefined)
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportImpact: (...a: any[]) => exportImpactMock(...a) }
})

const dsmlca = (id: string) => ({
  mfa_system_id: 'sys-test', scope: 'all', method: ['EF v3.1', 'climate change', 'GWP100'],
  method_label: 'EF v3.1 › climate change › GWP100', unit: 'kg CO2-eq',
  years: [{ year: 2030, total_impact: 1, impact_by_cohort: {}, impact_by_material: {}, count_by_cohort: {} }],
  summary: { total_impact: 1, peak_year: 2030, peak_impact: 1 }, stages_included: [], _id: id,
})
const scenResult = () => ({ task_id: 't', meta: { year_to_database: {}, warnings: [] }, results: [dsmlca('r')] })

beforeEach(() => {
  exportImpactMock.mockClear()
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDSMStore.setState({
    activeSystem: { id: 'sys-test', name: 'Car Fleet', time_horizon: { start_year: 2025, end_year: 2050 }, dimensions: [] } as any,
    systemState: { scenarios: [{ id: 'base-1', name: 'Base', is_base: true }], active_scenario_id: 'base-1' } as any,
    cohortMappings: {},
  })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp1-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP1-Base', year: 2030, years: [2030],
      mode: 'separate' as any, created_at: '2026-01-01',
    }] as any,
  })
  useSubsystemStore.setState({ subsystems: [], fetchForSystem: (async () => undefined) as never })
  useImpactStore.setState({
    staticResult: null,
    projectedResult: scenResult() as any,           // pinned to scenarios[0]
    projectedMultiResult: {
      result_type: 'multi_scenario_projected', task_id: 't', meta: {},
      scenarios: [
        { scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP1-Base' }, result: scenResult() },
        { scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-Base' }, result: scenResult() },
        { scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP5-Base' }, result: scenResult() },
      ],
    } as any,
    projectedJob: null, staticJob: null, error: null,
    // clear the multi-DSM / paired / param slots so handleExport takes the multi-LCI branch
    dsmScenarioOrder: [], pairedScenarioOrder: [], projectedScenarioOrder: [],
  } as any)
})

async function renderPanel() {
  const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
  const utils = render(<ProjectedImpactPanel />)
  await act(async () => { await Promise.resolve() })
  return utils
}

describe('Prospective Export button — moved to the MULTI-LCI card', () => {
  it('renders in the MULTI-LCI card header, NOT in the results section', async () => {
    const { queryByTestId } = await renderPanel()
    expect(queryByTestId('projected-multi-export')).not.toBeNull()
    expect(queryByTestId('projected-results-export')).toBeNull()
  })

  it('uses the shared secondary Button convention (a real button, not a ghost/link)', async () => {
    const { getByTestId } = await renderPanel()
    const btn = getByTestId('projected-multi-export') as HTMLButtonElement
    // Shared <Button variant="secondary"> — elevated bg + border, matching the
    // Static tab's "Export Excel". NOT ghost (transparent, no border).
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.style.backgroundColor).toBe('var(--bg-elevated)')
    expect(btn.style.border).toBe('1px solid var(--border-default)')
    expect(btn.style.backgroundColor).not.toBe('transparent')
  })

  it('clicking it exports ALL scenarios (multi_result envelope)', async () => {
    const { getByTestId } = await renderPanel()
    await act(async () => { fireEvent.click(getByTestId('projected-multi-export')) })
    expect(exportImpactMock).toHaveBeenCalledTimes(1)
    const [payload] = exportImpactMock.mock.calls[0] as [any, string]
    expect(payload.multi_result).toBeTruthy()
    expect(payload.multi_result.scenarios.length).toBe(3)
  })
})
