/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { Notation, NumberFormatSettings } from './numberFormat'

interface Props {
  settings: NumberFormatSettings
  onChange: (next: NumberFormatSettings) => void
  title?: string
  /** Restrict the offered notations. Defaults to all three. Use e.g.
   *  `['fixed']` for normalized-ratio surfaces (AESA SR ≈ 1.0) where
   *  scientific/SI add no value. */
  notations?: Notation[]
}

const ALL_NOTATIONS: Notation[] = ['scientific', 'fixed', 'si']
const NOTATION_LABEL: Record<Notation, string> = {
  scientific: 'Scientific (1.738e+4)',
  fixed: 'Fixed (17,380)',
  si: 'SI prefix (17.4k)',
}

export function NumberFormatControl({ settings, onChange, title = 'Number format', notations }: Props) {
  const offered = notations && notations.length > 0 ? notations : ALL_NOTATIONS
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const setNotation = (n: Notation) => onChange({ ...settings, notation: n })
  const setSig = (v: number) => onChange({ ...settings, sigFigs: v })
  const setDec = (v: number) => onChange({ ...settings, decimals: v })

  const sigActive = settings.notation === 'scientific' || settings.notation === 'si'
  const decActive = settings.notation === 'fixed'

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          padding: 0,
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.borderColor = 'var(--border-default)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.borderColor = 'var(--border-subtle)'
        }}
      >
        <SlidersHorizontal size={14} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: 240,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: '6px 0',
            fontSize: 12,
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ padding: '4px 12px 6px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            Notation
          </div>
          {offered.map((n) => (
            <NotationItem key={n} label={NOTATION_LABEL[n]} value={n} current={settings.notation} onSelect={setNotation} />
          ))}

          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />

          <SliderRow
            label="Significant figures"
            value={settings.sigFigs}
            min={1}
            max={6}
            disabled={!sigActive}
            onChange={setSig}
          />
          <SliderRow
            label="Decimal places"
            value={settings.decimals}
            min={0}
            max={4}
            disabled={!decActive}
            onChange={setDec}
          />
        </div>
      )}
    </div>
  )
}

function NotationItem({ label, value, current, onSelect }: { label: string; value: Notation; current: Notation; onSelect: (v: Notation) => void }) {
  const active = current === value
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      type="button"
      onClick={() => onSelect(value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 12px',
        background: 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        border: '1px solid var(--border-default)',
        background: active ? 'var(--accent)' : 'transparent',
      }} />
      <span>{label}</span>
    </button>
  )
}

function SliderRow({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <div style={{ padding: '6px 12px', opacity: disabled ? 0.45 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  )
}
