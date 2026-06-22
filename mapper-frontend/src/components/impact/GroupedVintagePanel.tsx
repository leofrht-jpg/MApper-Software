/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 5S — grouped selected-items panel for Activities/vintage mode.
//
// When several VINTAGES of the same activity are selected, the default flat
// chip list repeats the ref-product / location / unit / code on every chip
// (only the vintage differs) — unreadable at 18 items. This groups vintages of
// one activity (same `code`) under a SINGLE header (identity shown once) with
// compact removable vintage chips beneath.
//
// DISPLAY-ONLY (CLAUDE.md anti-pattern): selection state, item identity,
// per-item removal (via the passed `onRemove`), and the compute payload are all
// unchanged — this only changes how the selection is laid out. Rendered via the
// selector's optional `renderSelectedItems` seam; archetype mode / LCA
// Calculator never pass it and keep the default chips.

import { X } from 'lucide-react'
import type { ActivityProductItem, ProductItem } from '../shared/productItem'

interface Props {
  items: ProductItem[]
  onRemove: (item: ProductItem) => void
}

export function GroupedVintagePanel({ items, onRemove }: Props) {
  // Group activity items by base activity `code` (identical across vintages of
  // one activity; unique per activity). Non-activity items (shouldn't occur in
  // activity mode) fall into their own singleton groups keyed by productItemKey.
  const groups = new Map<string, ActivityProductItem[]>()
  for (const it of items) {
    if (it.type !== 'activity') continue
    const act = it as ActivityProductItem
    const key = act.code
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(act)
  }

  return (
    <div data-testid="grouped-vintage-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from(groups.entries()).map(([code, vintages]) => {
        const head = vintages[0]
        const meta = [head.location, head.unit].filter(Boolean).join(' · ')
        return (
          <div
            key={code}
            data-testid={`vintage-group-${code}`}
            style={{
              border: '1px solid var(--mod-plca)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)', padding: '6px 8px',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            {/* Activity identity — shown ONCE per group (5M discriminators). */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mod-plca)', wordBreak: 'break-word' }}>
                {head.name || head.product || head.display_name}
              </span>
              {head.product && head.product !== head.name && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{head.product}</span>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{meta || '—'}</span>
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }} title={code}>
                {code}
              </span>
            </div>
            {/* Compact removable vintage chips — only the differing vintage. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {vintages.map((v) => (
                <span
                  key={`${v.database}|${v.code}`}
                  data-testid={`vintage-chip-${v.database}|${v.code}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 6px', fontSize: 10,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  }}
                >
                  {v.vintage_label || v.display_name}
                  <button
                    type="button"
                    onClick={() => onRemove(v)}
                    data-testid={`vintage-chip-remove-${v.database}|${v.code}`}
                    aria-label={`Remove ${v.vintage_label || v.display_name}`}
                    title={`Remove ${v.vintage_label || v.display_name}`}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0, display: 'flex' }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
