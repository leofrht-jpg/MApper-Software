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
import { render, fireEvent, within, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { AESADashboard } from '../src/pages/AESADashboard'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle, AESASession,
  DSMSystemState, SharingPreset, SustainabilityRatioResult, SystemDefinition,
} from '../src/api/client'

// Loading card coverage (walkthrough 3, item 5). Fixture from the Patch 4R + 4T page test.
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


/**
 * Every calculation entry point, timed on a sidecar from this branch
 * (2026-10-21, EVS40 and MAp-test WP5, this machine):
 *
 *   over 10 s -- each MUST show the shared <ComputeProgress> card
 *     AESA compute, 4 parameter cases x all sharing (prospective)   76.8 s
 *     Monte Carlo, 1000 iterations x 25 indicators                  69.3 s
 *     System-level Prospective, 1 LCI scenario, GWP100              63.0 s
 *     Single-product Prospective, 4 background years, 25 ind.       18.8 s
 *     System-level Static (dsm-lca), 25 indicators                  10.7 s
 *   under 10 s -- no card needed
 *     System-level Static, GWP100 only 8.5 s; single-product Static 4.1 s;
 *     DSM simulate 0.0 s; subsystems compute-all 0.0 s; material flows 0.1 s;
 *     AESA without cases 0.0 s; every export waiting on the server <= 0.7 s
 *     (AESA save 0.3, Monte Carlo 0.3, system Static 0.7, prospective impact
 *     0.3, single-product 0.0, project modelling-only 0.2).
 */
const OVER_10_S: Array<[string, string]> = [
  ['AESA compute with cases', 'src/components/aesa/ConfigSidebar.tsx'],
  ['Monte Carlo', 'src/pages/MonteCarlo.tsx'],
  ['System-level Prospective', 'src/components/impact/ProjectedImpactPanel.tsx'],
  ['Single-product Prospective', 'src/components/impact/SingleProductProjectedPanel.tsx'],
  ['System-level Static', 'src/components/dsm/DSMImpactPanel.tsx'],
]

describe('every entry point over 10 s shows the shared loading card', () => {
  it.each(OVER_10_S)('%s', (_name, file) => {
    const src = readFileSync(file, 'utf-8')
    expect(src).toMatch(/import \{ ComputeProgress \} from '[./]+(components\/)?ui\/ComputeProgress'/)
    expect(src).toMatch(/<ComputeProgress[\s\S]*?active=\{/)
  })
})

describe('the AESA card says what is running, and is seen with the panel collapsed', () => {
  it('names the case x sharing matrix and the LCA reruns', async () => {
    const { computeLabel } = await import('../src/utils/aesaCases')
    expect(computeLabel({ cases: { parameter: ['v1g', 'v2h_credit0', 'v2h_credit50', 'v2h_credit100'], sharing: ['EpC', 'IN', 'AGR', 'LA', 'AR'] } }))
      .toBe('Computing AESA: 5 cases × 6 sharing · 4 LCA reruns')
    expect(computeLabel({ cases: { parameter: [], sharing: ['EpC'] } })).toBe('Computing AESA: 1 case × 2 sharing')
    expect(computeLabel(null)).toBe('Computing AESA…')
  })

  it('with the Configuration panel collapsed, the card shows on the dashboard', () => {
    useAESAStore.setState({ running: true, lastComputeArgs: { mfaSystemId: '', cases: { parameter: ['v1g'], sharing: [] } } } as any)
    render(<AESADashboard />)
    expect(screen.queryByTestId('aesa-compute-progress-main')).toBeNull()      // expanded: it is in the panel
    fireEvent.click(screen.getByTestId('aesa-sidebar-collapse'))
    const card = screen.getByTestId('aesa-compute-progress-main')
    expect(card.textContent).toContain('Computing AESA: 2 cases × 1 sharing · 1 LCA rerun')
  })
})
