/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * A collapsible block for anything that lists impact categories: pickers and
 * result tables alike. ONE component for all of them, so the chevron, the
 * summary and the remembered state behave the same everywhere.
 *
 * - Header styled like the CollapsibleCard (RESULTS) header: chevron, uppercase
 *   label, and a one-line summary that stays visible when collapsed.
 * - The body is hidden with `display: none`, never unmounted, so selections,
 *   sort order and scroll survive a collapse (the codebase rule).
 * - Open/closed is remembered per `storageKey` in localStorage as a
 *   convenience only: every read and write is guarded, and with storage
 *   unavailable (private window, blocked site data) it simply starts expanded.
 */
export function CollapsibleBlock({ storageKey, title, summary, actions, children, testId }: {
  /** One key per page/surface, e.g. "single-static.methods". */
  storageKey: string
  title: ReactNode
  /** Shown beside the title in both states, e.g. "25 of 25 selected". */
  summary?: ReactNode
  actions?: ReactNode
  children: ReactNode
  testId?: string
}) {
  const key = `mapper.collapse.${storageKey}`
  const [open, setOpen] = useState<boolean>(() => readOpen(key))
  const toggle = () => setOpen((o) => {
    writeOpen(key, !o)
    return !o
  })
  const tid = testId ?? `collapsible-${storageKey}`
  return (
    <div data-testid={tid} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-testid={`${tid}-toggle`}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none',
          marginBottom: open ? 'var(--space-2)' : 0,
        }}
      >
        <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        }}>
          {title}
        </span>
        {summary != null && (
          <span
            data-testid={`${tid}-summary`}
            style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </span>
        )}
        {actions && (
          <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
            {actions}
          </span>
        )}
      </div>
      <div data-testid={`${tid}-body`} style={{ display: open ? 'block' : 'none', minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}

function readOpen(key: string): boolean {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? true : v !== '0'
  } catch {
    return true
  }
}

function writeOpen(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? '1' : '0')
  } catch {
    // Storage unavailable: the block still works, it just won't remember.
  }
}
