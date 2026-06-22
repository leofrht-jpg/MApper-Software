/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import {
  extractLegendItems, renderLegendSvg,
} from '../src/components/charts/chartExport'

// Patch 4AE — Recharts `<Legend iconType="square">` (used by AESA
// Timeline, MultiScenarioImpactChart, ComparisonReferenceLineChart,
// MultiYearTrajectoryPanel, TimelinePreviewModal, and DSM Dashboard
// stacked charts) emits the swatch icon as:
//
//   <li class="recharts-legend-item">
//     <svg class="recharts-surface" ...>
//       <path stroke="none" fill="#34D399" d="..." />
//     </svg>
//     <span>label</span>
//   </li>
//
// Pre-Patch-4AE the extractor:
//   - missed the `fill` attribute entirely (no extraction path)
//   - matched `stroke="none"` as a valid color (because
//     `isTransparentColor("none")` returned false)
//   - rendered `<rect fill="none">` in the export = INVISIBLE
//     swatch in PNG transparent-background exports
//
// This suite covers the two regression vectors and a defensive
// renderer guard that coerces any leaked-through transparent color
// to a visible `#888`.

describe('isTransparentColor (Patch 4AE) — paint-keyword rejection', () => {
  // The function is non-exported; we exercise it indirectly via
  // extractLegendItems with synthetic DOMs.
  it('treats stroke="none" as transparent (no longer claims the color slot)', () => {
    document.body.innerHTML = `
      <div id="legend">
        <li class="recharts-legend-item">
          <svg><path stroke="none" fill="#34D399" d="M0,0h10v10h-10z" /></svg>
          <span>Climate change</span>
        </li>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items).toHaveLength(1)
    // The bug's pre-fix output would be { color: "none", ... }.
    // Post-fix the extractor must walk past the stroke and read
    // the path's fill instead.
    expect(items[0].color).toBe('#34D399')
    expect(items[0].color).not.toBe('none')
  })
})

describe('extractLegendItems (Patch 4AE) — SVG fill-attribute extraction', () => {
  it('reads fill from a Recharts iconType="square" path swatch', () => {
    // Faithful reproduction of Recharts 2.x default-legend DOM for
    // `iconType="square"` with explicit color in the payload.
    document.body.innerHTML = `
      <div id="legend">
        <ul class="recharts-default-legend">
          <li class="recharts-legend-item">
            <svg class="recharts-surface" viewBox="0 0 32 32" width="14" height="14">
              <path stroke="none" fill="#34D399" d="M0,4h32v24h-32z" class="recharts-legend-icon" />
            </svg>
            <span class="recharts-legend-item-text">Climate change</span>
          </li>
        </ul>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items).toHaveLength(1)
    expect(items[0].color).toBe('#34D399')
    expect(items[0].label).toBe('Climate change')
  })

  it('reads fill from a multi-item Recharts default legend', () => {
    document.body.innerHTML = `
      <div id="legend">
        <ul class="recharts-default-legend">
          <li class="recharts-legend-item">
            <svg><path stroke="none" fill="#34D399" d="M0,0h10v10h-10z" /></svg>
            <span>Climate change</span>
          </li>
          <li class="recharts-legend-item">
            <svg><path stroke="none" fill="#60A5FA" d="M0,0h10v10h-10z" /></svg>
            <span>Biosphere integrity</span>
          </li>
          <li class="recharts-legend-item">
            <svg><path stroke="none" fill="#F87171" d="M0,0h10v10h-10z" /></svg>
            <span>Land use change</span>
          </li>
        </ul>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items.map((i) => i.color)).toEqual(['#34D399', '#60A5FA', '#F87171'])
    expect(items.map((i) => i.label)).toEqual([
      'Climate change', 'Biosphere integrity', 'Land use change',
    ])
  })

  it('SVG fill takes priority over a (stroke="none" + fill=color) combo', () => {
    // Priority order: fill first, then backgroundColor, then stroke,
    // then border-top. Fill is highest so a fill-bearing icon never
    // falls to the stroke fallback (where "none" used to win).
    document.body.innerHTML = `
      <div id="legend">
        <li>
          <svg><path stroke="none" fill="#abcdef" /></svg>
          <span>row</span>
        </li>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    expect(extractLegendItems(legend)[0].color).toBe('#abcdef')
  })

  it('falls through to stroke for `iconType="line"` swatches (fill="none")', () => {
    // Recharts `iconType="line"` emits the icon as a horizontal
    // line: `<path stroke={color} fill="none" d="M0,h32...">`.
    // Priority order should then skip the fill="none" (rejected by
    // isTransparentColor) and read the stroke.
    document.body.innerHTML = `
      <div id="legend">
        <li>
          <svg><path stroke="#22D3EE" fill="none" d="M0,8 L20,8" /></svg>
          <span>line series</span>
        </li>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    expect(extractLegendItems(legend)[0].color).toBe('#22D3EE')
  })

  it('custom-HTML legends still extract via backgroundColor (BoxPlot pattern)', () => {
    // Existing behaviour — locks in that the Patch 4AE priority
    // shuffle doesn't regress the BoxPlotView / RadarView path.
    document.body.innerHTML = `
      <div id="legend">
        <span><span style="background-color: rgb(167, 139, 250)"></span><span>Multi-D</span></span>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Multi-D')
    expect(items[0].color.replace(/\s+/g, '')).toContain('167,139,250')
  })

  it('row with NO color anywhere falls back to #888 (last-resort sentinel)', () => {
    document.body.innerHTML = `
      <div id="legend">
        <li><span>no swatch here</span></li>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    expect(extractLegendItems(legend)[0].color).toBe('#888')
  })
})

describe('renderLegendSvg (Patch 4AE) — defensive fill validation', () => {
  it('never emits <rect fill="none"> even if extracted color is "none"', () => {
    // Belt-and-suspenders defence: the extractor shouldn't produce
    // "none" anymore (Patch 4AE), but the renderer also coerces
    // any transparent-paint value to #888 so an upstream bug can't
    // cause invisible swatches in transparent-background exports.
    const { svgString } = renderLegendSvg(
      [{ color: 'none', label: 'leaked' }], 400, 'transparent',
    )
    expect(svgString).not.toContain('fill="none"')
    expect(svgString).toContain('fill="#888"')
  })

  it('never emits <rect fill=""> for empty color', () => {
    const { svgString } = renderLegendSvg(
      [{ color: '', label: 'empty' }], 400, 'transparent',
    )
    expect(svgString).not.toContain('fill=""')
    expect(svgString).toContain('fill="#888"')
  })

  it('coerces "transparent" color to #888', () => {
    const { svgString } = renderLegendSvg(
      [{ color: 'transparent', label: 'see-through' }], 400, 'transparent',
    )
    expect(svgString).toContain('fill="#888"')
  })

  it('valid hex colors pass through verbatim', () => {
    const { svgString } = renderLegendSvg(
      [{ color: '#34D399', label: 'climate change' }], 400, 'transparent',
    )
    expect(svgString).toContain('fill="#34D399"')
  })
})

describe('end-to-end (Patch 4AE) — Recharts square swatch through transparent export', () => {
  it('renders a non-transparent fill in the exported SVG for an iconType="square" legend', () => {
    document.body.innerHTML = `
      <div id="legend">
        <ul class="recharts-default-legend">
          <li class="recharts-legend-item">
            <svg><path stroke="none" fill="#34D399" d="..." /></svg>
            <span>Climate change</span>
          </li>
        </ul>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    const { svgString } = renderLegendSvg(items, 400, 'transparent')

    // The whole flow: live DOM with path fill → extracted color →
    // rendered rect fill. The swatch must be painted with the
    // extracted hex, not "none" or empty.
    expect(svgString).toContain('fill="#34D399"')
    expect(svgString).not.toMatch(/<rect[^>]*\sfill="none"/)
    expect(svgString).not.toMatch(/<rect[^>]*\sfill=""/)
  })

  it('works identically across all three background modes (light, dark, transparent)', () => {
    document.body.innerHTML = `
      <div id="legend">
        <li>
          <svg><path stroke="none" fill="#60A5FA" /></svg>
          <span>blue</span>
        </li>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    for (const bg of ['light', 'dark', 'transparent'] as const) {
      const { svgString } = renderLegendSvg(items, 400, bg)
      expect(svgString).toContain('fill="#60A5FA"')
    }
  })
})
