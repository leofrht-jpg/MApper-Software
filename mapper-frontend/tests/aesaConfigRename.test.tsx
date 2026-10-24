/* SPDX-License-Identifier: MPL-2.0 */
/**
 * ToDo 0.3.2: "AESA: renaming a configuration does not save." Driven through
 * the real ConfigSidebar and the real store saveConfig; only the HTTP calls
 * are stubbed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

const SHARING = { id: 'p1', name: 'Preset', description: '', principles: [], category_assignments: [], chain: { layers: [] } } as any
const DEFAULTS = { boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }], default_multi_d: { tiers: [] }, default_carbon_budget: null } as any
const SYSTEM = { id: 'sys-1', name: 'WP5', unit_name: 'vehicles', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } } as any
const CFG = {
  id: 'cfg-1', name: 'Old name', mfa_system_id: 'sys-1', impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: null, sharing_preset_id: null, carbon_budget: null, method_mapping: [], created_at: '2026-05-11T10:00:00Z',
  dsm_scenario_id: null,
} as any

let putSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockImplementation(async () => useAESAStore.getState().configurations)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  putSpy = vi.spyOn(client, 'updateAESAConfiguration').mockImplementation(async (id: string, body: any) => ({ ...CFG, ...body, id }))
  useDSMStore.setState({ systems: [{ id: 'sys-1', name: 'WP5' } as never], activeSystem: SYSTEM, systemState: { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' } as any })
  useImpactStore.setState({ staticResult: null, projectedResult: null, staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {} } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING], configurations: [CFG], activeConfigId: null,
    creatingNewConfig: false, sessions: [], activeSessionId: null, result: null, error: null, source: 'fleet',
  } as any)
  useAESAStore.getState().setActiveConfig('cfg-1')
})

describe('renaming a saved AESA configuration', () => {
  it('Save sends the new name and the list shows it', async () => {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await act(async () => {})
    const input = screen.getByTestId('aesa-config-template-name') as HTMLInputElement
    expect(input.value).toBe('Old name')
    fireEvent.change(input, { target: { value: 'New name' } })
    await act(async () => {})
    expect((screen.getByTestId('aesa-config-template-name') as HTMLInputElement).value).toBe('New name')
    await act(async () => { fireEvent.click(screen.getByTestId('aesa-save-config')) })
    await act(async () => {})
    expect(putSpy).toHaveBeenCalledTimes(1)
    expect((putSpy.mock.calls[0][1] as any).name).toBe('New name')
    const s = useAESAStore.getState()
    expect(s.configurations.find((c) => c.id === 'cfg-1')?.name).toBe('New name')
    expect((screen.getByTestId('aesa-config-template-name') as HTMLInputElement).value).toBe('New name')
  })
})

describe('the cause: Save was disabled with no DSM system selected', () => {
  async function renameAndSave() {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await act(async () => {})
    fireEvent.change(screen.getByTestId('aesa-config-template-name'), { target: { value: 'New name' } })
    const btn = screen.getByTestId('aesa-save-config') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    await act(async () => { fireEvent.click(btn) })
    await act(async () => {})
  }

  it('renames a single-product template while the toggle reads System-level', async () => {
    useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
    useAESAStore.setState({ configurations: [{ ...CFG, mfa_system_id: null }] } as any)
    useAESAStore.getState().setActiveConfig('cfg-1')
    await renameAndSave()
    expect(putSpy).toHaveBeenCalledTimes(1)
    const body = putSpy.mock.calls[0][1] as any
    expect(body.name).toBe('New name')
    expect(body.mfa_system_id).toBeNull()
    expect(useAESAStore.getState().configurations[0].name).toBe('New name')
  })

  it('renames a System-level template with no system selected and keeps its system', async () => {
    useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
    useAESAStore.getState().setActiveConfig('cfg-1')
    await renameAndSave()
    expect((putSpy.mock.calls[0][1] as any).mfa_system_id).toBe('sys-1')
  })

  it('a NEW System-level configuration still needs a system, and says so', async () => {
    useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
    useAESAStore.getState().setActiveConfig(null)
    useAESAStore.setState({ creatingNewConfig: true } as any)
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await act(async () => {})
    const btn = screen.getByTestId('aesa-save-config') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('Select a DSM system to save a new System-level configuration.')
    expect(screen.getByTestId('aesa-sidebar-hint').textContent).toContain('save a new configuration')
  })
})
