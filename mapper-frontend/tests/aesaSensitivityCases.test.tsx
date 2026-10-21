/* SPDX-License-Identifier: MPL-2.0 */
/**
 * AESA sensitivity cases in the UI: the case window before Compute, the case
 * switcher, and the Cases comparison view.
 *
 * EVS40: with "Sharing sensitivity" ticked and four parameter cases in the
 * project, no case could be seen by name -- sharing variants only fed the
 * unlabelled box-plot spread, and parameter cases never reached AESA.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { parameterCaseOptions, sharingCaseOptions } from '../src/utils/aesaCases'
import * as client from '../src/api/client'
import type { AESAComputeResult, SustainabilityRatioResult } from '../src/api/client'

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const SHARING = {
  id: 'p1', name: 'EVS40 per car', description: '',
  principles: [
    { id: 'EpC', name: 'Equal per Capita', description: '' },
    { id: 'AR', name: 'Acquired Rights', description: '' },
    { id: 'PC', name: 'Per Car', description: '' },
  ],
  category_assignments: [],
  chain: { layers: [
    { layer_number: 1, name: 'Global -> Country', principle_mode: 'category_specific', data: { EpC: { 2025: [1, 2] }, AR: { 2025: [1, 2] } } },
    { layer_number: 4, name: 'one car', principle_mode: 'fixed', fixed_principle: 'PC', data: { PC: { 2025: [1, 2] } } },
  ] },
} as any

const DEFAULTS = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1', boundaries: {
    climate_change: { id: 'climate_change', name: 'Climate change', conventional_acronym: 'GWP100' },
    land_use: { id: 'land_use', name: 'Land use', conventional_acronym: 'LU' },
  } }],
  default_multi_d: { tiers: [] }, default_carbon_budget: null, carbon_budget_options: [], ssp_trajectories: [],
} as any

const PARAMS = {
  parameters: {
    ev_use: { name: 'ev_use', base_value: 5820.5, scenario_overrides: { v1g: 5136.4 } },
    battery_kwh: { name: 'battery_kwh', base_value: 99.8 },
  },
  scenarios: ['v1g'], categories: [],
} as any

const sr = (pb_id: string, srv: number, zone: string): SustainabilityRatioResult => ({
  year: 2025, pb_id, pb_name: pb_id.replace(/_/g, ' '), ef_indicator: 'EF v3.1',
  impact: srv, allocated_sos: 1, sr: srv, zone, sharing_principle: 'EpC', layer_factors: [],
  total_sharing_factor: 0, sharing_factor_l1: 0, sharing_factor_l2: 1, boundary_type: 'cumulative',
  confidence: 'high', unit: 'kg CO2 eq', impact_by_cohort: {}, method_label: '',
} as any)

// A result from BEFORE the matrix: only ``cases``. Still switches and still
// compares, so saved sessions keep working.
const RESULT_WITH_CASES: AESAComputeResult = {
  config_id: null,
  results: [sr('climate_change', 0.8, 'safe'), sr('land_use', 0.5, 'safe')],
  summary_by_year: [{ year: 2025, safe: 2, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 2 }],
  missing_categories: [], sensitivity: null,
  cases: [
    { id: 'sharing:AR', kind: 'sharing', label: 'Sharing: Acquired Rights', definition: ['x'],
      results: [sr('climate_change', 3.0, 'high_risk'), sr('land_use', 0.6, 'safe')] },
    { id: 'parameter:v1g', kind: 'parameter', label: 'Case: v1g', definition: ['ev_use = 5136.4 (base 5820.5)'],
      results: [sr('climate_change', 0.7, 'safe'), sr('land_use', 0.5, 'safe')] },
  ],
} as any

function seed(over: Record<string, unknown> = {}) {
  useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
  useImpactStore.setState({ staticResult: null, projectedResult: null, staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {} } as any)
  useSingleProductImpactStore.setState({
    staticResult: { archetype_id: 'ev9', archetype_name: 'EV9', scope: 'all', results: [], stage_amounts: {} },
    projectedRuns: [], staticRunMeta: null, projectedRunMeta: null,
  } as any)
  useParameterStore.setState({ table: PARAMS, fetchTable: async () => {} } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING], configurations: [], activeConfigId: null,
    creatingNewConfig: true, sessions: [], sessionsLoading: false, activeSessionId: null,
    source: 'single_product', singleProductBasis: 'static',
    draft: { name: 'EVS40', boundary_set_id: 'Sala2020_EF', sharing: SHARING, sharing_preset_id: 'p1',
      carbon_budget: null, method_mapping: [], impact_mode: 'static', dsm_scenario_id: null },
    result: null, lastRunAt: null, running: false, error: null, displayedIndicators: null,
    caseSelection: null, activeCase: 'base', activeSharing: 'base', ...over,
  } as any)
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  seed()
})

describe('which cases exist', () => {
  it('sharing: only principles every category-specific layer has data for', () => {
    expect(sharingCaseOptions(SHARING).map((o) => o.id)).toEqual(['sharing:EpC', 'sharing:AR'])
  })
  it('parameter: every case, with what it changes', () => {
    const [o] = parameterCaseOptions(PARAMS)
    expect(o.id).toBe('parameter:v1g')
    expect(o.definition).toEqual(['ev_use = 5136.4 (base 5820.5)'])
  })
})

describe('the case window', () => {
  const openWindow = () => fireEvent.click(screen.getByTestId('aesa-sidebar-compute'))

  it('opens on Compute with the base fixed and every case listed', () => {
    render(<AESADashboard />)
    openWindow()
    const modal = screen.getByTestId('aesa-case-modal')
    const base = within(modal).getByTestId('aesa-case-base') as HTMLInputElement
    expect(base.checked && base.disabled).toBe(true)
    for (const id of ['sharing:EpC', 'sharing:AR', 'parameter:v1g']) {
      expect((within(modal).getByTestId(`aesa-case-${id}`) as HTMLInputElement).checked).toBe(true)
    }
    expect(within(modal).queryByTestId('aesa-case-sharing:PC')).toBeNull()
    expect(modal.textContent).toContain('ev_use = 5136.4 (base 5820.5)')
  })

  it('computes only the ticked cases and remembers the choice', async () => {
    const spy = vi.spyOn(client, 'computeAESA').mockResolvedValue(RESULT_WITH_CASES)
    render(<AESADashboard />)
    openWindow()
    fireEvent.click(screen.getByTestId('aesa-case-sharing:AR'))
    await act(async () => { fireEvent.click(screen.getByTestId('aesa-case-run')) })
    const body = spy.mock.calls[0][0]
    expect(body.sharing_cases).toEqual(['EpC'])
    expect(body.parameter_cases).toEqual(['v1g'])
    expect(useAESAStore.getState().caseSelection).toEqual(['sharing:EpC', 'parameter:v1g'])
    openWindow()
    expect((screen.getByTestId('aesa-case-sharing:AR') as HTMLInputElement).checked).toBe(false)
  })

  it('Cancel computes nothing', () => {
    const spy = vi.spyOn(client, 'computeAESA').mockResolvedValue(RESULT_WITH_CASES)
    render(<AESADashboard />)
    openWindow()
    fireEvent.click(screen.getByTestId('aesa-case-cancel'))
    expect(screen.queryByTestId('aesa-case-modal')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('a project change forgets the selection', () => {
    useAESAStore.setState({ caseSelection: ['sharing:EpC'], activeCase: 'v1g', activeSharing: 'AR' } as any)
    act(() => { useProjectStore.setState({ currentProject: `other-${Math.random()}` }) })
    expect(useAESAStore.getState().caseSelection).toBeNull()
    expect(useAESAStore.getState().activeCase).toBe('base')
    expect(useAESAStore.getState().activeSharing).toBe('base')
  })
})

describe('showing the cases', () => {
  it('the switcher swaps what the views show', () => {
    seed({ result: RESULT_WITH_CASES, lastRunAt: 'x' })
    render(<AESADashboard />)
    fireEvent.click(screen.getByText('Detail'))
    const detail = () => screen.getByRole('table').textContent!
    expect(detail()).toContain('0.80')
    fireEvent.click(screen.getByTestId('aesa-sharing-switch-AR'))
    expect(detail()).toContain('3.00')
    expect(detail()).not.toContain('0.80')
  })

  it('an old result has two selectors, and a pair it never computed is disabled', () => {
    seed({ result: RESULT_WITH_CASES, lastRunAt: 'x' })
    render(<AESADashboard />)
    expect(screen.getByTestId('aesa-case-selector')).toBeTruthy()
    expect(screen.getByTestId('aesa-sharing-selector')).toBeTruthy()
    fireEvent.click(screen.getByTestId('aesa-case-switch-v1g'))
    // (v1g, AR) does not exist in a pre-matrix result.
    expect((screen.getByTestId('aesa-sharing-switch-AR') as HTMLButtonElement).disabled).toBe(true)
  })

  it('the Cases view compares each case with the base, by abbreviation', () => {
    seed({ result: RESULT_WITH_CASES, lastRunAt: 'x' })
    const { container } = render(<AESADashboard />)
    fireEvent.click(screen.getByText('Cases'))
    const svg = screen.getByTestId('aesa-cases-svg')
    expect(svg.textContent).toContain('GWP100')
    expect(svg.textContent).toContain('LU')
    // A zone change is a diamond; no change is a circle.
    // Parameter cases against Base under the chosen sharing (the base chain).
    expect(screen.getByTestId('aesa-cases-mark-climate_change-parameter:v1g').tagName).toBe('circle')
    expect(svg.textContent).toContain('ΔSR vs Base under the base chain')
    // Figure rules: dashed edge, legend after the plot, no caption text inside.
    const frame = container.querySelector('.aesa-cases-frame') as HTMLElement
    expect(frame.style.border).toContain('dashed')
    const legend = screen.getByTestId('aesa-cases-legend')
    expect(svg.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(legend.textContent).toContain('v1g')
  })

  it('without cases there is no switcher and the view says why', () => {
    seed({ result: { ...RESULT_WITH_CASES, cases: [] }, lastRunAt: 'x' })
    render(<AESADashboard />)
    expect(screen.queryByTestId('aesa-case-switcher')).toBeNull()
    fireEvent.click(screen.getByText('Cases'))
    expect(screen.getByTestId('aesa-cases-empty')).toBeTruthy()
  })
})

// ── the case x sharing matrix ────────────────────────────────────────────────

const MATRIX_RESULT: AESAComputeResult = {
  config_id: null,
  results: [sr('climate_change', 0.8, 'safe'), sr('land_use', 0.5, 'safe')],
  summary_by_year: [{ year: 2025, safe: 2, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 2 }],
  missing_categories: [], sensitivity: null, cases: [],
  case_axis: [{ id: 'base', label: 'Base', definition: [] }, { id: 'v1g', label: 'v1g', definition: ['ev_use = 5136.4 (base 5820.5)'] }],
  sharing_axis: [{ id: 'base', label: 'Base chain (p1)', definition: [] }, { id: 'AR', label: 'Acquired Rights (AR)', definition: ['x'] }],
  matrix: [
    { case: 'base', sharing: 'AR', results: [sr('climate_change', 3.0, 'high_risk'), sr('land_use', 0.6, 'safe')] },
    { case: 'v1g', sharing: 'base', results: [sr('climate_change', 0.7, 'safe'), sr('land_use', 0.5, 'safe')] },
    { case: 'v1g', sharing: 'AR', results: [sr('climate_change', 1.5, 'zone_of_uncertainty'), sr('land_use', 0.55, 'safe')] },
  ],
} as any

describe('cases and sharing as a matrix', () => {
  it('any case can be read under any sharing', () => {
    seed({ result: MATRIX_RESULT, lastRunAt: 'x' })
    render(<AESADashboard />)
    fireEvent.click(screen.getByText('Detail'))
    const detail = () => screen.getByRole('table').textContent!
    fireEvent.click(screen.getByTestId('aesa-case-switch-v1g'))
    expect(detail()).toContain('0.70')
    fireEvent.click(screen.getByTestId('aesa-sharing-switch-AR'))
    expect(detail()).toContain('1.50')                     // (v1g, AR)
    fireEvent.click(screen.getByTestId('aesa-case-switch-base'))
    expect(detail()).toContain('3.00')                     // (Base, AR)
  })

  it('the Cases view takes the difference against Base under the CHOSEN sharing', () => {
    seed({ result: MATRIX_RESULT, lastRunAt: 'x' })
    render(<AESADashboard />)
    fireEvent.click(screen.getByText('Cases'))
    const mark = () => screen.getByTestId('aesa-cases-mark-climate_change-parameter:v1g')
    // Base chain: v1g 0.7 vs Base 0.8, no zone change.
    expect(mark().tagName).toBe('circle')
    expect(mark().textContent).toContain('vs Base under the base chain 0.8')
    fireEvent.click(screen.getByTestId('aesa-sharing-switch-AR'))
    // Under AR: v1g 1.5 (uncertainty) vs Base 3.0 (high risk) -- a zone change.
    expect(mark().tagName).toBe('polygon')
    expect(mark().textContent).toContain('vs Base under Acquired Rights (AR) 3')
    expect(screen.getByTestId('aesa-cases-svg').textContent).toContain('ΔSR vs Base under Acquired Rights (AR)')
  })

  it('a sharing-only run compares its sharing choices with the base chain', () => {
    seed({ result: { ...MATRIX_RESULT,
      case_axis: [{ id: 'base', label: 'Base', definition: [] }],
      matrix: [MATRIX_RESULT.matrix![0]] }, lastRunAt: 'x' })
    render(<AESADashboard />)
    expect(screen.queryByTestId('aesa-case-selector')).toBeNull()      // one case: no selector
    fireEvent.click(screen.getByText('Cases'))
    expect(screen.getByTestId('aesa-cases-mark-climate_change-sharing:AR').tagName).toBe('polygon')
    expect(screen.getByTestId('aesa-cases-svg').textContent).toContain('ΔSR vs the base chain')
  })
})

describe('item C: single-product configurations save and list', () => {
  it('Save is enabled with no DSM system and sends mfa_system_id null', async () => {
    const spy = vi.spyOn(client, 'createAESAConfiguration').mockResolvedValue({ id: 'c1', name: 'EVS40', mfa_system_id: null } as any)
    render(<AESADashboard />)
    const save = screen.getByTestId('aesa-save-config') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await act(async () => { fireEvent.click(save) })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].mfa_system_id).toBeNull()
  })

  it('the configurations dropdown lists configurations saved without a system', () => {
    seed({
      configurations: [
        { id: 'sp', name: 'single product cfg', mfa_system_id: null } as any,
        { id: 'fl', name: 'fleet cfg', mfa_system_id: 'sys-1' } as any,
      ],
      result: RESULT_WITH_CASES, lastRunAt: 'x',
    })
    render(<AESADashboard />)
    fireEvent.click(screen.getByTestId('aesa-configurations-toggle'))
    const menu = screen.getByTestId('aesa-configurations-menu').textContent!
    expect(menu).toContain('single product cfg')
    expect(menu).not.toContain('fleet cfg')
  })
})

describe('the compute window lists cases and sharing apart', () => {
  it('two groups, each with its fixed Base, and the run counts cases x sharing', async () => {
    const { CaseSelectionModal } = await import('../src/components/aesa/CaseSelectionModal')
    const { availableCases } = await import('../src/utils/aesaCases')
    const options = availableCases({ runSensitivity: true, sharing: SHARING, paramTable: PARAMS, singleProduct: true })
    render(<CaseSelectionModal options={options} initial={new Set(options.map((o) => o.id))} onRun={() => {}} onCancel={() => {}} />)
    const cases = screen.getByTestId('aesa-case-group-case')
    const sharing = screen.getByTestId('aesa-case-group-sharing')
    expect(cases.textContent).toContain('reruns the LCA')
    expect(sharing.textContent).toContain('No LCA rerun')
    expect(cases.querySelector('[data-testid="aesa-case-base"]')).not.toBeNull()
    expect(sharing.querySelector('[data-testid="aesa-sharing-base"]')).not.toBeNull()
    expect(cases.querySelector('[data-testid="aesa-case-parameter:v1g"]')).not.toBeNull()
    expect(sharing.querySelector('[data-testid="aesa-case-sharing:AR"]')).not.toBeNull()
    // Base + v1g = 2 cases; base chain + EpC + AR = 3 sharing.
    expect(screen.getByTestId('aesa-case-run').textContent).toContain('2 cases × 3 sharing')
  })
})
