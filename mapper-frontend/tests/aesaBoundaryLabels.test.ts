/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  wrapBoundaryLabel, boundaryLabel, boundaryLabelText,
  radarLabelLayout, clippedLabels, overlappingLabelPairs,
  MAX_LABEL_LINE, MIN_LABEL_FONT_PX, LABEL_FONT_PX,
} from '../src/utils/aesaBoundaryLabels'

// The radar previously labelled its axes through `shortPbName`, which cut any
// word past 10 characters — "Ecotoxici… freshwater", "…zone depletion". The
// replacement never shortens a word: it wraps, and the layout gives the text
// the margin it needs.
//
// Recharts renders nothing in jsdom and the radar is hand-drawn SVG whose label
// extents depend on font metrics jsdom does not implement, so measuring a
// rendered chart would prove nothing. The geometry is therefore pure and
// exported, and overlap/clipping are checked as arithmetic on the same numbers
// the component draws with.

/** The shipped Sala 2020 set — the real label lengths, read from the data file
 *  rather than retyped, so a rename in the data reaches this test. */
const SALA_NAMES: string[] = (() => {
  const json = JSON.parse(readFileSync(
    resolve(process.cwd(), '../mapper-backend/mapper/data/aesa/boundary_sets.json'),
    'utf-8',
  ))
  const sala = json.sets.find((s: { id: string }) => s.id === 'Sala2020_EF')
  const bs = sala.boundaries
  const list = Array.isArray(bs) ? bs : Object.values(bs)
  return (list as Array<{ short_name?: string; name: string }>).map((b) => b.short_name || b.name)
})()

describe('the shipped fixture is the real thing', () => {
  it('reads all 16 Sala categories from the data file', () => {
    expect(SALA_NAMES).toHaveLength(16)
    expect(SALA_NAMES).toContain('Ecotoxicity, freshwater')
    expect(SALA_NAMES).toContain('Resource use, minerals and metals')
  })
})

// ── wrapping ────────────────────────────────────────────────────────────────

describe('labels wrap, never truncate', () => {
  it('no line is ever an ellipsis or a cut word', () => {
    for (const name of SALA_NAMES) {
      for (const line of wrapBoundaryLabel(name)) {
        expect(line, `${name} produced an ellipsis`).not.toMatch(/…|\.\.\./)
      }
    }
  })

  it('the wrapped lines reassemble to the original name', () => {
    // The strongest statement of "nothing was lost": every word survives, in
    // order. A truncating implementation cannot pass this.
    for (const name of SALA_NAMES) {
      const rejoined = wrapBoundaryLabel(name).join(' ').replace(/\s+/g, ' ')
      expect(rejoined).toBe(name.replace(', ', ' ').replace(/\s+/g, ' '))
    }
  })

  it('short names stay on one line', () => {
    expect(wrapBoundaryLabel('Land use')).toEqual(['Land use'])
    expect(wrapBoundaryLabel('Water use')).toEqual(['Water use'])
  })

  it("breaks at EF's own comma when there is one", () => {
    expect(wrapBoundaryLabel('Ecotoxicity, freshwater'))
      .toEqual(['Ecotoxicity', 'freshwater'])
    expect(wrapBoundaryLabel('Resource use, minerals and metals'))
      .toEqual(['Resource use', 'minerals and metals'])
  })

  it('balances at a space when there is no comma', () => {
    expect(wrapBoundaryLabel('Photochemical ozone formation'))
      .toEqual(['Photochemical', 'ozone formation'])
  })

  it('returns an over-long single word whole rather than cutting it', () => {
    const word = 'Supercalifragilisticexpialidocious'
    expect(wrapBoundaryLabel(word)).toEqual([word])
  })

  it('every wrapped line fits the budget, except an unbreakable word', () => {
    for (const name of SALA_NAMES) {
      const lines = wrapBoundaryLabel(name)
      for (const line of lines) {
        if (!line.includes(' ')) continue      // single word: nowhere to break
        expect(line.length, `"${line}" (from ${name})`).toBeLessThanOrEqual(MAX_LABEL_LINE)
      }
    }
  })

  it('handles empty and whitespace input without throwing', () => {
    expect(wrapBoundaryLabel('')).toEqual([''])
    expect(wrapBoundaryLabel('   ')).toEqual([''])
  })
})

// ── row → label ─────────────────────────────────────────────────────────────

describe('a result row resolves to a label plus its full name', () => {
  it('uses the engine-stamped short name and keeps the full one for the tooltip', () => {
    const { lines, full } = boundaryLabel({
      pb_short_name: 'Ecotoxicity, freshwater',
      pb_name: 'Ecotoxicity, freshwater',
    })
    expect(lines).toEqual(['Ecotoxicity', 'freshwater'])
    expect(full).toBe('Ecotoxicity, freshwater')
  })

  it('falls back to pb_name for rows saved before the field existed', () => {
    // A session saved by an older build has no pb_short_name. It must label
    // itself from what it does carry, not render blank.
    const { lines, full } = boundaryLabel({ pb_short_name: '', pb_name: 'Climate change' })
    expect(lines).toEqual(['Climate change'])
    expect(full).toBe('Climate change')
  })

  it('survives a row missing both fields', () => {
    expect(boundaryLabel({}).lines).toEqual([''])
  })

  it('the flat form joins the lines with a space', () => {
    expect(boundaryLabelText({ pb_short_name: 'Human toxicity, cancer' }))
      .toBe('Human toxicity cancer')
  })
})

// ── radar geometry: the claim the user asked to be confirmed ────────────────

/** Exactly the layout the component computes: the shipped 16 categories,
 *  wrapped, at the given canvas size. */
function layoutFor(size: number) {
  return radarLabelLayout(SALA_NAMES.map((n) => wrapBoundaryLabel(n)), size)
}

describe('radar labels neither overlap nor clip', () => {
  // 480 is the only size the radar renders at in the app: RadarView's `size`
  // prop defaults to 480 and the single call site (AESADashboard) passes
  // nothing. The SVG has fixed width/height, so a narrow window scrolls the
  // page rather than reflowing the chart — there is no smaller rendered size.
  // The sweep below nonetheless holds the property across a range, so adding a
  // compact call site later cannot silently reintroduce clipping.
  const APP_SIZE = 480

  it('the app size is clean', () => {
    const layout = layoutFor(APP_SIZE)
    expect(clippedLabels(layout, APP_SIZE)).toEqual([])
    expect(overlappingLabelPairs(layout)).toEqual([])
    expect(layout.fontPx).toBe(LABEL_FONT_PX)   // no shrinking needed at 480
    expect(layout.radius).toBeGreaterThan(APP_SIZE * 0.2)
  })

  it('RadarView still defaults to that size — the number above is not stale', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/aesa/RadarView.tsx'), 'utf-8')
    expect(src).toMatch(/size\s*=\s*480/)
  })

  it('stays clean across every size down to the legibility floor', () => {
    for (let size = 360; size <= 700; size += 10) {
      const layout = layoutFor(size)
      expect(clippedLabels(layout, size).map((b) => b.lines.join(' ')),
        `clipped at ${size}`).toEqual([])
      expect(overlappingLabelPairs(layout), `overlap at ${size}`).toEqual([])
      expect(layout.fontPx, `illegible font at ${size}`)
        .toBeGreaterThanOrEqual(MIN_LABEL_FONT_PX)
    }
  })

  it('shrinks the font instead of running off the canvas as space tightens', () => {
    // The old layout used a fixed 80px pad, so the longest label simply ran
    // past the edge. Padding now follows the text and the font gives way
    // before the boundary does.
    expect(layoutFor(400).fontPx).toBeLessThan(layoutFor(560).fontPx)
    expect(layoutFor(560).fontPx).toBe(LABEL_FONT_PX)
  })

  it('never shrinks below the legibility floor', () => {
    // Past this point the layout stops shrinking — below 7px nothing readable
    // remains, so a clipped label is reported rather than hidden behind an
    // unreadable one. Documented, not silently tolerated.
    expect(layoutFor(240).fontPx).toBe(MIN_LABEL_FONT_PX)
  })

  it('keeps the plot from collapsing on a narrow canvas', () => {
    for (const size of [240, 300, 360, 480]) {
      expect(layoutFor(size).radius, `radius collapsed at ${size}`)
        .toBeGreaterThanOrEqual(size * 0.2)
    }
  })

  it('a pathologically long category still does not overlap its neighbours', () => {
    const long = Array.from({ length: 16 }, () => ['Resource use', 'minerals and metals'])
    const layout = radarLabelLayout(long, 480)
    expect(overlappingLabelPairs(layout)).toEqual([])
    expect(clippedLabels(layout, 480)).toEqual([])
  })

  it('a filtered 3-indicator radar is clean too', () => {
    const three = SALA_NAMES.slice(0, 3).map((n) => wrapBoundaryLabel(n))
    const layout = radarLabelLayout(three, 480)
    expect(overlappingLabelPairs(layout)).toEqual([])
    expect(clippedLabels(layout, 480)).toEqual([])
  })
})
