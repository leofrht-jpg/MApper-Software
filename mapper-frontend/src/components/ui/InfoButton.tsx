/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { computePopoverPosition, type PopoverPlacement } from './popoverPosition'

// The box is border-box now; 306 is what the old 280 px content width plus its padding and border drew.
const POPOVER_WIDTH = 306

interface Props {
  /** The long help text. Not rendered until the (i) is opened. */
  children: ReactNode
  /** Accessible name of the (i) button, e.g. "About discarding". */
  label: string
  'data-testid'?: string
}

/**
 * The (i) button for long help: a small icon, the text in a popover that opens on click and
 * closes on a second click, Escape or a click elsewhere. Use it for any sentence of help that
 * would otherwise sit permanently on the screen.
 *
 * The popover is placed against the VIEWPORT (`position: fixed`, which an ancestor's overflow does
 * not clip): below the button when it fits, above when it does not, shifted to stay 8 px inside the
 * window, and re-placed on resize and on scroll of any container. The maths is
 * `computePopoverPosition`. It stays next to its button in the DOM (not a portal), so a surrounding
 * transform or backdrop-filter, which makes `fixed` relative to that ancestor, is corrected by
 * measuring where the popover actually landed.
 */
export function InfoButton({ children, label, 'data-testid': testId = 'info-button' }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<PopoverPlacement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      // The popover lives in a portal, outside `root`: a press inside either keeps it open.
      if (root.current?.contains(t) || popover.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // Place against the viewport once the popover is in the DOM (before paint, so it never shows in
  // the wrong spot), and again whenever the window resizes or any ancestor scrolls.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      if (!button.current || !popover.current) return
      const a = button.current.getBoundingClientRect()
      // Measure at the wanted width: the height depends on it.
      const el = popover.current
      el.style.width = `${Math.min(POPOVER_WIDTH, window.innerWidth - 16)}px`
      el.style.maxHeight = ''
      const r = el.getBoundingClientRect()
      const next = computePopoverPosition(a, { width: POPOVER_WIDTH, height: r.height }, { width: window.innerWidth, height: window.innerHeight })
      // Where did `fixed` really put it? Normally exactly at next; inside a transformed or filtered
      // ancestor it is offset by that ancestor's origin, and the offset is taken out again.
      el.style.top = `${next.top}px`
      el.style.left = `${next.left}px`
      const landed = el.getBoundingClientRect()
      const dx = landed.width > 0 ? landed.left - next.left : 0
      const dy = landed.width > 0 ? landed.top - next.top : 0
      setPlace(Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? { ...next, left: next.left - dx, top: next.top - dy } : next)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  return (
    <span ref={root} style={{ display: 'inline-flex' }}>
      <button
        ref={button}
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none', border: 'none', padding: 2, cursor: 'pointer', display: 'inline-flex',
          color: open ? 'var(--text-primary)' : 'var(--text-tertiary)', borderRadius: 'var(--radius-sm)',
        }}
      >
        <Info size={14} />
      </button>
      {open && (
        <div
          ref={popover}
          role="note"
          data-testid={`${testId}-popover`}
          style={{
            position: 'fixed', top: place?.top ?? 0, left: place?.left ?? 0, zIndex: 9999,
            width: place?.width ?? POPOVER_WIDTH, maxHeight: place?.maxHeight, overflowY: 'auto',
            visibility: place ? 'visible' : 'hidden', boxSizing: 'border-box',
            padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)', color: 'var(--text-secondary)',
            fontSize: 'var(--text-xs)', lineHeight: 1.5, fontWeight: 400, textAlign: 'left',
          }}
        >
          {children}
        </div>
      )}
    </span>
  )
}
