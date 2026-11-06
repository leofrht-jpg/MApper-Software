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

interface Props {
  children: ReactNode
  label?: string
  defaultOpen?: boolean
  'data-testid'?: string
}

/**
 * The "Details" toggle: one line is visible, the rest sits behind it, collapsed by default.
 * The body stays mounted and is hidden with `display: none` (the visibility-toggle rule), so
 * what is inside keeps its state across a collapse.
 */
export function DetailsToggle({ children, label = 'Details', defaultOpen = false, 'data-testid': testId }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid={testId}>
      <button
        type="button"
        data-testid={testId ? `${testId}-toggle` : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)',
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      <div data-testid={testId ? `${testId}-body` : undefined} style={{ display: open ? 'block' : 'none', marginTop: 6 }}>
        {children}
      </div>
    </div>
  )
}
