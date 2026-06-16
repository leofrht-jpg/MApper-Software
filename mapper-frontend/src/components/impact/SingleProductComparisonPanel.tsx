import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useSingleProductImpactStore } from '../../stores/singleProductImpactStore'
import { useNumberFormatter } from '../charts/numberFormat'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import {
  ComparisonReferenceLineChart,
  ComparisonDeltaChart,
} from '../charts/ComparisonReferenceLineChart'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ViewToggle } from './ViewToggle'
import { MethodSelector } from './MethodSelector'
import { exportSingleProductComparison } from '../../api/client'

interface Props {
  archetypeId: string | null
}

interface MethodDelta {
  methodKey: string
  methodLabel: string
  unit: string
  staticScore: number
  perScenario: Array<{
    dbName: string
    year: number | null
    iam: string
    ssp: string
    projectedScore: number
    delta: number
    deltaPct: number
  }>
}

// Single-product Comparison panel (Patch 3, M6).
// Shows P(scenario) − S per method, per projected scenario, against the
// active static-result baseline. Sign convention: green when projected
// improves on static (delta < 0), red when projected is worse.
//
// Summary line uses "impact-years saved" framing rather than reusing
// system-mode's "cumulative emissions" language — the latter is bound to
// fleet-level GWP integration over time, which is meaningless at a
// per-product, per-scenario delta. Each scenario already carries a year,
// so the natural single-product framing is "{indicator} change at {year}".
export function SingleProductComparisonPanel({ archetypeId }: Props) {
  const staticResult = useSingleProductImpactStore((s) => s.staticResult)
  const projectedRuns = useSingleProductImpactStore((s) => s.projectedRuns)
  const viewMode = useSingleProductImpactStore((s) => s.comparisonViewMode)
  const setViewMode = useSingleProductImpactStore((s) => s.setComparisonViewMode)
  const stageAmountsByArc = useSingleProductImpactStore((s) => s.stageAmountsByArc)
  const [expanded, setExpanded] = useState(true)
  const [chartMethodKey, setChartMethodKey] = useState<string | null>(null)

  const valueFormat = useNumberFormatter()

  // Default chart method to the first valid one shared by Static and the
  // first projected run; clear if no longer valid.
  useEffect(() => {
    if (!staticResult) return
    const valid = staticResult.results.map((r) => r.method.join('|'))
    if (valid.length === 0) return
    if (chartMethodKey == null || !valid.includes(chartMethodKey)) {
      setChartMethodKey(valid[0])
    }
  }, [staticResult, chartMethodKey])

  const methodDeltas = useMemo<MethodDelta[]>(() => {
    if (!staticResult || projectedRuns.length === 0) return []
    const out: MethodDelta[] = []
    for (const sm of staticResult.results) {
      const methodKey = sm.method.join('|')
      const perScenario: MethodDelta['perScenario'] = []
      for (const run of projectedRuns) {
        const pm = run.result.results.find((r) => r.method.join('|') === methodKey)
        if (!pm) continue
        const delta = pm.score - sm.score
        const deltaPct = sm.score !== 0 ? (delta / Math.abs(sm.score)) * 100 : 0
        perScenario.push({
          dbName: run.dbName,
          year: run.year,
          iam: run.iam,
          ssp: run.ssp,
          projectedScore: pm.score,
          delta,
          deltaPct,
        })
      }
      if (perScenario.length > 0) {
        out.push({
          methodKey,
          methodLabel: sm.method_label,
          unit: sm.unit,
          staticScore: sm.score,
          perScenario,
        })
      }
    }
    return out
  }, [staticResult, projectedRuns])

  // Patch 4G — Excel export state. MUST live above the early returns
  // below — see CLAUDE.md "Hooks must be called unconditionally". Patch
  // 4G originally placed these AFTER the result-presence guards, which
  // worked for any single render in isolation but threw "Rendered more
  // hooks than during the previous render" the moment the user
  // transitioned from "no results" to "both results present" within the
  // same component instance. Hook count must be invariant across every
  // render path.
  const [isExporting, setIsExporting] = useState(false)
  const handleExport = useCallback(async () => {
    if (!staticResult || projectedRuns.length === 0) return
    setIsExporting(true)
    try {
      // Use the comparison scope from the static result; both sides
      // computed at the same scope (frontend asserts this implicitly
      // by reading both sides into one panel).
      await exportSingleProductComparison(
        staticResult.archetype_name,
        staticResult.scope,
        staticResult,
        projectedRuns.map((r) => ({
          db_name: r.dbName,
          year: r.year,
          iam: r.iam,
          ssp: r.ssp,
          result: r.result,
        })),
        archetypeId ? stageAmountsByArc[archetypeId] : undefined,
      )
    } finally {
      setIsExporting(false)
    }
  }, [staticResult, projectedRuns, archetypeId, stageAmountsByArc])

  if (archetypeId == null) {
    return (
      <div
        data-testid="single-product-compare-empty"
        style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
        }}
      >
        Pick an archetype above to compare static vs projected impact.
      </div>
    )
  }

  if (!staticResult || projectedRuns.length === 0) {
    return (
      <div
        data-testid="single-product-compare-needs-runs"
        style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
          padding: 'var(--space-4)', textAlign: 'center',
        }}
      >
        Run both Static Background and Prospective Background first. Comparison reads results from each tab.
      </div>
    )
  }

  // Headline: count of indicator-scenarios that improved vs. worsened.
  const flat = methodDeltas.flatMap((m) => m.perScenario.map((s) => s.delta))
  const improved = flat.filter((d) => d < 0).length
  const worsened = flat.filter((d) => d > 0).length

  return (
    <div
      data-testid="single-product-compare-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      <CollapsibleCard
        title="Comparison"
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        summary={`${methodDeltas.length} indicators · ${projectedRuns.length} scenarios · ${improved} improved · ${worsened} worsened`}
        actions={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ViewToggle
              mode={viewMode}
              onChange={setViewMode}
              accent="var(--mod-plca)"
              testIdPrefix="single-product-compare-view-toggle"
            />
            <button
              type="button"
              data-testid="single-product-compare-export"
              onClick={handleExport}
              disabled={isExporting}
              title="Download Excel workbook"
              style={{
                height: 32, padding: '0 12px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)', fontWeight: 500,
                cursor: isExporting ? 'wait' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: isExporting ? 0.7 : 1,
              }}
            >
              {isExporting ? (
                <Loader2 size={14} style={{ animation: 'dsm-spin 1s linear infinite' }} />
              ) : (
                <Download size={14} />
              )}
              <span>Export</span>
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span data-testid="single-product-compare-headline">
              <strong>{improved}</strong> indicator-scenarios show
              {' '}<span style={{ color: 'var(--status-success)' }}>impact reduction</span>;
              {' '}<strong>{worsened}</strong> show
              {' '}<span style={{ color: 'var(--status-error)' }}>increase</span>
              {' '}vs. base ecoinvent at the projected scenario year.
            </span>
            <span style={{ flex: 1 }} />
            {viewMode === 'table' && (
              <NumberFormatControl
                settings={valueFormat.settings}
                onChange={valueFormat.setSettings}
              />
            )}
          </div>

          {/*
           * Chart view — reference-line + Δ panels stacked vertically.
           * Both views stay mounted via visibility-toggle so chart-local
           * state (hover, format setting) survives a round-trip.
           */}
          <div
            data-testid="single-product-compare-view-chart"
            style={{ display: viewMode === 'chart' ? 'flex' : 'none', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {chartMethodKey && (
              <>
                <ComparisonReferenceLineChart
                  staticResult={staticResult}
                  projectedRuns={projectedRuns}
                  activeMethodKey={chartMethodKey}
                  format={valueFormat}
                  filenameBase={staticResult.archetype_name.replace(/\s+/g, '_').toLowerCase()}
                  methodSelector={
                    <MethodSelector
                      methods={staticResult.results.map((r) => ({
                        key: r.method.join('|'),
                        label: r.method_label,
                      }))}
                      activeKey={chartMethodKey}
                      onChange={setChartMethodKey}
                      testId="single-product-compare-chart-method-select"
                    />
                  }
                />
                <ComparisonDeltaChart
                  staticResult={staticResult}
                  projectedRuns={projectedRuns}
                  activeMethodKey={chartMethodKey}
                  format={valueFormat}
                  filenameBase={staticResult.archetype_name.replace(/\s+/g, '_').toLowerCase()}
                />
              </>
            )}
          </div>

          <div
            data-testid="single-product-compare-view-table"
            style={{ display: viewMode === 'table' ? 'block' : 'none' }}
          >
          <table
            data-testid="single-product-compare-table"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                <th style={th}>Indicator</th>
                <th style={{ ...th, textAlign: 'right' }}>Static (S)</th>
                <th style={th}>Scenario</th>
                <th style={{ ...th, textAlign: 'right' }}>Projected (P)</th>
                <th style={{ ...th, textAlign: 'right' }}>Δ (P − S)</th>
                <th style={{ ...th, textAlign: 'right' }}>Δ %</th>
                <th style={{ ...th, textAlign: 'left' }}>Unit</th>
              </tr>
            </thead>
            <tbody>
              {methodDeltas.map((m) => (
                m.perScenario.map((s, i) => {
                  const isFirst = i === 0
                  const tone = s.delta < 0
                    ? 'var(--status-success)'
                    : s.delta > 0
                      ? 'var(--status-error)'
                      : 'var(--text-tertiary)'
                  return (
                    <tr
                      key={`${m.methodKey}|${s.dbName}`}
                      data-testid={`single-product-compare-row-${m.methodKey}-${s.dbName}`}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      <td style={{ ...td, fontWeight: isFirst ? 500 : 400, color: isFirst ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                        {isFirst ? m.methodLabel : ''}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {isFirst ? valueFormat.format(m.staticScore) : ''}
                      </td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {s.iam}/{s.ssp} {s.year ?? '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {valueFormat.format(s.projectedScore)}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: tone, fontWeight: 600 }}>
                        {s.delta > 0 ? '+' : ''}{valueFormat.format(s.delta)}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: tone }}>
                        {s.deltaPct > 0 ? '+' : ''}{s.deltaPct.toFixed(1)}%
                      </td>
                      <td style={{ ...td, color: 'var(--text-tertiary)' }}>
                        {isFirst ? m.unit : ''}
                      </td>
                    </tr>
                  )
                })
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </CollapsibleCard>
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  textAlign: 'left',
}

const td: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
}
