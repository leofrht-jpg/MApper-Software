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
import { render } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAComputeResult, AESAConfiguration, AESADefaultsBundle,
  DSMSystemState, SharingPreset, SystemDefinition, SustainabilityRatioResult,
} from '../src/api/client'

// Patch 4V — page-level scroll for AESA. The Radar chart was
// clipped at the viewport bottom because the AESA page wrapper
// constrained itself to viewport height with internal `overflow:
// hidden` on the inner main and `overflow: auto` on the active-view
// section. Internal scroll containers fragmented the layout and
// chart labels at the SVG's edges (positioned outside its 480-box
// bounding rect) ran off the bottom with no scroll affordance.
//
// Fix shape: drop viewport-fit constraints on the AESA root, inner
// main, and active-view section. Let Shell's outer `<main overflow:
// auto>` handle scroll. Sidebar becomes `position: sticky` so it
// stays visible while main scrolls.
//
// This test asserts the layout invariants — not pixel-perfect
// rendering. Three things must hold:
//   1. AESA root does NOT set `height: 100%` (no viewport-fit).
//   2. Inner main does NOT set `overflow: hidden` (no internal clip).
//   3. Active-view section does NOT set `overflow: auto` (no
//      internal scroll container — page scrolls instead).

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

// Synthesize 15 indicators × 1 year = 15 SR rows (radar's worst
// case for label clipping — the bug's repro shape).
const SR_RESULTS: SustainabilityRatioResult[] = Array.from({ length: 15 }, (_, i) => ({
  year: 2030, pb_id: `pb_${i}`, pb_name: `Indicator ${i}`,
  ef_indicator: 'EF v3.1', impact: 1, allocated_sos: 1,
  sr: 0.7, zone: 'safe' as const, sharing_principle: null,
  layer_factors: [], total_sharing_factor: 0,
  sharing_factor_l1: 0, sharing_factor_l2: 1,
  boundary_type: 'cumulative' as const, confidence: 'high' as const,
  unit: '', impact_by_cohort: {}, method_label: '',
} as SustainabilityRatioResult))

const RESULT: AESAComputeResult = {
  config_id: 'cfg-1', results: SR_RESULTS,
  summary_by_year: [{ year: 2030, safe: 15, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 15 }],
  missing_categories: [], sensitivity: null,
} as any

const CFG: AESAConfiguration = {
  id: 'cfg-1', name: 'cfg', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-08T10:00:00Z',
  dsm_scenario_id: 'base',
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
  useImpactStore.setState({
    staticResult: { meta: {}, results: [] } as any,
    projectedResult: null,
    staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {},
  } as any)
  useAESAStore.setState({
    defaults: DEFAULTS,
    presets: [SHARING],
    configurations: [CFG],
    activeConfigId: CFG.id,
    creatingNewConfig: false,
    sessions: [],
    sessionsLoading: false,
    activeSessionId: null,
    draft: {
      name: CFG.name, boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: 'base',
    },
    result: RESULT,
    lastRunAt: '2026-05-08T10:00:00Z',
    running: false,
    error: null,
    displayedIndicators: null,
  } as any)
})

describe('AESA page-level scroll (Patch 4V)', () => {
  it('AESA root does NOT set height: 100% (no viewport-fit constraint)', () => {
    const { container } = render(<AESADashboard />)
    // The page root is the first child div emitted by AESADashboard.
    const root = container.firstElementChild as HTMLElement
    expect(root).not.toBeNull()
    // Style assertion via inline style — tests that the
    // viewport-fit `height: 100%` regression doesn't return.
    expect(root.style.height).not.toBe('100%')
  })

  it('inner <main> does NOT set overflow: hidden', () => {
    const { container } = render(<AESADashboard />)
    const innerMain = container.querySelector('main') as HTMLElement
    expect(innerMain).not.toBeNull()
    expect(innerMain.style.overflow).not.toBe('hidden')
  })

  it('active-view section does NOT set overflow: auto (page scrolls instead)', () => {
    const { container } = render(<AESADashboard />)
    // The active-view section is the only <section> inside the AESA
    // dashboard's main column when a result is present. It carries
    // the visual chrome (border, radius, padding) for the chart pane.
    const sections = container.querySelectorAll('main section')
    expect(sections.length).toBeGreaterThan(0)
    const chartSection = sections[sections.length - 1] as HTMLElement
    // The bug's regression vector: setting overflow: auto creates an
    // internal scroll container that clips chart content (Radar
    // labels positioned outside the SVG bounding box). Patch 4V
    // removed this property; assert it stays gone.
    expect(chartSection.style.overflow).not.toBe('auto')
    expect(chartSection.style.overflow).not.toBe('hidden')
  })

  it('body wrapper uses alignItems: flex-start (sidebar can be sticky)', () => {
    const { container } = render(<AESADashboard />)
    // The body wrapper hosts sidebar+main. With `alignItems:
    // flex-start` the sidebar's height is content-driven, which is
    // a precondition for `position: sticky` to anchor without the
    // flex container stretching the sidebar to fill content height.
    const root = container.firstElementChild as HTMLElement
    const bodyWrapper = root.querySelector(':scope > div:last-of-type') as HTMLElement
    expect(bodyWrapper).not.toBeNull()
    expect(bodyWrapper.style.alignItems).toBe('flex-start')
  })

  it('configuration sidebar uses position: sticky', () => {
    const { container } = render(<AESADashboard />)
    const aside = container.querySelector('aside') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.style.position).toBe('sticky')
    expect(aside.style.top).toBe('0px')
  })
})
