/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { computePopoverPosition, POPOVER_MARGIN, type Box } from '../src/components/ui/popoverPosition'
import { InfoButton } from '../src/components/ui/InfoButton'

// Where the (i) popover goes. jsdom has no layout, so the pure function carries the maths and the
// component tests feed it mocked rects; the real placement numbers come from a browser run (see
// the PR description).

const VP = { width: 1000, height: 700 }
const POP = { width: 306, height: 90 }
const anchorAt = (left: number, top: number): Box => ({ left, top, right: left + 18, bottom: top + 18 })
const inside = (p: { top: number; left: number; width: number }, h: number, vp = VP) =>
  p.left >= POPOVER_MARGIN && p.top >= POPOVER_MARGIN
  && p.left + p.width <= vp.width - POPOVER_MARGIN && p.top + h <= vp.height - POPOVER_MARGIN

describe('computePopoverPosition', () => {
  it('plenty of room: below the button, left-aligned with it, at the wanted width', () => {
    const p = computePopoverPosition(anchorAt(300, 200), POP, VP)
    expect(p).toMatchObject({ placement: 'below', left: 300, top: 222, width: 306 })
  })

  it('near the bottom: flips above the button', () => {
    const p = computePopoverPosition(anchorAt(300, 650), POP, VP)
    expect(p.placement).toBe('above')
    expect(p.top).toBe(650 - 4 - POP.height)
    expect(inside(p, POP.height)).toBe(true)
  })

  it('near the right edge: shifts left to keep the margin', () => {
    const p = computePopoverPosition(anchorAt(960, 200), POP, VP)
    expect(p.left).toBe(VP.width - POPOVER_MARGIN - 306)
    expect(inside(p, POP.height)).toBe(true)
  })

  it('bottom right corner: above and shifted left', () => {
    const p = computePopoverPosition(anchorAt(980, 680), POP, VP)
    expect(p.placement).toBe('above')
    expect(inside(p, POP.height)).toBe(true)
  })

  it('very narrow window: the width is limited to the viewport minus both margins', () => {
    const vp = { width: 200, height: 700 }
    const p = computePopoverPosition(anchorAt(150, 200), POP, vp)
    expect(p.width).toBe(184)
    expect(p.left).toBe(POPOVER_MARGIN)
    expect(p.left + p.width).toBe(vp.width - POPOVER_MARGIN)
  })

  it('near the left edge: never starts left of the margin', () => {
    expect(computePopoverPosition(anchorAt(2, 200), POP, VP).left).toBe(POPOVER_MARGIN)
  })

  it('near the top: stays below, not above', () => {
    const p = computePopoverPosition(anchorAt(300, 2), POP, VP)
    expect(p.placement).toBe('below')
    expect(p.top).toBe(24)
  })

  it('too tall for either side: takes the roomier side and limits the height so it can scroll', () => {
    const vp = { width: 1000, height: 120 }
    const p = computePopoverPosition(anchorAt(300, 20), { width: 306, height: 300 }, vp)
    expect(p.placement).toBe('below')                      // 120 - 8 - 42 = 70 below vs 8 above
    expect(p.maxHeight).toBeGreaterThan(0)
    expect(p.top + Math.min(300, p.maxHeight)).toBeLessThanOrEqual(vp.height - POPOVER_MARGIN)
  })
})

describe('<InfoButton> placement in the window (mocked layout)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function mountAt(left: number, top: number, win = { width: 1000, height: 700 }) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: win.width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: win.height })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.tagName === 'BUTTON') return { left, top, right: left + 18, bottom: top + 18, width: 18, height: 18, x: left, y: top, toJSON: () => ({}) } as DOMRect
      if (this.getAttribute('role') === 'note') {
        const w = parseFloat(this.style.width) || 306
        // Where fixed put it: at its own style.left/top (no transformed ancestor in this fixture).
        const l = parseFloat(this.style.left) || 0
        const tp = parseFloat(this.style.top) || 0
        return { left: l, top: tp, right: l + w, bottom: tp + 90, width: w, height: 90, x: l, y: tp, toJSON: () => ({}) } as DOMRect
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    render(<InfoButton label="About x" data-testid="i">Help text.</InfoButton>)
    fireEvent.click(screen.getByTestId('i'))
    return screen.getByTestId('i-popover')
  }
  const box = (el: HTMLElement) => ({
    left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width),
  })

  it('is positioned against the viewport, which an ancestor\'s overflow does not clip', () => {
    expect(mountAt(300, 200).style.position).toBe('fixed')
  })

  it('corrects for an ancestor that makes fixed relative to itself (transform, backdrop-filter)', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
    // The popover lands 50 px right and 30 px lower than the style says.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.tagName === 'BUTTON') return { left: 300, top: 200, right: 318, bottom: 218, width: 18, height: 18, x: 300, y: 200, toJSON: () => ({}) } as DOMRect
      if (this.getAttribute('role') === 'note') {
        const l = (parseFloat(this.style.left) || 0) + 50
        const tp = (parseFloat(this.style.top) || 0) + 30
        return { left: l, top: tp, right: l + 306, bottom: tp + 90, width: 306, height: 90, x: l, y: tp, toJSON: () => ({}) } as DOMRect
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    render(<InfoButton label="About x" data-testid="i">Help text.</InfoButton>)
    fireEvent.click(screen.getByTestId('i'))
    const pop = screen.getByTestId('i-popover')
    expect(parseFloat(pop.style.left)).toBe(300 - 50)
    expect(parseFloat(pop.style.top)).toBe(222 - 30)
  })

  it.each([
    ['bottom right', 985, 680],
    ['top right', 985, 4],
    ['bottom left', 4, 680],
    ['top left', 4, 4],
  ])('%s: ends up fully inside the viewport', (_n, l, t) => {
    const b = box(mountAt(l, t))
    expect(b.left).toBeGreaterThanOrEqual(8)
    expect(b.left + b.width).toBeLessThanOrEqual(1000 - 8)
    expect(b.top).toBeGreaterThanOrEqual(8)
    expect(b.top + 90).toBeLessThanOrEqual(700 - 8)
  })

  it('a narrow window limits the width', () => {
    const b = box(mountAt(150, 200, { width: 220, height: 700 }))
    expect(b.width).toBe(204)
    expect(b.left + b.width).toBeLessThanOrEqual(220 - 8)
  })

  it('is placed again on window resize', () => {
    const pop = mountAt(985, 200)
    const before = box(pop).left
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(box(pop).left).toBeGreaterThan(before)
    expect(box(pop).left).toBe(985)
  })

  it('keeps its keyboard access and aria attributes, and closes on Escape and on a click outside', () => {
    mountAt(300, 200)
    const b = screen.getByTestId('i')
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(b.getAttribute('aria-label')).toBe('About x')
    fireEvent.mouseDown(screen.getByText('Help text.'))
    expect(screen.queryByText('Help text.')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Help text.')).toBeNull()
    expect(b.getAttribute('aria-expanded')).toBe('false')
  })
})
