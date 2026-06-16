import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useDSMStore } from '../../stores/dsmStore'

interface DSMScenariosChipProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  accentColor?: string
  disabled?: boolean
}

/**
 * Multi-select chip for DSM scenarios on Impact Assessment. N=1 collapses to
 * the legacy single-scenario path; N>1 routes through the multi-DSM fan-out.
 * Mirrors the LCI-scenario chip pattern in ProjectedImpactPanel: selected
 * scenarios render as removable chips, an "Add scenario" button opens a
 * picker with the remaining scenarios. Server-side ``active_scenario_id``
 * is never touched — this is selection state only.
 */
export function DSMScenariosChip({
  selectedIds,
  onChange,
  accentColor = 'var(--mod-dsm)',
  disabled = false,
}: DSMScenariosChipProps) {
  const { systemState, isSimulating } = useDSMStore()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const scenarios = systemState?.scenarios ?? []
  const selectedSet = new Set(selectedIds)
  const selectedScenarios = selectedIds
    .map((id) => scenarios.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
  const isBusy = isSimulating || disabled

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const toggleScenario = (sid: string) => {
    if (selectedSet.has(sid)) {
      if (selectedIds.length <= 1) return
      onChange(selectedIds.filter((id) => id !== sid))
    } else {
      onChange([...selectedIds, sid])
    }
  }

  return (
    <span
      ref={wrapRef}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative', flexWrap: 'wrap' }}
    >
      <span style={{
        color: 'var(--text-tertiary)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        fontSize: 10,
      }}>
        DSM scenario{selectedIds.length === 1 ? '' : 's'}
      </span>
      {/* Left-anchored Pick (UI convention: multi-select Pick/Add stays
          on the left so layout doesn't drift as selections grow/shrink).
          Selected chips flow rightward in selection order — newest at
          the rightmost position. */}
      <button
        type="button"
        data-testid="dsm-scenarios-pick"
        onClick={() => setOpen((v) => !v)}
        disabled={isBusy || scenarios.length === 0}
        title={scenarios.length === 0 ? 'No DSM scenarios available' : 'Pick DSM scenarios'}
        style={{
          height: 22,
          padding: '0 8px',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          cursor: isBusy || scenarios.length === 0 ? 'not-allowed' : 'pointer',
          fontSize: 'var(--text-xs)',
        }}
      >
        Pick ▾
      </button>
      {selectedScenarios.map((s) => (
        <span
          key={s.id}
          title={s.is_base ? 'Base scenario · uncheck in the dropdown to deselect' : `${s.name} · uncheck in the dropdown to deselect`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px',
            border: `1px solid ${accentColor}`,
            borderRadius: 'var(--radius-sm)',
            backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
            color: accentColor,
            fontSize: 'var(--text-xs)', fontWeight: 600,
          }}
        >
          {s.name}
          {isSimulating && <Loader2 size={10} style={{ animation: 'dsm-spin 1s linear infinite' }} />}
        </span>
      ))}
      {open && scenarios.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
            minWidth: 220, maxWidth: 360, maxHeight: 280, overflowY: 'auto',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
          }}
        >
          {scenarios.map((s) => {
            const checked = selectedSet.has(s.id)
            const isLastSelected = checked && selectedIds.length <= 1
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggleScenario(s.id)}
                disabled={isLastSelected}
                title={isLastSelected ? 'At least one scenario must remain selected' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none', background: 'transparent',
                  color: isLastSelected ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontWeight: 500,
                  cursor: isLastSelected ? 'not-allowed' : 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  gap: 8,
                }}
                onMouseEnter={(e) => { if (!isLastSelected) e.currentTarget.style.backgroundColor = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 14, height: 14,
                      border: `1px solid ${checked ? accentColor : 'var(--border-default)'}`,
                      borderRadius: 3,
                      backgroundColor: checked ? accentColor : 'transparent',
                      color: checked ? 'var(--bg-surface)' : 'transparent',
                      fontSize: 10, lineHeight: 1, fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                </span>
                {s.is_base && (
                  <span style={{
                    fontSize: 9, fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
                    padding: '1px 5px', borderRadius: 3,
                    backgroundColor: 'var(--bg-elevated)',
                  }}>
                    Base
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
