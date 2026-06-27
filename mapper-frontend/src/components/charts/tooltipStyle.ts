/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { CSSProperties } from 'react'

// Shared Recharts <Tooltip> styling for legible contrast on the dark theme.
//
// The bug this fixes: a `contentStyle` that sets only background/border/font
// leaves Recharts' default tooltip text colour in place — a dark grey that is
// near-invisible on the dark `--bg-elevated` surface. Setting an explicit
// `color` from the theme tokens (and overriding `itemStyle` so the value text
// doesn't fall back to the hovered series colour) restores contrast.
//
// Reuse these on any Recharts default-tooltip (`<Tooltip contentStyle=…
// itemStyle=… labelStyle=…>`). Custom `content={<…/>}` tooltips already render
// their own theme-tokened text and don't need this.

export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-xs)',
  // The fix — light text on the dark tooltip surface.
  color: 'var(--text-primary)',
}

// Value rows: force the theme text colour so the value isn't painted in the
// (often low-contrast) hovered-series colour. Series identity comes from the
// tooltip title / legend, not the value text colour.
export const TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: 'var(--text-primary)',
}

// Tooltip title (the category / x-value).
export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: 'var(--text-primary)',
  fontWeight: 600,
}
