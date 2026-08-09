/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Boundary labels for space-constrained AESA surfaces.
 *
 * Replaces `shortPbName`, which truncated any word over 10 characters
 * mid-word — the cause of "Ecotoxici… freshwater" and "Eutrophic… terrestri…".
 * Truncation destroys the word rather than fitting it, and a reader cannot
 * recover the term from the stump.
 *
 * NOTHING HERE IS ABBREVIATED. The label is the EF v3.1 category name
 * verbatim, taken from the boundary record (`pb_short_name`, stamped by the
 * engine from `PlanetaryBoundary.short_name || .name`). EF does not define
 * per-category acronyms — Zampori & Pant (2019), EUR 29682 EN, Table 2 gives
 * names, indicators and units only — so any acronym would be ours, and this
 * tool should not coin notation. Fitting is a layout problem, solved by
 * wrapping to two lines rather than by shortening the text.
 *
 * `conventional_acronym` (AP, HTP-c, …) exists on the boundary record for the
 * GLOSSARY only, presented as "commonly written AP". It is never a label.
 */

import type { AESADefaultsBundle, BoundarySet } from '../api/client'

/**
 * The boundary set a configuration is pointed at, or the first available.
 *
 * Shared by the config sidebar (which labels the picker and the category
 * table) and the dashboard (which populates the glossary), so both describe
 * the SAME boundaries. Two independent lookups is how a glossary comes to
 * explain a set the charts are not using.
 */
export function resolveBoundarySet(
  defaults: AESADefaultsBundle | null | undefined,
  boundarySetId: string | null | undefined,
): BoundarySet | null {
  if (!defaults) return null
  return defaults.boundary_sets.find((b) => b.id === boundarySetId)
    ?? defaults.boundary_sets[0]
    ?? null
}

/** Longest single line the radar can render before crowding its neighbour. */
export const MAX_LABEL_LINE = 20

/**
 * Split a boundary label into at most two lines, never breaking a word.
 *
 * EF names carry their own natural break — the comma in "Eutrophication,
 * terrestrial" — so that is preferred. Names without one ("Photochemical ozone
 * formation") wrap at the space that balances the two lines best, which keeps
 * the block narrow rather than leaving one long line and one short.
 *
 * A single word longer than the limit is returned whole. Better a wide label
 * than a destroyed one; the radar's margin accommodates it.
 */
export function wrapBoundaryLabel(label: string, maxLine = MAX_LABEL_LINE): string[] {
  const text = (label ?? '').trim()
  if (!text) return ['']
  if (text.length <= maxLine) return [text]

  // EF's own comma is the authored break point.
  const comma = text.indexOf(', ')
  if (comma > 0) {
    return [text.slice(0, comma), text.slice(comma + 2)]
  }

  const words = text.split(/\s+/)
  if (words.length === 1) return [text]

  // Balance: minimise the widest resulting line.
  let best: [string, string] | null = null
  let bestWidth = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const width = Math.max(a.length, b.length)
    if (width < bestWidth) {
      bestWidth = width
      best = [a, b]
    }
  }
  return best ?? [text]
}

/**
 * The label to render for one SR row, with the full name for the tooltip and
 * the SVG `<title>`.
 *
 * `pb_short_name` is stamped by the engine; `pb_name` is the fallback for rows
 * produced before the field existed (a saved session reloaded after upgrade),
 * so an older session labels itself rather than rendering blank.
 */
export function boundaryLabel(row: {
  pb_short_name?: string | null
  pb_name?: string | null
}): { lines: string[]; full: string } {
  const full = (row.pb_name ?? '').trim()
  const short = (row.pb_short_name ?? '').trim() || full
  return { lines: wrapBoundaryLabel(short), full: full || short }
}

/**
 * The same label, resolved from a boundary RECORD rather than an SR row.
 *
 * Tables that iterate the boundary set (category assignments, method → PB
 * mapping) have the `PlanetaryBoundary` in hand and no SR row. They must not
 * grow their own formatting — `CategoryAssignmentsTable` had exactly that, a
 * local `formatPbName`, which is how a second naming path starts.
 */
export function pbLabel(pb: {
  short_name?: string | null
  name?: string | null
}): { lines: string[]; full: string } {
  return boundaryLabel({ pb_short_name: pb.short_name, pb_name: pb.name })
}

/** Flattened single-line form, for surfaces with horizontal room. */
export function boundaryLabelText(row: {
  pb_short_name?: string | null
  pb_name?: string | null
}): string {
  return boundaryLabel(row).lines.join(' ')
}

// ── Radar label geometry ────────────────────────────────────────────────────
//
// Kept here, pure and exported, so overlap and clipping are testable as
// arithmetic. The radar is hand-drawn SVG, but label extents depend on text
// metrics jsdom does not provide, so measuring a rendered chart would prove
// nothing. This models the same numbers the component uses.

/** Font size of radar axis labels, px. */
export const LABEL_FONT_PX = 10
/** Mean glyph advance for the label font stack, as a fraction of font size.
 *  Deliberately generous — over-estimating width errs toward more margin. */
export const CHAR_ADVANCE = 0.58
/** Gap between the outer ring and the label block, px. */
export const LABEL_GAP = 16

export interface RadarLabelBox {
  index: number
  lines: string[]
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  /** Bounding box in SVG user units. */
  left: number
  right: number
  top: number
  bottom: number
}

export interface RadarLayout {
  /** Ring-to-edge padding, derived from the widest label. */
  pad: number
  radius: number
  /** Font actually used — reduced from `fontPx` when the margin cannot grow
   *  enough to fit the text at full size. */
  fontPx: number
  labels: RadarLabelBox[]
}

/** Never shrink below this — smaller is illegible, and an unreadable label
 *  that technically fits is no better than a clipped one. */
export const MIN_LABEL_FONT_PX = 7

/**
 * Lay out radar axis labels for `size`×`size`, deriving the padding from the
 * widest wrapped line.
 *
 * The previous layout used a FIXED pad of 80, so a label wider than the
 * leftover margin ran off the canvas — "…s and metals", "…zone depletion". The
 * padding now follows the text, and the radius shrinks to make room, which is
 * the correct trade: a slightly smaller plot with readable axes beats a larger
 * one with unreadable ones. Radius is floored at 22% of size so the plot can
 * never collapse to nothing on a narrow container.
 */
export function radarLabelLayout(
  labelLines: readonly string[][],
  size: number,
  fontPx = LABEL_FONT_PX,
): RadarLayout {
  // Fitting the widest label inside the margin is necessary but not
  // sufficient: two labels can each fit and still collide, which happens near
  // the top and bottom of the circle where neighbouring axes are only ~22°
  // apart. So shrink until the arrangement is actually clean, rather than
  // asserting cleanliness for the label lengths that happen to ship today.
  //
  // A smaller font helps on both axes at once — narrower, shorter boxes, and a
  // smaller margin leaves a larger radius, which spreads the labels further
  // apart. The floor still wins: if nothing down to MIN_LABEL_FONT_PX is
  // clean, the smallest attempt is returned, and `overlappingLabelPairs` will
  // say so rather than the layout pretending otherwise.
  let last = layoutAtFont(labelLines, size, fontPx)
  if (!isClean(last, size)) {
    for (let f = last.fontPx - 0.25; f >= MIN_LABEL_FONT_PX; f -= 0.25) {
      const attempt = layoutAtFont(labelLines, size, f)
      last = attempt
      if (isClean(attempt, size)) return attempt
    }
  }
  return last
}

function isClean(layout: RadarLayout, size: number): boolean {
  return clippedLabels(layout, size).length === 0
    && overlappingLabelPairs(layout).length === 0
}

function layoutAtFont(
  labelLines: readonly string[][],
  size: number,
  fontPx: number,
): RadarLayout {
  const n = labelLines.length
  const widestChars = Math.max(1, ...labelLines.flatMap((l) => l.map((s) => s.length)))

  // Padding follows the text. Where the canvas cannot give that much margin
  // without collapsing the plot, shrink the FONT until it can rather than
  // letting the label run off the edge — a smaller readable label beats a
  // clipped one. Below MIN_LABEL_FONT_PX we stop; nothing legible remains.
  const minRadius = size * 0.22
  const maxPad = size / 2 - minRadius
  const needed = (f: number) => widestChars * f * CHAR_ADVANCE + LABEL_GAP + 8
  let font = fontPx
  if (needed(font) > maxPad) {
    font = Math.max(MIN_LABEL_FONT_PX, (maxPad - LABEL_GAP - 8) / (widestChars * CHAR_ADVANCE))
  }
  const widestPx = widestChars * font * CHAR_ADVANCE
  const lineH = font + 1

  const pad = Math.min(Math.max(widestPx + LABEL_GAP + 8, 48), maxPad)
  const radius = size / 2 - pad
  const cx = size / 2
  const cy = size / 2

  const labels: RadarLabelBox[] = labelLines.map((lines, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const r = radius + LABEL_GAP
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    const cos = Math.cos(angle)
    const anchor: 'start' | 'middle' | 'end' =
      Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end'

    const wPx = Math.max(...lines.map((s) => s.length)) * font * CHAR_ADVANCE
    const hPx = lines.length * lineH
    const left = anchor === 'start' ? x : anchor === 'end' ? x - wPx : x - wPx / 2
    const top = y - hPx / 2
    return {
      index: i, lines, x, y, anchor,
      left, right: left + wPx, top, bottom: top + hPx,
    }
  })

  return { pad, radius, fontPx: font, labels }
}

/** Labels whose box escapes the canvas — the edge-clipping failure. */
export function clippedLabels(layout: RadarLayout, size: number): RadarLabelBox[] {
  return layout.labels.filter(
    (b) => b.left < 0 || b.right > size || b.top < 0 || b.bottom > size,
  )
}

/** Pairs whose boxes intersect — the overlap failure. */
export function overlappingLabelPairs(layout: RadarLayout): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const b = layout.labels
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      const overlap =
        b[i].left < b[j].right && b[j].left < b[i].right &&
        b[i].top < b[j].bottom && b[j].top < b[i].bottom
      if (overlap) out.push([i, j])
    }
  }
  return out
}
