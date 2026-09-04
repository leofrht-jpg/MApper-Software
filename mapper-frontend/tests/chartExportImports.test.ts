/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// chartExport.ts must IMPORT. That sounds too weak to be worth a test, and it
// is not: Dependabot #86 bumped svg2pdf.js 2.7.0 -> 2.8.1, whose UMD build
// throws while being imported --
//
//   TypeError: Cannot read properties of undefined (reading 'jsPDF')
//     node_modules/svg2pdf.js/dist/svg2pdf.umd.min.js:2:7353
//     src/components/charts/chartExport.ts:11
//
// -- so the module never loads and chart PDF export breaks OUTRIGHT rather
// than degrading. Every chart's export menu goes with it, because they all
// route through this one module.
//
// The suite already catches this, but only BY ACCIDENT: nine test files
// import chartExport for its pure helpers (extractLegendItems,
// renderLegendSvg, centeredLegendX, darkenReferenceLines, ...), and a
// throwing import fails them all. That guard evaporates the day someone
// vi.mock()s the module in those nine -- a reasonable thing to do, with no
// hint that it removes the only thing standing between us and a silently
// broken export. This test makes the guard deliberate, and says why.
//
// Verified load-bearing: installing svg2pdf.js@2.8.1 fails this file with the
// error above.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('chart PDF export loads at all', () => {
  it('imports chartExport.ts without throwing (svg2pdf + jspdf interop)', async () => {
    const mod = await import('../src/components/charts/chartExport')
    // exportChart is the entry point every chart's menu calls.
    expect(typeof mod.exportChart).toBe('function')
  })

  it('pins svg2pdf.js to an EXACT version — a caret would re-admit 2.8.x', () => {
    // The note lives beside the version in package.json; this is the part a
    // reader cannot skip. `^2.7.0` resolves 2.8.1 on any fresh install or
    // lockfile regeneration, which is precisely how the break would return.
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    const spec = pkg.dependencies['svg2pdf.js']
    expect(spec, 'svg2pdf.js must still be a direct dependency').toBeTruthy()
    expect(
      /^\d+\.\d+\.\d+$/.test(spec),
      `svg2pdf.js must be pinned exactly, got "${spec}". A range re-admits `
        + '2.8.1, whose UMD build cannot resolve jsPDF at import time and '
        + 'breaks chart PDF export outright. See the "//svg2pdf.js" note in '
        + 'package.json.',
    ).toBe(true)
  })
})

// ── and that it actually PRODUCES a PDF ─────────────────────────────────────
// The import guard above covers the failure that was actually seen (#86 threw
// while loading). It would not catch a bump that imports fine and then emits
// a blank page, which is the other way this can break silently — the download
// still arrives, so nothing looks wrong until someone opens the file.
//
// SCOPE, stated so it is not mistaken for more than it is: this is a SMOKE
// test, not a fidelity test. jsdom implements no SVG layout, so `getBBox` and
// `getComputedTextLength` have to be shimmed, and the geometry svg2pdf sees is
// therefore synthetic. It cannot tell you the chart LOOKS right. What it does
// tell you is that the whole path — serialize → parse → svg2pdf → jsPDF →
// blob — runs to completion and emits a structurally valid PDF whose content
// stream contains stroked paths and drawn text rather than an empty page.
describe('chart PDF export produces a real PDF', () => {
  function shimSvgLayout(): void {
    const proto = SVGElement.prototype as unknown as Record<string, unknown>
    if (typeof proto.getBBox !== 'function') {
      proto.getBBox = function (this: SVGElement) {
        const n = (a: string) => Number(this.getAttribute(a) ?? 0) || 0
        return { x: n('x'), y: n('y'), width: n('width') || 100, height: n('height') || 20 }
      }
    }
    if (typeof proto.getComputedTextLength !== 'function') {
      proto.getComputedTextLength = () => 50
    }
  }

  function chartContainer(): HTMLElement {
    const host = document.createElement('div')
    // Shaped like what serializeSvgForExport receives from a Recharts chart:
    // the .recharts-surface root findChartSvg looks for, gridlines, two data
    // paths, and axis text. Recharts renders nothing under jsdom, so the SVG
    // is written by hand rather than mounted.
    host.innerHTML = `
      <svg class="recharts-surface" width="480" height="300" viewBox="0 0 480 300">
        <rect x="0" y="0" width="480" height="300" fill="#ffffff"></rect>
        <line x1="40" y1="20" x2="40" y2="260" stroke="#cccccc"></line>
        <line x1="40" y1="260" x2="460" y2="260" stroke="#cccccc"></line>
        <path d="M40,240 L140,180 L240,120 L340,90 L440,60" fill="none" stroke="#1D9E75" stroke-width="2"></path>
        <path d="M40,250 L140,220 L240,200 L340,190 L440,170" fill="none" stroke="#EF9F27" stroke-width="2"></path>
        <text x="240" y="285" font-size="12" fill="#111111">Year</text>
        <text x="60" y="40" font-size="12" fill="#111111">kg CO2-eq</text>
      </svg>`
    document.body.appendChild(host)
    return host
  }

  it('emits a valid PDF containing stroked paths and text', async () => {
    shimSvgLayout()
    const { exportChart } = await import('../src/components/charts/chartExport')

    const blobs: Blob[] = []
    const url = globalThis.URL as unknown as Record<string, unknown>
    url.createObjectURL = (b: Blob) => { blobs.push(b); return 'blob:test' }
    url.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await exportChart(chartContainer(), 'guard_chart', 'pdf', 'light')

    expect(blobs.length, 'exportChart should trigger exactly one download').toBe(1)
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')

    const body = new TextDecoder('latin1').decode(bytes)
    const stream = /stream\r?\n([\s\S]*?)endstream/.exec(body)?.[1] ?? ''
    // A blank page still yields a valid PDF, so assert on what was DRAWN.
    const count = (re: RegExp) => (stream.match(re) ?? []).length
    expect(count(/^S$/gm), 'stroked paths in the content stream').toBeGreaterThanOrEqual(2)
    expect(count(/^BT$/gm), 'text blocks in the content stream').toBeGreaterThanOrEqual(1)
  })
})
