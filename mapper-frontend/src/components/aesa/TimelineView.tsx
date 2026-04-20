import { useMemo, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { CarbonBudgetConfig, SustainabilityRatioResult } from '../../api/client'
import { ZONE_COLOR, shortPbName } from './zones'

interface Props {
  results: SustainabilityRatioResult[]
  carbonBudget?: CarbonBudgetConfig | null
}

const PALETTE = [
  'var(--mod-aesa)', '#60A5FA', '#A78BFA', '#F59E0B', '#F87171', '#34D399',
  '#22D3EE', '#E879F9', '#FB923C', '#A3E635', '#F472B6', '#FCD34D',
  '#10B981', '#6366F1', '#FDBA74', '#06B6D4',
]

export function TimelineView({ results, carbonBudget }: Props) {
  const [logScale, setLogScale] = useState(false)

  const { data, pbs } = useMemo(() => {
    const pbMap = new Map<string, string>()
    const yearSet = new Set<number>()
    for (const r of results) {
      if (!pbMap.has(r.pb_id)) pbMap.set(r.pb_id, r.pb_name)
      yearSet.add(r.year)
    }
    const pbArr = Array.from(pbMap.entries()).map(([id, name]) => ({ id, name }))
    const years = Array.from(yearSet).sort((a, b) => a - b)
    const byKey = new Map<string, number | null>()
    for (const r of results) byKey.set(`${r.year}|${r.pb_id}`, r.sr)
    const rows = years.map((y) => {
      const row: Record<string, number | string> = { year: y }
      for (const p of pbArr) {
        const v = byKey.get(`${y}|${p.id}`)
        if (v === undefined || v === null) continue // gap for depleted / missing
        row[p.id] = logScale ? Math.max(v, 1e-6) : v
      }
      return row
    })
    return { data: rows, pbs: pbArr }
  }, [results, logScale])

  if (!data.length) {
    return (
      <div style={{ padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
        No results
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
          Log scale
        </label>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="var(--text-tertiary)"
            tick={{ fontSize: 11 }}
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? [0.01, 'auto'] : [0, 'auto']}
            allowDataOverflow
            tickFormatter={(v: number) => v.toFixed(2)}
            label={{ value: 'SR', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--text-tertiary)' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
            }}
            formatter={(v: number, name) => {
              const p = pbs.find((x) => x.id === name)
              return [v.toFixed(3), p?.name ?? name]
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => shortPbName(pbs.find((b) => b.id === value)?.name ?? String(value))}
          />
          <ReferenceLine
            y={1.0}
            stroke={ZONE_COLOR.safe}
            strokeDasharray="4 4"
            label={{ value: 'SR=1.0 (safe)', position: 'insideTopRight', fontSize: 10, fill: ZONE_COLOR.safe }}
          />
          <ReferenceLine
            y={2.0}
            stroke={ZONE_COLOR.zone_of_uncertainty}
            strokeDasharray="4 4"
            label={{ value: 'SR=2.0 (uncertainty)', position: 'insideTopRight', fontSize: 10, fill: ZONE_COLOR.zone_of_uncertainty }}
          />
          {pbs.map((p, idx) => (
            <Line
              key={p.id}
              dataKey={p.id}
              type="monotone"
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={1.75}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {carbonBudget && <CarbonBudgetInset budget={carbonBudget} />}
    </div>
  )
}

function CarbonBudgetInset({ budget }: { budget: CarbonBudgetConfig }) {
  const { depletionYear, series, totalAllocated } = useMemo(() => {
    const years = Object.keys(budget.projected_emissions)
      .map(Number)
      .filter((y) => y >= budget.start_year && y <= budget.end_year)
      .sort((a, b) => a - b)
    let cum = 0
    const pts = years.map((y) => {
      cum += budget.projected_emissions[y] ?? 0
      return { year: y, used: cum, remaining: Math.max(0, budget.initial_budget_gt - cum) }
    })
    const deplete = pts.find((p) => p.used >= budget.initial_budget_gt)
    return { depletionYear: deplete?.year ?? null, series: pts, totalAllocated: cum }
  }, [budget])

  return (
    <div style={{
      padding: '10px 12px',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--bg-elevated)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        }}>
          Carbon budget depletion
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {budget.initial_budget_gt} Gt · {budget.ssp_scenario}
          {depletionYear && (
            <span style={{ color: 'var(--danger)', marginLeft: 6 }}>
              depleted ~{depletionYear}
            </span>
          )}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={series} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 10 }} />
          <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 10 }} />
          <ReferenceLine y={budget.initial_budget_gt} stroke="var(--danger)" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="used" stroke="var(--mod-aesa)" strokeWidth={1.5} dot={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
            }}
            formatter={(v: number) => [`${v.toFixed(1)} Gt`, 'Cumulative']}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
        Total allocated over horizon: {totalAllocated.toFixed(1)} Gt · {budget.budget_source}
      </div>
    </div>
  )
}
