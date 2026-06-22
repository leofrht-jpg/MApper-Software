/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// The CO₂ / CO₂-eq budget-basis toggle must live in the CARBON BUDGET CONFIG
// (CarbonBudgetEditor), visible BEFORE any compute — not only in the SR results
// view (its prior home, gated on `result`). Default CO₂-eq; flips budget_basis
// on the draft (pre-compute setting).

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

describe('Budget-basis toggle in the carbon-budget config', () => {
  it('renders in the budget config on a fresh load with NO compute, default CO₂-eq', async () => {
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-budget-basis')).not.toBeNull())
    // No compute has run — the toggle does NOT require SR results.
    expect(useAESAStore.getState().result).toBeNull()
    // Fresh draft defaults to the CO₂-eq basis.
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2e_GHG')
    expect(queryByTestId('aesa-config-budget-basis-CO2e_GHG')?.getAttribute('aria-pressed')).toBe('true')
    expect(queryByTestId('aesa-config-budget-basis-CO2')?.getAttribute('aria-pressed')).toBe('false')
    // Tooltip note present.
    expect(queryByTestId('aesa-config-budget-basis-note')).not.toBeNull()
  })

  it('clicking CO₂ flips budget_basis on the draft (no result required)', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-budget-basis-CO2')).not.toBeNull())
    fireEvent.click(getByTestId('aesa-config-budget-basis-CO2'))
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2')
    // And back to CO₂-eq.
    fireEvent.click(getByTestId('aesa-config-budget-basis-CO2e_GHG'))
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2e_GHG')
    // Still no compute triggered from the config toggle (pre-compute setting).
    expect(useAESAStore.getState().result).toBeNull()
  })

  // Issue 2 regression guard — the toggle must exist in the carbon-budget
  // config under the LIVE default budget shape (2.0°C/50, 1150 Gt, SSP1-2.6,
  // CO₂-eq) on a fresh load with no compute. DEFAULTS above mirror that live
  // default (default_carbon_budget). The toggle lives inside the "Carbon
  // budget" CollapsibleSection, which defaults collapsed (Patch 4U) — it's
  // present in the DOM and reachable by expanding, the chosen behaviour. This
  // locks DOM presence so the control cannot silently be removed from source
  // again, independent of the section's collapse state.
  it('renders under the live default budget (2C/50, 1150 Gt, SSP1-2.6) with no compute', async () => {
    expect(DEFAULTS.default_carbon_budget.initial_budget_gt).toBe(1150)
    expect(DEFAULTS.default_carbon_budget.ssp_scenario).toBe('SSP1-2.6')
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-budget-basis')).not.toBeNull())
    expect(useAESAStore.getState().result).toBeNull()
    // Fresh draft inherits the live default → CO₂-eq active.
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2e_GHG')
    expect(queryByTestId('aesa-config-budget-basis-CO2e_GHG')?.getAttribute('aria-pressed')).toBe('true')
  })
})
