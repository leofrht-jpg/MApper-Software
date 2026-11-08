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
  /** The width to render at: the wanted width, limited to the viewport minus both margins. */
  width: number
  /** Set when even the roomier side cannot hold the whole popover; the popover then scrolls. */
  maxHeight: number
  placement: 'below' | 'above'
}

export const POPOVER_MARGIN = 8
export const POPOVER_GAP = 4

/**
 * Where a popover goes, so it stays inside the window. Below the anchor and left-aligned with it
 * by default (today's placement); above the anchor when it does not fit below and fits above (or
 * the space above is the larger); shifted left or right to keep `margin` px from the window edge;
 * its width limited to the viewport width minus the margins. Pure: no DOM.
 */
export function computePopoverPosition(
  anchor: Box,
  popover: Size,
  viewport: Size,
  margin: number = POPOVER_MARGIN,
  gap: number = POPOVER_GAP,
): PopoverPlacement {
  const width = Math.max(0, Math.min(popover.width, viewport.width - 2 * margin))
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width))

  const roomBelow = viewport.height - margin - (anchor.bottom + gap)
  const roomAbove = anchor.top - gap - margin
  const below = popover.height <= roomBelow || (popover.height > roomAbove && roomBelow >= roomAbove)
  const room = Math.max(0, below ? roomBelow : roomAbove)
  const height = Math.min(popover.height, room)
  const top = below ? anchor.bottom + gap : anchor.top - gap - height

  return { top, left, width, maxHeight: room, placement: below ? 'below' : 'above' }
}
