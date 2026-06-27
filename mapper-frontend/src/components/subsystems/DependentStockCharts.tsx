/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef, type RefObject } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { SimulationResult } from '../../api/client'
import { useChartColors, colorFor } from '../../utils/chartColors'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { StackedTotalTooltip } from '../charts/StackedTotalTooltip'
import { tightStackedDomain } from '../charts/yAxisDomain'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from '../charts/tooltipStyle'

// Stock counts default to fixed notation — they're integer/near-integer
// quantities (vehicles, units), so scientific is rarely useful.
const STOCK_DEFAULT = { notation: 'fixed' as const, sigFigs: 3, decimals: 0 }

interface DependentStockChartsProps {
  result: SimulationResult
  unitName?: string
}

export function DependentStockCharts({ result, unitName }: DependentStockChartsProps) {
  const { stockKeys, stockData, flowData } = useMemo(() => {
    const keys = new Set<string>()
    for (const yr of result.years) {
      for (const k of Object.keys(yr.stock)) keys.add(k)
      for (const k of Object.keys(yr.inflow)) keys.add(k)
      for (const k of Object.keys(yr.outflow)) keys.add(k)
    }
    const sortedKeys = Array.from(keys).sort()

    const stockRows = result.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const k of sortedKeys) row[k] = yr.stock[k] ?? 0
      return row
    })

    const flowRows = result.years.map((yr) => {
      const inflow = Object.values(yr.inflow).reduce((a, b) => a + b, 0)
      const outflow = Object.values(yr.outflow).reduce((a, b) => a + b, 0)
      return { year: yr.year, inflow, outflow: -outflow }
    })

    return { stockKeys: sortedKeys, stockData: stockRows, flowData: flowRows }
  }, [result])

  const colorMap = useChartColors(stockKeys)
  const stockRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)

  // Per-chart formatters; counts default to fixed.
  const stockFormat = useNumberFormatter(STOCK_DEFAULT)
  const flowFormat = useNumberFormatter(STOCK_DEFAULT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title="Stock over time (by archetype)"
        chartRef={stockRef}
        exportFilename="dependent_stock_by_archetype"
        extra={<NumberFormatControl settings={stockFormat.settings} onChange={stockFormat.setSettings} />}
      >
        <ChartExportContainer ref={stockRef} style={{ minHeight: 300, height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stockData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis domain={tightStackedDomain} stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={(v) => stockFormat.format(v as number)} />
              <Tooltip
                content={<StackedTotalTooltip unit={unitName} formatValue={stockFormat.format} />}
              />
              {stockKeys.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="1"
                  stroke={colorFor(colorMap, k, i)}
                  fill={colorFor(colorMap, k, i)}
                  fillOpacity={0.7}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartExportContainer>
      </Card>

      <Card
        title="Inflows vs outflows"
        chartRef={flowRef}
        exportFilename="dependent_inflows_outflows"
        extra={<NumberFormatControl settings={flowFormat.settings} onChange={flowFormat.setSettings} />}
      >
        <ChartExportContainer ref={flowRef} style={{ minHeight: 260, height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flowData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={(v) => flowFormat.format(v as number)} />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(v) => (typeof v === 'number' ? flowFormat.format(Math.abs(v)) : String(v))}
              />
              <Bar dataKey="inflow" fill="var(--success)" fillOpacity={0.85} isAnimationActive={false} />
              <Bar dataKey="outflow" fill="var(--danger)" fillOpacity={0.85} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartExportContainer>
      </Card>
    </div>
  )
}

function Card({ title, children, chartRef, exportFilename, extra }: {
  title: string
  children: React.ReactNode
  chartRef?: RefObject<HTMLDivElement | null>
  exportFilename?: string
  extra?: React.ReactNode
}) {
  return (
    <div style={{
      padding: 'var(--space-4)', backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {extra}
          {chartRef && exportFilename && (
            <ChartExportButton chartRef={chartRef} filename={exportFilename} />
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
