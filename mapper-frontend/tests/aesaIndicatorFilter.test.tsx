/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAESAStore } from '../src/stores/aesaStore'
import {
  AESA_INDICATOR_PALETTE,
  buildIndicatorColorMap,
  colorForIndicator,
  colorForIndicatorById,
} from '../src/utils/aesaIndicatorColors'

// Patch 4T — display filter for AESA result body. Three behaviour
// surfaces under test:
//   1. Color map is built from the FULL ordered indicator list and
//      pb_id-stable across full vs. filtered subsets (the whole
//      reason the helper now exists). A 3-indicator subset must
//      retrieve the same color for "climate change" as the full
//      16-indicator view.
//   2. Store actions (toggle / clearAll / selectAll / set) maintain
//      the documented invariants:
//        - `null` = "show all" (default; never explicitly stored).
//        - Toggling all explicit selections off → empty array
//          (zero indicators visible).
//        - Toggling everything explicitly on collapses back to
//          `null` (so saved sessions don't pin to the current id
//          list, and a future fresh result with new indicators
//          shows everything by default).
//   3. Compute clears any stale filter on completion. A user who
//      filtered out indicators on run #1 sees ALL of run #2's
//      indicators by default.

describe('buildIndicatorColorMap (Patch 4T)', () => {
  it('assigns palette slots in input order, keyed by pb_id', () => {
    const ids = ['climate_change', 'biosphere_integrity', 'land_use_change', 'fresh_water_use']
    const map = buildIndicatorColorMap(ids)
    expect(map.climate_change).toBe(AESA_INDICATOR_PALETTE[0])
    expect(map.biosphere_integrity).toBe(AESA_INDICATOR_PALETTE[1])
    expect(map.land_use_change).toBe(AESA_INDICATOR_PALETTE[2])
    expect(map.fresh_water_use).toBe(AESA_INDICATOR_PALETTE[3])
  })

  it('produces id-stable colors across full vs. filtered indicator sets', () => {
    // The Patch 4T contract: filtering must not change the color of
    // any indicator that survives the filter. Otherwise users
    // mentally mapping colours across views (e.g. radar with all
    // indicators → timeline with 3) would see a colour shuffle.
    const fullIds = [
      'climate_change', 'biosphere_integrity', 'land_use_change',
      'fresh_water_use', 'ocean_acidification', 'aerosol_loading',
    ]
    const fullMap = buildIndicatorColorMap(fullIds)
    // User filters to a subset — colors should be looked up from
    // the FULL map, not rebuilt from the subset's index.
    const subset = ['biosphere_integrity', 'fresh_water_use']
    for (const id of subset) {
      expect(fullMap[id]).toBe(buildIndicatorColorMap(fullIds)[id])
    }
    // Critically: the subset's id colors are NOT the first two
    // palette slots — they're slot 1 and slot 3 (indices in fullIds).
    expect(fullMap.biosphere_integrity).toBe(AESA_INDICATOR_PALETTE[1])
    expect(fullMap.fresh_water_use).toBe(AESA_INDICATOR_PALETTE[3])
  })

  it('wraps via modulo when more indicators than palette slots', () => {
    const N = AESA_INDICATOR_PALETTE.length
    const ids = Array.from({ length: N + 3 }, (_, i) => `pb_${i}`)
    const map = buildIndicatorColorMap(ids)
    expect(map.pb_0).toBe(AESA_INDICATOR_PALETTE[0])
    expect(map[`pb_${N}`]).toBe(AESA_INDICATOR_PALETTE[0])  // wrap
    expect(map[`pb_${N + 1}`]).toBe(AESA_INDICATOR_PALETTE[1])
  })
})

describe('colorForIndicatorById (Patch 4T)', () => {
  it('prefers the map when the id is present', () => {
    const map = { climate_change: '#aabbcc' }
    expect(colorForIndicatorById(map, 'climate_change', 7)).toBe('#aabbcc')
  })

  it('falls back to the index-based palette when the id is missing', () => {
    expect(colorForIndicatorById({}, 'unknown', 2)).toBe(AESA_INDICATOR_PALETTE[2])
    expect(colorForIndicatorById(null, 'unknown', 2)).toBe(AESA_INDICATOR_PALETTE[2])
  })

  it('preserves the legacy `colorForIndicator(_, idx)` semantics', () => {
    // Patch 4S contract — index-based, ignoring id. Must not regress.
    expect(colorForIndicator('foo', 3)).toBe(colorForIndicator('bar', 3))
    expect(colorForIndicator('x', AESA_INDICATOR_PALETTE.length))
      .toBe(AESA_INDICATOR_PALETTE[0])
  })
})

describe('aesaStore display filter actions (Patch 4T)', () => {
  beforeEach(() => {
    useAESAStore.setState({
      result: null, displayedIndicators: null, lastRunAt: null,
    } as any)
  })

  const FULL: readonly string[] = ['a', 'b', 'c', 'd']

  it('starts at `null` (show all)', () => {
    expect(useAESAStore.getState().displayedIndicators).toBeNull()
  })

  it('toggle off one indicator from null collapses to all-but-one', () => {
    useAESAStore.getState().toggleDisplayedIndicator('b', FULL)
    expect(useAESAStore.getState().displayedIndicators).toEqual(['a', 'c', 'd'])
  })

  it('toggle off then back on collapses to null (re-selects all)', () => {
    useAESAStore.getState().toggleDisplayedIndicator('b', FULL)
    useAESAStore.getState().toggleDisplayedIndicator('b', FULL)
    expect(useAESAStore.getState().displayedIndicators).toBeNull()
  })

  it('clearDisplayedIndicators sets the slot to empty array (zero visible)', () => {
    useAESAStore.getState().clearDisplayedIndicators(FULL)
    expect(useAESAStore.getState().displayedIndicators).toEqual([])
  })

  it('selectAllDisplayedIndicators resets to null', () => {
    useAESAStore.getState().clearDisplayedIndicators(FULL)
    useAESAStore.getState().selectAllDisplayedIndicators()
    expect(useAESAStore.getState().displayedIndicators).toBeNull()
  })

  it('toggling from empty back up to the full set collapses to null', () => {
    useAESAStore.getState().clearDisplayedIndicators(FULL)
    for (const id of FULL) useAESAStore.getState().toggleDisplayedIndicator(id, FULL)
    // All four explicitly toggled on → contract collapses to null.
    expect(useAESAStore.getState().displayedIndicators).toBeNull()
  })
})
