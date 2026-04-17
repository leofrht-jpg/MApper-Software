import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Download, Loader2, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { Button } from '../ui/Button'
import { useImpactStore } from '../../stores/impactStore'
import { useMFAStore } from '../../stores/mfaStore'
import { exportImpact, type ImpactCompareMethodResult } from '../../api/client'

const fmt = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
const fmtAxis = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(2)
  return String(n)
}
const fmtPct = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

const sty: React.CSSProperties = {
  height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
}

export function ComparisonPanel() {
  const { staticResult, projectedResult, compareResult, compare, error } = useImpactStore()
  const { activeSystem } = useMFAStore()
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!staticResult || !projectedResult || !activeSystem) return
    setIsExporting(true)
    try {
      const sysName = activeSystem.name.replace(/[^\w.-]+/g, '_') || 'system'
      await exportImpact(
        { result: projectedResult, compare_result: staticResult },
        `${sysName}_comparison_impact.xlsx`,
      )
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    if (staticResult && projectedResult && !compareResult) {
      void compare()
    }
  }, [staticResult, projectedResult, compareResult, compare])

  const methods = compareResult?.methods ?? []
  useEffect(() => {
    if (!selectedKey && methods.length > 0) setSelectedKey(methods[0].method.join('|'))
  }, [methods, selectedKey])

  const current = useMemo<ImpactCompareMethodResult | null>(() => {
    if (!methods.length) return null
    return methods.find((m) => m.method.join('|') === selectedKey) ?? methods[0]
  }, [methods, selectedKey])

  if (!staticResult || !projectedResult) {
    return (
      <EmptyState
        title="Comparison not ready"
        body="Run both Static LCI and Projected LCI first."
      />
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Comparison error"
        body={error}
      />
    )
  }

  if (!compareResult || !current) {
    return (
      <EmptyState
        title="Computing comparison…"
        body="Aligning years, methods, and scopes."
      />
    )
  }

  const endYear = current.points.length ? current.points[current.points.length - 1].year : null
  const direction = current.total_delta === 0 ? 'equal' : current.total_delta < 0 ? 'lower' : 'higher'
  const summaryColor = direction === 'lower' ? 'var(--success)' : direction === 'higher' ? 'var(--danger)' : 'var(--text-secondary)'
  const DirIcon = direction === 'lower' ? TrendingDown : direction === 'higher' ? TrendingUp : Minus

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header + method selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Scope: <strong style={{ color: 'var(--text-primary)' }}>{compareResult.scope}</strong> ·
          {' '}Years: <strong style={{ color: 'var(--text-primary)' }}>
            {current.points[0]?.year ?? '—'} – {endYear ?? '—'}
          </strong>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {methods.length > 1 && (
            <select style={{ ...sty, minWidth: 260 }} value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
              {methods.map((m) => (
                <option key={m.method.join('|')} value={m.method.join('|')}>
                  {m.method_label}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
            Export
          </Button>
        </div>
      </div>

      {/* Summary card */}
      <div style={{
        padding: 'var(--space-4)',
        backgroundColor: 'var(--bg-elevated)',
        border: `1px solid color-mix(in srgb, ${summaryColor} 30%, var(--border-default))`,
        borderRadius: 'var(--radius-lg)',
        display: 'flex', gap: 'var(--space-6)', alignItems: 'center',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-md)',
          backgroundColor: `color-mix(in srgb, ${summaryColor} 15%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: summaryColor,
          flexShrink: 0,
        }}>
          <DirIcon size={22} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>
            Cumulative difference ({current.method_label})
          </div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {current.total_delta >= 0 ? '+' : ''}{fmt(current.total_delta)}
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8 }}>
              {current.unit}
            </span>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: summaryColor, marginLeft: 10 }}>
              ({fmtPct(current.total_delta_pct)})
            </span>
          </div>
          {endYear != null && current.total_delta_pct != null && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              By {endYear}, projected impacts are{' '}
              <strong style={{ color: summaryColor }}>
                {Math.abs(current.total_delta_pct).toFixed(1)}% {direction}
              </strong>
              {' '}than static.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexShrink: 0 }}>
          <StatCell label="Total static" value={fmt(current.total_static)} unit={current.unit} />
          <StatCell label="Total projected" value={fmt(current.total_projected)} unit={current.unit} />
        </div>
      </div>

      {/* Chart 1: Overlay */}
      <ChartCard title="Impact per year — Static vs Projected" subtitle={current.unit}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={current.points} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
            <Tooltip content={<OverlayTooltip unit={current.unit} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="static_impact" name="Static LCI" stroke="var(--mod-lca)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="projected_impact" name="Projected LCI" stroke="var(--mod-plca)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Chart 2: Delta bars */}
      <ChartCard title="Δ per year (Projected − Static)" subtitle={`${current.unit} — green = improvement, red = worse`}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={current.points} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
            <ReferenceLine y={0} stroke="var(--text-tertiary)" />
            <Tooltip content={<DeltaTooltip unit={current.unit} />} />
            <Bar dataKey="delta" name="Δ">
              {current.points.map((p, i) => (
                <Cell key={i} fill={p.delta <= 0 ? 'var(--success)' : 'var(--danger)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Chart 3: Delta % */}
      <ChartCard title="Δ % per year" subtitle="((projected − static) / |static|) × 100">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={current.points} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <ReferenceLine y={0} stroke="var(--text-tertiary)" strokeDasharray="2 2" />
            <Tooltip content={<PctTooltip />} />
            <Line type="monotone" dataKey="delta_pct" name="Δ %" stroke="var(--mod-mfa)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

function StatCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
        {value} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>{unit}</span>
      </span>
    </div>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 'var(--space-4)',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
      flexDirection: 'column', gap: 12, color: 'var(--text-secondary)',
      fontSize: 'var(--text-sm)', textAlign: 'center', padding: 32,
    }}>
      <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 600 }}>{title}</div>
      <div>{body}</div>
    </div>
  )
}

function OverlayTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  const s = payload.find((p: any) => p.dataKey === 'static_impact')?.value ?? 0
  const p = payload.find((p: any) => p.dataKey === 'projected_impact')?.value ?? 0
  const delta = p - s
  const dColor = delta <= 0 ? 'var(--success)' : 'var(--danger)'
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ color: 'var(--mod-lca)' }}>Static: {fmt(s)} {unit}</div>
      <div style={{ color: 'var(--mod-plca)' }}>Projected: {fmt(p)} {unit}</div>
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-subtle)', color: dColor, fontWeight: 600 }}>
        Δ: {delta >= 0 ? '+' : ''}{fmt(delta)} {unit}
      </div>
    </div>
  )
}

function DeltaTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].value as number
  const pct = payload[0].payload.delta_pct as number | null
  const color = d <= 0 ? 'var(--success)' : 'var(--danger)'
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ color, fontWeight: 600 }}>Δ: {d >= 0 ? '+' : ''}{fmt(d)} {unit}</div>
      <div style={{ color: 'var(--text-secondary)' }}>{fmtPct(pct)}</div>
    </div>
  )
}

function PctTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const v = payload[0].value as number | null
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ color: 'var(--text-primary)' }}>{fmtPct(v)}</div>
    </div>
  )
}
