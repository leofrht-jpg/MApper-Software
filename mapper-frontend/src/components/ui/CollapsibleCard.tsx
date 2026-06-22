/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleCardProps {
  expanded: boolean
  onToggle: () => void
  title: string
  summary?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  // Opt-in visual variant (Patch 5W). 'default' = structural card on the base
  // surface (ITEMS TO COMPARE / CONFIGURATION / single-item cards). 'item' =
  // per-item card on the elevated surface (one step up the surface scale) so
  // selected items stand out from the structural cards around them. Defaults to
  // 'default' — never lighten the shared card globally.
  variant?: 'default' | 'item'
  // Optional leading slot rendered in the header, right after the chevron and
  // before the title (e.g. a per-item number badge). Defaults to nothing.
  leading?: React.ReactNode
}

export function CollapsibleCard({
  expanded, onToggle, title, summary, actions, children,
  variant = 'default', leading,
}: CollapsibleCardProps) {
  const sectionStyle: React.CSSProperties = {
    backgroundColor: variant === 'item' ? 'var(--bg-elevated)' : 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4) var(--space-5)',
  }

  // The body wrapper stays mounted in both states so children's local React
  // state survives collapse/expand round-trips (visibility-toggle, not
  // conditional unmount).
  const bodyStyle: React.CSSProperties = { display: expanded ? 'block' : 'none' }

  return (
    <section style={sectionStyle}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', userSelect: 'none',
          marginBottom: expanded ? 'var(--space-3)' : 0,
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {leading && (
          <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {leading}
          </span>
        )}
        <h3 style={{
          fontSize: 'var(--text-sm)', fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
          margin: 0,
        }}>
          {title}
        </h3>
        {summary && (
          <div style={{
            display: 'flex', gap: 'var(--space-4)',
            fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
            marginLeft: 'var(--space-3)',
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {summary}
          </div>
        )}
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}
          >
            {actions}
          </div>
        )}
      </div>
      <div style={bodyStyle}>
        {children}
      </div>
    </section>
  )
}
