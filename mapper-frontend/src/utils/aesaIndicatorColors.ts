/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 4S — shared color mapping for AESA per-indicator visual encoding.
// Patch 4T — extended with `buildIndicatorColorMap` so colors stay
// stable across full vs. filtered displays. The display filter narrows
// which indicators a chart renders; if colors were assigned by the
// filtered-array index, "climate change" would jump from green at
// N=16 to red at N=3 (now slot 0 of the subset). Building the map
// once from the FULL ordered indicator list and looking up by `pb_id`
// at render time keeps the color identity stable.
//
// All values are concrete hex codes. CSS variables (`var(--mod-aesa)`)
// resolve unreliably on SVG presentation attributes inside Recharts'
// detached legend wrapper — using literal hex keeps the legend swatch
// + line stroke in lockstep across browsers.

export const AESA_INDICATOR_PALETTE: readonly string[] = [
  '#34D399', // teal — matches `--mod-aesa` token, kept hex-literal so it
             // resolves on Recharts' standalone-rendered legend SVG
  '#60A5FA', // blue
  '#A78BFA', // purple
  '#F59E0B', // amber
  '#F87171', // red
  '#FCD34D', // yellow
  '#22D3EE', // cyan
  '#E879F9', // fuchsia
  '#FB923C', // orange
  '#A3E635', // lime
  '#F472B6', // pink
  '#06B6D4', // bright cyan
  '#10B981', // emerald
  '#6366F1', // indigo
  '#FDBA74', // light orange
  '#84CC16', // olive — last fallback for the 16th indicator before
             // wraparound, distinct from #A3E635 lime
] as const

/**
 * Deterministic color for an AESA indicator at index `idx` in its
 * stable display order. Wraps via modulo when more indicators exist
 * than palette slots.
 *
 * `pb_id` is accepted for API symmetry with `colorForIndicatorById`
 * but is ignored — the assignment is purely index-based. Use this
 * when you don't have a precomputed color map (e.g. one-off charts
 * that always render the full indicator set).
 */
export function colorForIndicator(_pb_id: string, idx: number): string {
  return AESA_INDICATOR_PALETTE[idx % AESA_INDICATOR_PALETTE.length]
}

/**
 * Build an `pb_id → color` map from an ordered list of indicator IDs.
 * Each id is assigned the palette slot at its position in the input
 * array; lookups by id return the same color regardless of how the
 * caller later subsets the indicator list (Patch 4T display filter).
 *
 * The input order should be the FULL set of computed indicators
 * (typically the order they appear in `result.results`), NOT a
 * post-filter subset. Pass it in once at the parent level and thread
 * the resulting map through to charts.
 */
export function buildIndicatorColorMap(pbIds: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {}
  pbIds.forEach((id, idx) => {
    if (!(id in map)) {
      map[id] = AESA_INDICATOR_PALETTE[idx % AESA_INDICATOR_PALETTE.length]
    }
  })
  return map
}

/**
 * Look up the color for an indicator. Falls back to index-based
 * assignment when the id isn't in the precomputed map (e.g. a
 * legacy caller without a map, or a transient state where the map
 * hasn't been built yet).
 */
export function colorForIndicatorById(
  map: Record<string, string> | null | undefined,
  pb_id: string,
  fallbackIdx: number,
): string {
  if (map && pb_id in map) return map[pb_id]
  return AESA_INDICATOR_PALETTE[fallbackIdx % AESA_INDICATOR_PALETTE.length]
}
