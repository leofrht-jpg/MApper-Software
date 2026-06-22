/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'

// Prospective info banner (cohort mappings) is collapsible: default expanded;
// clicking the header toggles the body shown/hidden. Real-render of
// ProjectedImpactPanel past its early-return guards (mirrors
// dsmImpactPanel.render.test.tsx's seeding).

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportImpact: vi.fn() }
})

beforeEach(() => {
  // @ts-expect-error — minimal stub for recharts ResponsiveContainer
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
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
  })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any, created_at: '2026-01-01',
    }],
  })
})

describe('Prospective info banner — collapsible', () => {
  it('is collapsed by default (thin header, body hidden)', async () => {
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { getByTestId, queryByTestId } = render(<ProjectedImpactPanel />)
    // Thin header (icon + short title + chevron) present, body hidden.
    expect(getByTestId('projected-info-banner-toggle')).toBeInTheDocument()
    expect(queryByTestId('projected-info-banner-body')).toBeNull()
    expect(getByTestId('projected-info-banner-toggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('expands on header click (body visible) and re-collapses on a second click', async () => {
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { getByTestId, queryByTestId } = render(<ProjectedImpactPanel />)
    const toggle = getByTestId('projected-info-banner-toggle')

    fireEvent.click(toggle) // expand
    expect(queryByTestId('projected-info-banner-body')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle) // re-collapse
    expect(queryByTestId('projected-info-banner-body')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Thin header still present.
    expect(getByTestId('projected-info-banner-toggle')).toBeInTheDocument()
  })
})
