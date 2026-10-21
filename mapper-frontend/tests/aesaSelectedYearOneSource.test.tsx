/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle, AESASession,
  DSMSystemState, SharingPreset, SustainabilityRatioResult, SystemDefinition,
} from '../src/api/client'

// AESA selected year: ONE source for the card and the view sliders (walkthrough 3, item 3).
// Fixture borrowed from the Patch 4R + 4T page-level integration test.
//
// Why this exists: the existing unit tests for these patches stub
// state and render sub-components (`<ConfigSidebar>`,
// `<IndicatorDisplayFilter>`) in isolation. They pass even if those
// components aren't actually wired into the page that assembles them.
// This test renders the FULL `<AESADashboard>` and asserts the
// page-level composition contract:
//
//   1. Live-mode result → "Save session" button visible in the
//      header; "Return to live view" NOT present.
//   2. Session-loaded mode → "Return to live view" replaces "Save
//      session" in the header.
//   3. Result on screen → `<IndicatorDisplayFilter>` renders ABOVE
//      the view selector (radar/timeline/detail/boxplot tabs).
//   4. Result on screen → split Export button renders.
//
// Anti-pattern guard rail: page composition is the integration point
// where new components most often fail to actually appear in the
// running app. Unit-test green + page-test red = "exists but isn't
// shipped." Unit-test green + page-test green = "actually visible."

// Recharts mock — without this the timeline/box-plot components fail
// to render in jsdom (zero-width ResizeObserver) and the chart panel
// throws before reaching the surrounding chrome we care about.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement(
      'div', { style: { width, height } },
      React.cloneElement(children, { width, height }),
    )
  return { ...actual, ResponsiveContainer }
})

// Stub system fixture — DSM store needs an active system for the
// dashboard to render anything past its first empty state.
const SYSTEM: SystemDefinition = {
  id: 'sys-1', name: 'WP5 - DK', unit_name: 'vehicles',
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

const SR_RESULTS: SustainabilityRatioResult[] = [
  ...['climate_change', 'biosphere_integrity', 'land_use_change'].flatMap(
    (pb_id) => [2030, 2040].map((year) => ({
      year, pb_id, pb_name: pb_id.replace(/_/g, ' '),
      ef_indicator: 'EF v3.1',
      impact: 1.0, allocated_sos: 1.0,
      sr: 0.7, zone: 'safe' as const,
      sharing_principle: null,
      layer_factors: [], total_sharing_factor: 0,
      sharing_factor_l1: 0, sharing_factor_l2: 1,
      boundary_type: 'cumulative' as const, confidence: 'high' as const,
      unit: '', impact_by_cohort: {}, method_label: '',
    } as SustainabilityRatioResult)),
  ),
]

const RESULT: AESAComputeResult = {
  config_id: 'cfg-1',
  results: SR_RESULTS,
  summary_by_year: [
    { year: 2030, safe: 3, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 3 },
    { year: 2040, safe: 3, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 3 },
  ],
  missing_categories: [],
  sensitivity: null,
} as any

const CFG_SNAPSHOT: AESAConfiguration = {
  id: 'cfg-snap', name: 'SSP2 - Static', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-08T10:00:00Z',
  dsm_scenario_id: 'base',
} as any

const SESSION_A: AESASession = {
  id: 'ses-a', name: 'My saved AESA run', project: 'p1',
  created_at: '2026-05-08T10:00:00Z', modified_at: '2026-05-08T10:00:00Z',
  configuration_snapshot: CFG_SNAPSHOT, result: RESULT,
  upstream_ia_task_id: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])

  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM,
    systemState: SYSTEM_STATE,
  })
  // Static impact result is what the dashboard checks for `activeImpact`
  // before showing the result body — minimal stub satisfies the gate.
  // ConfigSidebar reads `.results` to compute method-mapping coverage,
  // so the stub needs that array even though we're not testing
  // sidebar behaviour here.
  useImpactStore.setState({
    staticResult: { meta: {}, results: [] } as any,
    projectedResult: null,
    staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {},
  } as any)
  useAESAStore.setState({
    defaults: DEFAULTS,
    presets: [SHARING],
    configurations: [],
    activeConfigId: null,
    creatingNewConfig: true,
    sessions: [],
    sessionsLoading: false,
    activeSessionId: null,
    draft: {
      name: 'Draft', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: null,
    },
    result: RESULT,
    lastRunAt: '2026-05-08T10:00:00Z',
    running: false,
    error: null,
    displayedIndicators: null,
  } as any)
})


const ranges = (c: HTMLElement) => Array.from(c.querySelectorAll('input[type="range"]')) as HTMLInputElement[]

describe('the "Selected year" card and the view sliders are one control', () => {
  it('Radar: moving its slider moves the card, and the card moves the slider', () => {
    const { container } = render(<AESADashboard />)
    fireEvent.click(within(container as HTMLElement).getByText('Radar'))
    let [card, radar] = ranges(container as HTMLElement)
    expect(card).toBeTruthy(); expect(radar).toBeTruthy()
    expect(card.value).toBe('2040'); expect(radar.value).toBe('2040')

    fireEvent.change(radar, { target: { value: '2030' } })
    ;[card, radar] = ranges(container as HTMLElement)
    expect(card.value).toBe('2030')          // was: card 2040, radar 2030
    expect(radar.value).toBe('2030')

    fireEvent.change(card, { target: { value: '2040' } })
    ;[card, radar] = ranges(container as HTMLElement)
    expect(radar.value).toBe('2040')          // was: radar stayed on its own year
  })

  it('leaving Radar and coming back keeps the chosen year', () => {
    const { container } = render(<AESADashboard />)
    const c = container as HTMLElement
    fireEvent.click(within(c).getByText('Radar'))
    fireEvent.change(ranges(c)[1], { target: { value: '2030' } })
    fireEvent.click(within(c).getByText('Detail'))
    fireEvent.click(within(c).getByText('Radar'))
    expect(ranges(c).map((r) => r.value)).toEqual(['2030', '2030'])
  })
})

describe('Box plot slider writes the same year', () => {
  it('is controlled by the dashboard year when given one', async () => {
    const { BoxPlotView } = await import('../src/components/aesa/BoxPlotView')
    const onYearChange = vi.fn()
    const { container } = render(<BoxPlotView result={RESULT} year={2030} onYearChange={onYearChange} />)
    const slider = ranges(container as HTMLElement)[0]
    expect(slider.value).toBe('2030')
    fireEvent.change(slider, { target: { value: '2040' } })
    expect(onYearChange).toHaveBeenCalledWith(2040)
  })
})
