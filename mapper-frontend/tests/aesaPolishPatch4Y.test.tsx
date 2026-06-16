/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { ConfigSidebar, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_WIDTH_KEY } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle, AESASession,
  DSMSystemState, SharingPreset, SystemDefinition,
} from '../src/api/client'

// Patch 4Y — four AESA polish items:
//   1. Drag-resizable sidebar with localStorage-persisted width.
//   2. Name input relabelled "Configuration template name" (NOT
//      removed — it persists the configuration template name, not
//      the session name).
//   3. "+ New configuration" moved INTO the ConfigurationsDropdown
//      menu; standalone page-header button removed.
//   4. Delete + Save session modals portal to document.body so they
//      escape the sidebar's sticky stacking context.

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

const CFG_A: AESAConfiguration = {
  id: 'cfg-a', name: 'Cfg A', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-10T10:00:00Z',
  dsm_scenario_id: 'base',
} as any

const RESULT: AESAComputeResult = {
  config_id: 'cfg-a', results: [],
  summary_by_year: [],
  missing_categories: [],
} as any

const SESSION_A: AESASession = {
  id: 'ses-a', name: 'Saved A', project: 'p',
  created_at: '2026-05-10T10:00:00Z', modified_at: '2026-05-10T10:00:00Z',
  configuration_snapshot: CFG_A, result: RESULT,
  upstream_ia_task_id: null,
  displayed_indicators: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  // Reset localStorage between tests so width-persistence assertions
  // start from a clean slate.
  try { window.localStorage.clear() } catch { /* noop */ }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([CFG_A])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([SESSION_A])
  vi.spyOn(client, 'deleteAESASession').mockResolvedValue(undefined)

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
    configurations: [CFG_A], activeConfigId: CFG_A.id,
    creatingNewConfig: false,
    sessions: [SESSION_A], sessionsLoading: false,
    activeSessionId: null,
    draft: {
      name: 'Cfg A', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: 'base',
    },
    result: RESULT, lastRunAt: '2026-05-10T10:00:00Z',
    running: false, error: null, displayedIndicators: null,
  } as any)
})

describe('Item 1 — drag-resizable sidebar', () => {
  it('renders with default width on first mount (no stored width)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar"]') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.style.width).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`)
  })

  it('restores stored width from localStorage on mount', () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, '450')
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar"]') as HTMLElement
    expect(aside.style.width).toBe('450px')
  })

  it('clamps stored width to SIDEBAR_MAX_WIDTH', () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_MAX_WIDTH + 200))
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar"]') as HTMLElement
    expect(parseInt(aside.style.width, 10)).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH)
  })

  it('rejects stored width below SIDEBAR_MIN_WIDTH (falls back to default)', () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_MIN_WIDTH - 50))
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const aside = container.querySelector('[data-testid="aesa-config-sidebar"]') as HTMLElement
    expect(aside.style.width).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`)
  })

  it('drag handle is rendered on the right edge with cursor: col-resize', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const handle = container.querySelector('[data-testid="aesa-sidebar-resize-handle"]') as HTMLElement
    expect(handle).not.toBeNull()
    expect(handle.style.cursor).toBe('col-resize')
    expect(handle.style.position).toBe('absolute')
    expect(handle.style.right).toBe('0px')
  })

  it('drag increases width by mouse delta (bounded)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const handle = container.querySelector('[data-testid="aesa-sidebar-resize-handle"]') as HTMLElement
    const aside = container.querySelector('[data-testid="aesa-config-sidebar"]') as HTMLElement
    // Simulate drag: mousedown at x=300, mousemove to x=400 → dx=100.
    fireEvent.mouseDown(handle, { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 400 })
    expect(parseInt(aside.style.width, 10)).toBe(SIDEBAR_DEFAULT_WIDTH + 100)
    fireEvent.mouseUp(document)
    // Persisted to localStorage on drag end.
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH + 100))
  })
})

describe('Item 2 — Name input relabelled (NOT removed)', () => {
  it('renders the Configuration template name section', () => {
    const { container, getByText } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // Section title now reads "Configuration template name" rather
    // than the bare "Name" — disambiguates from session-name.
    expect(getByText('Configuration template name')).not.toBeNull()
    expect(container.querySelector('[data-testid="aesa-config-template-name"]')).not.toBeNull()
  })

  it('binding to draft.name preserved (existing template name shown)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const input = container.querySelector(
      '[data-testid="aesa-config-template-name"]',
    ) as HTMLInputElement
    expect(input.value).toBe('Cfg A')
  })
})

describe('Item 3 — + New configuration consolidated into dropdown', () => {
  it('does NOT render a standalone "+ New configuration" button in the page header', () => {
    const { container } = render(<AESADashboard />)
    // Pre-Patch-4Y had a `<Button>...+ New configuration</Button>`
    // sibling to the Configurations dropdown. Patch 4Y moved the
    // action into the dropdown menu.
    const allButtons = Array.from(container.querySelectorAll('button'))
    const newConfigButtons = allButtons.filter((b) =>
      (b.textContent ?? '').trim() === 'New configuration')
    expect(newConfigButtons.length).toBe(0)
  })

  it('renders + New configuration item inside the dropdown menu', () => {
    const { container } = render(<AESADashboard />)
    const toggle = container.querySelector('[data-testid="aesa-configurations-toggle"]') as HTMLElement
    fireEvent.click(toggle)
    const newItem = container.querySelector('[data-testid="aesa-configurations-new"]')
    expect(newItem).not.toBeNull()
    expect(newItem?.textContent).toContain('New configuration')
  })

  it('clicking the in-dropdown "+ New configuration" calls startNewConfig', () => {
    const { container } = render(<AESADashboard />)
    const toggle = container.querySelector('[data-testid="aesa-configurations-toggle"]') as HTMLElement
    fireEvent.click(toggle)
    const newItem = container.querySelector('[data-testid="aesa-configurations-new"]') as HTMLElement
    fireEvent.click(newItem)
    // startNewConfig sets activeConfigId: null AND creatingNewConfig: true.
    const state = useAESAStore.getState()
    expect(state.activeConfigId).toBeNull()
    expect(state.creatingNewConfig).toBe(true)
  })
})

describe('Item 4 — modals portal to document.body (escape sticky stacking context)', () => {
  it('Save session modal portals to document.body (not within the test render container)', () => {
    const { container } = render(<AESADashboard />)
    const btn = container.querySelector('[data-testid="aesa-save-session"]') as HTMLElement
    fireEvent.click(btn)
    // Modal is NOT inside the test container — it's portalled.
    expect(container.querySelector('[data-testid="aesa-save-session-modal"]')).toBeNull()
    // Modal IS inside document.body — locating via the document root.
    const portalled = document.body.querySelector('[data-testid="aesa-save-session-modal"]')
    expect(portalled).not.toBeNull()
  })

  it('Save session modal has z-index 9999 (above page chrome)', () => {
    const { container } = render(<AESADashboard />)
    fireEvent.click(container.querySelector('[data-testid="aesa-save-session"]') as HTMLElement)
    const modal = document.body.querySelector('[data-testid="aesa-save-session-modal"]') as HTMLElement
    expect(modal.style.zIndex).toBe('9999')
  })

  it('Delete session modal portals to document.body', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // Open the delete confirmation: find the trash button on the
    // SavedSessionsList row for SESSION_A.
    const trashButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.getAttribute('title') === 'Delete'
        || b.getAttribute('aria-label') === 'Delete saved session',
    )
    expect(trashButtons.length).toBeGreaterThan(0)
    fireEvent.click(trashButtons[0])
    // Modal NOT inside the sidebar render tree (would be trapped in
    // the sticky stacking context, the bug Patch 4X fixes)…
    expect(container.querySelector('[data-testid="aesa-session-delete-modal"]')).toBeNull()
    // …but present in document.body.
    const portalled = document.body.querySelector('[data-testid="aesa-session-delete-modal"]')
    expect(portalled).not.toBeNull()
    const modal = portalled as HTMLElement
    expect(modal.style.zIndex).toBe('9999')
  })
})
