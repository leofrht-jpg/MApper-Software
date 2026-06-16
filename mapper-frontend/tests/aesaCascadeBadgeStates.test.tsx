/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAConfiguration, AESADefaultsBundle, DSMSystemState, SharingPreset, SystemDefinition,
} from '../src/api/client'

// Patch 4W (Issue 1) — cascade scenario badge has three states:
//
//   1. Session mode (activeSessionId !== null) → ALWAYS suppress.
//      Session is self-contained; live runs map is empty by design.
//      Already locked in by Patch 4U.
//   2. Live mode + empty runs map (just-arrived state) → suppress.
//      Annotating EVERY scenario with "no run" is noise — user
//      hasn't run Impact Assessment yet; per-scenario badging
//      adds nothing.
//   3. Live mode + partial runs map (multi-DSM fan-out, some
//      scenarios cached) → show badge for missing scenarios.
//      Comparative information IS useful here: "SSP1 has a cached
//      Prospective run, SSP2 doesn't, pick the one you want to
//      load into AESA."
//
// The previous behaviour (badge on every scenario when runs map
// was empty) caused the screenshot the user reported: "SSP1 ·
// no Prospective run" while sitting at AESA with no runs cached.

const SYSTEM: SystemDefinition = {
  id: 'sys-1', name: 'WP5 - DK', unit_name: 'vehicles',
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
} as any

const SYSTEM_STATE: DSMSystemState = {
  scenarios: [
    { id: 'base', name: 'Base', is_base: true } as any,
    { id: 'ssp1', name: 'SSP1', is_base: false } as any,
    { id: 'ssp2', name: 'SSP2', is_base: false } as any,
  ],
  active_scenario_id: 'ssp1',
} as any

const SHARING: SharingPreset = {
  id: 'p1', name: 'Preset', description: '',
  principles: [], category_assignments: [],
  chain: { layers: [] } as any,
} as any

const DEFAULTS: AESADefaultsBundle = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' } as any],
  default_multi_d: { tiers: [] } as any,
  default_carbon_budget: null as any,
} as any

const CFG: AESAConfiguration = {
  id: 'cfg-1', name: 'Cfg', mfa_system_id: 'sys-1',
  impact_mode: 'projected', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-08T10:00:00Z',
  dsm_scenario_id: 'ssp1',
} as any

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([CFG])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM,
    systemState: SYSTEM_STATE,
  })
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING],
    configurations: [CFG], activeConfigId: CFG.id,
    creatingNewConfig: false,
    sessions: [], sessionsLoading: false,
    activeSessionId: null,  // LIVE mode
    draft: {
      name: CFG.name, boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'projected', dsm_scenario_id: 'ssp1',
    },
    result: null, lastRunAt: null, running: false, error: null,
    displayedIndicators: null,
  } as any)
})

describe('cascade badge — empty runs map suppression (Patch 4W Issue 1)', () => {
  it('does NOT badge any scenario when runs maps are empty in live mode', () => {
    useImpactStore.setState({
      staticResult: null, projectedResult: null,
      staticDsmScenarioRuns: {},
      projectedDsmScenarioRuns: {},
    } as any)
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = container.querySelector('[data-testid="aesa-cascade-scenario"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? '')
    for (const text of optionTexts) {
      expect(text).not.toContain('no Prospective run')
      expect(text).not.toContain('no Static run')
    }
  })

  it('DOES badge the missing scenario when runs map has SOME entries (multi-DSM partial)', () => {
    // Multi-DSM fan-out cached SSP1 but not SSP2 — comparative info
    // is meaningful here, so the SSP2 option should carry the badge.
    useImpactStore.setState({
      staticResult: null,
      projectedResult: { meta: {}, results: [] } as any,
      staticDsmScenarioRuns: {},
      projectedDsmScenarioRuns: { ssp1: { result: {} } as any },
    } as any)
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = container.querySelector('[data-testid="aesa-cascade-scenario"]') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? '')
    const ssp1 = optionTexts.find((t) => t.startsWith('SSP1')) ?? ''
    const ssp2 = optionTexts.find((t) => t.startsWith('SSP2')) ?? ''
    expect(ssp1).not.toContain('no Prospective run')  // cached, no badge
    expect(ssp2).toContain('no Prospective run')      // missing, badge present
  })

  it('does NOT badge any scenario when ALL scenarios have cached runs', () => {
    useImpactStore.setState({
      staticResult: null,
      projectedResult: { meta: {}, results: [] } as any,
      staticDsmScenarioRuns: {},
      projectedDsmScenarioRuns: {
        base: { result: {} } as any,
        ssp1: { result: {} } as any,
        ssp2: { result: {} } as any,
      },
    } as any)
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = container.querySelector('[data-testid="aesa-cascade-scenario"]') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? '')
    for (const text of optionTexts) {
      expect(text).not.toContain('no Prospective run')
    }
  })
})
