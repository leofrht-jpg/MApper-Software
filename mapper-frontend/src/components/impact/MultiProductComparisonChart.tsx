// Patch 4AG.4 — comparison chart for multi-product LCA results.
//
// Shape rules (decided in pre-work, locked here):
//   - scope='all' AND every successful archetype carries stage_breakdown
//     → STACKED mode: each stage is a stacked Bar; activity items (no
//       stages) get a single 'Total' segment in the same stack.
//   - any other case (specific scope, all-activity, scope='all' but
//     archetypes lack stage_breakdown) → SOLID mode: one bar per item
//     with a single 'Total' Bar.
//
// Methods axis: items on x-axis, method picker dropdown above the
// chart. Different LCIA methods have different units (kg CO₂-eq vs.
// m³ depriv. vs. kBq U-235); putting them on the same y-axis would
// be methodologically wrong.
//
// Color conventions: stages use CHART_PALETTE positional indexing
// (matches Patch 4B StageBreakdownChart). The 'Total' segment for
// activity items uses a neutral gray to visually separate it from
// stage colors.

import { useMemo, useRef, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import type { MultiProductLCAResult } from '../../api/client'
import { CHART_PALETTE, colorFor, useChartColors } from '../../utils/chartColors'
import { shortenByCommonPrefix } from '../../utils/labelPrefix'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'

const ACTIVITY_TOTAL_KEY = '__activity_total__'
const ACTIVITY_TOTAL_COLOR = '#9ca3af'  // neutral grey to distinguish from stage colors

interface MultiProductComparisonChartProps {
  result: MultiProductLCAResult
  scope: 'inflows' | 'stock' | 'outflows' | 'all'
  /** Method label to render; parent owns the method-picker state. */
  selectedMethodLabel: string | null
}

export function MultiProductComparisonChart({
  result, scope, selectedMethodLabel,
}: MultiProductComparisonChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const format = useNumberFormatter({ notation: 'scientific', sigFigs: 3 })

  // Successful items only — failed items don't contribute bars.
  const successItems = useMemo(
    () => result.items.filter((it) => it.status === 'success'),
    [result],
  )

  // Stable per-item color (solid mode). Keyed by item_id (stable + unique per
  // vintage) — NOT the label, so display-shortening (common-prefix stripping,
  // Patch 5S) never recolors a series. Via the shared resolution (scope
  // 'multi-product'), colors don't shuffle on add/remove/reorder. Must run
  // before the early returns (Rules of Hooks).
  const itemIds = useMemo(() => successItems.map((it) => it.item_id), [successItems])
  const itemColors = useChartColors(itemIds, 'multi-product')

  // Patch 5S — display-only common-prefix shortening: when all series share a
  // leading activity string, show only the differing vintage on bars/legend and
  // surface the shared activity once as a subtitle. Degrades to full labels when
  // there's no usable common prefix. Provenance (export) is unaffected.
  const { shortened: shortLabels, shared } = useMemo(
    () => shortenByCommonPrefix(successItems.map((it) => it.label)),
    [successItems],
  )

  // Determine mode + stage list. The "every successful archetype has
  // stage_breakdown" check is conservative: a single archetype without
  // a breakdown forces solid mode for that item, so we'd need a hybrid.
  // Instead we use mixed-stack: archetypes contribute stage segments;
  // activities (and stage-less archetypes) get an ACTIVITY_TOTAL slot.
  const { stageOrder, mode } = useMemo(() => {
    const stages: string[] = []
    const seen = new Set<string>()
    let hasArchetypeStages = false
    if (scope === 'all') {
      for (const item of successItems) {
        const sb = item.archetype_result?.stage_breakdown
        if (!sb || !selectedMethodLabel) continue
        const methodStages = sb[selectedMethodLabel]
        if (!methodStages) continue
        hasArchetypeStages = true
        for (const s of Object.keys(methodStages)) {
          if (!seen.has(s)) { seen.add(s); stages.push(s) }
        }
      }
    }
    return {
      stageOrder: stages,
      mode: hasArchetypeStages ? ('stacked' as const) : ('solid' as const),
    }
  }, [successItems, scope, selectedMethodLabel])

  // Bar chart data — one row per item, columns = stage names + ACTIVITY_TOTAL_KEY.
  const chartData = useMemo(() => {
    if (!selectedMethodLabel) return []
    return successItems.map((item, i) => {
      const row: Record<string, string | number> = { name: shortLabels[i] ?? item.label, type: item.type }
      if (mode === 'stacked' && item.archetype_result?.stage_breakdown) {
        const stages = item.archetype_result.stage_breakdown[selectedMethodLabel] ?? {}
        for (const s of stageOrder) {
          row[s] = stages[s] ?? 0
        }
      } else {
        // Solid mode — single 'Total' bar. Archetype: sum of method
        // result.score. Activity: method result.score.
        const methodResults = (
          item.archetype_result?.results ?? item.activity_result?.results ?? []
        )
        const m = methodResults.find((mr) => mr.method_label === selectedMethodLabel)
        if (mode === 'stacked') {
          // Activity item in stacked mode → ACTIVITY_TOTAL slot.
          row[ACTIVITY_TOTAL_KEY] = m?.score ?? 0
        } else {
          // Pure solid mode → 'Total' slot.
          row['Total'] = m?.score ?? 0
        }
      }
      return row
    })
  }, [successItems, mode, stageOrder, selectedMethodLabel, shortLabels])

  // Unit for the selected method (for y-axis label + tooltip).
  const methodUnit = useMemo(() => {
    if (!selectedMethodLabel) return ''
    for (const item of successItems) {
      const methodResults = (
        item.archetype_result?.results ?? item.activity_result?.results ?? []
      )
      const m = methodResults.find((mr) => mr.method_label === selectedMethodLabel)
      if (m) return m.unit
    }
    return ''
  }, [successItems, selectedMethodLabel])

  if (successItems.length === 0) {
    return (
      <div
        data-testid="multi-product-chart-empty"
        style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          border: '1px dashed var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        No successful computations to display. Check the Errors section or table view.
      </div>
    )
  }

  if (!selectedMethodLabel) {
    return (
      <div
        data-testid="multi-product-chart-no-method"
        style={{
          padding: 'var(--space-4)', textAlign: 'center',
          fontSize: 11, color: 'var(--text-tertiary)',
        }}
      >
        Pick an impact method above.
      </div>
    )
  }

  return (
    <div data-testid="multi-product-chart" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
        {shared && (
          <span data-testid="multi-product-chart-subtitle" style={{ marginRight: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
            {shared}
          </span>
        )}
        <NumberFormatControl
          settings={format.settings}
          onChange={format.setSettings}
        />
        <ChartExportButton
          chartRef={chartRef}
          legendRef={legendRef}
          filename={`multi_product_comparison_${selectedMethodLabel}`}
        />
      </div>
      <ChartExportContainer ref={chartRef} style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 64 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 11 }}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => format.format(v)}
              label={{
                value: methodUnit, angle: -90, position: 'left', offset: 15,
                fontSize: 11, fill: 'var(--text-tertiary)', textAnchor: 'middle',
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
              }}
              formatter={(v, name) => {
                const label = name === ACTIVITY_TOTAL_KEY ? 'Total (activity)'
                  : name === 'Total' ? 'Total'
                  : String(name)
                return [`${format.format(Number(v))} ${methodUnit}`, label]
              }}
            />
            {mode === 'stacked' ? (
              <>
                {stageOrder.map((stage, idx) => (
                  <Bar
                    key={stage}
                    dataKey={stage}
                    stackId="x"
                    fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
                    name={stage}
                  />
                ))}
                <Bar
                  dataKey={ACTIVITY_TOTAL_KEY}
                  stackId="x"
                  fill={ACTIVITY_TOTAL_COLOR}
                  name="Total (activity)"
                />
              </>
            ) : (
              // Solid mode (activity vintages / stage-less archetypes): one bar
              // per item, each painted its own STABLE color (keyed by label).
              <Bar dataKey="Total" name="Total">
                {chartData.map((_, i) => (
                  <Cell key={i} fill={colorFor(itemColors, successItems[i].item_id, i)} />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </ChartExportContainer>

      {/* Custom legend rendered outside the chart so it can be
          included verbatim in the export image (Patch 4I/4K pattern). */}
      <div
        ref={legendRef}
        data-testid="multi-product-chart-legend"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          fontSize: 11, padding: '6px 0',
        }}
      >
        {mode === 'stacked' ? (
          <>
            {stageOrder.map((stage, idx) => (
              <span key={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  display: 'inline-block', width: 10, height: 10,
                  backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length],
                  borderRadius: 2,
                }} />
                {stage}
              </span>
            ))}
            {successItems.some((it) => it.type === 'activity') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  display: 'inline-block', width: 10, height: 10,
                  backgroundColor: ACTIVITY_TOTAL_COLOR, borderRadius: 2,
                }} />
                Total (activity items)
              </span>
            )}
          </>
        ) : (
          // Solid mode: one legend entry per item, matching its stable bar color
          // (keyed by item_id). Text uses the display-shortened label.
          successItems.map((item, idx) => (
            <span
              key={item.item_id}
              data-testid={`multi-product-legend-item-${item.item_id}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <span style={{
                display: 'inline-block', width: 10, height: 10,
                backgroundColor: colorFor(itemColors, item.item_id, idx), borderRadius: 2,
              }} />
              {shortLabels[idx] ?? item.label}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

// Suppress unused-variable warning for the empty-state branch.
void useState
