/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Loader2 } from 'lucide-react'
import { useDSMStore } from '../../stores/dsmStore'

interface DSMScenarioChipProps {
  selectedScenarioId: string | null
  onSelect: (scenarioId: string) => void
  accentColor?: string
}

/**
 * Click-to-pick chip for DSM scenario selection on Impact Assessment.
 * Lists all scenarios from the active system; on pick, calls onSelect (which
 * the parent uses to update local state + re-simulate against that scenario).
 * Does NOT call activateScenario — server-side active flag stays put.
 */
export function DSMScenarioChip({
  selectedScenarioId,
  onSelect,
  accentColor = 'var(--mod-dsm)',
}: DSMScenarioChipProps) {
  const { systemState, isSimulating } = useDSMStore()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const scenarios = systemState?.scenarios ?? []
  const activeServerId = systemState?.active_scenario_id ?? null
  const selected = scenarios.find((s) => s.id === selectedScenarioId)
    ?? scenarios.find((s) => s.is_base)
    ?? scenarios[0]
  const displayName = selected?.name ?? 'Base'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, position: 'relative' }} ref={wrapRef}>
      <span style={{
        color: 'var(--text-tertiary)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        fontSize: 10,
      }}>
        DSM scenario
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={scenarios.length === 0 || isSimulating}
        title={scenarios.length === 0 ? 'No DSM scenarios available' : 'Click to switch DSM scenario'}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          color: accentColor, fontWeight: 600,
          fontSize: 'inherit', fontFamily: 'inherit',
          cursor: scenarios.length === 0 || isSimulating ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 2,
        }}
      >
        {displayName}
        {isSimulating
          ? <Loader2 size={11} style={{ animation: 'dsm-spin 1s linear infinite' }} />
          : <ChevronDown size={11} />}
      </button>
      {open && scenarios.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
            minWidth: 200, maxWidth: 320, maxHeight: 280, overflowY: 'auto',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
          }}
        >
          {scenarios.map((s) => {
            const active = s.id === selected?.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onSelect(s.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: active ? `color-mix(in srgb, ${accentColor} 12%, transparent)` : 'transparent',
                  color: active ? accentColor : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  gap: 8,
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
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
                  {s.id === activeServerId && !active && (
                    <span title="Active in DSM tab" style={{
                      fontSize: 9, fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
                    }}>
                      DSM-active
                    </span>
                  )}
                </span>
                {active && <Check size={12} />}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
