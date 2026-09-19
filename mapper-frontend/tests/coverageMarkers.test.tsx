/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// "Not specified" markers: the backend says which indicators a result cannot
// speak for (a PARTIAL authored activity with no characterised flow for them);
// these check the UI shows exactly that -- keyed by the full method tuple --
// and nothing when there is no gap. The Timeline legend is a Recharts
// `content` render and Recharts draws nothing in jsdom, so it is not covered
// here; the radar and the tables are plain DOM/SVG.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'

const FAM = 'EF v3.1'
const GW = [FAM, 'climate change', 'GWP100']
const AC = [FAM, 'acidification', 'accumulated exceedance (AE)']
const MOCK_METHODS = [{ family: FAM, categories: [
  { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: GW }] },
  { category: 'acidification', indicators: [{ indicator: 'accumulated exceedance (AE)', tuple: AC }] },
]}]

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, getMethods: vi.fn(() => Promise.resolve(MOCK_METHODS)), calculateArchetypeLCA: vi.fn() }
})

import * as client from '../src/api/client'
import type { AESACoverageGap, CoverageGap, SustainabilityRatioResult } from '../src/api/client'
import { CoverageGapNote, NotSpecifiedMarker, gapsFor } from '../src/components/authored/CoverageMarkers'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { RadarView } from '../src/components/aesa/RadarView'
import { DetailTable } from '../src/components/aesa/DetailTable'
import { useParameterStore } from '../src/stores/parameterStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'

const GAP: CoverageGap = {
  method: AC, database: 'mine', code: 'abc', activity_name: 'Boiler',
  scope_note: 'CO2 only; NOx and particulates not measured',
}

beforeEach(() => {
  cleanup()
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

describe('the lookup and the marker', () => {
  it('matches the FULL method tuple, never the display label', () => {
    // Same last element, different family: must not borrow the other's gap.
    const noLT = ['EF v3.1 no LT', 'acidification no LT', 'accumulated exceedance (AE)']
    expect(gapsFor([GAP], AC)).toHaveLength(1)
    expect(gapsFor([GAP], noLT)).toHaveLength(0)
    expect(gapsFor(undefined, AC)).toEqual([])
  })

  it('renders nothing without a gap, and names the activity with one', () => {
    const empty = render(<NotSpecifiedMarker gaps={[]} />)
    expect(empty.container.innerHTML).toBe('')
    const { getByTestId } = render(<NotSpecifiedMarker gaps={[GAP]} />)
    const m = getByTestId('not-specified-marker')
    expect(m.textContent).toBe('not specified')
    expect(m.getAttribute('title')).toContain('Boiler')
    expect(m.getAttribute('title')).toContain('unknown — not zero')
    expect(m.getAttribute('title')).toContain('CO2 only')
  })

  it('the note says unknown, not zero, and carries the declared scope', () => {
    const { getByTestId } = render(<CoverageGapNote gaps={[GAP]} />)
    const t = getByTestId('coverage-gap-note').textContent!
    expect(t).toContain('Not specified for 1 indicator')
    expect(t).toContain('accumulated exceedance (AE)')
    expect(t).toContain('unknown size, not a zero one')
    expect(t).toContain('Boiler: CO2 only')
  })
})

describe('Single-product Static marks the row, from the result', () => {
  function res(gaps?: CoverageGap[]) {
    return {
      archetype_id: 'a1', archetype_name: 'Heated product', scope: 'all', amount: 1,
      stage_amounts: {}, stages_included: ['Manufacturing'], elapsed_seconds: 1,
      compute_database: null, parameter_scenario: null, warnings: [], stage_breakdown: null,
      results: [
        { method: GW, method_label: 'GWP100', score: 5, unit: 'kg CO2-eq', contributions: [] },
        { method: AC, method_label: 'accumulated exceedance (AE)', score: 0.01, unit: 'mol H+-eq', contributions: [] },
      ],
      ...(gaps ? { coverage_gaps: gaps } : {}),
    }
  }

  async function compute(result: unknown) {
    useSingleProductImpactStore.getState().reset()
    useParameterStore.setState({ table: { parameters: {}, scenarios: [], categories: [] }, selectedScenarios: [] } as never)
    vi.mocked(client.calculateArchetypeLCA).mockResolvedValue(result as never)
    const view = render(<SingleProductStaticPanel archetypeId="a1" />)
    const btn = await screen.findByTestId('single-product-static-calculate')
    await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 4000 })
    fireEvent.click(btn)
    await waitFor(() => expect(view.container.textContent).toContain('Heated product'), { timeout: 5000 })
    return view
  }

  it('marks only the uncovered indicator and shows the note', async () => {
    const { container } = await compute(res([GAP]))
    const rows = [...container.querySelectorAll('tbody tr')]
    const ac = rows.find((r) => r.textContent!.includes('accumulated exceedance'))!
    const gw = rows.find((r) => r.textContent!.includes('GWP100'))!
    expect(within(ac as HTMLElement).queryByTestId('not-specified-marker')).not.toBeNull()
    expect(within(gw as HTMLElement).queryByTestId('not-specified-marker')).toBeNull()
    expect(within(container).getByTestId('single-product-static-coverage-note')).toBeTruthy()
  })

  it('a result with no gaps (or stored before step 4) shows nothing', async () => {
    const { container } = await compute(res())
    expect(within(container).queryByTestId('not-specified-marker')).toBeNull()
    expect(within(container).queryByTestId('single-product-static-coverage-note')).toBeNull()
  })
})

describe('AESA', () => {
  const row = (pb_id: string, sr: number): SustainabilityRatioResult => ({
    year: 2030, pb_id, pb_name: pb_id, pb_short_name: pb_id, impact: 1, allocated_sos: 1, sr, zone: 'safe',
    impact_by_cohort: {},
  } as any)
  const ROWS = [row('climate_change', 0.6), row('acidification', 0.2), row('land_use', 0.4)]
  const AGAP: AESACoverageGap = { ...GAP, pb_id: 'acidification' }

  it('the radar hatches the not-specified axis and draws its vertex hollow', () => {
    const { container } = render(<RadarView results={ROWS} coverageGaps={[AGAP]} />)
    expect(container.querySelector('[data-testid="radar-not-specified-acidification"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="radar-not-specified-climate_change"]')).toBeNull()
    // The hatch is IN the exported svg, so an export carries it.
    const svg = container.querySelector('svg[data-chart-export-target]')!
    expect(svg.querySelector('pattern#radar-not-specified')).not.toBeNull()
    const hollow = [...svg.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === 'none'
      && c.getAttribute('stroke-dasharray') === '2 2')
    expect(hollow).toHaveLength(1)
    expect(hollow[0].querySelector('title')!.textContent).toContain('SR ≥')
    expect(within(container).getByTestId('radar-legend-not-specified').textContent).toContain('lower bound')
  })

  it('the radar is unchanged without gaps', () => {
    const { container } = render(<RadarView results={ROWS} />)
    expect(container.querySelector('[data-testid^="radar-not-specified-"]')).toBeNull()
    expect(within(container).queryByTestId('radar-legend-not-specified')).toBeNull()
  })

  it('the detail table marks the boundary row', () => {
    const { container } = render(<DetailTable results={ROWS} coverageGaps={[AGAP]} />)
    expect(within(container).queryByTestId('aesa-detail-not-specified-acidification-2030')).not.toBeNull()
    expect(within(container).queryByTestId('aesa-detail-not-specified-climate_change-2030')).toBeNull()
  })
})
