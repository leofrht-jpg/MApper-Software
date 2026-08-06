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
import { render, fireEvent, within, screen } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle, AESASession,
  DSMSystemState, SharingPreset, SystemDefinition,
} from '../src/api/client'

// Patch 5AS — the run-sensitivity control used to render as a checkbox plus a
// bare "σ" glyph in the Configuration header's icon cluster. Nothing on screen
// said what it did: the checkbox's accessible name was the glyph itself, and
// the explanation lived only in a title attribute. (An aria-label existed, but
// it sat on the wrapping <label>, where it does not name the input.)
//
// What this suite locks in:
//   1. The control has visible label text, "Sensitivity analysis".
//   2. That text is ASSOCIATED with the checkbox — getByLabelText resolves to
//      the input, so it is a real label, not adjacent text. This is the
//      assertion that fails if someone reverts to a glyph.
//   3. The label is typographically identical to the "Configuration" header
//      label it aligns under, which is why it reads as a named control.
//   4. The tooltip carries what the two words cannot: which five principles,
//      and what "off" means.
//   5. Behaviour is unchanged — it still drives `runSensitivity` in the
//      compute payload, both directions.
//   6. The glyph is gone from the rendered sidebar entirely.

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
  activeSystem = SYSTEM as SystemDefinition | null,
  impactReady = true,
  computeSpy = vi.fn().mockResolvedValue(undefined),
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
    activeSystem, systemState: activeSystem ? SYSTEM_STATE : null,
  } as any)
  useImpactStore.setState({
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
    lastRunAt: null, running: false, error: null,
    displayedIndicators: null,
    compute: computeSpy as any,
    saveConfig: vi.fn().mockResolvedValue(CFG) as any,
  } as any)
}

const LABEL = 'Sensitivity analysis'

describe('the sensitivity toggle is a named control, not a glyph (Patch 5AS)', () => {
  beforeEach(() => setStores())

  it('renders the label text inside the Configuration header', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).getByText(LABEL)).not.toBeNull()
  })

  it('the label is ASSOCIATED with the checkbox, not merely adjacent to it', () => {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // getByLabelText resolves through the label/control association. If the
    // text were a bare <span> next to the input, this throws.
    const input = screen.getByLabelText(LABEL) as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('checkbox')
    expect(input.id).toBe('aesa-run-sensitivity')
  })

  it('clicking the label text toggles the checkbox (a real label, not decoration)', () => {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const input = screen.getByLabelText(LABEL) as HTMLInputElement
    expect(input.checked).toBe(true) // sensitivity is on by default
    fireEvent.click(screen.getByText(LABEL))
    expect(input.checked).toBe(false)
  })

  it('no "σ" glyph survives anywhere in the sidebar', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(container.textContent).not.toContain('σ')
  })

  it('the tooltip explains what the two words cannot carry', () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const title = (getByTestId('aesa-run-sensitivity-toggle').getAttribute('title') ?? '').toLowerCase()
    // Which principles, and what OFF means — the two things the label omits.
    for (const p of ['epc', 'in', 'agr', 'la', 'ar']) expect(title).toContain(p)
    expect(title).toContain('box-plot')
    expect(title).toContain('off')
  })

  it('matches the typography of the "Configuration" label it sits under', () => {
    const { container, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    const configLabel = within(header).getByText('Configuration') as HTMLElement
    const toggle = getByTestId('aesa-run-sensitivity-toggle') as HTMLElement
    // Same header typography — the point of the fix is that it reads as a
    // peer of the section label rather than as a stray widget.
    for (const prop of ['fontSize', 'fontWeight', 'textTransform', 'letterSpacing', 'color'] as const) {
      expect(toggle.style[prop]).toBe(configLabel.style[prop])
    }
  })
})

describe('labelling the toggle did not change what it does', () => {
  it('compute receives runSensitivity: true while the box is ticked', () => {
    const computeSpy = vi.fn().mockResolvedValue(undefined)
    setStores({ computeSpy })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    fireEvent.click(container.querySelector('[data-testid="aesa-sidebar-compute"]') as HTMLElement)
    expect(computeSpy.mock.calls[0][0].runSensitivity).toBe(true)
  })

  it('unticking it sends runSensitivity: false to compute', () => {
    const computeSpy = vi.fn().mockResolvedValue(undefined)
    setStores({ computeSpy })
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    fireEvent.click(screen.getByLabelText(LABEL))
    fireEvent.click(container.querySelector('[data-testid="aesa-sidebar-compute"]') as HTMLElement)
    expect(computeSpy.mock.calls[0][0].runSensitivity).toBe(false)
  })

  it('is hidden in session-loaded mode, where the cascade is read-only', () => {
    setStores({ activeSession: SESSION.id })
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(queryByTestId('aesa-run-sensitivity-toggle')).toBeNull()
  })

  it('stays visible but inert with no DSM system selected — Compute is what is gated', () => {
    setStores({ activeSystem: null })
    const { getByTestId, container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // The toggle is still operable; it is a setting for the NEXT compute.
    const input = getByTestId('aesa-run-sensitivity-toggle').querySelector('input') as HTMLInputElement
    expect(input.disabled).toBe(false)
    // Compute is the control that refuses, and says why.
    const compute = container.querySelector('[data-testid="aesa-sidebar-compute"]') as HTMLButtonElement
    expect(compute.disabled).toBe(true)
    expect(compute.getAttribute('title')).toContain('Select a DSM system first')
  })
})

describe('the other header controls carry accessible names too', () => {
  beforeEach(() => setStores())

  it('Compute, Save and Collapse each expose a title and an aria-label', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const header = container.querySelector('header') as HTMLElement
    for (const id of ['aesa-sidebar-compute', 'aesa-save-config', 'aesa-sidebar-collapse']) {
      const el = within(header).getByTestId(id)
      expect(el.getAttribute('title')?.length).toBeGreaterThan(0)
      expect(el.getAttribute('aria-label')?.length).toBeGreaterThan(0)
    }
  })

  it('Collapse names the thing it collapses, not just the verb', () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const collapse = getByTestId('aesa-sidebar-collapse')
    expect(collapse.getAttribute('aria-label')).toBe('Collapse configuration sidebar')
  })

  it('the collapsed rail\'s expand button is labelled as well', () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={true} onToggle={() => {}} />)
    const expand = getByTestId('aesa-sidebar-expand')
    expect(expand.getAttribute('aria-label')).toBe('Expand configuration sidebar')
    expect(expand.getAttribute('title')).toBe('Expand configuration sidebar')
  })
})
