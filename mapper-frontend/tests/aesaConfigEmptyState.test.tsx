/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESADefaultsBundle, AESAConfiguration,
  SharingPreset, SystemDefinition, DSMSystemState,
} from '../src/api/client'

// Patch 4Q — empty-state guidance in AESA Configuration sidebar.
// When a project has zero saved configurations AND the user hasn't
// started a new one, the cascade + sections are hidden behind an
// empty-state block prompting "Create your first configuration".
//
// Tests cover:
//   - Empty state renders when configurations=[] and !creatingNewConfig.
//   - Cascade + footer absent in empty state (the gates that flip both off).
//   - Clicking the inline "Create your first configuration" button
//     fires startNewConfig → empty state disappears, cascade renders.
//   - Empty state hides when at least one config exists.
//   - Empty state hides when activeConfigId is set (existing config selected).

const SYSTEM: SystemDefinition = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const SYSTEM_STATE: DSMSystemState = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenarios: [{ id: 'base', name: 'Base', is_base: true } as any],
  active_scenario_id: 'base',
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

const SAVED_CONFIG: AESAConfiguration = {
  id: 'cfg-1', name: 'My config', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-01-01',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM,
    systemState: SYSTEM_STATE,
  })
  useImpactStore.setState({
    staticResult: null,
    projectedResult: null,
    staticDsmScenarioRuns: {},
    projectedDsmScenarioRuns: {},
  })
  // Reset AESA store to its empty initial shape — no configs, no
  // active id, no draft, not creating.
  useAESAStore.setState({
    defaults: DEFAULTS,
    presets: [SHARING],
    configurations: [],
    activeConfigId: null,
    draft: null,
    creatingNewConfig: false,
    result: null,
    lastRunAt: null,
    running: false,
    error: null,
  })
})

describe('AESA Configuration empty state (Patch 4Q)', () => {
  it('shows the empty state when no configs exist and no creation in flight', () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(getByTestId('aesa-config-empty-state')).toBeInTheDocument()
  })

  it('hides the cascade and footer in the empty state', () => {
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // Cascade-level testids absent — the gate `!showEmptyState && draft && ...`
    // short-circuits before the cascade renders.
    expect(queryByTestId('aesa-cascade-model')).toBeNull()
    expect(queryByTestId('aesa-cascade-scenario')).toBeNull()
  })

  it('clicking "Create your first configuration" hides the empty state', async () => {
    const { getByTestId, queryByTestId, findByTestId } = render(
      <ConfigSidebar collapsed={false} onToggle={() => {}} />,
    )
    expect(getByTestId('aesa-config-empty-state')).toBeInTheDocument()
    fireEvent.click(getByTestId('aesa-config-empty-state-create'))
    // After click: creatingNewConfig=true → empty state removed,
    // cascade rendered.
    await waitFor(() => {
      expect(queryByTestId('aesa-config-empty-state')).toBeNull()
    })
    expect(await findByTestId('aesa-cascade-model')).toBeInTheDocument()
  })

  it('hides the empty state when a saved configuration exists', () => {
    useAESAStore.setState({
      configurations: [SAVED_CONFIG],
      // activeConfigId still null — listing exists but none selected
      // is enough to suppress the empty state. The user has at least
      // one config to fall back to.
    })
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(queryByTestId('aesa-config-empty-state')).toBeNull()
  })

  it('hides the empty state when an existing config is loaded (activeConfigId set)', () => {
    useAESAStore.setState({
      configurations: [SAVED_CONFIG],
      activeConfigId: SAVED_CONFIG.id,
      // draft seeded by `setActiveConfig` would be needed for the
      // cascade to render; here we just confirm the empty-state gate
      // is closed regardless.
    })
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(queryByTestId('aesa-config-empty-state')).toBeNull()
  })

  it('hides the empty state when creatingNewConfig is true (post page-header click)', () => {
    // Simulates the user clicking "+ New configuration" in the
    // AESADashboard page header, which calls `startNewConfig`.
    useAESAStore.getState().startNewConfig()
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(queryByTestId('aesa-config-empty-state')).toBeNull()
  })
})

describe('startNewConfig store action (Patch 4Q)', () => {
  it('flips creatingNewConfig and seeds a fresh draft from defaults', () => {
    expect(useAESAStore.getState().creatingNewConfig).toBe(false)
    expect(useAESAStore.getState().draft).toBeNull()
    useAESAStore.getState().startNewConfig()
    expect(useAESAStore.getState().creatingNewConfig).toBe(true)
    // Draft seeded — the cascade renders against this immediately.
    expect(useAESAStore.getState().draft).not.toBeNull()
    // activeConfigId stays null — no real saved config yet.
    expect(useAESAStore.getState().activeConfigId).toBeNull()
  })

  it('resets creatingNewConfig when an existing config is selected', () => {
    useAESAStore.getState().startNewConfig()
    expect(useAESAStore.getState().creatingNewConfig).toBe(true)
    useAESAStore.setState({ configurations: [SAVED_CONFIG] })
    useAESAStore.getState().setActiveConfig(SAVED_CONFIG.id)
    expect(useAESAStore.getState().creatingNewConfig).toBe(false)
  })
})
