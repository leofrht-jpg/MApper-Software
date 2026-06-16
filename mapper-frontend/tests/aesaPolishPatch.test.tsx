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
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle, AESASession,
  DSMSystemState, SharingPreset, SystemDefinition, SustainabilityRatioResult,
} from '../src/api/client'

// Polish patch (4U) covers four AESA UX items:
//   1. Bug — cascade "no Static/Prospective run" annotation must be
//      suppressed in saved-session mode (the live runs map is empty
//      by design when a session is loaded; the badge is misleading).
//   2. Sidebar collapsibles — five infrequent sections default to
//      collapsed; keys reset when active session/config changes.
//   3. Configurations dropdown replaces top-left pills — pills must
//      not render in the page header; dropdown trigger must.
//   4. Two distinct save concerns kept; footer save labels itself
//      "Save configuration template" so users don't conflate it with
//      the page-header "Save session".

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const SYSTEM: SystemDefinition = {
  id: 'sys-1', name: 'WP5 - DK', unit_name: 'vehicles',
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
} as any

const SYSTEM_STATE: DSMSystemState = {
  scenarios: [
    { id: 'base', name: 'Base', is_base: true } as any,
    { id: 'ssp2', name: 'SSP2', is_base: false } as any,
  ],
  active_scenario_id: 'ssp2',
} as any

const SHARING: SharingPreset = {
  id: 'p1', name: 'Ferhati 2026 Multi-D', description: '',
  principles: [{ id: 'AGR', name: 'AGR', description: '' }],
  category_assignments: [
    { pb_id: 'climate_change', principle_id: 'AGR', justification: '' },
    { pb_id: 'land_use_change', principle_id: 'AGR', justification: '' },
  ],
  chain: { layers: [{} as any, {} as any] } as any,
} as any

const DEFAULTS: AESADefaultsBundle = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' } as any],
  default_multi_d: { tiers: [] } as any,
  default_carbon_budget: null as any,
} as any

const SR_RESULTS: SustainabilityRatioResult[] = [
  ...['climate_change', 'land_use_change'].flatMap(
    (pb_id) => [2030].map((year) => ({
      year, pb_id, pb_name: pb_id.replace(/_/g, ' '),
      ef_indicator: 'EF v3.1', impact: 1, allocated_sos: 1,
      sr: 0.7, zone: 'safe' as const, sharing_principle: null,
      layer_factors: [], total_sharing_factor: 0,
      sharing_factor_l1: 0, sharing_factor_l2: 1,
      boundary_type: 'cumulative' as const, confidence: 'high' as const,
      unit: '', impact_by_cohort: {}, method_label: '',
    } as SustainabilityRatioResult)),
  ),
]

const RESULT: AESAComputeResult = {
  config_id: 'cfg-1', results: SR_RESULTS,
  summary_by_year: [{ year: 2030, safe: 2, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 2 }],
  missing_categories: [], sensitivity: null,
} as any

const CFG_PROSPECTIVE: AESAConfiguration = {
  id: 'cfg-prospective', name: 'WP5 - SSP2 - Prospective', mfa_system_id: 'sys-1',
  impact_mode: 'projected', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-08T10:00:00Z',
  dsm_scenario_id: 'ssp2',
} as any

const CFG_STATIC: AESAConfiguration = {
  id: 'cfg-static', name: 'WP5 - SSP2 - Static', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-08T10:00:00Z',
  dsm_scenario_id: 'ssp2',
} as any

const SESSION_PROSPECTIVE: AESASession = {
  id: 'ses-1', name: 'WP5 SSP2 Prospective run', project: 'p1',
  created_at: '2026-05-08T10:00:00Z', modified_at: '2026-05-08T10:00:00Z',
  configuration_snapshot: CFG_PROSPECTIVE, result: RESULT,
  upstream_ia_task_id: null,
  displayed_indicators: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([CFG_STATIC, CFG_PROSPECTIVE])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])

  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM,
    systemState: SYSTEM_STATE,
  })
  useImpactStore.setState({
    // The bug case: live runs maps are EMPTY but a session result is
    // on screen. Cascade should not annotate "no Prospective run"
    // because the result IS the session, not the live runs map.
    staticResult: { meta: {}, results: [] } as any,
    projectedResult: { meta: { scenario: { iam: 'remind', ssp: 'SSP1-PkBudg1150' } }, results: [] } as any,
    staticDsmScenarioRuns: {},
    projectedDsmScenarioRuns: {},
  } as any)
  useAESAStore.setState({
    defaults: DEFAULTS,
    presets: [SHARING],
    configurations: [CFG_STATIC, CFG_PROSPECTIVE],
    activeConfigId: CFG_PROSPECTIVE.id,
    creatingNewConfig: false,
    sessions: [SESSION_PROSPECTIVE],
    sessionsLoading: false,
    activeSessionId: SESSION_PROSPECTIVE.id,
    draft: {
      name: CFG_PROSPECTIVE.name,
      boundary_set_id: 'Sala2020_EF',
      sharing: SHARING,
      sharing_preset_id: SHARING.id,
      carbon_budget: null,
      method_mapping: [],
      impact_mode: 'projected',
      dsm_scenario_id: 'ssp2',
    },
    result: RESULT,
    lastRunAt: '2026-05-08T10:00:00Z',
    running: false,
    error: null,
    displayedIndicators: null,
  } as any)
})

describe('Item 1 — cascade no-run annotation suppressed in session mode', () => {
  it('does NOT show "· no Prospective run" badge while a session is loaded', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = container.querySelector('[data-testid="aesa-cascade-scenario"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? '')
    for (const text of optionTexts) {
      expect(text).not.toContain('no Prospective run')
      expect(text).not.toContain('no Static run')
    }
  })

  it('DOES show the annotation in live mode with empty runs maps', () => {
    // Drop session mode → reverts to live cascade. Live + empty runs
    // map = annotation should fire. This is the existing Patch 4O
    // behaviour we're preserving outside session mode.
    useAESAStore.setState({ activeSessionId: null } as any)
    // Populate the runs map with a DIFFERENT scenario id than ssp2 so
    // ssp2 gets the badge. (Empty maps suppress via the
    // `runsPopulated` short-circuit by design.)
    useImpactStore.setState({
      projectedDsmScenarioRuns: { base: {} as any },
    } as any)
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const select = container.querySelector('[data-testid="aesa-cascade-scenario"]') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? '')
    // SSP2 should now carry the "no Prospective run" annotation.
    const ssp2 = optionTexts.find((t) => t.includes('SSP2')) ?? ''
    expect(ssp2).toContain('no Prospective run')
  })
})

describe('Item 2 — sidebar sections collapsible', () => {
  it('Sharing preset section defaults to collapsed (body hidden)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const sec = container.querySelector('[data-testid="aesa-collapsible-sharing-preset"]')
    expect(sec).not.toBeNull()
    // Body wrapper is the second child div; with the section
    // collapsed by default, its `display` is 'none'.
    const body = sec!.querySelector(':scope > div') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.style.display).toBe('none')
  })

  it('Compute Source and Name sections remain always-expanded (not collapsible)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // Always-expanded sections are NOT data-testid="aesa-collapsible-*"
    // — they use the static <Section>. Negative assertion.
    expect(container.querySelector('[data-testid="aesa-collapsible-compute-source"]')).toBeNull()
    expect(container.querySelector('[data-testid="aesa-collapsible-name"]')).toBeNull()
    expect(container.querySelector('[data-testid="aesa-collapsible-planetary-boundary-set"]')).toBeNull()
  })

  it('Five infrequent sections all render as collapsibles', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const expected = [
      'aesa-collapsible-sharing-preset',
      'aesa-collapsible-downscaling-chain',
      'aesa-collapsible-sharing-principles',
      'aesa-collapsible-category-assignments',
      'aesa-collapsible-carbon-budget-cumulative-climate-',
      'aesa-collapsible-method-pb-mapping',
    ]
    for (const id of expected) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull()
    }
  })

  it('clicking the title toggles the body open and closed', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const sec = container.querySelector('[data-testid="aesa-collapsible-sharing-preset"]')!
    const toggle = sec.querySelector('button')!
    const body = sec.querySelector(':scope > div') as HTMLElement
    expect(body.style.display).toBe('none')
    fireEvent.click(toggle)
    expect(body.style.display).toBe('block')
    fireEvent.click(toggle)
    expect(body.style.display).toBe('none')
  })
})

describe('Item 3 — Configurations dropdown replaces top-left pills', () => {
  it('renders the top-right Configurations dropdown trigger', () => {
    const { container } = render(<AESADashboard />)
    expect(container.querySelector('[data-testid="aesa-configurations-dropdown"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="aesa-configurations-toggle"]')).not.toBeNull()
  })

  it('opens a menu listing every configuration', () => {
    // Dropdown is disabled in session mode (matches the existing
    // pill-row gate). Drop session mode for this test so the
    // toggle click actually opens the menu.
    useAESAStore.setState({ activeSessionId: null } as any)
    const { container } = render(<AESADashboard />)
    const toggle = container.querySelector('[data-testid="aesa-configurations-toggle"]') as HTMLElement
    fireEvent.click(toggle)
    expect(container.querySelector('[data-testid="aesa-configurations-menu"]')).not.toBeNull()
    expect(container.querySelector(`[data-testid="aesa-configurations-row-${CFG_STATIC.id}"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="aesa-configurations-row-${CFG_PROSPECTIVE.id}"]`)).not.toBeNull()
  })

  it('does NOT render legacy inline pills in the page header', () => {
    const { container } = render(<AESADashboard />)
    // Legacy pill row was a flex-wrap div directly under the header
    // div with one chip per configuration. The dropdown trigger is
    // the only configurations affordance now.
    // Search for any element whose text contains both config names —
    // that would indicate the old pill row. If both names appear,
    // they should only appear together inside the (closed) dropdown
    // trigger label, NOT as separate sibling pills.
    // Simpler invariant: there is exactly one element whose
    // `data-testid` matches `aesa-configurations-*`. With the
    // dropdown closed, there's no row-level testid yet.
    const dropdownEls = container.querySelectorAll('[data-testid^="aesa-configurations"]')
    // Trigger button, dropdown wrapper — 2 elements when closed.
    // (Wrapper testid is "aesa-configurations-dropdown"; toggle is
    // "aesa-configurations-toggle".)
    expect(dropdownEls.length).toBe(2)
  })
})

describe('Item 4 — two distinct save concerns', () => {
  beforeEach(() => {
    // Move out of session mode so the footer save renders.
    useAESAStore.setState({ activeSessionId: null } as any)
  })

  it('footer save in sidebar persists configuration TEMPLATE (distinct from session save)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const footerSave = container.querySelector('[data-testid="aesa-save-config"]') as HTMLButtonElement
    expect(footerSave).not.toBeNull()
    // Tooltip + aria-label make the distinction explicit.
    expect(footerSave.getAttribute('title')).toContain('configuration template')
    expect(footerSave.getAttribute('aria-label')).toContain('configuration template')
  })

  it('header Save session button persists frozen result snapshot (Patch 4R)', () => {
    const { container } = render(<AESADashboard />)
    const headerSave = container.querySelector('[data-testid="aesa-save-session"]') as HTMLButtonElement
    expect(headerSave).not.toBeNull()
    // Patch 4Z — header Save button is icon-only; identity carried
    // via title + aria-label.
    expect(headerSave.getAttribute('title')).toContain('Save session')
    expect(headerSave.getAttribute('aria-label')).toContain('Save session')
    // Different testid + different label = no UI ambiguity.
    expect(headerSave.getAttribute('data-testid')).not.toBe('aesa-save-config')
  })
})
