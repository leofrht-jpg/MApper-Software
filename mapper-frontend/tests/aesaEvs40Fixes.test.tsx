/* SPDX-License-Identifier: MPL-2.0 */
/**
 * EVS40 bug report, AESA half.
 *
 *  - Item 2: the SR numerator's basis (as computed / per year) is chosen in
 *    the Configuration panel, sent with the run's compute-time stage amounts,
 *    and stated beside every impact and SOS on screen.
 *  - Item 3: the export did nothing on a single-product run (it returned early
 *    without a DSM system and swallowed errors into the console). It now runs,
 *    says where the file went in the packaged app, and says why when it fails.
 *  - Item 4: the CO2 / CO2-eq toggle above the result views is gone; the
 *    Configuration panel's copy is the only one.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { DetailTable } from '../src/components/aesa/DetailTable'
import { RadarView } from '../src/components/aesa/RadarView'
import { perYearBlockedReason } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { impactBasisLabel, quantityUnit } from '../src/utils/aesaImpactBasis'
import * as client from '../src/api/client'
import type { AESAComputeResult, SustainabilityRatioResult } from '../src/api/client'

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const SHARING = { id: 'p1', name: 'Preset', description: '', principles: [], category_assignments: [], chain: { layers: [] } } as any
const DEFAULTS = { boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }], default_multi_d: { tiers: [] }, default_carbon_budget: null, carbon_budget_options: [], ssp_trajectories: [] } as any

const SR: SustainabilityRatioResult[] = ['climate_change', 'land_use', 'water_use'].map((pb_id) => ({
  year: 2025, pb_id, pb_name: pb_id.replace(/_/g, ' '), ef_indicator: 'EF v3.1',
  impact: 51993.786, allocated_sos: 543.092, sr: 95.7, zone: 'high_risk',
  sharing_principle: 'EpC', layer_factors: [], total_sharing_factor: 0,
  sharing_factor_l1: 0, sharing_factor_l2: 1, boundary_type: 'cumulative', confidence: 'high',
  unit: 'kg CO2 eq', impact_by_cohort: {}, method_label: '',
} as any))

const RESULT = (over: Partial<AESAComputeResult> = {}): AESAComputeResult => ({
  config_id: null, results: SR,
  summary_by_year: [{ year: 2025, safe: 0, zone_of_uncertainty: 0, high_risk: 3, total_assessed: 3 }],
  missing_categories: [], sensitivity: null, ...over,
} as any)

const SP_STATIC = { archetype_id: 'ev9', archetype_name: 'EV9-NMC811-99.8kWh', scope: 'all', results: [], stage_amounts: {} } as any

function seed(over: Record<string, unknown> = {}) {
  useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
  useImpactStore.setState({ staticResult: null, projectedResult: null, staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {} } as any)
  useSingleProductImpactStore.setState({ staticResult: SP_STATIC, projectedRuns: [], staticRunMeta: null, projectedRunMeta: null } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING], configurations: [], activeConfigId: null,
    creatingNewConfig: true, sessions: [], sessionsLoading: false, activeSessionId: null,
    source: 'single_product', singleProductBasis: 'static',
    draft: {
      name: 'EVS40 per car', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id,
      carbon_budget: { initial_budget_gt: 1150, budget_basis: 'CO2e_GHG', ssp_scenario: 'SSP2-4.5', projected_emissions: {}, start_year: 2025, end_year: 2100 },
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: null,
    },
    result: RESULT(), lastRunAt: '2026-10-20T10:00:00Z', running: false, error: null,
    displayedIndicators: null, ...over,
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

describe('item 4: one budget-basis control', () => {
  it('the toggle above the result views is gone', () => {
    const { container } = render(<AESADashboard />)
    expect(container.querySelector('[data-testid="aesa-budget-basis-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="aesa-budget-basis-note"]')).toBeNull()
    expect(container.querySelector('[data-testid="aesa-budget-basis-CO2"]')).toBeNull()
  })
})

describe('item 3: the export runs on a single-product result and says what happened', () => {
  it('exports with no DSM system active, named after the archetype', async () => {
    const spy = vi.spyOn(client, 'exportAESA').mockResolvedValue({ path: null })
    render(<AESADashboard />)
    await act(async () => { fireEvent.click(screen.getByTestId('aesa-export-default')) })
    expect(spy).toHaveBeenCalledTimes(1)
    const [cfg, , , , name] = spy.mock.calls[0]
    expect(cfg.mfa_system_id).toBe('')
    expect(cfg.impact_basis).toBe('as_computed')
    expect(name).toBe('EV9-NMC811-99.8kWh')
  })

  it('shows where the packaged app wrote the file', async () => {
    vi.spyOn(client, 'exportAESA').mockResolvedValue({ path: '/Users/x/Downloads/EV9_AESA.xlsx' })
    render(<AESADashboard />)
    await act(async () => { fireEvent.click(screen.getByTestId('aesa-export-default')) })
    expect(screen.getByTestId('aesa-export-saved').textContent).toContain('/Users/x/Downloads/EV9_AESA.xlsx')
  })

  it('shows a failure instead of swallowing it', async () => {
    vi.spyOn(client, 'exportAESA').mockRejectedValue(new Error('POST /aesa/export failed: 500'))
    render(<AESADashboard />)
    await act(async () => { fireEvent.click(screen.getByTestId('aesa-export-default')) })
    expect(screen.getByTestId('aesa-export-error').textContent).toContain('500')
  })
})

describe('item 3: the packaged app goes through the backend, not a blob', () => {
  const realLocation = window.location
  afterEach(() => { Object.defineProperty(window, 'location', { value: realLocation, configurable: true }) })

  it('POSTs /aesa/export/save as JSON and returns the path', async () => {
    Object.defineProperty(window, 'location', { value: { ...realLocation, port: '8765' }, configurable: true })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ path: '/Users/x/Downloads/a.xlsx', bytes: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const out = await client.exportAESA({ id: 'd' } as any, RESULT(), 'f.xlsx', null, 'EV9')
    expect(out.path).toBe('/Users/x/Downloads/a.xlsx')
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toMatch(/\/aesa\/export\/save$/)
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init.body)).source_name).toBe('EV9')
  })
})

describe('item 2: every impact says what it is per', () => {
  it('the strip under the zone cards names both bases', () => {
    seed({ result: RESULT({ impact_basis: 'per_year', lifetime_years: 16 }) })
    render(<AESADashboard />)
    const strip = screen.getByTestId('aesa-impact-basis-strip').textContent!
    expect(strip).toContain('per year: whole-life impact / 16 yr')
    expect(strip).toContain('Allocated SOS: per year')
  })

  it('the label matches the backend export wording exactly', () => {
    expect(impactBasisLabel({ impact_basis: 'as_computed', lifetime_years: null })).toBe('per functional unit, as computed (not annualised)')
    expect(impactBasisLabel({ impact_basis: 'per_year', lifetime_years: 16 })).toBe('per year: whole-life impact / 16 yr')
  })

  it('the Detail table headers carry the basis', () => {
    render(<DetailTable results={SR} basis={{ impact_basis: 'as_computed', lifetime_years: null }} />)
    expect(screen.getByTestId('aesa-detail-impact-header').textContent).toBe('Impact (per FU)')
    expect(screen.getByTestId('aesa-detail-sos-header').textContent).toBe('Allocated SOS (per yr)')
  })

  it('an impact never borrows the boundary\'s "/yr" unit', () => {
    const rows = SR.map((r) => ({ ...r, unit: 'kg CO2 eq/yr' }))
    const { container } = render(<RadarView results={rows} basis={{ impact_basis: 'as_computed', lifetime_years: null }} />)
    const t = Array.from(container.querySelectorAll('circle > title')).map((x) => x.textContent!).find((x) => x.startsWith('climate change'))!
    expect(t).toContain('kg CO2 eq per FU')
    expect(t).not.toContain('eq/yr per FU')
    expect(t).toContain('kg CO2 eq per yr')
    expect(quantityUnit('kg CO2 eq/yr')).toBe('kg CO2 eq')
    expect(quantityUnit('mol H+ eq')).toBe('mol H+ eq')
  })

  it('the Radar tooltip states impact and SOS with their units and bases', () => {
    const { container } = render(<RadarView results={SR} basis={{ impact_basis: 'per_year', lifetime_years: 16 }} />)
    const titles = Array.from(container.querySelectorAll('circle > title')).map((t) => t.textContent!)
    const climate = titles.find((t) => t.startsWith('climate change'))!
    expect(climate).toContain('Impact: ')
    expect(climate).toContain('kg CO2 eq per yr (per year: whole-life impact / 16 yr)')
    expect(climate).toContain('Allocated SOS: ')
  })
})

describe('item 2: the Functional unit option is guarded', () => {
  it('names why per year cannot apply to a run without years entered', () => {
    expect(perYearBlockedReason(null)).toMatch(/Compute the single-product run first/)
    expect(perYearBlockedReason({ preset: '1year', lifetime: 15, amounts: {} })).toMatch(/"1 year"/)
    expect(perYearBlockedReason({ preset: 'custom', lifetime: null, amounts: {} })).toMatch(/without years entered/)
    expect(perYearBlockedReason({ preset: 'custom', lifetime: 16, amounts: {} })).toBeNull()
    // A result made before the Lifetime preset was removed still reads.
    expect(perYearBlockedReason({ preset: 'lifetime', lifetime: 16, amounts: {} })).toBeNull()
  })

  it('compute sends the run\'s own stage meta and the chosen basis', async () => {
    const spy = vi.spyOn(client, 'computeAESA').mockResolvedValue(RESULT())
    const meta = { preset: 'lifetime', lifetime: 16, lifetime_param: 'lifetime_yr', amounts: { 'Use Phase': 16 } }
    useSingleProductImpactStore.setState({ staticRunMeta: meta } as any)
    useAESAStore.setState({ draft: { ...useAESAStore.getState().draft!, impact_basis: 'per_year' } } as any)
    await useAESAStore.getState().compute({ mfaSystemId: '', singleProductResult: SP_STATIC, referenceYear: 2025 })
    const body = spy.mock.calls[0][0]
    expect(body.config!.impact_basis).toBe('per_year')
    expect(body.single_product_stage_meta).toEqual(meta)
  })

  it('a fleet compute sends no single-product meta', async () => {
    const spy = vi.spyOn(client, 'computeAESA').mockResolvedValue(RESULT())
    useSingleProductImpactStore.setState({ staticRunMeta: { preset: 'lifetime', lifetime: 16, amounts: {} } } as any)
    await useAESAStore.getState().compute({ mfaSystemId: 'sys', impactInline: { results: [] } as any })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][0].single_product_stage_meta).toBeNull()
  })
})
