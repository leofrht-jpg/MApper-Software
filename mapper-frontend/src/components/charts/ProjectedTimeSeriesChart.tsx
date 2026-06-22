/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef } from 'react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type TooltipContentProps,
} from 'recharts'
import type { ProjectedRun } from '../../stores/singleProductImpactStore'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { type useNumberFormatter } from './numberFormat'
import { SCENARIO_PALETTE } from '../../utils/chartColors'

type NumberFormatterAPI = ReturnType<typeof useNumberFormatter>

interface Props {
  // Per-database calculation runs (one per (iam, ssp, year) combination).
  // Lines are grouped by (iam, ssp); points come from each run's matching
  // method score at that database's year.
  runs: ProjectedRun[]
  // Active method to plot. Required — there's no multi-method overlay
  // (per Patch 4C scope).
  activeMethodKey: string
  format: NumberFormatterAPI
  filenameBase: string
  // Optional method-selector UI rendered next to the format control.
  methodSelector?: React.ReactNode
}

interface TrajectoryRow {
  year: number
  // One key per (iam, ssp) trajectory holding the method score for that
  // year, keyed by the human-readable label so Recharts dataKey matches the
  // legend.
  [trajectoryLabel: string]: number
}

// Single-product Projected time-series chart (Patch 4C).
//
// Why this is a separate component (don't extend MultiScenarioImpactChart):
// system-mode multi-LCI returns ImpactAssessmentResult per scenario, each
// with a built-in `years` time series (DSM × archetypes). Single-product
// Projected returns scalar scores per (iam, ssp, year) — there's no inner
// time series. Trying to bend the system-mode chart's dataset shape onto a
// flat scalar list invites shape-detection branching that obscures both
// callers. Keep them separate.
export function ProjectedTimeSeriesChart({
  runs, activeMethodKey, format, filenameBase, methodSelector,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  // Patch 4I — separate ref on the legend block so ChartExportButton can
  // export it independently. The legend lives outside ChartExportContainer
  // (so the existing chart-only export keeps its current shape), which
  // means a sibling ref is the cleanest way to point at it.
  const legendRef = useRef<HTMLDivElement>(null)

  // Group runs by (iam, ssp) trajectory. Each trajectory becomes one line.
  const { trajectories, rows, unit } = useMemo(() => {
    const trajMap = new Map<string, ProjectedRun[]>()
    for (const run of runs) {
      const key = `${run.iam}/${run.ssp}`
      if (!trajMap.has(key)) trajMap.set(key, [])
      trajMap.get(key)!.push(run)
    }
    const trajectories = Array.from(trajMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, list], idx) => ({
        label,
        color: SCENARIO_PALETTE[idx % SCENARIO_PALETTE.length],
        runs: list.slice().sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
      }))

    // Year axis = union of years across trajectories.
    const yearSet = new Set<number>()
    for (const t of trajectories) {
      for (const r of t.runs) {
        if (r.year != null) yearSet.add(r.year)
      }
    }
    const years = Array.from(yearSet).sort((a, b) => a - b)

    let unit = ''
    const rows: TrajectoryRow[] = years.map((year) => {
      const row: TrajectoryRow = { year }
      for (const t of trajectories) {
        const run = t.runs.find((r) => r.year === year)
        if (!run) continue
        const m = run.result.results.find((r) => r.method.join('|') === activeMethodKey)
        if (!m) continue
        row[t.label] = m.score
        if (!unit) unit = m.unit
      }
      return row
    })
    return { trajectories, rows, unit }
  }, [runs, activeMethodKey])

  if (rows.length === 0 || trajectories.length === 0) {
    return (
      <div
        data-testid="projected-time-series-empty"
        style={{
          padding: 'var(--space-4)', textAlign: 'center',
          fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)',
        }}
      >
        No data for the selected method.
      </div>
    )
  }

  return (
    <div data-testid="projected-time-series-chart" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          Impact across years · {trajectories.length} trajectory{trajectories.length === 1 ? '' : 'ies'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {methodSelector}
          <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
          <ChartExportButton
            chartRef={chartRef}
            legendRef={legendRef}
            filename={`single_product_projected_${filenameBase}`}
          />
        </div>
      </div>

      <ChartExportContainer ref={chartRef}>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis
                stroke="var(--text-tertiary)"
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                tickFormatter={(v) => format.format(v as number)}
                label={{
                  value: unit, angle: -90, position: 'left', offset: 15,
                  style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' },
                }}
              />
              <Tooltip content={<TrajectoryTooltip unit={unit} format={format.format} />} />
              {trajectories.map((t) => (
                <Line
                  key={t.label}
                  type="monotone"
                  dataKey={t.label}
                  stroke={t.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: t.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartExportContainer>

      <div ref={legendRef} data-testid="projected-time-series-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        {trajectories.map((t) => (
          <span key={t.label} data-testid={`projected-time-series-legend-${t.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: t.color, display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--font-mono)' }}>{t.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function TrajectoryTooltip({
  active, payload, label, unit, format,
}: Partial<TooltipContentProps<number, string>> & { unit: string; format: (v: number) => string }) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload
    .filter((p) => typeof p.value === 'number')
    .map((p) => ({
      name: String(p.name ?? p.dataKey ?? ''),
      value: p.value as number,
      color: (p.color ?? p.stroke) as string,
    }))
    .sort((a, b) => b.value - a.value)
  return (
    <div style={{
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      fontSize: 12,
      padding: '8px 10px',
      minWidth: 200,
      boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
    }}>
      {label !== undefined && (
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          Year {String(label)}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2px 8px', alignItems: 'center' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: r.color, display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.name}</span>
            <span style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {format(r.value)}
              {unit ? <span style={{ marginLeft: 4, fontWeight: 400, color: 'var(--text-secondary)' }}>{unit}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
