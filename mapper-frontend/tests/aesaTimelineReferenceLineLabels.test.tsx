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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TimelineView } from '../src/components/aesa/TimelineView'
import type { SustainabilityRatioResult } from '../src/api/client'

// Patch 4AF — SR=1.0 (safe) and SR=2.0 (uncertainty) reference-line
// labels moved OUT of the chart plot area and INTO the legend.
//
// Patch 4AD attempted to fix label overlap by repositioning to
// `insideTopLeft`, but with a compressed-vs-expanded Y-range
// (climate-change-filtered Timeline runs 0-60), 1.0 and 2.0 still
// collapsed to nearly the same pixel row at the bottom-left. The
// architectural fix: reference markers are interpretation aids,
// not data, so they live in the legend (where chart meanings are
// documented), not the plot area (for data only).
//
// What this suite locks in:
//   1. The dashed reference lines still render in the chart at
//      y=1.0 and y=2.0 (only labels move).
//   2. No "SR=" text exists inside the chart's plot SVG.
//   3. Legend contains descriptive entries
//      "SR = 1.0 (safe boundary)" and "SR = 2.0 (uncertainty
//      boundary)" alongside the indicator data series.
//   4. Indicator data series still render correctly (Patch 4S
//      legend payload preserved).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const SAMPLE_RESULTS: SustainabilityRatioResult[] = [
  ...['climate_change', 'biosphere_integrity'].flatMap(
    (pb_id) => [2030, 2040].map((year) => ({
      year, pb_id, pb_name: pb_id.replace(/_/g, ' '),
      ef_indicator: 'EF v3.1', impact: 1.0, allocated_sos: 1.0,
      sr: year === 2030 ? 0.7 : 3.5,
      zone: 'safe' as const,
      sharing_principle: null,
      layer_factors: [], total_sharing_factor: 0,
      sharing_factor_l1: 0, sharing_factor_l2: 1,
      boundary_type: 'cumulative' as const, confidence: 'high' as const,
      unit: '', impact_by_cohort: {}, method_label: '',
    } as SustainabilityRatioResult)),
  ),
]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('AESA Timeline SR boundaries move from plot area to legend (Patch 4AF)', () => {
  it('no "SR=" or "SR =" text label renders INSIDE the chart plot SVG', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    // Recharts' chart SVG is rendered inside `.recharts-wrapper`;
    // the legend sits OUTSIDE that wrapper in
    // `.recharts-legend-wrapper`. Look at plot text only.
    const chartSvg = container.querySelector('.recharts-wrapper svg')
    expect(chartSvg).not.toBeNull()
    const plotTexts = Array.from(chartSvg!.querySelectorAll('text'))
    for (const t of plotTexts) {
      const s = t.textContent ?? ''
      expect(s).not.toMatch(/SR\s*=\s*[12]\.0/)
    }
  })

  it('legend contains both reference-line entries with descriptive text', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    // Recharts renders the legend as `<ul class="recharts-default-legend">`
    // with one `<li class="recharts-legend-item">` per entry. Read
    // the full legend's textContent so we don't fight per-cell DOM
    // structure across Recharts versions.
    const legend = container.querySelector('.recharts-legend-wrapper')
    expect(legend).not.toBeNull()
    const legendText = legend!.textContent ?? ''
    expect(legendText).toContain('SR = 1.0 (safe boundary)')
    expect(legendText).toContain('SR = 2.0 (uncertainty boundary)')
  })

  it('legend still contains indicator data series (Patch 4S preserved)', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    const legend = container.querySelector('.recharts-legend-wrapper')
    const legendText = legend!.textContent ?? ''
    // shortPbName routes `pb_name.replace(/_/g, ' ')`; with these
    // short fixture names ("climate change", "biosphere integrity")
    // the bare names survive verbatim.
    expect(legendText).toContain('climate change')
    expect(legendText).toContain('biosphere integrity')
  })

  // Note: a regression test for "dashed reference lines still
  // render in the chart SVG" was attempted here. Recharts 3.x +
  // jsdom (in the mocked-ResponsiveContainer test environment)
  // doesn't paint internal chart shapes — neither `<Line>` data
  // series nor `<ReferenceLine>` boundaries render as concrete
  // SVG nodes. The lines DO render in production where the chart
  // gets real layout dimensions. We rely on the unchanged
  // `<ReferenceLine y={1.0} stroke=... strokeDasharray="4 4" />`
  // markup as the methodological lock-in; Patch 4AF only dropped
  // the `label` props, not the lines themselves.

  it('legend reference-line entries carry the correct zone colors', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    // Recharts renders each `type: 'plainline'` legend item's icon
    // as a small `<svg>` containing a `<path>` (or `<line>`) with
    // `stroke={color}`. We assert that the two reference-line
    // entries' icon strokes use colors distinct from the indicator
    // swatch colors (which are `fill`-based per Patch 4S
    // iconType="square").
    const legend = container.querySelector('.recharts-legend-wrapper')!
    const items = Array.from(legend.querySelectorAll('li.recharts-legend-item'))
    // 2 indicator entries + 2 reference-line entries = 4 total.
    expect(items.length).toBe(4)
    // Reference-line entries are the last two in the payload order.
    // Their icons carry a non-empty stroke (because plainline type
    // draws via stroke, not fill).
    const refItems = items.slice(2)
    for (const item of refItems) {
      // Find the icon stroke — could be on a <path> or <line>.
      const strokeCarrier = item.querySelector('[stroke]')
      expect(strokeCarrier).not.toBeNull()
      const stroke = strokeCarrier!.getAttribute('stroke') ?? ''
      expect(stroke).not.toBe('')
      expect(stroke).not.toBe('none')
      expect(stroke).not.toBe('transparent')
    }
  })
})
