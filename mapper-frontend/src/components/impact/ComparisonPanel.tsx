/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Download, Loader2, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { Button } from '../ui/Button'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { useImpactStore } from '../../stores/impactStore'
import { useDSMStore } from '../../stores/dsmStore'
import { exportImpact, type ImpactCompareMethodResult } from '../../api/client'

const fmt = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
const fmtPct = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

const sty: React.CSSProperties = {
  height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
}

function ComparisonPanelImpl() {
  const {
    staticResult, projectedResult, projectedMultiResult, compareResult, compare, error,
    pairedScenarioOrder, pairedScenarioRuns, activePairedScenario, selectPairedScenario,
    staticDsmScenarioOrder, staticDsmScenarioRuns, activeStaticDsmScenario, selectStaticDsmScenario,
    projectedDsmScenarioOrder, projectedDsmScenarioRuns, activeProjectedDsmScenario, selectProjectedDsmScenario,
  } = useImpactStore()
  const isMultiProjected = !!projectedMultiResult && projectedMultiResult.scenarios.length > 1
  const isPairedProjected = pairedScenarioOrder.length > 1
  const isMultiDsmStatic = staticDsmScenarioOrder.length > 1
  const isMultiDsmProjected = projectedDsmScenarioOrder.length > 1
  // Multi-DSM-on-both-sides paired interpretation (Patch 2G): when both
  // Static and Projected ran multi-DSM, the comparison's load-bearing axis
  // stays "Static-vs-Projected"; DSM scenario is the alignment dimension.
  // The user picks one DSM scenario via the tab bar; we swap both sides to
  // that scenario and re-run compare(). Independent DSM scenarios per side
  // would make the comparison ambiguous — see CLAUDE.md anti-pattern.
  const isMultiDsmBoth = isMultiDsmStatic && isMultiDsmProjected
  const { activeSystem } = useDSMStore()
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [isExporting, setIsExporting] = useState(false)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const overlayRef = useRef<HTMLDivElement>(null)
  const deltaRef = useRef<HTMLDivElement>(null)
  const deltaPctRef = useRef<HTMLDivElement>(null)

  // DSM-keyed intersection (Patch 2G). Two cases produce a tab bar:
  //
  //   (a) multi-DSM Static × multi-DSM Projected — intersect the two
  //       per-side ordered lists; selecting a tab swaps both sides via
  //       the per-side selectors.
  //   (b) paired Projected × multi-DSM Static (legacy 2F.2) — intersect
  //       the paired DSM ids with the Static-side DSM ids; selecting a
  //       tab swaps Static via selectStaticDsmScenario and Projected
  //       via selectPairedScenario.
  //
  // The non-tab cases (single on one side, mixed paired+single, etc.)
  // bypass the intersection logic entirely.
  const pairedDsmIds = useMemo(
    () => new Set(
      pairedScenarioOrder.map((k) => pairedScenarioRuns[k]?.dsmScenarioId).filter(Boolean) as string[],
    ),
    [pairedScenarioOrder, pairedScenarioRuns],
  )

  const commonDsmIds = useMemo(() => {
    if (isMultiDsmBoth) {
      const projSet = new Set(projectedDsmScenarioOrder)
      return staticDsmScenarioOrder.filter((id) => projSet.has(id))
    }
    if (isPairedProjected && isMultiDsmStatic) {
      return staticDsmScenarioOrder.filter((id) => pairedDsmIds.has(id))
    }
    return [] as string[]
  }, [isMultiDsmBoth, isPairedProjected, isMultiDsmStatic, staticDsmScenarioOrder, projectedDsmScenarioOrder, pairedDsmIds])

  // Static-only / projected-only ids surfaced in the inline note. Paired
  // case: "projected-only" reads from pairedDsmIds rather than
  // projectedDsmScenarioOrder.
  const staticOnlyDsmIds = useMemo(() => {
    if (isMultiDsmBoth) {
      const projSet = new Set(projectedDsmScenarioOrder)
      return staticDsmScenarioOrder.filter((id) => !projSet.has(id))
    }
    if (isPairedProjected && isMultiDsmStatic) {
      return staticDsmScenarioOrder.filter((id) => !pairedDsmIds.has(id))
    }
    return [] as string[]
  }, [isMultiDsmBoth, isPairedProjected, isMultiDsmStatic, staticDsmScenarioOrder, projectedDsmScenarioOrder, pairedDsmIds])

  const projectedOnlyDsmIds = useMemo(() => {
    if (isMultiDsmBoth) {
      const staticSet = new Set(staticDsmScenarioOrder)
      return projectedDsmScenarioOrder.filter((id) => !staticSet.has(id))
    }
    if (isPairedProjected && isMultiDsmStatic) {
      const staticSet = new Set(staticDsmScenarioOrder)
      return Array.from(pairedDsmIds).filter((id) => !staticSet.has(id))
    }
    return [] as string[]
  }, [isMultiDsmBoth, isPairedProjected, isMultiDsmStatic, staticDsmScenarioOrder, projectedDsmScenarioOrder, pairedDsmIds])

  const findPairKeyByDsmId = (dsmId: string): string | null => {
    for (const k of pairedScenarioOrder) {
      if (pairedScenarioRuns[k]?.dsmScenarioId === dsmId) return k
    }
    return null
  }
  const onPickComparisonDsm = (dsmId: string) => {
    selectStaticDsmScenario(dsmId)
    if (isMultiDsmBoth) {
      selectProjectedDsmScenario(dsmId)
    } else if (isPairedProjected) {
      const pk = findPairKeyByDsmId(dsmId)
      if (pk) selectPairedScenario(pk)
    }
  }

  // Look up a human-readable label for an id, preferring the side that
  // has it. Static side first (Static is the "anchor" axis on Comparison),
  // then projected, then paired.
  const dsmScenarioLabelFor = (id: string): string => {
    return staticDsmScenarioRuns[id]?.scenarioName
      ?? projectedDsmScenarioRuns[id]?.scenarioName
      ?? (() => {
        for (const k of pairedScenarioOrder) {
          const r = pairedScenarioRuns[k]
          if (r?.dsmScenarioId === id) return r.dsmScenarioName
        }
        return id
      })()
  }

  // Per-chart formatters. overlayFormat covers headline, StatCells, and the
  // Static-vs-Projected line chart. deltaFormat covers the Δ-per-year bar chart.
  // The Δ% line chart uses percent-only formatting (no control needed).
  const overlayFormat = useNumberFormatter()
  const deltaFormat = useNumberFormatter()

  const handleExport = async () => {
    if (!staticResult || !projectedResult || !activeSystem) return
    setIsExporting(true)
    try {
      const sysName = activeSystem.name.replace(/[^\w.-]+/g, '_') || 'system'
      // When Comparison runs against a tab-bar-selected DSM scenario,
      // embed the scenario in the filename so re-exports across tabs
      // produce distinct files. Per-tab; the user re-clicks to export
      // each scenario.
      const activeDsmIdForName = isMultiDsmBoth
        ? activeStaticDsmScenario
        : (isPairedProjected && isMultiDsmStatic
          ? (pairedScenarioRuns[activePairedScenario ?? '']?.dsmScenarioId ?? null)
          : null)
      const dsmTag = activeDsmIdForName
        ? `_${dsmScenarioLabelFor(activeDsmIdForName).replace(/[^\w.-]+/g, '_')}`
        : ''
      await exportImpact(
        { result: projectedResult, compare_result: staticResult },
        `${sysName}_comparison${dsmTag}_impact.xlsx`,
      )
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    // Multi-DSM both sides: only compare when the two active ids are equal
    // and inside commonDsmIds (the tab bar's switch handler keeps them
    // aligned).
    const multiDsmBothReady = isMultiDsmBoth
      ? (commonDsmIds.length > 0
        && activeStaticDsmScenario != null
        && activeStaticDsmScenario === activeProjectedDsmScenario
        && commonDsmIds.includes(activeStaticDsmScenario))
      : true
    // Paired × multi-DSM-static: only compare when the active DSM scenario
    // is one of the common ids (otherwise the two sides aren't aligned).
    const pairedReady = isPairedProjected
      ? (isMultiDsmStatic && commonDsmIds.length > 0
        && activePairedScenario != null
        && commonDsmIds.includes(pairedScenarioRuns[activePairedScenario]?.dsmScenarioId ?? ''))
      : true
    if (
      staticResult && projectedResult && !compareResult && !isMultiProjected
      && multiDsmBothReady && pairedReady
    ) {
      void compare()
    }
  }, [
    staticResult, projectedResult, compareResult, compare, isMultiProjected,
    isPairedProjected, isMultiDsmStatic, isMultiDsmBoth, commonDsmIds,
    activeStaticDsmScenario, activeProjectedDsmScenario,
    activePairedScenario, pairedScenarioRuns,
  ])

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
        body="Run both Static Background and Prospective Background first."
      />
    )
  }

  if (isMultiProjected) {
    return (
      <EmptyState
        title="Comparison unavailable for multi-scenario LCI"
        body="The Prospective Background run includes multiple SSP × IAM scenarios. Re-run Prospective Background with a single scenario to enable Static vs Prospective comparison."
      />
    )
  }

  // Paired projected × single static: no DSM dimension on the static side
  // to align with — surface guidance to run a multi-DSM static covering
  // the same DSM scenarios as the pair list.
  if (isPairedProjected && !isMultiDsmStatic) {
    return (
      <EmptyState
        title="Comparison needs multi-DSM static run"
        body="Prospective Background is paired (DSM × LCI). To compare against static, re-run Static Background with the same DSM scenarios selected (multi-DSM)."
      />
    )
  }

  // Paired projected × multi-DSM static, but no shared DSM scenario.
  if (isPairedProjected && isMultiDsmStatic && commonDsmIds.length === 0) {
    return (
      <EmptyState
        title="No matching DSM scenarios"
        body="Static and Projected runs don't share a DSM scenario. Re-run one of them so they overlap on at least one DSM scenario."
      />
    )
  }

  // Multi-DSM both sides, fully disjoint — empty intersection.
  if (isMultiDsmBoth && commonDsmIds.length === 0) {
    return (
      <EmptyState
        title="No comparable DSM scenarios"
        body="Static and Projected must share at least one DSM scenario."
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

  const activeDsmId = isMultiDsmBoth
    ? activeStaticDsmScenario
    : isPairedProjected
      ? (pairedScenarioRuns[activePairedScenario ?? '']?.dsmScenarioId ?? null)
      : null
  const showDsmTabBar = (isMultiDsmBoth || (isPairedProjected && isMultiDsmStatic))
    && commonDsmIds.length > 0
  const hasNonIntersection = staticOnlyDsmIds.length > 0 || projectedOnlyDsmIds.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* DSM-scenario tab bar — paired×multi-DSM-static and multi-DSM-both
          intersection (Patch 2G). Switching swaps both sides via the
          appropriate selectors so Comparison stays aligned. */}
      {showDsmTabBar && (
        <div data-testid="comparison-dsm-tab-bar" style={{
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          padding: '6px 10px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            marginRight: 4,
          }}>
            DSM scenario
          </span>
          {commonDsmIds.map((dsmId) => {
            const active = activeDsmId === dsmId
            return (
              <button
                key={dsmId}
                onClick={() => onPickComparisonDsm(dsmId)}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--mod-dsm)' : 'var(--border-default)'),
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)'
                    : 'var(--bg-elevated)',
                  color: active ? 'var(--mod-dsm)' : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
                }}
              >
                {dsmScenarioLabelFor(dsmId)}
              </button>
            )
          })}
        </div>
      )}

      {/* Non-intersection note: list ids that ran on only one side. */}
      {showDsmTabBar && hasNonIntersection && (
        <div data-testid="comparison-non-intersection-note" style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          padding: '6px 10px',
          backgroundColor: 'color-mix(in srgb, var(--warning) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border-subtle))',
          borderRadius: 'var(--radius-md)',
        }}>
          Showing {commonDsmIds.length} intersecting DSM scenario{commonDsmIds.length === 1 ? '' : 's'}.
          {staticOnlyDsmIds.length > 0 && (
            <> {staticOnlyDsmIds.map(dsmScenarioLabelFor).join(', ')} computed only on Static.</>
          )}
          {projectedOnlyDsmIds.length > 0 && (
            <> {projectedOnlyDsmIds.map(dsmScenarioLabelFor).join(', ')} computed only on Projected.</>
          )}
          {' '}Re-run with matching DSM scenarios to compare these.
        </div>
      )}

      {/* Results — collapsible (Patch 2I). Tab bar + non-intersection note
          stay above this so scenario switching remains possible while
          Results is collapsed. */}
      <CollapsibleCard
        expanded={resultsExpanded}
        onToggle={() => setResultsExpanded((v) => !v)}
        title="Results"
        summary={!resultsExpanded ? (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            Cumulative difference: {current.total_delta >= 0 ? '+' : ''}
            {overlayFormat.format(current.total_delta)} {current.unit}
            {current.total_delta_pct != null && <> ({fmtPct(current.total_delta_pct)})</>}
            {showDsmTabBar && <> · {commonDsmIds.length} comparable scenario{commonDsmIds.length === 1 ? '' : 's'}</>}
          </span>
        ) : undefined}
        actions={
          <>
            {methods.length > 1 && (
              <select
                style={{ ...sty, minWidth: 260 }}
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
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
          </>
        }
      >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Scope: <strong style={{ color: 'var(--text-primary)' }}>{compareResult.scope}</strong> ·
        {' '}Years: <strong style={{ color: 'var(--text-primary)' }}>
          {current.points[0]?.year ?? '—'} – {endYear ?? '—'}
        </strong>
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
            {current.total_delta >= 0 ? '+' : ''}{overlayFormat.format(current.total_delta)}
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
          <StatCell label="Total static" value={overlayFormat.format(current.total_static)} unit={current.unit} />
          <StatCell label="Total projected" value={overlayFormat.format(current.total_projected)} unit={current.unit} />
        </div>
      </div>

      {/* Chart 1: Overlay */}
      <ChartCard
        title="Impact per year — Static vs Projected"
        subtitle={current.unit}
        chartRef={overlayRef}
        exportFilename={`impact_overlay_${current.method.join('_')}`}
        extra={<NumberFormatControl settings={overlayFormat.settings} onChange={overlayFormat.setSettings} />}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={current.points} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} tickFormatter={(v) => overlayFormat.format(v as number)} />
            <Tooltip content={<OverlayTooltip unit={current.unit} fmtValue={overlayFormat.format} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="static_impact" name="Static Background" stroke="var(--mod-lca)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="projected_impact" name="Prospective Background" stroke="var(--mod-plca)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Chart 2: Delta bars */}
      <ChartCard
        title="Δ per year (Projected − Static)"
        subtitle={`${current.unit} — green = improvement, red = worse`}
        chartRef={deltaRef}
        exportFilename={`impact_delta_${current.method.join('_')}`}
        extra={<NumberFormatControl settings={deltaFormat.settings} onChange={deltaFormat.setSettings} />}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={current.points} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} tickFormatter={(v) => deltaFormat.format(v as number)} />
            <ReferenceLine y={0} stroke="var(--text-tertiary)" />
            <Tooltip content={<DeltaTooltip unit={current.unit} fmtValue={deltaFormat.format} />} />
            <Bar dataKey="delta" name="Δ">
              {current.points.map((p, i) => (
                <Cell key={i} fill={p.delta <= 0 ? 'var(--success)' : 'var(--danger)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Chart 3: Delta % */}
      <ChartCard
        title="Δ % per year"
        subtitle="((projected − static) / |static|) × 100"
        chartRef={deltaPctRef}
        exportFilename={`impact_delta_pct_${current.method.join('_')}`}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={current.points} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <ReferenceLine y={0} stroke="var(--text-tertiary)" strokeDasharray="2 2" />
            <Tooltip content={<PctTooltip />} />
            <Line type="monotone" dataKey="delta_pct" name="Δ %" stroke="var(--mod-dsm)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      </div>
      </CollapsibleCard>
    </div>
  )
}

// memo skips re-renders cascading from the parent ImpactAssessment when only
// activeTab/libraryOpen flip. Pairs with the visibility-toggle pattern in
// pages/ImpactAssessment.tsx.
export const ComparisonPanel = memo(ComparisonPanelImpl)

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

function ChartCard({ title, subtitle, children, chartRef, exportFilename, extra }: {
  title: string
  subtitle?: string
  children: React.ReactNode
  chartRef?: RefObject<HTMLDivElement | null>
  exportFilename?: string
  extra?: React.ReactNode
}) {
  return (
    <div style={{
      padding: 'var(--space-4)',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{subtitle}</div>}
          {extra}
          {chartRef && exportFilename && (
            <ChartExportButton chartRef={chartRef} filename={exportFilename} />
          )}
        </div>
      </div>
      {chartRef ? <ChartExportContainer ref={chartRef}>{children}</ChartExportContainer> : children}
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

function OverlayTooltip({ active, payload, label, unit, fmtValue }: any) {
  if (!active || !payload?.length) return null
  const s = payload.find((p: any) => p.dataKey === 'static_impact')?.value ?? 0
  const p = payload.find((p: any) => p.dataKey === 'projected_impact')?.value ?? 0
  const delta = p - s
  const dColor = delta <= 0 ? 'var(--success)' : 'var(--danger)'
  const f: (n: number) => string = fmtValue ?? fmt
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ color: 'var(--mod-lca)' }}>Static: {f(s)} {unit}</div>
      <div style={{ color: 'var(--mod-plca)' }}>Projected: {f(p)} {unit}</div>
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-subtle)', color: dColor, fontWeight: 600 }}>
        Δ: {delta >= 0 ? '+' : ''}{f(delta)} {unit}
      </div>
    </div>
  )
}

function DeltaTooltip({ active, payload, label, unit, fmtValue }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].value as number
  const pct = payload[0].payload.delta_pct as number | null
  const color = d <= 0 ? 'var(--success)' : 'var(--danger)'
  const f: (n: number) => string = fmtValue ?? fmt
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ color, fontWeight: 600 }}>Δ: {d >= 0 ? '+' : ''}{f(d)} {unit}</div>
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
