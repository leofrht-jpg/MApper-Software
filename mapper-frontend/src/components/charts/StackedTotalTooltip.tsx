/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { TooltipContentProps, TooltipPayloadEntry } from 'recharts'

// Recharts 3: the content callback receives `TooltipContentProps` (active /
// payload / label live here, NOT on `TooltipProps`). Partial<> because the
// component is also used as a `content={<.../>}` element that Recharts clones
// with those fields injected, so they're not present at author time.
type Payload = TooltipPayloadEntry

function defaultFormat(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return v.toFixed(3)
}

export interface StackedTotalTooltipProps extends Partial<TooltipContentProps<number, string>> {
  unit?: string
  formatValue?: (v: number) => string
  totalLabel?: string
  /** When true, sums absolute values (use for symmetric outflow charts where some series are negative). */
  absoluteSum?: boolean
}

export function StackedTotalTooltip(props: StackedTotalTooltipProps) {
  const {
    active,
    payload,
    label,
    unit,
    formatValue,
    totalLabel = 'Total',
    absoluteSum = false,
  } = props

  if (!active || !payload || payload.length === 0) return null

  const fmt = formatValue ?? defaultFormat
  const items = payload.filter((p: Payload) => p.value !== undefined && p.value !== null)
  const total = items.reduce((acc: number, p: Payload) => {
    const v = typeof p.value === 'number' ? p.value : 0
    return acc + (absoluteSum ? Math.abs(v) : v)
  }, 0)

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
        padding: '8px 10px',
        minWidth: 180,
        boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
      }}
    >
      {label !== undefined && (
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          {String(label)}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2px 8px', alignItems: 'center' }}>
        {items.map((p: Payload, i: number) => {
          const value = typeof p.value === 'number' ? (absoluteSum ? Math.abs(p.value) : p.value) : 0
          const name = p.name ?? p.dataKey ?? ''
          return (
            <div key={`${name}-${i}`} style={{ display: 'contents' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: (p.color ?? p.fill ?? 'var(--text-tertiary)') as string,
                  display: 'inline-block',
                }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>{String(name)}</span>
              <span style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(value)}
              </span>
            </div>
          )
        })}
      </div>
      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{totalLabel}</span>
        <span
          style={{
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(total)}
          {unit ? <span style={{ marginLeft: 4, fontWeight: 500, color: 'var(--text-secondary)' }}>{unit}</span> : null}
        </span>
      </div>
    </div>
  )
}

export default StackedTotalTooltip
