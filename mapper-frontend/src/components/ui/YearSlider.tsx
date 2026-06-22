/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

interface YearSliderProps {
  years: number[]
  value: number
  onChange: (year: number) => void
  label?: string
  accentColor?: string
  ariaLabel?: string
  rightSlot?: ReactNode
  showDots?: boolean
  variant?: 'card' | 'inline'
}

export function YearSlider({
  years,
  value,
  onChange,
  label = 'Selected year',
  accentColor = 'var(--mod-dsm)',
  ariaLabel,
  rightSlot,
  showDots = true,
  variant = 'card',
}: YearSliderProps) {
  if (!years.length) return null
  const min = years[0]
  const max = years[years.length - 1]

  const snap = (raw: number) => {
    if (years.includes(raw)) return raw
    return years.reduce((best, y) => (Math.abs(y - raw) < Math.abs(best - raw) ? y : best), years[0])
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Home') { e.preventDefault(); onChange(min) }
    else if (e.key === 'End') { e.preventDefault(); onChange(max) }
  }

  const containerStyle: CSSProperties = variant === 'card'
    ? {
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4) var(--space-5)',
      }
    : { padding: 'var(--space-2) 0' }

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showDots ? 'var(--space-3)' : 0, gap: 'var(--space-3)' }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            fontWeight: 600,
          }}>
            {label}
          </div>
          <div style={{
            fontSize: 'var(--text-2xl)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            color: accentColor,
            lineHeight: 1.1,
          }}>
            {value}
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(snap(Number(e.target.value)))}
          onKeyDown={handleKey}
          aria-label={ariaLabel ?? label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          style={{ flex: 1, accentColor }}
        />
        {rightSlot != null && (
          <div style={{ flexShrink: 0 }}>{rightSlot}</div>
        )}
      </div>
      {showDots && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
          {years.map((y) => {
            const active = y === value
            return (
              <button
                key={y}
                onClick={() => onChange(y)}
                title={String(y)}
                aria-label={`Select year ${y}`}
                style={{
                  flexShrink: 0,
                  width: active ? 12 : 8,
                  height: active ? 12 : 8,
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: active ? accentColor : 'var(--bg-active)',
                  transition: 'all var(--duration-fast) var(--ease-out)',
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
