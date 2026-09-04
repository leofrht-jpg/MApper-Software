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
import { describe, expect, it } from 'vitest'
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
