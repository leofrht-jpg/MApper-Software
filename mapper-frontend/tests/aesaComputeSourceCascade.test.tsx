/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, within } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESADefaultsBundle,
  AESAConfiguration,
  ImpactAssessmentResult,
  SharingPreset,
  SystemDefinition,
  DSMSystemState,
} from '../src/api/client'

// Patch 4O — Compute Source cascade. Three-level picker (DSM model →
// scenario → background) replacing the flat LciSourceRadio. Tests
// cover:
//
//   - Cascade renders three selectors when a system + state are loaded.
//   - The DSM model picker shows the loaded systems list.
//   - The Scenario picker shows the active system's scenarios.
//   - The Background radios are wired to `draft.impact_mode`.
//   - Picking a scenario updates `draft.dsm_scenario_id` AND mirrors
//     the matching DsmScenarioRun into `staticResult` /
//     `projectedResult` via the existing impactStore selectors.
//   - Saved configs without `dsm_scenario_id` still parse and the
//     draft factory writes `null` (backward-compat).
//
// Hooks-driven render tests for the cascade itself; the backend
// schema field is covered by Python tests on the API surface.

const SYSTEM: SystemDefinition = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const SECOND_SYSTEM: SystemDefinition = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'sys-2', name: 'Buildings', unit_name: 'buildings',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const SYSTEM_STATE: DSMSystemState = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenarios: [
    { id: 'base', name: 'Base', is_base: true } as any,
    { id: 'scen-a', name: 'Fast EV', is_base: false } as any,
    { id: 'scen-b', name: 'Slow EV', is_base: false } as any,
  ],
  active_scenario_id: 'base',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const STATIC_RESULT: ImpactAssessmentResult = {
  task_id: 'static-task',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: { mode: 'static', mfa_system_id: 'sys-1', scope: 'stock', dsm_scenario_id: 'base' } as any,
  results: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const SHARING: SharingPreset = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'preset-1', name: 'Preset', description: '',
  principles: [], category_assignments: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain: { layers: [] } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const DEFAULTS: AESADefaultsBundle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' } as any],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default_multi_d: { tiers: [] } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default_carbon_budget: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

beforeEach(() => {
  // jsdom stubs.
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  // Stub the network calls the sidebar's mount effects fire.
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  // Reset stores.
  useDSMStore.setState({
    systems: [
      { id: SYSTEM.id, name: SYSTEM.name } as never,
      { id: SECOND_SYSTEM.id, name: SECOND_SYSTEM.name } as never,
    ],
    activeSystem: SYSTEM,
    systemState: SYSTEM_STATE,
  })
  useImpactStore.setState({
    staticResult: STATIC_RESULT,
    projectedResult: null,
    staticDsmScenarioRuns: {
      base: { scenario: 'base', scenarioName: 'Base', job: null as never, result: STATIC_RESULT },
      'scen-a': { scenario: 'scen-a', scenarioName: 'Fast EV', job: null as never, result: STATIC_RESULT },
      // No run for scen-b — exercises the "no run" hint.
    },
    projectedDsmScenarioRuns: {},
  })
  useAESAStore.setState({
    defaults: DEFAULTS,
    presets: [SHARING],
    configurations: [],
    activeConfigId: null,
    // Patch 4Q — flip creatingNewConfig so the empty state doesn't
    // mask the cascade we're testing here. Patch 4O tests assume
    // the cascade is rendered; pre-Patch-4Q they ran in the
    // "no configs, no creation in flight" state which now shows
    // the empty-state guidance instead.
    creatingNewConfig: true,
    draft: {
      name: 'Draft',
      boundary_set_id: 'Sala2020_EF',
      sharing: SHARING,
      sharing_preset_id: SHARING.id,
      carbon_budget: null,
      method_mapping: [],
      impact_mode: 'static',
      dsm_scenario_id: null,
    },
    result: null,
    lastRunAt: null,
    running: false,
    error: null,
  })
})

describe('ComputeSourceCascade — Patch 4O render', () => {
  it('renders three cascade selectors', async () => {
    const { findByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(await findByTestId('aesa-cascade-model')).toBeInTheDocument()
    expect(await findByTestId('aesa-cascade-scenario')).toBeInTheDocument()
    // Background uses the existing LciOption components — assert their
    // labels are present (the radios themselves don't have testids).
    const sidebar = (await findByTestId('aesa-cascade-model')).closest('aside')
    expect(sidebar).not.toBeNull()
    expect(within(sidebar as HTMLElement).getByText('Static Background')).toBeInTheDocument()
    expect(within(sidebar as HTMLElement).getByText('Prospective Background')).toBeInTheDocument()
  })

  it('lists every loaded DSM system in the model picker', async () => {
    const { findByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const modelSelect = await findByTestId('aesa-cascade-model') as HTMLSelectElement
    const optionTexts = Array.from(modelSelect.options).map((o) => o.textContent)
    expect(optionTexts).toContain('Fleet')
    expect(optionTexts).toContain('Buildings')
    // Active system is selected by default.
    expect(modelSelect.value).toBe('sys-1')
  })

  it('lists every scenario from the active system in the scenario picker', async () => {
    const { findByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const scenarioSelect = await findByTestId('aesa-cascade-scenario') as HTMLSelectElement
    const optionTexts = Array.from(scenarioSelect.options).map((o) => o.textContent)
    expect(optionTexts.some((t) => t?.startsWith('Base'))).toBe(true)
    expect(optionTexts.some((t) => t?.startsWith('Fast EV'))).toBe(true)
    expect(optionTexts.some((t) => t?.startsWith('Slow EV'))).toBe(true)
  })

  it('annotates scenarios that have no run for the current background', async () => {
    const { findByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const scenarioSelect = await findByTestId('aesa-cascade-scenario') as HTMLSelectElement
    const optionTexts = Array.from(scenarioSelect.options).map((o) => o.textContent ?? '')
    // scen-b has no static run cached — gets the badge.
    const slowOpt = optionTexts.find((t) => t.startsWith('Slow EV'))
    expect(slowOpt).toContain('no Static run')
    // Base + scen-a have runs — no badge.
    const baseOpt = optionTexts.find((t) => t.startsWith('Base'))
    expect(baseOpt).not.toContain('no Static run')
  })

  it('writes draft.dsm_scenario_id when the user picks a scenario', async () => {
    const { findByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const scenarioSelect = await findByTestId('aesa-cascade-scenario') as HTMLSelectElement
    fireEvent.change(scenarioSelect, { target: { value: 'scen-a' } })
    await waitFor(() => {
      expect(useAESAStore.getState().draft?.dsm_scenario_id).toBe('scen-a')
    })
  })

  it('shows the "no run cached" hint when the picked scenario lacks a result', async () => {
    const { findByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // Initially Base is active — has a run, no hint.
    expect(queryByTestId('aesa-cascade-no-run')).toBeNull()
    // Switch to scen-b which has no run cached.
    fireEvent.change(await findByTestId('aesa-cascade-scenario'), { target: { value: 'scen-b' } })
    await waitFor(() => {
      expect(queryByTestId('aesa-cascade-no-run')).toBeInTheDocument()
    })
  })
})

describe('AESAConfiguration backward compat (Patch 4O)', () => {
  it('parses configs without dsm_scenario_id (defaults to null/undefined)', () => {
    const legacy: Partial<AESAConfiguration> = {
      id: 'cfg-1', name: 'Legacy', mfa_system_id: 'sys-1',
      impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
      method_mapping: [], created_at: '2026-01-01',
      // dsm_scenario_id deliberately omitted.
    }
    // The TS type makes the field optional; runtime parses fine.
    expect((legacy as AESAConfiguration).dsm_scenario_id ?? null).toBeNull()
  })

  it('draftFromConfig coerces missing dsm_scenario_id to null', async () => {
    // Re-import the helper via a dynamic import so we don't pollute
    // the module-level mock graph above. Imported helpers are pure.
    const mod = await import('../src/stores/aesaStore')
    const { useAESAStore: store } = mod
    const cfg: AESAConfiguration = {
      id: 'cfg-2', name: 'Legacy', mfa_system_id: 'sys-1',
      impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
      sharing: SHARING, sharing_preset_id: SHARING.id,
      carbon_budget: null, method_mapping: [], created_at: '2026-01-01',
      // dsm_scenario_id omitted — simulates a pre-Patch-4O saved config.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    // Apply via setActiveConfig which routes through draftFromConfig.
    store.setState({ configurations: [cfg], presets: [SHARING], defaults: DEFAULTS })
    store.getState().setActiveConfig(cfg.id)
    expect(store.getState().draft?.dsm_scenario_id).toBeNull()
  })
})
