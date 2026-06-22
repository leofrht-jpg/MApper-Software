/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle, AESASession,
  DSMSystemState, SharingPreset, SystemDefinition,
} from '../src/api/client'

// Patch 4AC — Compute / Save / Run-sensitivity moved from a
// separate sidebar footer into the Configuration header row,
// alongside the collapse chevron. Co-locates the primary actions
// with the section they apply to (no spatial gap). Icons follow
// the Patch 4Z icon-only convention; the contextual hint / error
// row directly below the header surfaces "why Compute is disabled"
// for users who don't hover.
//
// What this test suite locks in:
//   1. Compute, Save, Run-sensitivity, Return-to-live all appear in
//      the HEADER (not a separate footer block).
//   2. No <footer> element renders.
//   3. Session-loaded mode swaps Compute → Return-to-live in the
//      header position (Patch 4R semantics preserved).
//   4. Compute click still fires the compute action.
//   5. Save click still fires saveConfig (the configuration-template
//      save, Patch 4Y).
//   6. Hint row surfaces gating reasons when Compute is disabled.

const SYSTEM: SystemDefinition = {
  id: 'sys-1', name: 'WP5', unit_name: 'vehicles',
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
} as any

const SYSTEM_STATE: DSMSystemState = {
  scenarios: [{ id: 'base', name: 'Base', is_base: true } as any],
  active_scenario_id: 'base',
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
  id: 'cfg-1', name: 'cfg', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-11T10:00:00Z',
  dsm_scenario_id: 'base',
} as any

const RESULT: AESAComputeResult = {
  config_id: 'cfg-1', results: [], summary_by_year: [], missing_categories: [],
} as any

const SESSION: AESASession = {
  id: 'ses-1', name: 'Saved', project: 'p',
  created_at: '2026-05-11T10:00:00Z', modified_at: '2026-05-11T10:00:00Z',
  configuration_snapshot: CFG, result: RESULT,
  upstream_ia_task_id: null, displayed_indicators: null,
}

function setStores({
  activeSession = null as string | null,
  impactReady = true,
  computeSpy = vi.fn().mockResolvedValue(undefined),
  saveSpy = vi.fn().mockResolvedValue(CFG),
  error = null as string | null,
} = {}) {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  try { window.localStorage.clear() } catch { /* noop */ }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([CFG])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([SESSION])
  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM, systemState: SYSTEM_STATE,
  })
  useImpactStore.setState({
    // handleCompute reads activeImpact.task_id to decide between
    // task-id and inline-result paths. Provide a non-mirror task_id
    // so the click goes through the task-id path; both branches
    // call `compute(...)` so the test target is reachable either
    // way.
    staticResult: impactReady ? ({ meta: {}, results: [], task_id: 'task-static-1' } as any) : null,
    projectedResult: null,
    staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {},
  } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING],
    configurations: [CFG], activeConfigId: CFG.id,
    creatingNewConfig: false,
    sessions: [SESSION], sessionsLoading: false,
    activeSessionId: activeSession,
    draft: {
      name: 'cfg', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: 'base',
    },
    result: activeSession ? RESULT : null,
    lastRunAt: null, running: false, error,
    displayedIndicators: null,
    compute: computeSpy as any,
    saveConfig: saveSpy as any,
  } as any)
}

describe('Configuration header carries primary actions (Patch 4AC)', () => {
  beforeEach(() => setStores())

  it('Compute button renders INSIDE the <header>, not in a footer', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    expect(header).not.toBeNull()
    const computeInHeader = within(header).queryByTestId('aesa-sidebar-compute')
    expect(computeInHeader).not.toBeNull()
  })

  it('Save (configuration template) renders in the header', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    const save = within(header).queryByTestId('aesa-save-config')
    expect(save).not.toBeNull()
    expect(save?.getAttribute('title')).toContain('configuration template')
    expect(save?.getAttribute('aria-label')).toContain('configuration template')
  })

  it('Run-sensitivity toggle renders in the header (inline with Compute)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).queryByTestId('aesa-run-sensitivity-toggle')).not.toBeNull()
  })

  it('NO <footer> element renders in the sidebar', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // The pre-Patch-4AC footer was a `<footer>` child of `<aside>`.
    // Patch 4AC removed it entirely — header owns the actions.
    expect(container.querySelector('footer')).toBeNull()
  })

  it('Compute is icon-only (no visible "Compute" label text)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const compute = container.querySelector('[data-testid="aesa-sidebar-compute"]') as HTMLElement
    // textContent is empty (icon-only) — title carries the affordance text.
    expect(compute.textContent?.trim()).toBe('')
    expect(compute.getAttribute('aria-label')).toBe('Compute')
  })

  it('clicking Compute calls the compute action with current draft + flag', async () => {
    const computeSpy = vi.fn().mockResolvedValue(undefined)
    setStores({ computeSpy })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const compute = container.querySelector('[data-testid="aesa-sidebar-compute"]') as HTMLElement
    fireEvent.click(compute)
    expect(computeSpy).toHaveBeenCalledOnce()
    const arg = computeSpy.mock.calls[0][0]
    // Sensitivity defaults to true (the toggle starts checked); the
    // compute payload reflects whatever the toggle was when clicked.
    expect(arg.runSensitivity).toBe(true)
    expect(arg.mfaSystemId).toBe('sys-1')
  })

  it('clicking Save invokes saveConfig (the configuration-template save)', () => {
    const saveSpy = vi.fn().mockResolvedValue(CFG)
    setStores({ saveSpy })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const save = container.querySelector('[data-testid="aesa-save-config"]') as HTMLElement
    fireEvent.click(save)
    expect(saveSpy).toHaveBeenCalledOnce()
    expect(saveSpy.mock.calls[0][0]).toBe('sys-1')
  })
})

describe('session-loaded mode swap (Patch 4AC preserves Patch 4R semantics)', () => {
  it('shows Return-to-live in the header instead of Compute when a session is loaded', () => {
    setStores({ activeSession: SESSION.id })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).queryByTestId('aesa-sidebar-return-to-live')).not.toBeNull()
    expect(within(header).queryByTestId('aesa-sidebar-compute')).toBeNull()
    expect(within(header).queryByTestId('aesa-save-config')).toBeNull()
    expect(within(header).queryByTestId('aesa-run-sensitivity-toggle')).toBeNull()
  })

  it('Return-to-live is icon-only with title + aria-label', () => {
    setStores({ activeSession: SESSION.id })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const btn = container.querySelector('[data-testid="aesa-sidebar-return-to-live"]') as HTMLElement
    expect(btn.textContent?.trim()).toBe('')
    expect(btn.getAttribute('title')).toBe('Return to live view')
    expect(btn.getAttribute('aria-label')).toBe('Return to live view')
  })
})

describe('contextual hint row surfaces gating reasons (Patch 4AC)', () => {
  it('shows "Run the Static LCI first" when no impact result is available', () => {
    setStores({ impactReady: false })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const hint = container.querySelector('[data-testid="aesa-sidebar-hint"]') as HTMLElement
    expect(hint).not.toBeNull()
    expect(hint.textContent).toContain('Static LCI')
  })

  it('renders error in the hint row (danger color)', () => {
    setStores({ error: 'Compute backend failed' })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const hint = container.querySelector('[data-testid="aesa-sidebar-hint"]') as HTMLElement
    expect(hint).not.toBeNull()
    expect(hint.textContent).toContain('Compute backend failed')
  })

  it('hides the hint row when there are no gating reasons', () => {
    setStores({ impactReady: true, error: null })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(container.querySelector('[data-testid="aesa-sidebar-hint"]')).toBeNull()
  })

  it('hides the hint row in session-loaded mode (cascade is read-only)', () => {
    setStores({ activeSession: SESSION.id, impactReady: false })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(container.querySelector('[data-testid="aesa-sidebar-hint"]')).toBeNull()
  })
})
