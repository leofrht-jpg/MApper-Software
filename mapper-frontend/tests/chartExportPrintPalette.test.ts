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
  buildPrintInkMapping,
  adaptInkForPrint,
  renderLegendSvg,
  centeredLegendX,
} from '../src/components/charts/chartExport'
import { CHART_PALETTE, SCENARIO_PALETTE } from '../src/utils/chartColors'

// Patch 5AJ — chart EXPORTS use a print palette: INK (text / axis lines / tick
// marks / labels / grid / borders) is re-themed to black-on-grey on a white
// background, while DATA series colours (cohort / scenario fills) are NEVER
// recoloured and the on-screen dark theme is untouched. The serialized SVG has
// no jsdom layout engine, so we lock the pure colour-mapping contract (per the
// 5AD/5AF pure-function convention).

const PRINT_INK = '#000000'
const PRINT_GRID = '#cbd5e1'

describe('print ink mapping — INK sources only', () => {
  const mapping = buildPrintInkMapping()

  it('maps every text-token form (hex / rgb / var) → black', () => {
    // --text-tertiary #5A6577 = rgb(90, 101, 119)
    expect(mapping['#5A6577']).toBe(PRINT_INK)
    expect(mapping['rgb(90, 101, 119)']).toBe(PRINT_INK)
    expect(mapping['var(--text-tertiary)']).toBe(PRINT_INK)
    // --text-secondary #8B95A5 (tick labels)
    expect(mapping['#8B95A5']).toBe(PRINT_INK)
    expect(mapping['var(--text-secondary)']).toBe(PRINT_INK)
    // --text-primary #E8ECF1 (titles)
    expect(mapping['#E8ECF1']).toBe(PRINT_INK)
  })

  it('maps every border-token form → light grey (grid stays subtle on white)', () => {
    // --border-subtle #1E2530 = rgb(30, 37, 48)
    expect(mapping['#1E2530']).toBe(PRINT_GRID)
    expect(mapping['rgb(30, 37, 48)']).toBe(PRINT_GRID)
    expect(mapping['var(--border-subtle)']).toBe(PRINT_GRID)
    expect(mapping['var(--border-default)']).toBe(PRINT_GRID)
  })

  it('NEVER contains a data palette colour as a remap key (data is untouchable)', () => {
    const keys = Object.keys(mapping).map((k) => k.toLowerCase())
    for (const c of [...CHART_PALETTE, ...SCENARIO_PALETTE]) {
      expect(keys).not.toContain(c.toLowerCase())
    }
  })

  it('does NOT remap module/accent colours used by reference lines', () => {
    // --mod-plca #f59e0b is the year-detail ReferenceLine stroke AND a member of
    // CHART_PALETTE — it must never be a colour-remap key (handled by class).
    expect(mapping['#f59e0b']).toBeUndefined()
    expect(mapping['#F59E0B']).toBeUndefined()
    expect(mapping['var(--mod-plca)']).toBeUndefined()
  })
})

describe('adaptInkForPrint — recolours ink, preserves data', () => {
  it('recolours axis/tick/label ink (var + rgb + hex) but leaves cohort fills intact', () => {
    const svg = [
      '<svg>',
      '<line class="recharts-cartesian-axis-line" stroke="var(--text-tertiary)" style="stroke: rgb(90, 101, 119);" />',
      '<text class="recharts-cartesian-axis-tick-value" style="fill: rgb(139, 149, 165);">2030</text>',
      '<line class="recharts-cartesian-grid-horizontal" stroke="var(--border-subtle)" />',
      // Data series — must survive verbatim.
      '<path class="recharts-area-area" fill="#8b5cf6" />',
      '<path class="recharts-area-curve" stroke="#14b8a6" style="stroke: rgb(20, 184, 166);" />',
      '</svg>',
    ].join('')
    const out = adaptInkForPrint(svg)

    // Ink → black, grid → grey.
    expect(out).not.toContain('var(--text-tertiary)')
    expect(out).not.toContain('rgb(90, 101, 119)')
    expect(out).not.toContain('rgb(139, 149, 165)')
    expect(out).toContain(PRINT_INK)
    expect(out).toContain(PRINT_GRID)
    expect(out).not.toContain('var(--border-subtle)')

    // Data fills/strokes — byte-for-byte preserved.
    expect(out).toContain('fill="#8b5cf6"')
    expect(out).toContain('stroke="#14b8a6"')
    expect(out).toContain('rgb(20, 184, 166)')
  })

  it('leaves the reference-line accent colour untouched (darkened by class, not colour)', () => {
    const svg = '<line class="recharts-reference-line-line" stroke="#f59e0b" style="stroke: rgb(245, 158, 11);" />'
    const out = adaptInkForPrint(svg)
    expect(out).toContain('#f59e0b')
    expect(out).toContain('rgb(245, 158, 11)')
  })
})

describe('legend export contracts intact (5O visible-only / 5AF centring)', () => {
  it('renders legend text in black for light/transparent (print) and keeps swatch data colours', () => {
    const items = [
      { color: '#8b5cf6', label: 'BEV-LFP' },
      { color: '#14b8a6', label: 'HEV-LFP' },
    ]
    const light = renderLegendSvg(items, 240, 'light')
    const transparent = renderLegendSvg(items, 240, 'transparent')
    // Text fill = black ink.
    expect(light.svgString).toContain(`fill="${PRINT_INK}"`)
    expect(transparent.svgString).toContain(`fill="${PRINT_INK}"`)
    // Swatch data colours preserved.
    expect(light.svgString).toContain('fill="#8b5cf6"')
    expect(light.svgString).toContain('fill="#14b8a6"')
  })

  it('dark export legend keeps light text (on-screen-equivalent), not print ink', () => {
    const dark = renderLegendSvg([{ color: '#8b5cf6', label: 'BEV-LFP' }], 240, 'dark')
    expect(dark.svgString).toContain('fill="#E8ECF1"')
  })

  it('centred-legend math (5AF) is unchanged', () => {
    expect(centeredLegendX(800, 400)).toBe(200)
    expect(centeredLegendX(300, 500)).toBe(0)
  })
})
