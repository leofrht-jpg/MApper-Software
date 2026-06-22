/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, CalendarRange, Loader2 } from 'lucide-react'
import { AreaChart, Area, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { StackedTotalTooltip } from '../charts/StackedTotalTooltip'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { tightStackedDomain } from '../charts/yAxisDomain'
import type { ArchetypeTimeline } from '../../api/client'

interface TimelinePreviewModalProps {
  archetypeName: string
  fetchTimeline: (years: number[]) => Promise<ArchetypeTimeline | null>
  onClose: () => void
}

const PALETTE = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4',
  '#8b5cf6', '#f43f5e', '#10b981', '#facc15', '#3b82f6',
  '#ec4899', '#14b8a6',
]


export function TimelinePreviewModal({ archetypeName, fetchTimeline, onClose }: TimelinePreviewModalProps) {
  const [yearStart, setYearStart] = useState(2025)
  const [yearEnd, setYearEnd] = useState(2050)
  const [step, setStep] = useState(5)
  const [timeline, setTimeline] = useState<ArchetypeTimeline | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  // Single formatter — applies to chart axis, tooltip, header total-mass
  // span, and the per-cell quantities in the year table.
  const valueFormat = useNumberFormatter()

  const yearList = useMemo(() => {
    const out: number[] = []
    for (let y = yearStart; y <= yearEnd; y += Math.max(1, step)) out.push(y)
    return out
  }, [yearStart, yearEnd, step])

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const t = await fetchTimeline(yearList)
      setTimeline(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load().catch(() => undefined) /* initial load */ }, [])

  const chartData = useMemo(() => {
    if (!timeline) return []
    return timeline.years.map((y) => {
      const row: Record<string, number> = { year: y }
      for (const r of timeline.rows) {
        row[r.name] = r.quantities[y] ?? 0
      }
      return row
    })
  }, [timeline])

  const sortedRows = useMemo(() => {
    if (!timeline || timeline.years.length === 0) return []
    const yStart = timeline.years[0]
    const yEnd = timeline.years[timeline.years.length - 1]
    // Sort: evolving rows first (by largest delta), then fixed rows alphabetically.
    return [...timeline.rows].sort((a, b) => {
      if (a.has_evolution !== b.has_evolution) return a.has_evolution ? -1 : 1
      const da = Math.abs((a.quantities[yEnd] ?? 0) - (a.quantities[yStart] ?? 0))
      const db = Math.abs((b.quantities[yEnd] ?? 0) - (b.quantities[yStart] ?? 0))
      return db - da
    })
  }, [timeline])

  const cellColor = (qStart: number, q: number): string => {
    if (qStart === 0) return 'transparent'
    const delta = (q - qStart) / qStart
    if (Math.abs(delta) < 0.001) return 'transparent'
    if (delta < 0) {
      const intensity = Math.min(1, Math.abs(delta))
      return `color-mix(in srgb, var(--success) ${Math.round(intensity * 35)}%, transparent)`
    }
    const intensity = Math.min(1, delta)
    return `color-mix(in srgb, var(--danger) ${Math.round(intensity * 35)}%, transparent)`
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220 }}
    >
      <div style={{ width: 1080, maxHeight: '92vh', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarRange size={18} strokeWidth={1.5} style={{ color: 'var(--mod-plca)' }} />
            <div>
              <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Timeline — {archetypeName}</h3>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                Per-unit material quantities across the selected horizon.
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          <label>Start <NumberInput value={yearStart} onChange={setYearStart} integerOnly emptyValue={2025} style={inputS} /></label>
          <label>End <NumberInput value={yearEnd} onChange={setYearEnd} integerOnly emptyValue={2050} style={inputS} /></label>
          <label>Step <NumberInput value={step} onChange={setStep} integerOnly min={1} emptyValue={1} style={inputS} /></label>
          <Button variant="secondary" onClick={load} disabled={loading} style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)' }}>
            {loading ? <Loader2 size={12} className="plca-spin" /> : 'Refresh'}
          </Button>
          {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
          {timeline && (
            <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Total mass: {valueFormat.format(timeline.total_mass_by_year[timeline.years[0]] ?? 0)} kg →
              {' '}{valueFormat.format(timeline.total_mass_by_year[timeline.years[timeline.years.length - 1]] ?? 0)} kg
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Chart */}
          <div style={{ padding: 'var(--space-3) var(--space-6)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <NumberFormatControl settings={valueFormat.settings} onChange={valueFormat.setSettings} />
              <ChartExportButton
                chartRef={chartRef}
                legendSelector=".recharts-legend-wrapper"
                filename={`timeline_${archetypeName.replace(/[^\w.-]+/g, '_').slice(0, 40)}_${yearStart}-${yearEnd}`}
              />
            </div>
            <ChartExportContainer ref={chartRef} style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="year" stroke="var(--text-tertiary)" fontSize={11} />
                <YAxis domain={tightStackedDomain} stroke="var(--text-tertiary)" fontSize={11} tickFormatter={(v) => valueFormat.format(v as number)} />
                <Tooltip content={<StackedTotalTooltip unit="kg" formatValue={valueFormat.format} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {sortedRows.map((r, idx) => (
                  <Area
                    key={r.node_id}
                    type="monotone"
                    dataKey={r.name}
                    stackId="1"
                    stroke={PALETTE[idx % PALETTE.length]}
                    fill={PALETTE[idx % PALETTE.length]}
                    fillOpacity={0.55}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            </ChartExportContainer>
          </div>

          {/* Table */}
          <div style={{ padding: '0 var(--space-6) var(--space-4)' }}>
            {timeline && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={th}>Material</th>
                    <th style={th}>Unit</th>
                    {timeline.years.map((y) => <th key={y} style={{ ...th, textAlign: 'right' }}>{y}</th>)}
                    <th style={{ ...th, textAlign: 'right' }}>Δ%</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => {
                    const qStart = row.quantities[timeline.years[0]] ?? 0
                    const qEnd = row.quantities[timeline.years[timeline.years.length - 1]] ?? 0
                    const deltaPct = qStart ? ((qEnd - qStart) / qStart) * 100 : null
                    return (
                      <tr key={row.node_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={td}>
                          {row.name}
                          {row.has_evolution && (
                            <span style={{ marginLeft: 6, padding: '1px 5px', border: '1px solid var(--mod-plca)', color: 'var(--mod-plca)', borderRadius: 3, fontSize: 10 }}>
                              evolving
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{row.unit}</td>
                        {timeline.years.map((y) => {
                          const q = row.quantities[y] ?? 0
                          return (
                            <td key={y} style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', backgroundColor: cellColor(qStart, q) }}>
                              {valueFormat.format(q)}
                            </td>
                          )
                        })}
                        <td style={{
                          ...td,
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          color: deltaPct == null ? 'var(--text-tertiary)'
                            : deltaPct < 0 ? 'var(--success)'
                            : deltaPct > 0 ? 'var(--danger)' : 'var(--text-secondary)',
                        }}>
                          {deltaPct == null ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes plca-spin { to { transform: rotate(360deg) } } .plca-spin { animation: plca-spin 1s linear infinite }`}</style>
    </div>
  )
}

const inputS: React.CSSProperties = {
  marginLeft: 4,
  width: 80,
  height: 24,
  padding: '0 6px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }
const td: React.CSSProperties = { padding: '6px 8px' }
