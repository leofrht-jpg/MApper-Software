/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'

/**
 * Companion to `cohortMappingSync.test.tsx` (which locks the Static
 * `DSMImpactPanel` "N of M mapped" count). This locks the SAME subsystem-count
 * fix in the Prospective `ProjectedImpactPanel`: the store's `subsystems` list
 * mixes in a synthesized PRIMARY entry, and it must be EXCLUDED from the
 * subsystem mapped-count — otherwise the primary's cohorts are double-counted
 * (the "69 of 126" bug on Static; on Prospective the visible surface is the
 * "Cohort mappings (N mapped)" numerator).
 */

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportImpact: vi.fn() }
})

beforeEach(() => {
  // @ts-expect-error — minimal stub for recharts ResponsiveContainer
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  // Primary contributes 0 primary cohorts (empty dimensions) so the mapped
  // count isolates the subsystem contribution.
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test', name: 'Test System',
      time_horizon: { start_year: 2020, end_year: 2030 }, dimensions: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    systemState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    cohortMappings: {},
  })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any, created_at: '2026-01-01',
    }],
  })
  // Reset the subsystem singleton + neutralise its real network fetch (the
  // dsmStore subscription in subsystemStore.ts fires fetchForSystem on every
  // activeSystem change; unstubbed those fetches race and pollute the render).
  useSubsystemStore.setState({
    subsystems: [],
    fetchForSystem: (async () => undefined) as never,
  })
})

async function renderPanel() {
  const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
  const utils = render(<ProjectedImpactPanel />)
  await act(async () => { await Promise.resolve() })
  return utils
}

describe('ProjectedImpactPanel — subsystem mapped count excludes the synthesized primary', () => {
  it('counts ONLY the dependent subsystem, never the primary entry (whatever it holds)', async () => {
    const { getByTestId } = await renderPanel()
    act(() => {
      useSubsystemStore.setState({
        fetchForSystem: (async () => undefined) as never,
        subsystems: [
          // Synthesized PRIMARY — deliberately carries mapped cohort_mappings.
          // The filter must exclude it, so these 3 must NOT reach the count
          // (a broken filter would report "5 mapped").
          {
            id: 'sys-test', name: 'Test System', type: 'primary', dependency_rules: [],
            dimensions: [],
            cohort_mappings: {
              'BEV|S': { archetype_id: 'p1' }, 'BEV|L': { archetype_id: 'p2' }, 'ICEV|S': { archetype_id: 'p3' },
            },
          },
          // Dependent: 2 mapped cohorts — the only ones that should count.
          {
            id: 'sub1', name: 'Fueling', type: 'dependent', dependency_rules: [],
            dimensions: [{ name: 'station', display_name: 'Station', labels: ['A', 'B', 'C', 'D'] }],
            cohort_mappings: { A: { archetype_id: 'x' }, B: { archetype_id: 'y' } },
          },
        ] as never,
      })
    })
    // 0 primary (empty dims) + 2 dependent = 2 mapped, NOT 5.
    const toggle = getByTestId('projected-info-banner-toggle')
    expect(toggle.textContent).toContain('Cohort mappings (2 mapped)')
    // Title breaks the count down; primary is 0 here (its dims are empty and
    // its own cohort_mappings are excluded), subsystem is the dependent's 2.
    const titled = toggle.querySelector('[title]')
    expect(titled?.getAttribute('title')).toContain('0 primary + 2 subsystem')
  })
})
