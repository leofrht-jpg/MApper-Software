import { useMemo } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { AESAYearResult } from '../../api/client'

interface RatioTimelineProps {
  years: AESAYearResult[]
}

const palette = [
  'var(--mod-aesa)',
  'var(--mod-lca)',
  'var(--mod-mfa)',
  'var(--mod-plca)',
  '#60A5FA',
  '#F472B6',
  '#A3E635',
  '#FCD34D',
  '#FB7185',
  '#22D3EE',
]

export function RatioTimeline({ years }: RatioTimelineProps) {
  const { data, boundaries } = useMemo(() => {
    const bmap = new Map<string, string>()
    for (const y of years) {
      for (const i of y.indicators) {
        if (!bmap.has(i.boundary_id)) bmap.set(i.boundary_id, i.boundary_name)
      }
    }
    const bids = Array.from(bmap.keys())
    const rows = years.map((y) => {
      const row: Record<string, number | string> = { year: y.year }
      for (const i of y.indicators) row[i.boundary_id] = i.ratio
      return row
    })
    return { data: rows, boundaries: bids.map((id) => ({ id, name: bmap.get(id) ?? id })) }
  }, [years])

  if (!data.length) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--text-xs)',
        textAlign: 'center',
      }}>
        No ratio data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
        <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
        <YAxis
          stroke="var(--text-tertiary)"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => v.toFixed(1)}
          label={{ value: 'Ratio', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--text-tertiary)' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
          }}
          formatter={(v: number, name) => {
            const b = boundaries.find((x) => x.id === name)
            return [v.toFixed(3), b?.name ?? name]
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          formatter={(value) => boundaries.find((b) => b.id === value)?.name ?? value}
        />
        <ReferenceLine y={0.8} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: 'Caution (0.8)', position: 'insideBottomRight', fontSize: 10, fill: 'var(--warning)' }} />
        <ReferenceLine y={1.0} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: 'Boundary (1.0)', position: 'insideTopRight', fontSize: 10, fill: 'var(--danger)' }} />
        {boundaries.map((b, idx) => (
          <Line
            key={b.id}
            dataKey={b.id}
            type="monotone"
            stroke={palette[idx % palette.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
