/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 5AB — canonical multi-select FILTER dropdown for MApper.
//
// A pill trigger ("Label (N) ⌄") opening a panel with a threshold-gated
// "Search…" input (useOptionSearch), a checkbox list, "No matches", and
// Select all / Clear affordances. Search is view-only (never a backend call,
// never touches the selection). This is the single template for every
// multi-select Location/Unit/Folder-style filter across the app — extracted
// from the Impact Assessment picker (Patches 5T/5Y) and now also used by
// Database Explorer (superseding the separate MultiSelectDropdown).
//
// Out of scope (different patterns): single-select / sort dropdowns, the
// database picker, DSM scenario chips / vertical checklists, and AESA's
// IndicatorDisplayFilter (null-means-all + color swatches — deferred).

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { useOptionSearch } from '../../hooks/useOptionSearch'

// Pure helper — split the (already search-filtered, already-sorted) visible
// options into a SELECTED-first group and the rest, preserving the incoming
// order WITHIN each group. So selected-first takes priority over whatever sort
// the consumer applied (Name A→Z, etc.), and that sort still holds inside each
// group. Exported for direct unit testing.
export function partitionSelectedFirst(
  visible: string[],
  selected: string[],
): { selectedGroup: string[]; restGroup: string[] } {
  const sel = new Set(selected)
  const selectedGroup: string[] = []
  const restGroup: string[] = []
  for (const o of visible) (sel.has(o) ? selectedGroup : restGroup).push(o)
  return { selectedGroup, restGroup }
}

export interface FilterDropdownProps {
  label: string
  /** Full in-memory option set (the search filters these client-side). */
  options: string[]
  /** Selected option values. */
  selected: string[]
  onChange: (next: string[]) => void
  /** Stable testid prefix; sub-elements derive ids from it
   *  (`-toggle` / `-menu` / `-search` / `-option-<opt>` / `-no-matches`
   *  / `-select-all` / `-clear`). */
  testId?: string
  disabled?: boolean
  /** Accent token for the active pill (default `var(--accent)`; the Impact
   *  Assessment picker passes `var(--mod-lca)` to preserve its look). */
  accent?: string
}

export function FilterDropdown({
  label, options, selected, onChange, testId, disabled = false,
  accent = 'var(--accent)',
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Client-side option search via the shared hook (view-only; threshold-gated).
  const { query: search, setQuery: setSearch, searchRef, showSearch, visibleOptions } =
    useOptionSearch(options, open)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    // Escape closes — unless focus is in the search input (so Esc clears focus
    // intent there first, matching the prior Database Explorer behavior).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
    // The list re-groups (toggled item jumps between the Selected group and the
    // rest) on the next render. Reset the scroll so the reflow doesn't leave the
    // listbox mid-jump — the toggled item is always findable from the top.
    if (listRef.current) listRef.current.scrollTop = 0
  }
  const allSelected = options.length > 0 && selected.length === options.length
  const noneSelected = selected.length === 0
  // Selected-first grouping (live: re-derived every render from the `selected`
  // prop, so checking/unchecking re-sorts without closing the dropdown).
  const { selectedGroup, restGroup } = partitionSelectedFirst(visibleOptions, selected)
  const showGroupDivider = selectedGroup.length > 0 && restGroup.length > 0

  const tinted = selected.length > 0
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        disabled={disabled}
        data-testid={testId ? `${testId}-toggle` : undefined}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, padding: '4px 8px',
          background: tinted ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'var(--bg-elevated)',
          border: '1px solid ' + (tinted ? accent : 'var(--border-subtle)'),
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {/* Count summary — canonical across all filters (Patch 5AB). */}
        {label}{selected.length > 0 ? ` (${selected.length})` : ''}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div
          data-testid={testId ? `${testId}-menu` : undefined}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
            minWidth: 200,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: 4,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Pinned, threshold-gated search; stays fixed while the list scrolls. */}
          {showSearch && (
            <div style={{ position: 'relative', marginBottom: 4 }}>
              <Search size={11} style={{ position: 'absolute', top: 7, left: 7, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
              <input
                ref={searchRef}
                data-testid={testId ? `${testId}-search` : undefined}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label={`Search ${label} options`}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '5px 6px 5px 22px', fontSize: 11,
                  background: 'var(--bg-base)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none',
                }}
              />
            </div>
          )}
          <div ref={listRef} data-testid={testId ? `${testId}-list` : undefined} style={{ maxHeight: 240, overflowY: 'auto' }}>
            {visibleOptions.length === 0 ? (
              <div
                data-testid={testId ? `${testId}-no-matches` : undefined}
                style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}
              >
                No matches
              </div>
            ) : (
              <>
                {/* Selected items float to the top, in their own labelled group,
                    above the existing sort. Live-updates on toggle. */}
                {selectedGroup.length > 0 && (
                  <div
                    data-testid={testId ? `${testId}-selected-label` : undefined}
                    style={{
                      padding: '3px 8px 2px', fontSize: 9, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    Selected ({selectedGroup.length})
                  </div>
                )}
                {selectedGroup.map((opt) => renderOption(opt, true, testId, toggle))}
                {showGroupDivider && (
                  <div
                    data-testid={testId ? `${testId}-group-divider` : undefined}
                    style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 6px' }}
                  />
                )}
                {restGroup.map((opt) => renderOption(opt, false, testId, toggle))}
              </>
            )}
          </div>
          {/* Select all / Clear — canonical on every filter (Patch 5AB).
              Operate on the FULL option set (not the search-visible subset),
              so the affordance is predictable regardless of the query. */}
          <div style={{ display: 'flex', gap: 4, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              data-testid={testId ? `${testId}-select-all` : undefined}
              disabled={allSelected || options.length === 0}
              onClick={() => onChange([...options])}
              style={footerBtnStyle(allSelected || options.length === 0)}
            >
              Select all
            </button>
            <button
              type="button"
              data-testid={testId ? `${testId}-clear` : undefined}
              disabled={noneSelected}
              onClick={() => onChange([])}
              style={footerBtnStyle(noneSelected)}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function renderOption(
  opt: string,
  checked: boolean,
  testId: string | undefined,
  toggle: (v: string) => void,
) {
  return (
    <label
      key={opt}
      data-testid={testId ? `${testId}-option-${opt}` : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer',
        fontSize: 11, color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-base)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <input type="checkbox" checked={checked} onChange={() => toggle(opt)} style={{ margin: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
    </label>
  )
}

function footerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-default)', background: 'var(--bg-base)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
