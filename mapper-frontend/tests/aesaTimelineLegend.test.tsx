/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { TimelineView } from '../src/components/aesa/TimelineView'
import { AESA_INDICATOR_PALETTE, colorForIndicator } from '../src/utils/aesaIndicatorColors'
import type { SustainabilityRatioResult } from '../src/api/client'

// Recharts' `ResponsiveContainer` measures its parent via
// `ResizeObserver` and reports 0 width in jsdom (no layout). The
// chart's child SVG never renders → the legend never renders.
// Mock it to pass children through with a fixed size so the chart
// emits its real DOM (legend items + lines) for assertion.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement(
      'div',
      { style: { width, height } },
      // Children is a single ReactElement (the chart). Clone with
      // explicit width/height so Recharts skips its own measurement.
      React.cloneElement(children, { width, height }),
    )
  return { ...actual, ResponsiveContainer }
})

// Patch 4S — AESA Timeline legend swatches. Pre-fix bug: Recharts'
// default `iconType="line"` rendered swatches as 1-2px horizontal
// strokes that read as faint outlines at legend size, AND the
// palette's slot 0 (`var(--mod-aesa)`) didn't resolve on the SVG
// `stroke` attribute inside Recharts' detached legend wrapper.
// Fix: explicit `payload` with concrete hex `color` per entry +
// `iconType="square"` so swatches render as filled rectangles.
//
// The test class that should have caught this asserts color-presence
// on swatch elements, not just label-presence. Swatches must:
//   - exist (one per indicator)
//   - have a non-transparent, non-empty color value
//   - not all share the same color (which would mean one
//     fallback color leaked everywhere)
//   - match what the corresponding `<Line>` uses for its stroke
//     (so legend-to-line mapping is faithful)

const SAMPLE_RESULTS: SustainabilityRatioResult[] = [
  // 4 indicators × 2 years.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...['climate_change', 'biosphere_integrity', 'land_use_change', 'fresh_water_use'].flatMap(
    (pb_id) => [2030, 2040].map((year) => ({
      year,
      pb_id,
      pb_name: pb_id.replace(/_/g, ' '),
      ef_indicator: 'EF v3.1',
      impact: 1.0,
      allocated_sos: 1.0,
      sr: year === 2030 ? 0.7 : 1.4,
      zone: 'safe' as const,
      sharing_principle: null,
    } as SustainabilityRatioResult)),
  ),
]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('colorForIndicator helper (Patch 4S)', () => {
  it('returns concrete hex colors, never CSS variables', () => {
    // CSS variables in Recharts' detached legend wrapper don't resolve
    // on SVG `stroke` attributes — that was the bug. Every palette
    // slot must be a `#rrggbb` literal.
    for (const c of AESA_INDICATOR_PALETTE) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('returns deterministic colors for the same indicator index', () => {
    expect(colorForIndicator('climate_change', 0)).toBe(colorForIndicator('climate_change', 0))
    expect(colorForIndicator('foo', 3)).toBe(colorForIndicator('bar', 3))  // index drives, not id
  })

  it('wraps via modulo when index exceeds palette size', () => {
    expect(colorForIndicator('x', AESA_INDICATOR_PALETTE.length))
      .toBe(AESA_INDICATOR_PALETTE[0])
  })
})

describe('TimelineView legend swatches (Patch 4S, updated by Patch 4AF)', () => {
  // Patch 4AF replaces Recharts' default legend (`payload`-driven
  // `<path>` icons) with a custom `content={()=>...}` render. The
  // legend now contains:
  //   - N indicator entries (one per pb_id), swatch = `<rect fill>`
  //   - 2 reference-line entries (SR=1.0 safe, SR=2.0 uncertainty),
  //     swatch = `<line stroke stroke-dasharray="4 4">`
  // The Patch 4S color contract still holds for the indicators:
  // concrete hex fills drawn from `AESA_INDICATOR_PALETTE`. The
  // assertions below are updated to the new swatch shape.

  it('renders one legend swatch per indicator with a concrete color', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    const items = container.querySelectorAll('li.recharts-legend-item')
    // 4 indicators + 2 reference-line entries.
    expect(items.length).toBe(6)
    // Indicator entries are the first 4; each contains a <rect>
    // swatch with a non-empty fill.
    const indicatorColors: string[] = []
    for (let i = 0; i < 4; i++) {
      const li = items[i]
      const rect = li.querySelector('rect')
      expect(rect).not.toBeNull()
      const fill = (rect!.getAttribute('fill') ?? '').trim()
      expect(fill).not.toBe('')
      expect(fill).not.toBe('transparent')
      expect(fill).not.toBe('none')
      expect(fill).not.toMatch(/^var\(/)
      indicatorColors.push(fill)
    }
    // Distinct — Patch 4S regression vector (all-same-fallback bug).
    expect(new Set(indicatorColors).size).toBe(4)
  })

  it('legend swatch colors are drawn from the indicator palette', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    const items = container.querySelectorAll('li.recharts-legend-item')
    const paletteLower = AESA_INDICATOR_PALETTE.slice(0, 4).map((c) => c.toLowerCase())
    for (let i = 0; i < 4; i++) {
      const li = items[i]
      const rect = li.querySelector('rect')
      const fill = (rect?.getAttribute('fill') ?? '').toLowerCase()
      expect(paletteLower).toContain(fill)
    }
  })

  it('indicator swatches render as <rect> (Patch 4AF custom legend shape)', () => {
    // Pre-Patch-4AF Recharts emitted indicator icons as <path d="M-16,-16h32...">.
    // Patch 4AF's custom legend uses native <rect fill={color} rx="1">.
    // The Patch 4AE export pipeline (priority 1 = SVG fill attribute)
    // picks up the rect's fill correctly — the visual contract.
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    const items = container.querySelectorAll('li.recharts-legend-item')
    expect(items.length).toBeGreaterThanOrEqual(4)
    // First 4 items are indicator entries.
    for (let i = 0; i < 4; i++) {
      const rect = items[i].querySelector('rect')
      expect(rect).not.toBeNull()
      expect(rect!.getAttribute('fill')).not.toBe(null)
    }
  })

  it('Patch 4AF reference-line entries render last two slots with dashed strokes', () => {
    const { container } = render(<TimelineView results={SAMPLE_RESULTS} />)
    const items = container.querySelectorAll('li.recharts-legend-item')
    expect(items.length).toBe(6)
    // Items 4 and 5 are the reference-line entries — swatch is
    // `<line stroke stroke-dasharray="4 4">`.
    for (let i = 4; i < 6; i++) {
      const line = items[i].querySelector('line')
      expect(line).not.toBeNull()
      expect(line!.getAttribute('stroke-dasharray')).toBe('4 4')
      const stroke = line!.getAttribute('stroke') ?? ''
      expect(stroke).not.toBe('')
      expect(stroke).not.toBe('none')
    }
  })
})
