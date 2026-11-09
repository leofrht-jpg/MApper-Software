/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

export interface Box { top: number; left: number; right: number; bottom: number }
export interface Size { width: number; height: number }

export interface PopoverPlacement {
  /** Viewport coordinates for `position: fixed`. */
  top: number
  left: number
  /** The width to render at: the wanted width, limited to the viewport minus both margins. It does not depend on the anchor. */
  width: number
  /** The viewport height minus both margins: the popover never grows past it and scrolls inside instead. */
  maxHeight: number
  placement: 'below' | 'above'
}

export const POPOVER_MARGIN = 8
export const POPOVER_GAP = 4

/** The width a popover is drawn at: the wanted width, or the window minus both margins when that is narrower. */
export function popoverWidth(wanted: number, viewportWidth: number, margin: number = POPOVER_MARGIN): number {
  return Math.max(0, Math.min(wanted, viewportWidth - 2 * margin))
}

/**
 * Where a popover goes, so it stays inside the window. Below the anchor and left-aligned with it
 * by default; above the anchor when it does not fit below and fits above (or the space above is the
 * larger); shifted left or right to keep `margin` px from the window edge; the height capped at the
 * viewport height minus the margins and the top clamped so the box never crosses an edge. The width
 * is `popoverWidth`, the same wherever the anchor is. Pure: no DOM.
 */
export function computePopoverPosition(
  anchor: Box,
  popover: Size,
  viewport: Size,
  margin: number = POPOVER_MARGIN,
  gap: number = POPOVER_GAP,
): PopoverPlacement {
  const width = popoverWidth(popover.width, viewport.width, margin)
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width))

  const maxHeight = Math.max(0, viewport.height - 2 * margin)
  const height = Math.min(popover.height, maxHeight)
  const roomBelow = viewport.height - margin - (anchor.bottom + gap)
  const roomAbove = anchor.top - gap - margin
  const below = height <= roomBelow || (height > roomAbove && roomBelow >= roomAbove)
  const wanted = below ? anchor.bottom + gap : anchor.top - gap - height
  const top = Math.max(margin, Math.min(wanted, viewport.height - margin - height))

  return { top, left, width, maxHeight, placement: below ? 'below' : 'above' }
}
