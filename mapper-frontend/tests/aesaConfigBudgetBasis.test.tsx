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
import FIXTURE from './fixtures/aesaDefaultCarbonBudget.json'

// B9 — the live default budget comes from BACKEND data (carbon_budgets.json),
// so it is read from a backend-generated fixture rather than retyped here.
// `initial_budget_gt === 1150` as a bare literal made a budget-data edit break
// a frontend test, in a file that gave the backend author no hint their change
// caused it. `mapper-backend/tests/test_aesa_default_budget_fixture.py` fails
// FIRST on drift and says what to regenerate — the same tripwire the two other
// carbon-budget fixtures already carry.
const LIVE = FIXTURE.default_carbon_budget

// The CO₂ / CO₂-eq budget-basis toggle must live in the CARBON BUDGET CONFIG
// (CarbonBudgetEditor), visible BEFORE any compute — not only in the SR results
// view (its prior home, gated on `result`). Default CO₂-eq; flips budget_basis
// on the draft (pre-compute setting).

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }
const STATIC_RESULT: any = { task_id: 't', meta: { mode: 'static', mfa_system_id: 'sys-1', scope: 'stock' }, results: [] }
const SHARING: any = { id: 'preset-1', name: 'Ferhati 2026 Multi-D', built_in: true, principles: [], category_assignments: [], chain: { layers: [] } }
const DEFAULT_CB: any = {
  initial_budget_gt: LIVE.initial_budget_gt,
  budget_source: LIVE.budget_source,
  start_year: LIVE.start_year,
  end_year: LIVE.end_year,
  ssp_scenario: LIVE.ssp_scenario,
  // The pathway is a stub — these tests are about the basis toggle and its
  // labelling, not about the SSP series. Everything else mirrors the engine.
  projected_emissions: { 2025: 40, 2050: 10 },
  co2e_conversion: LIVE.co2e_conversion,
  provisional: LIVE.provisional,
}
const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }],
  multi_d_defaults: [], sharing_data: {},
  ssp_trajectories: [{ id: 'SSP1-2.6', name: 'SSP1-2.6', projected_emissions: DEFAULT_CB.projected_emissions }],
  carbon_budget_options: FIXTURE.budget_options.map((o) => ({
    id: o.id, name: o.name, remaining_gt_from_2025: o.remaining_gt_from_2025,
    source: 'IPCC AR6',
    co2e_conversion: { kind: 'ratio', factor: o.co2e_factor, source: 'AR6 analog' },
  })),
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
  it('renders under the live default budget with no compute', async () => {
    // Asserted against the backend fixture, not a retyped literal (B9).
    expect(DEFAULTS.default_carbon_budget.initial_budget_gt).toBe(LIVE.initial_budget_gt)
    expect(DEFAULTS.default_carbon_budget.ssp_scenario).toBe(LIVE.ssp_scenario)
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-budget-basis')).not.toBeNull())
    expect(useAESAStore.getState().result).toBeNull()
    // Fresh draft inherits the live default → CO₂-eq active.
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2e_GHG')
    expect(queryByTestId('aesa-config-budget-basis-CO2e_GHG')?.getAttribute('aria-pressed')).toBe('true')
  })

  // B2 — the rendered counterpart of tests/carbonBudgetBasisLabels.test.tsx,
  // which locks the helpers. This locks the SIDEBAR: a fresh draft is CO₂-eq,
  // so its sparkline caption must show the converted magnitude in CO₂-eq, not
  // the stored CO₂ scalar under a bare/CO₂ unit.
  it('the sparkline caption states the CONVERTED magnitude, labelled CO₂-eq', async () => {
    const { container, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-budget-basis')).not.toBeNull())
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2e_GHG')

    const caption = Array.from(container.querySelectorAll('div'))
      .map((n) => n.textContent ?? '')
      .find((t) => t.startsWith('Cumulative emissions vs'))
    expect(caption, 'sparkline caption not rendered').toBeTruthy()

    const converted = LIVE.initial_budget_gt * LIVE.co2e_conversion.factor
    expect(caption).toContain(converted.toFixed(1))
    expect(caption).toContain('CO₂-eq')
    // The whole point: no CO₂-only unit over a CO₂-eq magnitude, and not the
    // pre-basis scalar.
    expect(caption).not.toMatch(/Gt\s*CO(?:₂|2)(?!\s*(?:-eq|e\b))/i)
    expect(caption).not.toContain(String(LIVE.initial_budget_gt))
  })

  it('flipping to CO₂ puts the caption back on the published CO₂ budget', async () => {
    const { container, getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-budget-basis-CO2')).not.toBeNull())
    fireEvent.click(getByTestId('aesa-config-budget-basis-CO2'))
    const caption = Array.from(container.querySelectorAll('div'))
      .map((n) => n.textContent ?? '')
      .find((t) => t.startsWith('Cumulative emissions vs'))
    expect(caption).toContain(`${LIVE.initial_budget_gt} Gt CO₂`)
  })
})
