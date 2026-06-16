import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ArchetypeSummary } from '../../api/client'

interface Props {
  archetypes: ArchetypeSummary[]
  selectedId: string | null
  onChange: (id: string) => void
  disabled?: boolean
  placeholder?: string
  accentColor?: string
}

// Single-select dropdown grouped by folder. Used by Impact Assessment's
// Single-product mode (Patch 3) — picks one archetype out of the BOM store.
// Distinct from ArchetypeCheckboxTree, which is multi-select with a 6-pick
// cap and isn't appropriate for single-pick contexts.
export function ArchetypeSelect({
  archetypes,
  selectedId,
  onChange,
  disabled = false,
  placeholder = 'Pick an archetype',
  accentColor = 'var(--mod-lca)',
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = useMemo(
    () => archetypes.find((a) => a.id === selectedId) ?? null,
    [archetypes, selectedId],
  )

  // Group by `folder` (top-level only — nested folders flatten to their
  // top segment for picker grouping; the canonical tree view still lives
  // in LCA Architect for users who need depth).
  const grouped = useMemo(() => {
    const map = new Map<string, ArchetypeSummary[]>()
    for (const a of archetypes) {
      const top = (a.folder ?? '').split('/')[0] || '(uncategorised)'
      if (!map.has(top)) map.set(top, [])
      map.get(top)!.push(a)
    }
    for (const list of map.values()) list.sort((x, y) => x.name.localeCompare(y.name))
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [archetypes])

  const buttonLabel = selected ? selected.name : placeholder
  const empty = archetypes.length === 0

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', minWidth: 240 }}>
      <button
        type="button"
        data-testid="archetype-select-button"
        onClick={() => !disabled && !empty && setOpen((v) => !v)}
        disabled={disabled || empty}
        title={empty ? 'No archetypes loaded' : selected?.name ?? placeholder}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          width: '100%',
          height: 32,
          padding: '0 10px',
          border: `1px solid ${selected ? accentColor : 'var(--border-default)'}`,
          borderRadius: 'var(--radius-md)',
          background: selected
            ? `color-mix(in srgb, ${accentColor} 8%, var(--bg-elevated))`
            : 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          cursor: disabled || empty ? 'not-allowed' : 'pointer',
          fontSize: 'var(--text-xs)',
          fontWeight: selected ? 600 : 500,
          textAlign: 'left',
          opacity: disabled || empty ? 0.6 : 1,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {buttonLabel}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && !disabled && !empty && (
        <div
          role="listbox"
          data-testid="archetype-select-listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
            minWidth: 280, maxWidth: 480, maxHeight: 320, overflowY: 'auto',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
          }}
        >
          {grouped.map(([folder, items]) => (
            <div key={folder} style={{ marginBottom: 4 }}>
              <div style={{
                padding: '4px 8px',
                fontSize: 10, fontWeight: 700,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}>
                {folder}
              </div>
              {items.map((a) => {
                const checked = a.id === selectedId
                const errored = (a.validation_error_rows ?? 0) > 0
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    data-testid={`archetype-select-option-${a.id}`}
                    onClick={() => { onChange(a.id); setOpen(false) }}
                    title={errored ? `${a.name} — ${a.validation_error_rows} error rows; cannot compute until fixed` : a.name}
                    disabled={errored}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', textAlign: 'left',
                      padding: '6px 10px',
                      border: 'none',
                      background: checked ? `color-mix(in srgb, ${accentColor} 14%, transparent)` : 'transparent',
                      color: errored ? 'var(--text-tertiary)' : 'var(--text-primary)',
                      fontSize: 'var(--text-xs)',
                      cursor: errored ? 'not-allowed' : 'pointer',
                      borderRadius: 'var(--radius-sm)',
                    }}
                    onMouseEnter={(e) => { if (!errored && !checked) e.currentTarget.style.backgroundColor = 'var(--bg-elevated)' }}
                    onMouseLeave={(e) => { if (!checked) e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name}
                    </span>
                    {errored && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: 'var(--status-error)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {a.validation_error_rows} err
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
