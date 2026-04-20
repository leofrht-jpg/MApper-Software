import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useMFAStore } from '../../stores/mfaStore'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
  '#e07b53', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#6366f1',
]

type Scope = 'inflows' | 'outflows' | 'stock' | 'all'
type GroupBy = 'material' | 'component' | 'stage' | 'archetype'

const SCOPE_OPTIONS: { value: Scope; label: string; tip: string }[] = [
  { value: 'inflows', label: 'Manufacturing', tip: 'Manufacturing stage materials x units produced each year.' },
  { value: 'stock', label: 'Operation', tip: 'Use Phase + Maintenance materials x in-service stock each year.' },
  { value: 'outflows', label: 'End of Life', tip: 'End of Life stage materials x units retired each year.' },
]

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'material', label: 'Material' },
  { value: 'component', label: 'Component' },
  { value: 'stage', label: 'Stage' },
  { value: 'archetype', label: 'Archetype' },
]

const fmtQty = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  if (a < 0.01) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const fmtAxis = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'k'
  if (a < 0.01) return n.toExponential(2)
  return String(Math.round(n))
}

export function MaterialFlowPanel() {
  const {
    activeSystem,
    simulationResult,
    materialFlows,
    materialFlowLoading,
    error,
    calcMaterialFlows,
    exportMatFlows,
  } = useMFAStore()

  const [scope, setScope] = useState<Scope>('stock')
  const [groupBy, setGroupBy] = useState<GroupBy>('material')
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const availableYears = useMemo(() => {
    if (simulationResult) return simulationResult.years.map((y) => y.year)
    if (activeSystem) {
      const { start_year, end_year } = activeSystem.time_horizon
      return Array.from({ length: end_year - start_year + 1 }, (_, i) => start_year + i)
    }
    return []
  }, [simulationResult, activeSystem])

  useEffect(() => {
    if (availableYears.length === 0) return
    if (yearStart == null || !availableYears.includes(yearStart)) setYearStart(availableYears[0])
    if (yearEnd == null || !availableYears.includes(yearEnd)) setYearEnd(availableYears[availableYears.length - 1])
  }, [availableYears, yearStart, yearEnd])

  useEffect(() => {
    if (materialFlows && materialFlows.materials.length > 0) {
      const allYears = new Set<number>()
      for (const m of materialFlows.materials) for (const y of Object.keys(m.values)) allYears.add(Number(y))
      const sorted = Array.from(allYears).sort((a, b) => a - b)
      setDetailYear(sorted[Math.floor(sorted.length / 2)] ?? sorted[0])
    }
  }, [materialFlows])

  const handleCalculate = async () => {
    if (!activeSystem?.id) return
    const fullStart = availableYears[0]
    const fullEnd = availableYears[availableYears.length - 1]
    const ys = yearStart != null && yearStart !== fullStart ? yearStart : null
    const ye = yearEnd != null && yearEnd !== fullEnd ? yearEnd : null
    await calcMaterialFlows(scope, ys, ye, groupBy)
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const fullStart = availableYears[0]
      const fullEnd = availableYears[availableYears.length - 1]
      const ys = yearStart != null && yearStart !== fullStart ? yearStart : null
      const ye = yearEnd != null && yearEnd !== fullEnd ? yearEnd : null
      await exportMatFlows(scope, ys, ye)
    } finally {
      setIsExporting(false)
    }
  }

  // ── Data transforms ──

  const years = useMemo(() => {
    if (!materialFlows) return []
    const s = new Set<number>()
    for (const m of materialFlows.materials) for (const y of Object.keys(m.values)) s.add(Number(y))
    return Array.from(s).sort((a, b) => a - b)
  }, [materialFlows])

  const materialKeys = useMemo(() => {
    if (!materialFlows) return []
    return materialFlows.materials.map((m) => m.name)
  }, [materialFlows])

  const areaData = useMemo(() => {
    if (!materialFlows || years.length === 0) return []
    return years.map((yr) => {
      const row: Record<string, number | string> = { year: yr }
      for (const m of materialFlows.materials) {
        row[m.name] = m.values[yr] ?? 0
      }
      return row
    })
  }, [materialFlows, years])

  // Determine the dominant unit for the Y-axis label
  const dominantUnit = useMemo(() => {
    if (!materialFlows || materialFlows.materials.length === 0) return ''
    const unitTotals: Record<string, number> = {}
    for (const m of materialFlows.materials) {
      const total = Object.values(m.values).reduce((a, b) => a + b, 0)
      unitTotals[m.unit] = (unitTotals[m.unit] ?? 0) + total
    }
    let best = ''
    let bestTotal = 0
    for (const [u, t] of Object.entries(unitTotals)) {
      if (t > bestTotal) { best = u; bestTotal = t }
    }
    return best
  }, [materialFlows])

  // Top materials table
  const topMaterials = useMemo(() => {
    if (!materialFlows) return []
    return materialFlows.materials.map((m) => {
      const total = Object.values(m.values).reduce((a, b) => a + b, 0)
      const yearVal = detailYear != null ? (m.values[detailYear] ?? 0) : 0
      return { ...m, total, yearVal }
    }).sort((a, b) => b.total - a.total)
  }, [materialFlows, detailYear])

  // Year detail bar data
  const yearBarData = useMemo(() => {
    if (!materialFlows || detailYear == null) return []
    return materialFlows.materials
      .map((m) => ({ name: m.name, quantity: m.values[detailYear] ?? 0, unit: m.unit }))
      .filter((d) => d.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 20)
  }, [materialFlows, detailYear])

  // Unique key that changes whenever materialFlows is replaced, forcing Recharts to fully remount
  const chartKey = useMemo(() => {
    if (!materialFlows) return ''
    return `${materialFlows.scope}-${materialFlows.group_by}-${materialFlows.elapsed_seconds}-${materialFlows.materials.length}`
  }, [materialFlows])

  // Summary
  const summary = useMemo(() => {
    if (!materialFlows || materialFlows.materials.length === 0) return null
    // Per-unit subtotals
    const unitTotals: Record<string, number> = {}
    for (const m of materialFlows.materials) {
      const total = Object.values(m.values).reduce((a, b) => a + b, 0)
      unitTotals[m.unit] = (unitTotals[m.unit] ?? 0) + total
    }
    const unitBreakdown = Object.entries(unitTotals).sort((a, b) => b[1] - a[1])
    const mixedUnits = unitBreakdown.length > 1
    // Peak year
    const yearTotals: Record<number, number> = {}
    for (const m of materialFlows.materials) {
      for (const [y, v] of Object.entries(m.values)) {
        const yr = Number(y)
        yearTotals[yr] = (yearTotals[yr] ?? 0) + v
      }
    }
    let peakYear = 0
    let peakVal = 0
    for (const [y, v] of Object.entries(yearTotals)) {
      if (v > peakVal) { peakYear = Number(y); peakVal = v }
    }
    return { unitBreakdown, mixedUnits, peakYear, peakVal, materialCount: materialFlows.materials.length }
  }, [materialFlows])

  if (!activeSystem) return null

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  const headCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)',
    color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)',
    position: 'sticky', top: 0,
  }

  const numCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Controls ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-5)', flexWrap: 'nowrap' }}>
          {/* Scope */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Scope
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {SCOPE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScope(s.value)}
                  disabled={materialFlowLoading}
                  title={s.tip}
                  style={{
                    padding: '6px 10px', borderRadius: 'var(--radius-md)',
                    cursor: materialFlowLoading ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (scope === s.value ? 'var(--mod-mfa)' : 'var(--border-default)'),
                    backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--mod-mfa) 12%, transparent)' : 'var(--bg-elevated)',
                    color: scope === s.value ? 'var(--mod-mfa)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                    opacity: materialFlowLoading ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Group by */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Group by
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {GROUP_OPTIONS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setGroupBy(g.value)}
                  disabled={materialFlowLoading}
                  style={{
                    padding: '6px 10px', borderRadius: 'var(--radius-md)',
                    cursor: materialFlowLoading ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (groupBy === g.value ? 'var(--mod-mfa)' : 'var(--border-default)'),
                    backgroundColor: groupBy === g.value ? 'color-mix(in srgb, var(--mod-mfa) 12%, transparent)' : 'var(--bg-elevated)',
                    color: groupBy === g.value ? 'var(--mod-mfa)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: groupBy === g.value ? 600 : 500,
                    opacity: materialFlowLoading ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Years */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Years
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={yearStart ?? ''}
                onChange={(e) => setYearStart(Number(e.target.value))}
                disabled={materialFlowLoading || availableYears.length === 0}
                style={{ height: 32, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>to</span>
              <select
                value={yearEnd ?? ''}
                onChange={(e) => setYearEnd(Number(e.target.value))}
                disabled={materialFlowLoading || availableYears.length === 0}
                style={{ height: 32, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
              >
                {availableYears.filter((y) => yearStart == null || y >= yearStart).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Calculate */}
          <Button
            variant="primary"
            onClick={handleCalculate}
            disabled={materialFlowLoading || !simulationResult}
            style={{ backgroundColor: 'var(--mod-mfa)', height: 36 }}
            title={simulationResult ? 'Calculate material flows' : 'Run simulation first'}
          >
            {materialFlowLoading ? (
              <>
                <Loader2 size={14} style={{ animation: 'mfp-spin 1s linear infinite' }} />
                Calculating...
              </>
            ) : (
              <>
                <BarChart3 size={14} />
                Calculate
              </>
            )}
          </Button>
        </div>

        {materialFlowLoading && (
          <div style={{ marginTop: 'var(--space-3)', height: 4, backgroundColor: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: '33%', backgroundColor: 'var(--mod-mfa)', animation: 'mfp-progress 1.6s ease-in-out infinite' }} />
          </div>
        )}

        <style>{`@keyframes mfp-spin { to { transform: rotate(360deg); } } @keyframes mfp-progress { 0% { left: -33%; } 100% { left: 100%; } }`}</style>

        {error && !materialFlowLoading && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Results ─── */}
      {materialFlows && materialFlows.materials.length > 0 && (
        <>
          {/* Export + elapsed */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {materialFlows.materials.length} series | {materialFlows.scope} | grouped by {materialFlows.group_by}
              </span>
              {materialFlows.elapsed_seconds > 0 && (
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', padding: '2px 8px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  {materialFlows.elapsed_seconds.toFixed(2)}s
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
              <Download size={14} /> {isExporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          </div>

          {/* Summary card */}
          {summary && (
            <div style={cardStyle}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Cumulative demand ({materialFlows.scope})
              </div>
              {materialFlows.stages_included.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Stages: {materialFlows.stages_included.join(', ')}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {summary.mixedUnits ? (
                  <>
                    <span style={{ fontSize: 'var(--text-lg)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-mfa)' }}>
                      {summary.unitBreakdown.map(([u, t]) => `${fmtQty(t)} ${u}`).join(' · ')}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-mfa)' }}>
                      {fmtQty(summary.unitBreakdown[0][1])}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{summary.unitBreakdown[0][0]} (total)</span>
                  </>
                )}
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 16 }}>
                  Peak in {summary.peakYear}: {fmtQty(summary.peakVal)} {dominantUnit} | {summary.materialCount} series
                </span>
              </div>
            </div>
          )}

          {/* Stacked area chart */}
          <div style={cardStyle} key={chartKey}>
            <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Material quantities over time
            </h4>
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis
                    stroke="var(--text-tertiary)"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    tickFormatter={fmtAxis}
                    label={dominantUnit ? { value: dominantUnit, angle: -90, position: 'insideLeft', style: { fill: 'var(--text-tertiary)', fontSize: 11 } } : undefined}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                    formatter={(v: number) => fmtQty(v)}
                  />
                  {materialKeys.map((k, i) => (
                    <Area
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stackId="1"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.7}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top materials table */}
          <div style={cardStyle}>
            <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Top materials
            </h4>
            <div style={{ overflow: 'auto', maxHeight: 400 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headCell}>Name</th>
                    <th style={headCell}>Unit</th>
                    {groupBy === 'material' && <th style={headCell}>Stage</th>}
                    {groupBy === 'material' && <th style={headCell}>Component</th>}
                    <th style={{ ...headCell, textAlign: 'right' }}>{detailYear ?? 'Year'}</th>
                    <th style={{ ...headCell, textAlign: 'right' }}>Total</th>
                    <th style={{ ...headCell, textAlign: 'right' }}>Evolution</th>
                  </tr>
                </thead>
                <tbody>
                  {topMaterials.slice(0, 30).map((m) => (
                    <tr key={m.name + m.unit} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{m.name}</td>
                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{m.unit}</td>
                      {groupBy === 'material' && <td style={{ padding: '6px 10px' }}>{m.stage && <Badge label={m.stage} variant="mfa" />}</td>}
                      {groupBy === 'material' && <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{m.component}</td>}
                      <td style={{ ...numCell, color: 'var(--text-primary)' }}>{fmtQty(m.yearVal)}</td>
                      <td style={{ ...numCell, color: 'var(--mod-mfa)', fontWeight: 600 }}>{fmtQty(m.total)}</td>
                      <td style={{ ...numCell }}>
                        <EvolutionBadge method={m.evolution_method} rate={m.evolution_rate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Year detail selector + bar chart */}
          {years.length > 0 && (
            <>
              <div style={{ ...cardStyle, padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                  Year detail
                </span>
                <select
                  value={detailYear ?? ''}
                  onChange={(e) => setDetailYear(Number(e.target.value))}
                  style={{ height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
                >
                  {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
                </select>
              </div>

              {yearBarData.length > 0 && (
                <div style={cardStyle}>
                  <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                    Top 20 materials in {detailYear}
                  </h4>
                  <div style={{ height: Math.max(200, yearBarData.length * 28) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={yearBarData} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 12 }}>
                        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          stroke="var(--text-tertiary)"
                          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                          tickFormatter={fmtAxis}
                        />
                        <YAxis type="category" dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={140} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                          formatter={(v: number) => fmtQty(v)}
                        />
                        <Bar dataKey="quantity" fill="var(--mod-mfa)" fillOpacity={0.85} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Empty hint */}
      {!materialFlows && !materialFlowLoading && (
        <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--bg-surface)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {simulationResult
            ? 'Choose scope and group-by, then click Calculate to see material flow quantities.'
            : 'Run a simulation first (Fleet dynamics tab), then calculate material flows here.'}
        </div>
      )}
    </div>
  )
}

function EvolutionBadge({ method, rate }: { method: string | null; rate: number | null }) {
  if (!method || method === 'fixed') return <span style={{ color: 'var(--text-tertiary)' }}>-</span>
  if (method === 'milestones') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 500, backgroundColor: 'color-mix(in srgb, var(--info) 10%, transparent)', color: 'var(--info)', borderRadius: 'var(--radius-sm)', border: '1px solid color-mix(in srgb, var(--info) 20%, transparent)' }}>
        milestones
      </span>
    )
  }
  const isRebound = method === 'rebound_effect'
  const pct = rate != null ? (rate * 100).toFixed(1) : '?'
  const sign = isRebound ? '+' : '-'
  const color = isRebound ? 'var(--warning)' : 'var(--success)'
  const Icon = isRebound ? TrendingUp : TrendingDown
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 500, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, color, borderRadius: 'var(--radius-sm)', border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
      <Icon size={12} /> {sign}{pct}%/yr
    </span>
  )
}
