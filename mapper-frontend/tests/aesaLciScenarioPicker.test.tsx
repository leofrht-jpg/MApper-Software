/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// Patch 5AQ — AESA can assess ANY of the multi-LCI Prospective Background
// scenarios (not just scenario 1). All N full ImpactAssessmentResults are
// persisted in projectedMultiResult.scenarios[]; AESA consumes the chosen one
// inline. This test: the picker lists the N scenarios, and the chosen one's
// result reaches the AESA compute (inline, not via the single shared task_id).

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }
const SHARING: any = { id: 'preset-1', name: 'Preset', description: '', built_in: true, principles: [], category_assignments: [], chain: { layers: [] } }
const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }],
  multi_d_defaults: [], sharing_data: {}, ssp_trajectories: [], carbon_budget_options: [],
  default_multi_d: { tiers: [] }, default_carbon_budget: null,
}

const mkResult = (tid: string): any => ({
  task_id: tid,
  meta: { mode: 'projected', mfa_system_id: 'sys-1', scope: 'stock' },
  results: [],
})
const scen = (iam: string, ssp: string, tid: string): any => ({
  scenario: { base_db: 'ecoinvent-3.10', iam, ssp },
  result: mkResult(tid),
})
const MULTI: any = {
  result_type: 'multi_scenario_projected',
  task_id: 'multi-1',
  meta: {},
  scenarios: [
    scen('remind', 'SSP1-PkBudg1150', 'r-ssp1'),
    scen('remind', 'SSP2-PkBudg1150', 'r-ssp2'),
    scen('remind', 'SSP5-PkBudg1150', 'r-ssp5'),
  ],
}

const DRAFT: any = {
  name: 'cfg', boundary_set_id: 'Sala2020_EF', sharing: SHARING, sharing_preset_id: 'preset-1',
  carbon_budget: null, method_mapping: [{ method_tuple: ['EF v3.1', 'climate change', 'x'], pb_id: 'climate_change' }],
  impact_mode: 'projected', dsm_scenario_id: null,
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  vi.spyOn(client, 'computeAESA').mockResolvedValue({ results: [], summary_by_year: [], sensitivity: null } as any)
  useDSMStore.setState({ systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never], activeSystem: SYSTEM, systemState: SYSTEM_STATE })
  useImpactStore.setState({
    staticResult: null,
    projectedResult: MULTI.scenarios[0].result, // store pins scenario 0 (the bug)
    projectedMultiResult: MULTI,
  })
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [SHARING], draft: DRAFT,
    configurations: [], activeConfigId: null, creatingNewConfig: true,
    activeSessionId: null, configLoadError: null, error: null, running: false,
  })
})

afterEach(cleanup)

describe('AESA LCI scenario picker (Patch 5AQ)', () => {
  it('lists the N computed prospective scenarios, defaulting to scenario 1', async () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = await waitFor(() => getByTestId('aesa-lci-scenario-select') as HTMLSelectElement)
    const opts = Array.from(select.querySelectorAll('option'))
    expect(opts).toHaveLength(3)
    expect(opts.map((o) => o.textContent)).toEqual([
      'remind / SSP1-PkBudg1150',
      'remind / SSP2-PkBudg1150',
      'remind / SSP5-PkBudg1150',
    ])
    expect(select.value).toBe('0') // default = scenario 1, current behavior
  })

  it('the chosen scenario reaches the AESA compute inline (not the shared task_id)', async () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = await waitFor(() => getByTestId('aesa-lci-scenario-select') as HTMLSelectElement)

    // Pick SSP5 (index 2).
    act(() => { fireEvent.change(select, { target: { value: '2' } }) })

    await act(async () => { fireEvent.click(getByTestId('aesa-sidebar-compute')) })

    await waitFor(() => expect(client.computeAESA).toHaveBeenCalled())
    const arg = (client.computeAESA as any).mock.calls.at(-1)[0]
    // The CHOSEN scenario's result is passed inline; the shared multi task_id is not used.
    expect(arg.impact_result?.task_id).toBe('r-ssp5')
    expect(arg.impact_task_id).toBeNull()
  })

  it('defaults to scenario 1 reaching compute when unchanged', async () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => getByTestId('aesa-lci-scenario-select'))
    await act(async () => { fireEvent.click(getByTestId('aesa-sidebar-compute')) })
    await waitFor(() => expect(client.computeAESA).toHaveBeenCalled())
    const arg = (client.computeAESA as any).mock.calls.at(-1)[0]
    expect(arg.impact_result?.task_id).toBe('r-ssp1')
  })
})
