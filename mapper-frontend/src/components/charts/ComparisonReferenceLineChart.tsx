import { useMemo, useRef } from 'react'
import {
  CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps,
} from 'recharts'
import type { ProjectedRun } from '../../stores/singleProductImpactStore'
import type { ArchetypeLCACalculateResult } from '../../api/client'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { type useNumberFormatter } from './numberFormat'
import { SCENARIO_PALETTE } from '../../utils/chartColors'

type NumberFormatterAPI = ReturnType<typeof useNumberFormatter>

interface Props {
  staticResult: ArchetypeLCACalculateResult
  projectedRuns: ProjectedRun[]
  activeMethodKey: string
  format: NumberFormatterAPI
  filenameBase: string
  methodSelector?: React.ReactNode
}

interface Row {
  year: number
  static: number
  // Per-trajectory projected score at this year. Missing = no data point
  // for that trajectory at that year (Recharts handles undefined as a gap).
  [trajectoryLabel: string]: number | undefined
}

// Patch 4C — Single-product Comparison reference-line chart.
//
// Reads:
//   Static  → one scalar S per method (from staticResult.results)
//   Projected → N runs, each with method scores at the run's year
//
// Renders the active method as: horizontal reference line at S, plus one
// curve per (iam, ssp) trajectory through the projected per-year scores.
// Sign convention: green where projected < static (improvement), red where
// projected > static (worsening) — applied per-trajectory via color
// gradient on the area between curve and reference line.
export function ComparisonReferenceLineChart({
  staticResult, projectedRuns, activeMethodKey, format, filenameBase, methodSelector,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  // Patch 4I — separate ref on the legend block (Static dashed line +
  // per-trajectory swatches + improvement/worsening dot legend).
  const legendRef = useRef<HTMLDivElement>(null)

  const { trajectories, rows, staticScore, unit } = useMemo(() => {
    const sm = staticResult.results.find((r) => r.method.join('|') === activeMethodKey)
    const staticScore = sm?.score ?? 0
    const unit = sm?.unit ?? ''

    const trajMap = new Map<string, ProjectedRun[]>()
    for (const run of projectedRuns) {
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

    const yearSet = new Set<number>()
    for (const t of trajectories) {
      for (const r of t.runs) if (r.year != null) yearSet.add(r.year)
    }
    const years = Array.from(yearSet).sort((a, b) => a - b)

    const rows: Row[] = years.map((year) => {
      const row: Row = { year, static: staticScore }
      for (const t of trajectories) {
        const run = t.runs.find((r) => r.year === year)
        if (!run) continue
        const m = run.result.results.find((r) => r.method.join('|') === activeMethodKey)
        if (!m) continue
        row[t.label] = m.score
      }
      return row
    })

    return { trajectories, rows, staticScore, unit }
  }, [staticResult, projectedRuns, activeMethodKey])

  if (rows.length === 0 || trajectories.length === 0) {
    return (
      <div
        data-testid="comparison-reference-line-empty"
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
    <div data-testid="comparison-reference-line-chart" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          Projected vs static · {trajectories.length} {trajectories.length === 1 ? 'trajectory' : 'trajectories'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {methodSelector}
          <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
          <ChartExportButton
            chartRef={chartRef}
            legendRef={legendRef}
            filename={`single_product_compare_refline_${filenameBase}`}
          />
        </div>
      </div>

      <ChartExportContainer ref={chartRef}>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
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
              <Tooltip content={<RefLineTooltip unit={unit} format={format.format} staticScore={staticScore} />} />
              <ReferenceLine
                y={staticScore}
                stroke="var(--text-secondary)"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
                label={{
                  value: `Static: ${format.format(staticScore)}`,
                  position: 'right',
                  fill: 'var(--text-secondary)',
                  fontSize: 10,
                }}
              />
              {trajectories.map((t) => (
                <Line
                  key={t.label}
                  type="monotone"
                  dataKey={t.label}
                  stroke={t.color}
                  strokeWidth={2}
                  dot={(props: { cx?: number; cy?: number; payload?: Row }) => {
                    const { cx, cy, payload } = props
                    if (cx == null || cy == null || !payload) return <g />
                    const v = payload[t.label]
                    if (typeof v !== 'number') return <g />
                    const tone = v < staticScore
                      ? 'var(--status-success)'
                      : v > staticScore
                        ? 'var(--status-error)'
                        : t.color
                    return <circle cx={cx} cy={cy} r={3.5} fill={tone} stroke={t.color} strokeWidth={1} />
                  }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartExportContainer>

      <div ref={legendRef} data-testid="comparison-refline-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text-secondary)', display: 'inline-block' }} />
          <span>Static (St)</span>
        </span>
        {trajectories.map((t) => (
          <span key={t.label} data-testid={`comparison-refline-legend-${t.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: t.color, display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--font-mono)' }}>{t.label}</span>
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: 'var(--status-success)', display: 'inline-block' }} />
          <span>Improvement (P&lt;S)</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: 'var(--status-error)', display: 'inline-block' }} />
          <span>Worsening (P&gt;S)</span>
        </span>
      </div>
    </div>
  )
}

function RefLineTooltip({
  active, payload, label, unit, format, staticScore,
}: Partial<TooltipContentProps<number, string>> & { unit: string; format: (v: number) => string; staticScore: number }) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload
    .filter((p) => typeof p.value === 'number' && p.dataKey !== 'static')
    .map((p) => {
      const v = p.value as number
      return {
        name: String(p.name ?? p.dataKey ?? ''),
        value: v,
        delta: v - staticScore,
        color: (p.color ?? p.stroke) as string,
      }
    })
    .sort((a, b) => a.delta - b.delta)
  return (
    <div style={{
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      fontSize: 12,
      padding: '8px 10px',
      minWidth: 240,
      boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
    }}>
      {label !== undefined && (
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          Year {String(label)}
        </div>
      )}
      <div style={{ color: 'var(--text-secondary)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
        Static: {format(staticScore)}{unit ? ` ${unit}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: '2px 8px', alignItems: 'center' }}>
        {rows.map((r, i) => {
          const tone = r.delta < 0 ? 'var(--status-success)' : r.delta > 0 ? 'var(--status-error)' : 'var(--text-tertiary)'
          return (
            <div key={i} style={{ display: 'contents' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: r.color, display: 'inline-block' }} />
              <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.name}</span>
              <span style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {format(r.value)}
              </span>
              <span style={{ color: tone, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.delta > 0 ? '+' : ''}{format(r.delta)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Δ-only chart: P(year) − S per trajectory, centered at 0.
interface DeltaProps {
  staticResult: ArchetypeLCACalculateResult
  projectedRuns: ProjectedRun[]
  activeMethodKey: string
  format: NumberFormatterAPI
  filenameBase: string
}

export function ComparisonDeltaChart({
  staticResult, projectedRuns, activeMethodKey, format, filenameBase,
}: DeltaProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  const { trajectories, rows, unit } = useMemo(() => {
    const sm = staticResult.results.find((r) => r.method.join('|') === activeMethodKey)
    const staticScore = sm?.score ?? 0
    const unit = sm?.unit ?? ''

    const trajMap = new Map<string, ProjectedRun[]>()
    for (const run of projectedRuns) {
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

    const yearSet = new Set<number>()
    for (const t of trajectories) {
      for (const r of t.runs) if (r.year != null) yearSet.add(r.year)
    }
    const years = Array.from(yearSet).sort((a, b) => a - b)

    const rows = years.map((year) => {
      const row: Record<string, number> = { year }
      for (const t of trajectories) {
        const run = t.runs.find((r) => r.year === year)
        if (!run) continue
        const m = run.result.results.find((r) => r.method.join('|') === activeMethodKey)
        if (!m) continue
        row[t.label] = m.score - staticScore
      }
      return row
    })
    return { trajectories, rows, unit }
  }, [staticResult, projectedRuns, activeMethodKey])

  if (rows.length === 0 || trajectories.length === 0) return null

  return (
    <div data-testid="comparison-delta-chart" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          Impact assessment change compared to Static Background (Δ &gt; 0 → worsening, Δ &lt; 0 → improvement)
        </div>
        <ChartExportButton chartRef={chartRef} filename={`single_product_compare_delta_${filenameBase}`} />
      </div>

      <ChartExportContainer ref={chartRef}>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            {/* Patch 4F — switched from AreaChart with vertical-gradient
                fill to LineChart, matching the sibling reference-line
                chart's styling. The gradient was meant to convey
                direction (red at top, green at bottom) but read as a
                shadow/halo against the page background. The Δ sign is
                already legible from the curve crossing y=0; the tooltip
                colors values green/red explicitly. */}
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis
                stroke="var(--text-tertiary)"
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                tickFormatter={(v) => format.format(v as number)}
                label={{
                  value: `Δ ${unit}`, angle: -90, position: 'left', offset: 15,
                  style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' },
                }}
              />
              <Tooltip content={<DeltaTooltip unit={unit} format={format.format} />} />
              <ReferenceLine y={0} stroke="var(--text-secondary)" strokeWidth={1.5} />
              {trajectories.map((t) => (
                <Line
                  key={t.label}
                  type="monotone"
                  dataKey={t.label}
                  stroke={t.color}
                  strokeWidth={2}
                  isAnimationActive={false}
                  connectNulls
                  dot={{ r: 3, fill: t.color, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartExportContainer>
    </div>
  )
}

function DeltaTooltip({
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
    .sort((a, b) => a.value - b.value)
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
        {rows.map((r, i) => {
          const tone = r.value < 0 ? 'var(--status-success)' : r.value > 0 ? 'var(--status-error)' : 'var(--text-tertiary)'
          return (
            <div key={i} style={{ display: 'contents' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: r.color, display: 'inline-block' }} />
              <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.name}</span>
              <span style={{ color: tone, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.value > 0 ? '+' : ''}{format(r.value)}
                {unit ? <span style={{ marginLeft: 4, fontWeight: 400, color: 'var(--text-secondary)' }}>{unit}</span> : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
