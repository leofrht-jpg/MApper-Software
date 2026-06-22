/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Dot,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'

import {
  exportMultiYearContribution,
  type MultiYearContributionResult,
} from '../../api/client'
import { Button } from '../ui/Button'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { ContributionAnalysisPanel } from './ContributionAnalysisPanel'

type View = 'trajectory' | 'evolution' | 'snapshot'

/** Stable palette for evolution series. Reused across renders so colours
 *  don't flicker when the user toggles snapshot ↔ evolution. */
const EVOLUTION_PALETTE = [
  '#3ECFCF', '#FF7676', '#F7B500', '#7B61FF', '#5BC470',
  '#FF9C5A', '#5AB6FF', '#D060D0', '#9CC65A', '#FF5C9F',
]

interface Props {
  result: MultiYearContributionResult
  /** Phase label rendered while the multi-year run is in progress. */
  loadingPhase?: string | null
  loadingStartedAt?: number | null
}

export function MultiYearTrajectoryPanel({ result, loadingPhase: _loadingPhase, loadingStartedAt: _loadingStartedAt }: Props) {
  const [view, setView] = useState<View>('trajectory')
  const [snapshotYear, setSnapshotYear] = useState<number>(result.years[0] ?? 0)
  const [exporting, setExporting] = useState(false)
  const trajectoryChartRef = useRef<HTMLDivElement>(null)
  const evolutionChartRef = useRef<HTMLDivElement>(null)
  const trajFormat = useNumberFormatter()
  const evoFormat = useNumberFormatter()

  const exportSlug = useMemo(() => {
    const target = (result.target_label || 'target').replace(/[^\w.-]+/g, '_').slice(0, 40)
    const method = result.method.join('_').replace(/[^\w.-]+/g, '_').slice(0, 60)
    const span = `${result.years[0] ?? ''}-${result.years[result.years.length - 1] ?? ''}`
    return `${target}_${method}_${span}`
  }, [result.target_label, result.method, result.years])

  const trajectoryData = useMemo(
    () => result.trajectory.map((p) => ({
      year: p.year,
      score: p.score,
      hasWarnings: p.has_warnings,
      database: p.compute_database,
    })),
    [result.trajectory],
  )

  // For evolution: top-K contributors by aggregate score across years (the
  // backend already returns them sorted by mean contribution descending).
  const TOP_K = 8
  const evolutionTopK = useMemo(
    () => result.evolution.slice(0, TOP_K),
    [result.evolution],
  )
  // Disambiguate display labels when two distinct activities (different
  // (database, code) → different ``activity_key``) share the same
  // ``activity_name``: append ``· <location>`` only on collisions, so unique
  // names stay clean. Fixes the bug where stacked Areas keyed on
  // ``activity_name`` collapsed multiple distinct activities into one.
  const labelByKey = useMemo(() => {
    const counts = new Map<string, number>()
    evolutionTopK.forEach((ev) => {
      counts.set(ev.activity_name, (counts.get(ev.activity_name) ?? 0) + 1)
    })
    const map = new Map<string, string>()
    evolutionTopK.forEach((ev) => {
      const collides = (counts.get(ev.activity_name) ?? 0) > 1
      const label = collides && ev.location
        ? `${ev.activity_name} · ${ev.location}`
        : ev.activity_name
      map.set(ev.activity_key, label)
    })
    return map
  }, [evolutionTopK])
  const evolutionData = useMemo(() => {
    return result.years.map((y) => {
      const row: Record<string, number | string> = { year: y }
      evolutionTopK.forEach((ev) => {
        row[ev.activity_key] = ev.by_year[String(y)] ?? 0
      })
      return row
    })
  }, [result.years, evolutionTopK])

  const handleExport = async () => {
    setExporting(true)
    try {
      const safe = (result.target_label || 'target').replace(/[^\w.-]+/g, '_').slice(0, 40)
      const span = `${result.years[0]}-${result.years[result.years.length - 1]}`
      const date = new Date().toISOString().slice(0, 10)
      await exportMultiYearContribution(
        result,
        `MApper_LCA_Trajectory_${safe}_${span}_${date}.xlsx`,
      )
    } finally {
      setExporting(false)
    }
  }

  const summary = (
    <>
      <span style={{ color: 'var(--text-secondary)' }}>
        {result.years[0]}–{result.years[result.years.length - 1]}
      </span>
      <span style={{ color: 'var(--text-tertiary)' }}>
        · {result.years.length} year{result.years.length === 1 ? '' : 's'}
      </span>
      <span style={{ color: 'var(--text-tertiary)' }}>
        · {result.method[result.method.length - 1] ?? result.method.join(' › ')}
      </span>
    </>
  )

  // Only relabel + tooltip when both buttons are simultaneously visible — i.e.
  // the Snapshot tab embeds the per-year ContributionAnalysisPanel which has
  // its own export button. Other tabs keep the simpler "Export XLSX" label.
  const bothVisible = view === 'snapshot'
  const exportLabel = bothVisible ? 'Export multi-year XLSX' : 'Export XLSX'
  const exportTitle = bothVisible
    ? 'Download multi-year trajectory and evolution data as Excel'
    : undefined
  const actions = (
    <Button
      onClick={handleExport}
      disabled={exporting}
      variant="secondary"
      title={exportTitle}
    >
      {exporting ? <Loader2 size={14} className="lca-spin" /> : <Download size={14} />}
      <span style={{ marginLeft: 6 }}>{exportLabel}</span>
    </Button>
  )

  const snapshotResult = result.results[String(snapshotYear)]

  return (
    <CollapsibleCard
      expanded
      onToggle={() => {}}
      title="Multi-year trajectory"
      summary={summary}
      actions={actions}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
        {result.target_label} · {result.method.join(' › ')}
        {result.compute_database_pattern && (
          <span style={{ marginLeft: 8 }} title={result.compute_database_pattern}>
            · pattern: {shortenPattern(result.compute_database_pattern)}
          </span>
        )}
        {result.elapsed_seconds > 0 && (
          <span style={{ marginLeft: 8 }} title="Total wall-clock time across all years">
            · {result.elapsed_seconds.toFixed(2)}s
          </span>
        )}
      </div>

      {result.warnings.length > 0 && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '8px 12px', marginBottom: 'var(--space-3)',
            backgroundColor: 'color-mix(in srgb, #f59e0b 12%, transparent)',
            border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)', color: 'var(--text-primary)',
          }}
        >
          <span style={{
            flexShrink: 0, padding: '1px 6px', borderRadius: 999,
            backgroundColor: '#f59e0b', color: '#1f1300', fontWeight: 700,
          }}>{result.warnings.length}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.5 }}>
            <strong>Trajectory warnings (per-year)</strong>
            {result.warnings.slice(0, 5).map((w, i) => (
              <span key={i} style={{ color: 'var(--text-secondary)' }}>{w}</span>
            ))}
            {result.warnings.length > 5 && (
              <span style={{ color: 'var(--text-tertiary)' }}>
                …and {result.warnings.length - 5} more.
              </span>
            )}
          </div>
        </div>
      )}

      {/* View tab strip */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
        {([
          ['trajectory', 'Trajectory'],
          ['evolution', 'Evolution'],
          ['snapshot', 'Snapshot'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            style={{
              padding: '0 var(--space-5)', height: 38, background: 'none', border: 'none',
              borderBottom: view === key ? '2px solid var(--accent)' : '2px solid transparent',
              color: view === key ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontSize: 'var(--text-sm)',
              fontWeight: view === key ? 600 : 500,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'trajectory' && (
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          {trajectoryData.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span style={{
                fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)',
                fontWeight: 700, color: 'var(--accent)',
              }}>
                {trajFormat.format(trajectoryData[0].score)}
                <span style={{ margin: '0 8px', color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span>
                {trajFormat.format(trajectoryData[trajectoryData.length - 1].score)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                {result.method_unit}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
            <NumberFormatControl settings={trajFormat.settings} onChange={trajFormat.setSettings} />
            <ChartExportButton
              chartRef={trajectoryChartRef}
              filename={`multiyear_trajectory_${exportSlug}`}
            />
          </div>
          <ChartExportContainer ref={trajectoryChartRef} style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trajectoryData} margin={{ top: 8, right: 24, bottom: 8, left: 56 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="year" stroke="var(--text-tertiary)" fontSize={12} />
                <YAxis
                  stroke="var(--text-tertiary)"
                  fontSize={12}
                  tickFormatter={(v) => trajFormat.format(v as number)}
                  label={{
                    value: result.method_unit,
                    angle: -90,
                    position: 'left',
                    offset: 15,
                    style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                  }}
                  formatter={(v) => [trajFormat.format(Number(v)), result.method_unit]}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={(props: { cx?: number; cy?: number; payload?: { hasWarnings: boolean }; index?: number }) => {
                    const cx = props.cx ?? 0
                    const cy = props.cy ?? 0
                    const flagged = props.payload?.hasWarnings
                    const key = `dot-${props.index}`
                    return flagged ? (
                      <Dot key={key} cx={cx} cy={cy} r={5} fill="#f59e0b" stroke="var(--accent)" strokeWidth={1.5} />
                    ) : (
                      <Dot key={key} cx={cx} cy={cy} r={3.5} fill="var(--accent)" />
                    )
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartExportContainer>
          <div style={{ marginTop: 8, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={12} color="#f59e0b" />
            Amber dot = year emitted warnings (e.g. activity not found in compute DB).
          </div>
        </div>
      )}

      {view === 'evolution' && (
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
            <NumberFormatControl settings={evoFormat.settings} onChange={evoFormat.setSettings} />
            <ChartExportButton
              chartRef={evolutionChartRef}
              // Recharts renders <Legend> as `<div class="recharts-legend-wrapper">`
              // inside the chart container; query for it at export time so
              // the Mode picker can offer Legend-only / Chart+Legend.
              legendSelector=".recharts-legend-wrapper"
              filename={`multiyear_evolution_${exportSlug}`}
            />
          </div>
          <ChartExportContainer ref={evolutionChartRef} style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolutionData} margin={{ top: 8, right: 24, bottom: 8, left: 56 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="year" stroke="var(--text-tertiary)" fontSize={12} />
                <YAxis
                  stroke="var(--text-tertiary)"
                  fontSize={12}
                  tickFormatter={(v) => evoFormat.format(v as number)}
                  label={{
                    value: result.method_unit,
                    angle: -90,
                    position: 'left',
                    offset: 15,
                    style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                  }}
                  formatter={(v) => evoFormat.format(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {evolutionTopK.map((ev, i) => (
                  <Area
                    key={ev.activity_key}
                    type="monotone"
                    stackId="1"
                    dataKey={ev.activity_key}
                    name={labelByKey.get(ev.activity_key) ?? ev.activity_name}
                    stroke={EVOLUTION_PALETTE[i % EVOLUTION_PALETTE.length]}
                    fill={EVOLUTION_PALETTE[i % EVOLUTION_PALETTE.length]}
                    fillOpacity={0.6}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartExportContainer>
          <div style={{ marginTop: 8, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Top {evolutionTopK.length} contributors (union across years, sorted by mean contribution).
          </div>
        </div>
      )}

      {view === 'snapshot' && (
        <div>
          {/* Year tab strip */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 4,
              padding: '8px var(--space-5)',
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'color-mix(in srgb, var(--accent) 4%, transparent)',
            }}
          >
            {result.years.map((y) => {
              const point = result.trajectory.find((p) => p.year === y)
              const flagged = point?.has_warnings
              return (
                <button
                  key={y}
                  onClick={() => setSnapshotYear(y)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    border: '1px solid',
                    borderColor: y === snapshotYear ? 'var(--accent)' : 'var(--border-default)',
                    backgroundColor: y === snapshotYear ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                    color: y === snapshotYear ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: y === snapshotYear ? 600 : 500,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {y}
                  {flagged && <AlertTriangle size={11} color="#f59e0b" />}
                </button>
              )
            })}
          </div>
          <div style={{ padding: 'var(--space-3) var(--space-5)' }}>
            {snapshotResult ? (
              <ContributionAnalysisPanel
                result={snapshotResult}
                nestedInMultiYear
                stageBreakdown={(snapshotResult.by_stage ?? []).map((s) => ({
                  stage: s.stage,
                  impact: s.score,
                  percentage: s.percentage ?? 0,
                }))}
              />
            ) : (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                No data for {snapshotYear}.
              </div>
            )}
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}

function shortenPattern(pattern: string): string {
  // ``ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150``
  // → ``REMIND SSP2-PKBUDG1150``
  const m = pattern.match(/_premise_([a-z0-9-]+)_(.+)$/i)
  if (!m) return pattern
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`
}
