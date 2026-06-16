// Patch 4T — multi-select chip + checklist for the AESA display
// filter. Compact header chip ("Showing N of M indicators") expands
// into a checklist with Select all / Clear all buttons. Mirrors the
// Sensitivity-cases checklist pattern from `DSMImpactPanel`. View-
// state only — never modifies the underlying compute.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { shortPbName } from './zones'
import { colorForIndicatorById } from '../../utils/aesaIndicatorColors'

interface Props {
  /** Full ordered list of indicators in the current result. The
   * filter is opt-out from this set; an empty array hides the
   * component entirely (nothing to filter). */
  allIndicators: ReadonlyArray<{ id: string; name: string }>
  /** Effective display set. `null` = "all selected" (default). */
  displayed: string[] | null
  /** pb_id → color map computed from `allIndicators`. */
  colorMap: Record<string, string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}

export function IndicatorDisplayFilter({
  allIndicators,
  displayed,
  colorMap,
  onToggle,
  onSelectAll,
  onClearAll,
}: Props) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement | null>(null)
  const total = allIndicators.length

  // Effective list of displayed ids — `null` resolves to all.
  const effective = useMemo<string[]>(
    () => displayed ?? allIndicators.map((x) => x.id),
    [displayed, allIndicators],
  )
  const visibleCount = effective.length

  // Click-outside to close the popover. Bound only while open.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (total === 0) return null

  const filtered = visibleCount < total
  const allOff = visibleCount === 0

  return (
    <div
      ref={popRef}
      data-testid="aesa-indicator-filter"
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        data-testid="aesa-indicator-filter-toggle"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px',
          fontSize: 11, fontWeight: filtered ? 600 : 500,
          color: filtered ? 'var(--text-primary)' : 'var(--text-secondary)',
          background: filtered
            ? 'color-mix(in srgb, var(--mod-aesa) 14%, transparent)'
            : 'var(--bg-elevated)',
          border: `1px solid ${filtered ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
        }}
        title={
          allOff
            ? 'No indicators displayed. Click to re-enable.'
            : filtered
              ? `Filtering: ${visibleCount} of ${total} indicators visible`
              : `Showing all ${total} indicators`
        }
      >
        Indicators: {visibleCount} of {total}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div
          data-testid="aesa-indicator-filter-menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
            minWidth: 280, maxHeight: 360, overflowY: 'auto',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 8,
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Charts &amp; export only
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={onSelectAll}
                data-testid="aesa-indicator-filter-select-all"
                style={pillBtn}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onClearAll}
                data-testid="aesa-indicator-filter-clear-all"
                style={pillBtn}
              >
                Clear all
              </button>
            </div>
          </div>
          {allIndicators.map((ind, idx) => {
            const checked = effective.includes(ind.id)
            const color = colorForIndicatorById(colorMap, ind.id, idx)
            return (
              <label
                key={ind.id}
                data-testid={`aesa-indicator-filter-row-${ind.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 6px',
                  fontSize: 11, cursor: 'pointer',
                  color: checked ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-base)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14,
                  border: `1.5px solid ${checked ? color : 'var(--border-default)'}`,
                  background: checked ? color : 'transparent',
                  borderRadius: 3,
                }}>
                  {checked && <Check size={10} color="white" />}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(ind.id)}
                  style={{ display: 'none' }}
                />
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: color,
                  flexShrink: 0,
                }} />
                <span style={{ flex: 1 }}>{shortPbName(ind.name)}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

const pillBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}
