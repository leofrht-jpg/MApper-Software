/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// Issue 1 — the two numbered config sections ("1 LCIA configuration",
// "2 AESA configuration") are collapsible via the standard visibility-toggle
// pattern: default expanded, the numbered header toggles, the body STAYS
// MOUNTED (display:none) when collapsed — never conditional-unmount (that's
// the Issue-2 failure class — a control vanishing because an ancestor stopped
// rendering it).

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }
const STATIC_RESULT: any = { task_id: 't', meta: { mode: 'static', mfa_system_id: 'sys-1', scope: 'stock' }, results: [] }
const SHARING: any = { id: 'preset-1', name: 'Ferhati 2026 Multi-D', built_in: true, principles: [], category_assignments: [], chain: { layers: [] } }
const DEFAULT_CB: any = {
  initial_budget_gt: 1150, budget_source: 'IPCC AR6 WG1 Table SPM.2', start_year: 2025, end_year: 2100,
  ssp_scenario: 'SSP1-2.6', projected_emissions: { 2025: 40, 2050: 10 },
  co2e_conversion: { kind: 'ratio', factor: 1.4846, source: 'AR6 2C-analog' }, provisional: true,
}
const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }],
  multi_d_defaults: [], sharing_data: {},
  ssp_trajectories: [{ id: 'SSP1-2.6', name: 'SSP1-2.6', projected_emissions: DEFAULT_CB.projected_emissions }],
  carbon_budget_options: [{ id: 'IPCC_AR6_2C_50', name: 'IPCC AR6 — 2.0°C, 50th', remaining_gt_from_2025: 1150, source: 'IPCC AR6', co2e_conversion: DEFAULT_CB.co2e_conversion }],
  default_multi_d: { tiers: [] }, default_carbon_budget: DEFAULT_CB,
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  useDSMStore.setState({ systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never], activeSystem: SYSTEM, systemState: SYSTEM_STATE })
  useImpactStore.setState({ staticResult: STATIC_RESULT, projectedResult: null })
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [SHARING], draft: null,
    configurations: [], activeConfigId: null, creatingNewConfig: true,
    activeSessionId: null, configLoadError: null, error: null, result: null, lastComputeArgs: null,
  } as any)
})

afterEach(cleanup)

const display = (el: HTMLElement | null) => el && getComputedStyle(el).display

describe('Issue 1 — numbered config sections are collapsible', () => {
  it('default expanded: both stage bodies render with display:block', async () => {
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-stage-1-body')).not.toBeNull())
    expect(display(queryByTestId('aesa-stage-1-body'))).toBe('block')
    expect(display(queryByTestId('aesa-stage-2-body'))).toBe('block')
  })

  it('clicking a header collapses via visibility-toggle — body stays in the DOM', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-stage-1-toggle')).not.toBeNull())

    fireEvent.click(getByTestId('aesa-stage-1-toggle'))
    const body1 = queryByTestId('aesa-stage-1-body')
    expect(body1).not.toBeNull()              // still MOUNTED (not unmounted)
    expect(display(body1)).toBe('none')       // hidden via CSS only
    // The carbon-budget toggle inside stage 2 is unaffected by collapsing stage 1.
    expect(queryByTestId('aesa-config-budget-basis')).not.toBeNull()

    fireEvent.click(getByTestId('aesa-stage-1-toggle'))
    expect(display(queryByTestId('aesa-stage-1-body'))).toBe('block')  // re-expands
  })

  it('each section collapses independently', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-stage-2-toggle')).not.toBeNull())
    fireEvent.click(getByTestId('aesa-stage-2-toggle'))
    expect(display(queryByTestId('aesa-stage-2-body'))).toBe('none')
    // Stage 1 untouched.
    expect(display(queryByTestId('aesa-stage-1-body'))).toBe('block')
  })
})
