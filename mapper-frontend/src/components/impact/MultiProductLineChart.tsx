/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 5S — Line view for the multi-item comparison (Activities/vintage mode).
//
// Thin sibling to the Bar chart (MultiProductComparisonChart). It is NOT
// MultiScenarioImpactChart (that consumes cohort-aware ImpactAssessmentResult)
// nor ProjectedTimeSeriesChart (its runs carry ArchetypeLCAResult + it lives in
// the single-item tab). This reuses the SHARED primitives — SCENARIO_PALETTE,
// ChartExportButton/Container, native-SVG legend, NumberFormatControl, 5O-style
// clickable per-series visibility — rather than duplicating a charting stack.
//
// Model (anti-pattern guard, CLAUDE.md): the Line view is PER-SCENARIO over
// years, NOT per-item. Series are grouped by (base_database + iam + ssp) read
// from the structured vintage coords (Patch 5R `ActivityVintageMeta`, joined to
// result items by item_id) — never by string-parsing the label. Each premise
// vintage item contributes one (year, score) point to its scenario's line. The
// static (ecoinvent) vintage has no year/ssp → rendered as a labeled horizontal
// reference line.

import { useMemo, useRef, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type TooltipContentProps,
} from 'recharts'
import type { MultiProductLCAResult } from '../../api/client'
import { SCENARIO_PALETTE } from '../../utils/chartColors'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'

export interface VintageCoord {
  label: string
  database: string
  base_database?: string | null
  iam?: string | null
  ssp?: string | null
  year?: number | null
}

interface Props {
  result: MultiProductLCAResult
  /** Structured vintage coords keyed by item_id ("{database}|{code}"). */
  vintageCoords: Record<string, VintageCoord>
  selectedMethodLabel: string | null
  filenameBase: string
  /** Shared activity caption (e.g. "electricity, low voltage · DK · kWh"). */
  subtitle?: string
}

function scenarioColor(idx: number): string {
  return SCENARIO_PALETTE[idx % SCENARIO_PALETTE.length]
}

function scoreFor(item: MultiProductLCAResult['items'][number], methodLabel: string): number | null {
  const results = item.archetype_result?.results ?? item.activity_result?.results ?? []
  const m = results.find((r) => r.method_label === methodLabel)
  return m ? m.score : null
}

export interface VintageLineSeries {
  label: string
  color: string
  originalIdx: number
  points: { year: number; value: number }[]
}

export interface VintageLineModel {
  scenarios: VintageLineSeries[]
  staticLines: { label: string; value: number }[]
  years: number[]
  unit: string
}

// Pure model builder (jsdom-testable, no layout). PER-SCENARIO over years:
// groups premise vintages by (base+iam+ssp); the static (no ssp/year) vintage
// becomes a reference line. Series colored by ORIGINAL sorted index (stable
// under display toggling). NEVER string-parses labels — reads structured coords.
export function buildVintageLineModel(
  items: MultiProductLCAResult['items'],
  vintageCoords: Record<string, VintageCoord>,
  selectedMethodLabel: string | null,
): VintageLineModel {
  const success = items.filter((it) => it.status === 'success')
  const iams = new Set<string>()
  for (const it of success) {
    const c = vintageCoords[it.item_id]
    if (c?.iam && c.ssp && c.year != null) iams.add(c.iam)
  }
  const prefixIam = iams.size > 1

  const scenarioMap = new Map<string, { label: string; points: Map<number, number> }>()
  const staticLines: { label: string; value: number }[] = []
  let unit = ''
  for (const it of success) {
    const c = vintageCoords[it.item_id]
    const v = selectedMethodLabel ? scoreFor(it, selectedMethodLabel) : null
    if (v == null) continue
    const results = it.activity_result?.results ?? it.archetype_result?.results ?? []
    const mr = results.find((r) => r.method_label === selectedMethodLabel)
    if (mr) unit = mr.unit
    if (c && c.ssp && c.year != null) {
      const key = `${c.base_database ?? ''}|${c.iam ?? ''}|${c.ssp}`
      const label = prefixIam && c.iam ? `${c.iam}/${c.ssp}` : c.ssp
      if (!scenarioMap.has(key)) scenarioMap.set(key, { label, points: new Map() })
      scenarioMap.get(key)!.points.set(c.year, v)
    } else {
      staticLines.push({ label: c?.label || it.label, value: v })
    }
  }

  const scenarios: VintageLineSeries[] = Array.from(scenarioMap.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((s, idx) => ({
      label: s.label,
      color: scenarioColor(idx),
      originalIdx: idx,
      points: Array.from(s.points.entries())
        .sort(([a], [b]) => a - b)
        .map(([year, value]) => ({ year, value })),
    }))

  const yearSet = new Set<number>()
  for (const s of scenarios) for (const p of s.points) yearSet.add(p.year)
  const years = Array.from(yearSet).sort((a, b) => a - b)

  return { scenarios, staticLines, years, unit }
}

export function MultiProductLineChart({
  result, vintageCoords, selectedMethodLabel, filenameBase, subtitle,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const format = useNumberFormatter({ notation: 'scientific', sigFigs: 3 })
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const { scenarios, staticLines, rows, unit, years } = useMemo(() => {
    const model = buildVintageLineModel(result.items, vintageCoords, selectedMethodLabel)
    // Recharts rows: one per year, one numeric key per scenario label. Missing
    // points → null so connectNulls=false leaves gaps (no interpolation).
    const rows = model.years.map((year) => {
      const row: Record<string, number | null> = { year }
      for (const s of model.scenarios) {
        const pt = s.points.find((p) => p.year === year)
        row[s.label] = pt ? pt.value : null
      }
      return row
    })
    return { ...model, rows }
  }, [result, vintageCoords, selectedMethodLabel])

  if (!selectedMethodLabel) {
    return (
      <div data-testid="multi-product-line-no-method" style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)' }}>
        Pick an impact method above.
      </div>
    )
  }

  const visibleScenarios = scenarios.filter((s) => !hidden.has(s.label))
  const allHidden = scenarios.length > 0 && visibleScenarios.length === 0

  const toggle = (label: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(label)) next.delete(label); else next.add(label)
    return next
  })

  const CustomTooltip = ({ active, payload, label }: Partial<TooltipContentProps<number, string>>) => {
    if (!active || !payload || payload.length === 0) return null
    const sorted = [...payload].filter((p) => p.value != null).sort((a, b) => (b.value as number) - (a.value as number))
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 11, padding: '6px 8px' }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
        {sorted.map((p) => (
          <div key={String(p.dataKey)} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
            <span>{String(p.dataKey)}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{format.format(p.value as number)} {unit}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div data-testid="multi-product-line-chart" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {subtitle && (
          <span data-testid="multi-product-line-subtitle" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{subtitle}</span>
        )}
        <span style={{ flex: 1 }} />
        <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
        <ChartExportButton chartRef={chartRef} legendRef={legendRef} filename={`${filenameBase}_line`} />
      </div>

      {allHidden ? (
        <div data-testid="multi-product-line-all-hidden" style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
          All scenarios hidden — click a legend entry to show one.
        </div>
      ) : (
        <ChartExportContainer ref={chartRef} style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 64 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="year" type="category" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
              <YAxis
                stroke="var(--text-tertiary)" tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => format.format(v)}
                label={{ value: unit, angle: -90, position: 'left', offset: 15, fontSize: 11, fill: 'var(--text-tertiary)', textAnchor: 'middle' }}
              />
              <Tooltip content={<CustomTooltip />} />
              {/* Static (ecoinvent) vintages → labeled horizontal reference lines. */}
              {staticLines.map((s) => (
                <ReferenceLine
                  key={s.label} y={s.value} stroke="var(--text-tertiary)" strokeDasharray="5 4"
                  label={{ value: s.label, position: 'right', fontSize: 10, fill: 'var(--text-tertiary)' }}
                />
              ))}
              {/* One line per VISIBLE scenario; colored by ORIGINAL index so
                  hiding one never recolors the others. Gaps (connectNulls=false)
                  for sparse years — no interpolation across missing years. */}
              {visibleScenarios.map((s) => (
                <Line
                  key={s.label} type="monotone" dataKey={s.label}
                  stroke={s.color} strokeWidth={2} dot connectNulls={false} isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartExportContainer>
      )}

      {/* Native-SVG-friendly legend. Visible entries live inside legendRef (the
          export reads only these → export = visible only, per Patch 5O). Hidden
          (toggle-back) entries render in a SIBLING outside the ref. Colors
          resolve from the ORIGINAL scenario index — stable under toggling. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, padding: '6px 0' }}>
        <div ref={legendRef} data-testid="multi-product-line-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {scenarios.filter((s) => !hidden.has(s.label)).map((s) => (
            <button
              key={s.label} type="button"
              data-testid={`multi-product-line-legend-item-${s.label}`}
              aria-pressed="true"
              onClick={() => toggle(s.label)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 11 }}
            >
              <span style={{ display: 'inline-block', width: 10, height: 10, background: s.color, borderRadius: 2 }} />
              {s.label}
            </button>
          ))}
        </div>
        {scenarios.some((s) => hidden.has(s.label)) && (
          <div data-testid="multi-product-line-legend-hidden" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {scenarios.filter((s) => hidden.has(s.label)).map((s) => (
              <button
                key={s.label} type="button"
                data-testid={`multi-product-line-legend-item-${s.label}`}
                aria-pressed="false"
                onClick={() => toggle(s.label)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', textDecoration: 'line-through', fontSize: 11 }}
              >
                <span style={{ display: 'inline-block', width: 10, height: 10, background: s.color, borderRadius: 2, opacity: 0.4 }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Year-count caption (helps when the gating is borderline). */}
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
        {scenarios.length} scenario{scenarios.length === 1 ? '' : 's'} · {years.length} year{years.length === 1 ? '' : 's'}
        {staticLines.length > 0 ? ` · ${staticLines.length} static reference${staticLines.length === 1 ? '' : 's'}` : ''}
      </span>
    </div>
  )
}
