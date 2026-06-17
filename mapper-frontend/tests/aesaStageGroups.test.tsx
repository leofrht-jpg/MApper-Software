/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, within } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// Phase 3 — the Configuration sidebar is reorganized into 3 numbered stages:
//   1. LCIA configuration (SR numerator)  — Compute Source cascade
//   2. AESA configuration (carrying capacity) — PB set, Method→PB mapping,
//      sharing preset, downscaling chain, principles, assignments, carbon budget
//   3. Saved sessions
// Presentational only: same components/testids/store bindings, reparented.
// These assert the stage structure (headers + which section nests under which
// stage), NOT pixels. The whole-config NAME field stays GLOBAL (outside the
// stages) because it names the whole AESAConfiguration, not the Stage-2 template.

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }
const STATIC_RESULT: any = { task_id: 't', meta: { mode: 'static', mfa_system_id: 'sys-1', scope: 'stock' }, results: [] }
const SHARING: any = {
  id: 'preset-1', name: 'Ferhati 2026 Multi-D', description: '', built_in: true,
  principles: [], category_assignments: [], chain: { layers: [] },
}
const DEFAULT_CB: any = {
  initial_budget_gt: 1150, budget_source: 'IPCC AR6 WG1 Table SPM.2',
  start_year: 2025, end_year: 2050, ssp_scenario: 'SSP2-4.5',
  projected_emissions: { 2025: 40, 2030: 38, 2050: 22 }, provisional: true,
}
const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }],
  multi_d_defaults: [], sharing_data: {},
  ssp_trajectories: [{ id: 'SSP2-4.5', name: 'SSP2-4.5', projected_emissions: DEFAULT_CB.projected_emissions }],
  carbon_budget_options: [{ id: 'IPCC_AR6_2C_50', name: 'IPCC AR6 — 2.0°C, 50th', remaining_gt_from_2025: 1150, source: 'IPCC AR6' }],
  default_multi_d: { tiers: [] }, default_carbon_budget: DEFAULT_CB,
}
const ONE_CONFIG: any = {
  id: 'cfg-1', name: 'Saved cfg', mfa_system_id: 'sys-1', impact_mode: 'static',
  boundary_set_id: 'Sala2020_EF', sharing: SHARING, carbon_budget: DEFAULT_CB,
  method_mapping: [], created_at: '2025-01-01T00:00:00Z',
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([ONE_CONFIG])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  useDSMStore.setState({ systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never], activeSystem: SYSTEM, systemState: SYSTEM_STATE })
  useImpactStore.setState({ staticResult: STATIC_RESULT, projectedResult: null })
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [SHARING], draft: null,
    configurations: [ONE_CONFIG], activeConfigId: null, creatingNewConfig: false,
    activeSessionId: null, configLoadError: null, error: null,
  })
})

afterEach(cleanup)

async function renderSidebar() {
  const utils = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
  await waitFor(() => expect(utils.queryByTestId('aesa-config-fieldset')).not.toBeNull())
  return utils
}

describe('AESA ConfigSidebar — 3 numbered stages (Phase 3)', () => {
  it('renders the three numbered stage headers', async () => {
    const { getByTestId } = await renderSidebar()
    expect(within(getByTestId('aesa-stage-1')).getByText('LCIA configuration')).toBeTruthy()
    expect(within(getByTestId('aesa-stage-2')).getByText('AESA configuration (carrying capacity)')).toBeTruthy()
    expect(within(getByTestId('aesa-stage-3')).getByText(/Saved sessions/)).toBeTruthy()
  })

  it('Stage 1 holds the Compute Source cascade', async () => {
    const { getByTestId } = await renderSidebar()
    expect(within(getByTestId('aesa-stage-1')).getByText('Compute Source')).toBeTruthy()
  })

  it('Stage 2 holds the PB set AND the Method→PB mapping (moved under the PB set)', async () => {
    const { getByTestId } = await renderSidebar()
    const stage2 = getByTestId('aesa-stage-2')
    expect(within(stage2).getByText('Planetary Boundary set')).toBeTruthy()
    expect(within(stage2).getByTestId('aesa-collapsible-method-pb-mapping')).toBeTruthy()
  })

  it('the whole-config NAME field is GLOBAL — inside the fieldset but OUTSIDE all three stages', async () => {
    const { getByTestId } = await renderSidebar()
    const name = getByTestId('aesa-config-template-name')
    expect(name.closest('[data-testid="aesa-config-fieldset"]')).not.toBeNull()
    expect(name.closest('[data-testid="aesa-stage-1"]')).toBeNull()
    expect(name.closest('[data-testid="aesa-stage-2"]')).toBeNull()
    expect(name.closest('[data-testid="aesa-stage-3"]')).toBeNull()
  })

  it('Stage 3 (sessions) is OUTSIDE the config fieldset (stays interactive in session mode)', async () => {
    const { getByTestId } = await renderSidebar()
    const stage3 = getByTestId('aesa-stage-3')
    expect(stage3.closest('[data-testid="aesa-config-fieldset"]')).toBeNull()
  })
})
