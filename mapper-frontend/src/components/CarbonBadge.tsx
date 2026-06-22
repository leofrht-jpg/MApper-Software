/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState } from 'react'
import { Leaf, RotateCcw } from 'lucide-react'
import {
  equivalenceText,
  formatCo2,
  formatEnergy,
  useCarbonStore,
} from '../stores/carbonStore'
import { getGridIntensities } from '../api/client'

export function CarbonBadge() {
  const [open, setOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  const session_total_co2_g = useCarbonStore((s) => s.session_total_co2_g)
  const session_total_energy_wh = useCarbonStore((s) => s.session_total_energy_wh)
  const lifetime_total_co2_g = useCarbonStore((s) => s.lifetime_total_co2_g)
  const records = useCarbonStore((s) => s.session_records)
  const country_code = useCarbonStore((s) => s.country_code)
  const country_name = useCarbonStore((s) => s.country_name)
  const grid_intensity = useCarbonStore((s) => s.grid_intensity_g_per_kwh)
  const tdp_override = useCarbonStore((s) => s.tdp_override)
  const countries = useCarbonStore((s) => s.countries)
  const setCountries = useCarbonStore((s) => s.setCountries)
  const resetSession = useCarbonStore((s) => s.resetSession)
  const last_pulse_id = useCarbonStore((s) => s.last_pulse_id)

  // Lazy-load countries on first mount so the Settings modal isn't required.
  useEffect(() => {
    if (countries.length > 0) return
    getGridIntensities()
      .then((res) => setCountries(res.countries, res.eu_average, res.world_average))
      .catch(() => {
        /* best-effort */
      })
  }, [countries.length, setCountries])

  // Pulse animation when a new record lands.
  useEffect(() => {
    if (last_pulse_id === 0) return
    setPulse(true)
    const timer = setTimeout(() => setPulse(false), 900)
    return () => clearTimeout(timer)
  }, [last_pulse_id])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const tdpLabel = tdp_override != null ? `${tdp_override} W` : 'auto'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Computation carbon footprint"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: open ? 'var(--surface-1)' : 'transparent',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
          padding: '4px 10px',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-mono)',
          transition: 'background 120ms ease',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            color: '#22c55e',
            transition: 'transform 180ms ease',
            transform: pulse ? 'scale(1.35)' : 'scale(1)',
          }}
        >
          <Leaf size={14} />
        </span>
        <span>{formatCo2(session_total_co2_g)}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 340,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: 14,
            zIndex: 1000,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              Session
            </div>
            <button
              onClick={resetSession}
              title="Reset session"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--text-xs)',
              }}
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>

          <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {formatCo2(session_total_co2_g)}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              CO₂
            </div>
          </div>
          <div style={{ marginTop: 2, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {formatEnergy(session_total_energy_wh)} · {equivalenceText(session_total_co2_g)}
          </div>

          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            <span>Lifetime total</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatCo2(lifetime_total_co2_g)}</span>
          </div>

          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 6 }}>
            Recent computations
          </div>
          {records.length === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No computations this session yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {records.slice(0, 5).map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--text-xs)' }}>
                  <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>{r.module}</span> · {r.description}
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {formatCo2(r.co2_g)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Grid: {country_code} · {country_name} · {grid_intensity} g CO₂/kWh
            <br />
            Estimate based on CPU time × {tdpLabel} TDP. Approximate.
            <br />
            <span style={{ fontStyle: 'italic' }}>Change country in Settings → Location.</span>
          </div>
        </div>
      )}
    </div>
  )
}
