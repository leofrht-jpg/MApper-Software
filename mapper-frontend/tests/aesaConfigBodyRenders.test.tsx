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
import { render, waitFor, cleanup, act } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// Patch 5AP — the AESA CONFIGURATION sidebar rendered header-only (the whole
// config-form body gone). Root cause: reset() (project change / bw2-project
// re-sync) nulls `draft` but keeps `defaults`; loadDefaults' early-return
// (`if (defaults) return`) then skipped rebuilding the draft, so a null draft
// + non-null defaults gated the body off (`!showEmptyState && draft &&
// defaults && boundarySet`). The existing cascade tests seed `draft` directly,
// so they never exercised the null-draft-with-defaults state — AND they used a
// `default_carbon_budget: null` mock, so the real 5AO non-null carbon-budget
// shape (CarbonBudgetEditor) was never rendered. This test does both.

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }
const STATIC_RESULT: any = { task_id: 't', meta: { mode: 'static', mfa_system_id: 'sys-1', scope: 'stock' }, results: [] }

const SHARING: any = {
  id: 'preset-1', name: 'Ferhati 2026 Multi-D', description: '', built_in: true,
  principles: [], category_assignments: [], chain: { layers: [] },
}

// The REAL fresh-default carbon budget (5AO): IPCC AR6 2.0°C/50th 1150 Gt ×
// SSP2-4.5 over 2025–2050 — a NON-NULL CarbonBudgetConfig (unlike the prior
// cascade-test mock which used null).
const DEFAULT_CB: any = {
  initial_budget_gt: 1150,
  budget_source: 'IPCC AR6 WG1 Table SPM.2',
  start_year: 2025,
  end_year: 2050,
  ssp_scenario: 'SSP2-4.5',
  projected_emissions: { 2025: 40, 2030: 38, 2035: 34, 2040: 30, 2045: 26, 2050: 22 },
  provisional: true,
}

const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }],
  multi_d_defaults: [],
  sharing_data: {},
  ssp_trajectories: [
    { id: 'SSP2-4.5', name: 'SSP2-4.5 (middle of the road)', projected_emissions: DEFAULT_CB.projected_emissions },
  ],
  carbon_budget_options: [
    { id: 'IPCC_AR6_2C_50', name: 'IPCC AR6 — 2.0°C, 50th percentile', remaining_gt_from_2025: 1150, source: 'IPCC AR6 WG1 Table SPM.2' },
  ],
  default_multi_d: { tiers: [] },
  default_carbon_budget: DEFAULT_CB,
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
})

afterEach(cleanup)

describe('AESA ConfigSidebar body renders (Patch 5AP)', () => {
  it('renders the config-form BODY when defaults are cached but draft was nulled (post-reset)', async () => {
    // The header-only bug state: defaults set, draft null, configs present →
    // showEmptyState false. Pre-fix, loadDefaults early-returned and never
    // rebuilt the draft, so the body fieldset never rendered.
    useAESAStore.setState({
      defaults: DEFAULTS,
      defaultsLoading: false,
      presets: [SHARING],
      draft: null,
      configurations: [ONE_CONFIG],
      activeConfigId: null,
      creatingNewConfig: false,
      activeSessionId: null,
      configLoadError: null,
      error: null,
    })

    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)

    // The mount effect calls loadDefaults → (fix) rebuilds the draft from the
    // cached defaults → the body fieldset renders. Empty-state must NOT show
    // (configs exist), and no config-load error banner.
    await waitFor(() => expect(queryByTestId('aesa-config-fieldset')).not.toBeNull())
    expect(queryByTestId('aesa-config-empty-state')).toBeNull()
    expect(queryByTestId('aesa-config-load-error')).toBeNull()
    // The real (non-null) carbon-budget shape rendered through CarbonBudgetEditor.
    expect(useAESAStore.getState().draft?.carbon_budget?.initial_budget_gt).toBe(1150)
  })

  it('reset() rebuilds the draft from cached defaults (never null-with-defaults)', () => {
    useAESAStore.setState({ defaults: DEFAULTS, presets: [SHARING], draft: null })
    act(() => { useAESAStore.getState().reset() })
    const draft = useAESAStore.getState().draft
    expect(draft).not.toBeNull()
    expect(draft?.carbon_budget?.initial_budget_gt).toBe(1150)
  })

  it('reset() leaves draft null only when defaults are not yet loaded', () => {
    useAESAStore.setState({ defaults: null, presets: [], draft: { name: 'x' } as any })
    act(() => { useAESAStore.getState().reset() })
    expect(useAESAStore.getState().draft).toBeNull()
  })
})
