/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle,
  DSMSystemState, SharingPreset, SystemDefinition,
} from '../src/api/client'

// Patch 4Z — two AESA top-area polish items:
//   1. Collapsed sidebar variant fills the sticky area (was
//      truncating early at maxHeight: calc(100vh - 96px) carryover
//      from Patch 4V; collapsed has no scrollable body so the clamp
//      was wrong).
//   2. Save session and Export buttons render icon-only; the
//      Configurations dropdown stays full-label because it surfaces
//      the active configuration name (state-carrying label, not a
//      universally-recognizable action).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

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
  id: 'cfg-1', name: 'PB-EF AESA configuration', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-10T10:00:00Z',
  dsm_scenario_id: 'base',
} as any

const RESULT: AESAComputeResult = {
  config_id: 'cfg-1', results: [],
  summary_by_year: [], missing_categories: [],
} as any

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  try { window.localStorage.clear() } catch { /* noop */ }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([CFG])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])

  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM, systemState: SYSTEM_STATE,
  })
  useImpactStore.setState({
    staticResult: { meta: {}, results: [] } as any,
    projectedResult: null,
    staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {},
  } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING],
    configurations: [CFG], activeConfigId: CFG.id,
    creatingNewConfig: false,
    sessions: [], sessionsLoading: false, activeSessionId: null,
    draft: {
      name: CFG.name, boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: 'base',
    },
    result: RESULT, lastRunAt: '2026-05-10T10:00:00Z',
    running: false, error: null, displayedIndicators: null,
  } as any)
})

describe('Item 1 — collapsed sidebar fills sticky area', () => {
  it('uses minHeight (not maxHeight) so the bar extends naturally', () => {
    const { container } = render(<ConfigSidebar collapsed={true} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar-collapsed"]') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.style.minHeight).toBe('calc(100vh - 96px)')
    // No maxHeight clamp — the early-truncation regression vector.
    expect(aside.style.maxHeight).toBe('')
  })

  it('preserves sticky positioning so the bar follows page scroll', () => {
    const { container } = render(<ConfigSidebar collapsed={true} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar-collapsed"]') as HTMLElement
    expect(aside.style.position).toBe('sticky')
    expect(aside.style.top).toBe('0px')
  })

  it('expanded sidebar retains its maxHeight clamp (no regression)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar"]') as HTMLElement
    expect(aside).not.toBeNull()
    // maxHeight on the expanded variant is load-bearing: the sidebar
    // body has internal `overflow: auto` and needs a bounded height
    // for the scroll container to engage.
    expect(aside.style.maxHeight).toBe('calc(100vh - 96px)')
  })
})

describe('Item 2 — Save session is icon-only', () => {
  it('renders no visible text label', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-save-session"]') as HTMLElement
    expect(btn).not.toBeNull()
    // textContent should be empty (or only whitespace) — icon-only.
    // The <Save> lucide icon renders as an inline <svg> with no text
    // child, so textContent ⇒ '' (trimmed).
    expect(btn.textContent?.trim()).toBe('')
  })

  it('carries title + aria-label for hover tooltip and accessibility', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-save-session"]') as HTMLElement
    expect(btn.getAttribute('title')).toBe('Save session')
    expect(btn.getAttribute('aria-label')).toBe('Save session')
  })

  it('contains the floppy-disk icon (svg child)', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-save-session"]') as HTMLElement
    expect(btn.querySelector('svg')).not.toBeNull()
  })
})

describe('Item 2 — Export default button is icon-only with split geometry', () => {
  it('renders no visible text label', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-export-default"]') as HTMLElement
    expect(btn).not.toBeNull()
    expect(btn.textContent?.trim()).toBe('')
  })

  it('has title + aria-label communicating "Export .xlsx"', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-export-default"]') as HTMLElement
    // Title carries the human-readable affordance text. Aria-label
    // carries an SR-friendly version. Both must mention export/xlsx.
    const title = btn.getAttribute('title') ?? ''
    const aria = btn.getAttribute('aria-label') ?? ''
    expect(title).toMatch(/Export.*xlsx/i)
    expect(aria).toMatch(/Export.*xlsx/i)
  })

  it('uses split-button geometry — borderRadius rounded only on the left', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-export-default"]') as HTMLElement
    // The caret sibling rounds the right side; the Button rounds
    // only the left so the two visually join into one pill.
    expect(btn.style.borderRadius).toBe('var(--radius-md) 0 0 var(--radius-md)')
  })

  it('caret dropdown ▾ is still rendered as a separate trigger', () => {
    const { container } = render(<AESADashboard />)
    const caret = container.querySelector('[data-testid="aesa-export-menu-toggle"]')
    expect(caret).not.toBeNull()
  })

  it('clicking the caret opens the export menu with "Export visible" + "Export all"', () => {
    const { container } = render(<AESADashboard />)
    const caret = container.querySelector('[data-testid="aesa-export-menu-toggle"]') as HTMLElement
    fireEvent.click(caret)
    expect(container.querySelector('[data-testid="aesa-export-filtered"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="aesa-export-all"]')).not.toBeNull()
  })
})

describe('Item 2 — Configurations dropdown stays full-label (state-carrying)', () => {
  it('still renders the configuration name in the trigger label', () => {
    const { container } = render(<AESADashboard />)
    const toggle = container.querySelector('[data-testid="aesa-configurations-toggle"]') as HTMLElement
    expect(toggle).not.toBeNull()
    // The trigger text contains the active configuration name —
    // this is the state-carrying label per the Patch 4Z rule:
    // icon-only is for universally-recognizable actions; labels
    // that surface state stay visible.
    expect(toggle.textContent).toContain('Configurations')
    expect(toggle.textContent).toContain(CFG.name)
  })
})
