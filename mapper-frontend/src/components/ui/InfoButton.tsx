/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'

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
 */
export function InfoButton({ children, label, 'data-testid': testId = 'info-button' }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <span ref={root} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
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
          role="note"
          data-testid={`${testId}-popover`}
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, width: 280,
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
