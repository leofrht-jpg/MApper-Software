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
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from '../src/components/charts/tooltipStyle'
import { SCENARIO_PALETTE } from '../src/utils/chartColors'

// Issue 2 — chart tooltips must render legible (light) text on the dark
// tooltip surface, from the app's theme tokens, NOT the hovered series colour.
// Recharts tooltips don't paint in jsdom (no hover/layout), so the contrast
// guarantee is asserted on the shared style tokens that every default-tooltip
// now uses.

describe('chart tooltip contrast (shared tokens)', () => {
  it('text + background come from theme tokens (light-on-dark)', () => {
    expect(TOOLTIP_CONTENT_STYLE.color).toBe('var(--text-primary)')
    expect(TOOLTIP_CONTENT_STYLE.backgroundColor).toBe('var(--bg-elevated)')
    expect(TOOLTIP_LABEL_STYLE.color).toBe('var(--text-primary)')
  })

  it('value text colour is FIXED to the theme token, independent of series colour', () => {
    // The four legend series colours (orange/magenta/teal/green, …) must NOT
    // leak into the tooltip value text — itemStyle forces the theme colour, so
    // contrast holds for every series. Assert the item colour matches none of
    // the palette colours (it is the theme token, not a data colour).
    expect(TOOLTIP_ITEM_STYLE.color).toBe('var(--text-primary)')
    for (const seriesColor of SCENARIO_PALETTE.slice(0, 4)) {
      expect(TOOLTIP_ITEM_STYLE.color).not.toBe(seriesColor)
    }
  })
})
