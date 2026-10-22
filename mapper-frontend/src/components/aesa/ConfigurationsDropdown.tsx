/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Top-right dropdown listing the user's saved AESA configurations
// (cascade + sharing preset + method mapping templates). Replaces the
// top-left inline-pill row, which crowded as configurations grew.
//
// Distinct from the SAVED SESSIONS list (Patch 4R, in the sidebar) —
// configurations are reusable input templates, sessions are
// historical result snapshots. Two different lifecycles, two
// different dropdowns.

import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import type { AESAConfiguration } from '../../api/client'

interface Props {
  configurations: AESAConfiguration[]
  activeConfigId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  /** Patch 4Y — start-new is now an item INSIDE the dropdown
   *  rather than a sibling page-header button. Consolidates
   *  configuration management into one surface.  */
  onNew: () => void
  /** Disable the trigger entirely (e.g. session-loaded mode). */
  disabled?: boolean
  /** Second line under each template's name: what it was saved for (a DSM
   *  system, or single product). Templates of the whole project are listed,
   *  so this is what tells two of them apart. */
  describe?: (c: AESAConfiguration) => string | null
}

export function ConfigurationsDropdown({
  configurations, activeConfigId, onSelect, onDelete, onNew, disabled = false, describe,
}: Props) {
  const [open, setOpen] = useState(false)
  // Template awaiting a second click to delete. window.confirm is a no-op in
  // the packaged app's WKWebView (returns false), so deletion could never run.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Rendered with zero templates too: the pill is where configurations live,
  // and a pill that disappears reads as "this project lost its templates".

  const active = configurations.find((c) => c.id === activeConfigId) ?? null
  const N = configurations.length

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }} data-testid="aesa-configurations-dropdown">
      <Button
        variant="secondary"
        onClick={() => setOpen((x) => !x)}
        disabled={disabled}
        data-testid="aesa-configurations-toggle"
        title={active ? `Configurations (${N}) · active: ${active.name}` : `Configurations (${N})`}
      >
        <Bookmark size={14} />
        Configurations ({N}){active ? ` · ${active.name}` : ''}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <div
          data-testid="aesa-configurations-menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30,
            minWidth: 280, maxWidth: 380, maxHeight: 360, overflowY: 'auto',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 4,
          }}
        >
          {/* Patch 4Y — "+ New configuration" at the top of the menu,
              replacing the separate page-header button. Consolidates
              all configuration management (switch / new / delete)
              into this single surface. Methodologically important:
              edits to a loaded configuration UPDATE it in place (the
              footer Save calls updateAESAConfiguration when
              activeConfigId is set). Without an explicit "new" path
              users would have no way to fork to a fresh config. */}
          <button
            type="button"
            onClick={() => { onNew(); setOpen(false) }}
            data-testid="aesa-configurations-new"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', textAlign: 'left',
              padding: '6px 8px',
              background: 'transparent',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              fontSize: 12, fontWeight: 600,
              marginBottom: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-base)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <Plus size={12} /> New configuration
          </button>
          {N === 0 && (
            <div
              data-testid="aesa-configurations-empty"
              style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-tertiary)' }}
            >
              No saved templates in this project yet.
            </div>
          )}
          {configurations.map((c) => {
            const isActive = c.id === activeConfigId
            return (
              <div
                key={c.id}
                data-testid={`aesa-configurations-row-${c.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: isActive
                    ? 'color-mix(in srgb, var(--mod-aesa) 14%, transparent)'
                    : 'transparent',
                  border: `1px solid ${isActive ? 'var(--mod-aesa)' : 'transparent'}`,
                  marginBottom: 2,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'var(--bg-base)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent'
                }}
              >
                <button
                  type="button"
                  onClick={() => { onSelect(c.id); setOpen(false) }}
                  data-testid={`aesa-configurations-select-${c.id}`}
                  style={{
                    flex: 1, textAlign: 'left',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 12,
                    padding: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                  {describe?.(c) && (
                    <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary)' }}>
                      {describe(c)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { onSelect(c.id); setOpen(false) }}
                  title="Edit in sidebar"
                  style={iconBtn}
                >
                  <Pencil size={11} />
                </button>
                {pendingDelete === c.id ? (
                  <button
                    type="button"
                    onClick={() => { setPendingDelete(null); onDelete(c.id) }}
                    data-testid={`aesa-configurations-delete-confirm-${c.id}`}
                    title={`Delete the template "${c.name}"`}
                    style={{ ...iconBtn, color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 10, padding: '2px 6px' }}
                  >
                    Delete?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(c.id)}
                    data-testid={`aesa-configurations-delete-${c.id}`}
                    title="Delete configuration"
                    style={iconBtn}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  padding: 3,
  borderRadius: 'var(--radius-sm)',
  display: 'inline-flex',
}
