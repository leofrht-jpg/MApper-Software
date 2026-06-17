import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { ZONE_COLOR } from '../src/components/aesa/zones'
import { darkenReferenceLines } from '../src/components/charts/chartExport'

const PRINT_REF = '#374151'  // chartExport's ink colour for reference lines

// AESA SR timeline — the SR=1.0 / SR=2.0 zone-threshold reference lines and
// their legend swatches MUST read from one shared zone-colour source
// (`ZONE_COLOR`). A desync once rendered the lines effectively invisible on the
// dark theme: the lines and swatches must stay locked to the same constant.
//
// Recharts 3.x renders nothing in jsdom (confirmed in 5AV), so we assert the
// SOURCE (the shared constant + both call sites derive from it), NOT a rendered
// stroke colour.

const dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(
  resolve(dir, '..', 'src/components/aesa/TimelineView.tsx'),
  'utf8',
)

// The reference-line block: from the "Dashed reference lines" comment down to
// the indicator <Line> map. Isolates the two <ReferenceLine>s from the legend.
const refBlock = src.slice(
  src.indexOf('Dashed reference lines'),
  src.lastIndexOf('pbs.map'),  // the DATA-line map after the reference lines (the legend also uses pbs.map)
)
// The legend block: the custom <Legend content=…> up to the reference lines.
const legendBlock = src.slice(
  src.indexOf('<Legend'),
  src.indexOf('Dashed reference lines'),
)

describe('AESA SR-timeline reference lines share the zone-colour source', () => {
  it('ZONE_COLOR has the intended zone hexes', () => {
    expect(ZONE_COLOR.safe).toBe('#1D9E75')
    expect(ZONE_COLOR.zone_of_uncertainty).toBe('#EF9F27')
    expect(ZONE_COLOR.high_risk).toBe('#E24B4A')
  })

  it('both reference-line strokes derive from ZONE_COLOR (not a literal/black)', () => {
    expect(refBlock).toMatch(/stroke=\{ZONE_COLOR\.safe\}/)
    expect(refBlock).toMatch(/stroke=\{ZONE_COLOR\.zone_of_uncertainty\}/)
    // no hard-coded colour / black on these lines
    expect(refBlock).not.toMatch(/stroke="#/)
    expect(refBlock).not.toMatch(/stroke="(black|#000)/i)
  })

  it('legend swatches derive from the SAME ZONE_COLOR source', () => {
    expect(legendBlock).toMatch(/stroke=\{ZONE_COLOR\.safe\}/)
    expect(legendBlock).toMatch(/stroke=\{ZONE_COLOR\.zone_of_uncertainty\}/)
  })

  it('reference lines carry an explicit strokeWidth (the visibility fix — Recharts default 1px read as invisible)', () => {
    // Two reference lines, each with an explicit strokeWidth matching the
    // swatch weight so the (correct) zone colour is actually visible.
    const widths = refBlock.match(/strokeWidth=\{2\}/g) ?? []
    expect(widths.length).toBeGreaterThanOrEqual(2)
  })

  it('the SR=1.0/2.0 reference lines are tagged mapper-semantic-ref (export exemption)', () => {
    const markers = refBlock.match(/className="mapper-semantic-ref"/g) ?? []
    expect(markers.length).toBe(2)
  })
})

// ── Export: darkenReferenceLines exempts semantic zone lines ──────────────────
// Recharts renders nothing in jsdom, so we test the pure DOM pass directly on a
// hand-built SVG fragment (two reference-line groups). This is the regression
// guard: the marked (semantic) line keeps its ZONE_COLOR; the plain annotation
// line is darkened to PRINT_REF exactly as before.

function buildRefSvg(): SVGSVGElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <g class="recharts-reference-line mapper-semantic-ref">
        <line class="recharts-reference-line-line" stroke="${ZONE_COLOR.safe}"></line>
      </g>
      <g class="recharts-reference-line">
        <line class="recharts-reference-line-line" stroke="#123456"></line>
      </g>
    </svg>`
  return wrap.querySelector('svg') as unknown as SVGSVGElement
}

describe('darkenReferenceLines exempts mapper-semantic-ref lines', () => {
  it('retains the marked line ZONE_COLOR, darkens the plain line to PRINT_REF', () => {
    const svg = buildRefSvg()
    const [marked, plain] = Array.from(
      svg.querySelectorAll<SVGElement>('.recharts-reference-line-line'),
    )

    darkenReferenceLines(svg)

    // semantic (tagged) line: ZONE_COLOR retained, untouched
    expect(marked.getAttribute('stroke')).toBe(ZONE_COLOR.safe)
    // plain annotation line: darkened to ink, as before
    expect(plain.getAttribute('stroke')).toBe(PRINT_REF)
  })
})
