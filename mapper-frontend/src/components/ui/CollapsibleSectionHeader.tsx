/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * A section header that doubles as a collapse toggle — same chevron + click
 * semantics as `CollapsibleCard` (ChevronDown/ChevronRight, full-width click
 * target, `actions` stop-propagate so buttons don't toggle). Unlike
 * `CollapsibleCard` it renders NO card chrome, so it can be dropped into a
 * component's EXISTING header/card in place of the plain title row.
 *
 * When `onToggle` is omitted the header is inert (no chevron, not clickable) —
 * backward-compatible for consumers that don't opt into collapsing.
 */
export function CollapsibleSectionHeader({
  collapsed, onToggle, children, actions, style,
}: {
  collapsed?: boolean
  onToggle?: () => void
  /** The title block (left of the chevron row). */
  children: React.ReactNode
  /** Right-aligned action controls (buttons); clicks won't toggle the section. */
  actions?: React.ReactNode
  style?: React.CSSProperties
}) {
  const clickable = !!onToggle
  return (
    <div
      onClick={onToggle}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        cursor: clickable ? 'pointer' : 'default',
        userSelect: clickable ? 'none' : 'auto',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {clickable && (
          <span style={{ color: 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
        {children}
      </div>
      {actions && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
