import { describe, it, expect } from 'vitest'
import { centeredLegendX, extractLegendItems } from '../src/components/charts/chartExport'

// Patch 5AF — the exported (combined chart+legend) image centers the legend
// horizontally within the export's full width, clamped to the left margin,
// instead of left-aligning it. Layout only — never changes which series export
// (the 5O visible-only contract upstream in extractLegendItems is untouched).
// The SVG export has no jsdom layout engine, so we lock the centering math.

describe('centeredLegendX (Patch 5AF)', () => {
  it('centers a single-item (narrow) legend under a wider chart', () => {
    // chart/export width 800, lone legend item ~120 wide → centered.
    expect(centeredLegendX(800, 120)).toBe((800 - 120) / 2)  // 340
  })

  it('centers a multi-item legend', () => {
    expect(centeredLegendX(800, 360)).toBe((800 - 360) / 2)  // 220
  })

  it('rounds to an integer x (sub-pixel widths)', () => {
    expect(centeredLegendX(801, 120)).toBe(Math.round((801 - 120) / 2))  // 341 (340.5→341)
    expect(Number.isInteger(centeredLegendX(801, 120))).toBe(true)
  })

  it('clamps to 0 (left margin) when the legend is as wide / wider than the export', () => {
    expect(centeredLegendX(400, 400)).toBe(0)
    expect(centeredLegendX(300, 360)).toBe(0)  // never negative → never off-edge
  })

  it('is 0 exactly when legend equals total width (no off-by-one push-off)', () => {
    expect(centeredLegendX(640, 640)).toBe(0)
  })
})

describe('visible-only export contract is independent of centering (Patch 5O regression)', () => {
  it('extractLegendItems emits only the rows present in legendRef (centering does not add/remove series)', () => {
    // Simulate a legendRef holding only the VISIBLE entries (hidden ones live
    // in a sibling outside the ref, per 5O). The exporter reads exactly these.
    const legend = document.createElement('div')
    legend.innerHTML = `
      <span><span style="background: rgb(20, 184, 166)"></span><span>SSP2</span></span>
    `
    const items = extractLegendItems(legend)
    expect(items.map((i) => i.label)).toEqual(['SSP2'])  // one visible series → exported alone (now centered)
  })
})
