/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, Dice5 } from 'lucide-react'
import {
  calculateArchetypeLCA,
  exportSingleProductStatic,
  BASE_SCENARIO,
  type ArchetypeLCACalculateResult,
} from '../../api/client'
import { useSingleProductImpactStore } from '../../stores/singleProductImpactStore'
import { useParameterStore } from '../../stores/parameterStore'
import { SensitivityCases, hasVaryingParameters, varyingCases } from './SensitivityCases'
import { SensitivityRangeChart } from '../charts/SensitivityRangeChart'
import { MethodPicker } from '../MethodPicker'
import { useNumberFormatter } from '../charts/numberFormat'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { StageBreakdownChart } from '../charts/StageBreakdownChart'
import { Button } from '../ui/Button'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ComputeProgress } from '../ui/ComputeProgress'
import { stageAmountsEqual } from './StageAmountsEditor'
import { useMonteCarloStore } from '../../stores/monteCarloStore'

interface Props {
  archetypeId: string | null
  /** Lets the Results card hand this computation to the Uncertainty tab. */
  onNavigate?: (id: string) => void
}

type Scope = 'inflows' | 'stock' | 'outflows' | 'all'

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'all', label: 'Full Lifecycle' },
  { value: 'inflows', label: 'Manufacturing' },
  { value: 'stock', label: 'Operation' },
  { value: 'outflows', label: 'End of Life' },
]

// Single-product Static LCI panel (Patch 3, M4).
// Computes one archetype against the active project's base ecoinvent via the
// extended /lca/calculate-archetype endpoint. Multi-parameter fan-out (N>1)
// runs N sequential client-side calls — each call is one endpoint POST
// passing parameter_scenario; no orchestrator. The single-product mode has
// no DSM axis (it makes no sense to apply fleet dynamics to one product) and
// no multi-LCI axis (Static is base ecoinvent only — that's what Projected
// is for). So this panel ships only the parameter axis for fan-out.
export function SingleProductStaticPanel({ archetypeId, onNavigate }: Props) {
  const [scope, setScope] = useState<Scope>('all')
  const [selectedMethods, setSelectedMethods] = useState<string[][]>([])
  // Patch 4D — per-archetype config restore. The picker is uncontrolled
  // (manages its own `selected` map internally), so we re-seed it by
  // remounting via a key bump on archetype change. The skip ref suppresses
  // the synthetic onChange that fires from the picker's mount-time effect
  // so it doesn't immediately overwrite scope/selectedMethods we just set.
  const [pickerSeed, setPickerSeed] = useState(0)
  // Initialize true so the picker's mount-time onChange (fires with the
  // seed value before our archetype-restore effect runs) doesn't write
  // back to the store on first render.
  const skipNextMethodsChangeRef = useRef(true)
  // Tracks the last archetypeId the restore effect has committed. On
  // rerender with a new archetypeId, the picker's [selected, onChange]
  // effect re-fires before the parent's archetype effect runs — its
  // `selected` map is still the previous archetype's. Detect that race
  // and skip the write so we don't pollute the new archetype's slot.
  const lastArchetypeIdRef = useRef<string | null>(null)

  // Static = one base-ecoinvent run with no scenario variation, so it computes
  // on Base only — the sensitivity-cases selector is not exposed here (it lives
  // on the Prospective tab). See CLAUDE.md "Sensitivity cases".

  const [configExpanded, setConfigExpanded] = useState(true)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const paramTable = useParameterStore((st) => st.table)
  const fetchParamTable = useParameterStore((st) => st.fetchTable)
  const selectedScenarios = useParameterStore((st) => st.selectedScenarios)
  const toggleSelectedScenario = useParameterStore((st) => st.toggleSelectedScenario)
  useEffect(() => { if (!paramTable) void fetchParamTable() }, [paramTable, fetchParamTable])
  const effectiveCases = useMemo(() => {
    if (!hasVaryingParameters(paramTable)) return []
    const avail = varyingCases(paramTable)
    return selectedScenarios.filter((c) => avail.includes(c) && c !== BASE_SCENARIO)
  }, [paramTable, selectedScenarios])

  const [isCalculating, setIsCalculating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultsByScenario, setResultsByScenario] = useState<
    Record<string, ArchetypeLCACalculateResult>
  >({})
  const [scenarioOrder, setScenarioOrder] = useState<string[]>([])
  const [activeScenario, setActiveScenario] = useState<string | null>(null)

  const valueFormat = useNumberFormatter()
  const setStoreStaticResult = useSingleProductImpactStore((s) => s.setStaticResult)
  const stageAmountsByArc = useSingleProductImpactStore((s) => s.stageAmountsByArc)
  const staticConfigByArc = useSingleProductImpactStore((s) => s.staticConfigByArc)
  const setStaticConfigForArc = useSingleProductImpactStore((s) => s.setStaticConfigForArc)
  const currentStageAmounts = archetypeId ? stageAmountsByArc[archetypeId]?.amounts ?? null : null

  // Publish the active-scenario result to the cross-panel store so the
  // Comparison tab can read it. We publish per active scenario rather than
  // per run so switching the scenario tab updates the comparison baseline.
  useEffect(() => {
    if (activeScenario && resultsByScenario[activeScenario]) {
      setStoreStaticResult(resultsByScenario[activeScenario])
    }
  }, [activeScenario, resultsByScenario, setStoreStaticResult])

  // Patch 4D — restore per-archetype Static config on archetype change.
  // Reads `staticConfigByArc` only on archetype change (not on every store
  // update) so the panel is the source of truth between user edits. The
  // picker remount via `pickerSeed` re-seeds the indicator checklist.
  useEffect(() => {
    if (!archetypeId) return
    const cfg = staticConfigByArc[archetypeId]
    skipNextMethodsChangeRef.current = true
    setScope(cfg?.scope ?? 'all')
    setSelectedMethods(cfg?.selectedMethods ?? [])
    setPickerSeed((s) => s + 1)
    lastArchetypeIdRef.current = archetypeId
    // Intentional: only re-run on archetype change, not on store updates
    // we caused ourselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archetypeId])

  const handleScopeClick = useCallback((next: Scope) => {
    setScope(next)
    if (archetypeId !== lastArchetypeIdRef.current) return
    if (archetypeId) setStaticConfigForArc(archetypeId, { scope: next, selectedMethods })
  }, [archetypeId, selectedMethods, setStaticConfigForArc])

  const handleMethodsChange = useCallback((m: string[][]) => {
    setSelectedMethods(m)
    // Suppress the seed-fired onChange that follows the picker remount on
    // archetype restore — its value matches the just-restored selection,
    // so writing it to the store is redundant (and would also fire when
    // restoring "no config" → empty, polluting other archetypes' lookups).
    if (skipNextMethodsChangeRef.current) {
      skipNextMethodsChangeRef.current = false
      return
    }
    // Race guard: archetypeId changed since the last committed restore;
    // picker's selected map is still the previous archetype's.
    if (archetypeId !== lastArchetypeIdRef.current) return
    if (archetypeId) setStaticConfigForArc(archetypeId, { scope, selectedMethods: m })
  }, [archetypeId, scope, setStaticConfigForArc])

  const handleCalculate = useCallback(async () => {
    if (!archetypeId || selectedMethods.length === 0) return
    setIsCalculating(true)
    setError(null)
    setResultsByScenario({})
    setScenarioOrder([])
    setActiveScenario(null)

    // Base first, then each selected case. The endpoint takes one scenario, so
    // N cases are N sequential calls -- the same shape the system-level
    // orchestrator uses. Only meaningful since ab0c533: before that fix
    // single-product ignored parameters and every case returned the same number.
    const scenariosToRun = [BASE_SCENARIO, ...effectiveCases]
    setProgress({ done: 0, total: scenariosToRun.length })
    const acc: Record<string, ArchetypeLCACalculateResult> = {}
    try {
      for (let i = 0; i < scenariosToRun.length; i++) {
        const sc = scenariosToRun[i]
        const result = await calculateArchetypeLCA(archetypeId, scope, selectedMethods, {
          parameterScenario: sc === BASE_SCENARIO ? null : sc,
          stageAmounts: currentStageAmounts ?? undefined,
        })
        acc[sc] = result
        setProgress({ done: i + 1, total: scenariosToRun.length })
      }
      setResultsByScenario(acc)
      setScenarioOrder(scenariosToRun)
      setActiveScenario(scenariosToRun[0])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsCalculating(false)
      setProgress(null)
    }
  }, [archetypeId, scope, selectedMethods, currentStageAmounts])

  const isMulti = scenarioOrder.length > 1
  // Same derivation the Sensitivity cases checklist uses, so a case marked
  // inert there is marked inert here too.
  const varying = useMemo(() => varyingCases(paramTable), [paramTable])
  const isInertCase = useCallback(
    (s: string) => s !== BASE_SCENARIO && !varying.includes(s),
    [varying],
  )
  const activeResult = activeScenario ? resultsByScenario[activeScenario] : null
  const hasResults = scenarioOrder.length > 0 && activeResult != null

  const setMonteCarloHandoff = useMonteCarloStore((st) => st.setHandoff)

  // Hand this exact computation to the Uncertainty tab. Everything the Monte
  // Carlo run needs is already pinned here -- archetype, indicators, scope,
  // stage amounts and the active sensitivity case -- so arriving there
  // requires no re-specification.
  const handleRunUncertainty = useCallback(() => {
    if (!archetypeId || !activeResult) return
    setMonteCarloHandoff({
      archetypeId,
      archetypeName: activeResult.archetype_name,
      methods: selectedMethods,
      scope,
      stageAmounts: currentStageAmounts ?? {},
      basisAmounts: null,
      parameterScenario: activeScenario === BASE_SCENARIO ? null : activeScenario,
      computeDatabase: null,
    })
    onNavigate?.('uncertainty')
  }, [archetypeId, activeResult, selectedMethods, scope, currentStageAmounts, activeScenario, setMonteCarloHandoff, onNavigate])


  // Patch 4G — Excel export for the Static Background sub-tab. Sends
  // every computed sensitivity case (not just active), so the workbook
  // captures the full multi-parameter fan-out the user ran.
  const [isExporting, setIsExporting] = useState(false)
  const handleExport = useCallback(async () => {
    if (!activeResult) return
    setIsExporting(true)
    try {
      const scenarios = scenarioOrder.map((s) => ({
        label: s,
        result: resultsByScenario[s],
      })).filter((s) => s.result != null)
      await exportSingleProductStatic(
        activeResult.archetype_name,
        scope,
        scenarios,
        archetypeId ? stageAmountsByArc[archetypeId] : undefined,
      )
    } finally {
      setIsExporting(false)
    }
  }, [activeResult, scenarioOrder, resultsByScenario, scope, archetypeId, stageAmountsByArc])
  const hasStageBreakdown =
    !!activeResult?.stage_breakdown &&
    Object.keys(activeResult.stage_breakdown).length > 0
  const isStale =
    !!activeResult &&
    !stageAmountsEqual(activeResult.stage_amounts, currentStageAmounts)

  if (archetypeId == null) {
    return (
      <div
        data-testid="single-product-static-empty"
        style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
        }}
      >
        Pick an archetype above to compute its static impact.
      </div>
    )
  }

  const configSummary = `${SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope} · ${selectedMethods.length} indicators`

  const calculateButton = (
    <Button
      variant="primary"
      data-testid="single-product-static-calculate"
      onClick={handleCalculate}
      disabled={selectedMethods.length === 0 || isCalculating}
      style={{ backgroundColor: 'var(--mod-lca)', height: 32 }}
    >
      {isCalculating ? (
        <>
          <Loader2 size={14} style={{ animation: 'dsm-spin 1s linear infinite', marginRight: 6 }} />
          Calculating…
        </>
      ) : (
        <>Calculate</>
      )}
    </Button>
  )

  return (
    <div
      data-testid="single-product-static-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      <CollapsibleCard
        title="Configuration"
        expanded={configExpanded}
        onToggle={() => setConfigExpanded((v) => !v)}
        summary={configSummary}
        actions={calculateButton}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label style={topLabel}>Scope</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {SCOPE_OPTIONS.map((s) => {
                const isActive = scope === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    data-testid={`single-product-scope-${s.value}`}
                    onClick={() => handleScopeClick(s.value)}
                    style={{
                      padding: '6px 10px',
                      border: '1px solid ' + (isActive ? 'var(--mod-lca)' : 'var(--border-default)'),
                      backgroundColor: isActive
                        ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)'
                        : 'var(--bg-elevated)',
                      color: isActive ? 'var(--mod-lca)' : 'var(--text-primary)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: isActive ? 600 : 500,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label style={topLabel}>Impact methods</label>
            <div style={{ marginTop: 6 }}>
              <MethodPicker
                key={pickerSeed}
                onChange={handleMethodsChange}
                accent="var(--mod-lca)"
                initialSelected={selectedMethods}
                defaultAllSelected
              />
            </div>
          </div>

          {/* Sensitivity cases. Patch 5AW removed this box because Static was
              Base-only; it is back because single-product now resolves
              parameters (ab0c533) so the cases produce different numbers. */}
          <SensitivityCases
            table={paramTable}
            selected={selectedScenarios}
            onToggle={toggleSelectedScenario}
            testId="single-product-static-sensitivity-cases"
          />

          {error && (
            <div
              data-testid="single-product-static-error"
              style={{
                padding: '8px 12px',
                fontSize: 'var(--text-xs)', color: 'var(--status-error)',
                backgroundColor: 'color-mix(in srgb, var(--status-error) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--status-error) 30%, transparent)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {error}
            </div>
          )}
        </div>
      </CollapsibleCard>

      <ComputeProgress
        active={isCalculating}
        label={progress ? `Calculating ${progress.done}/${progress.total}` : 'Calculating…'}
        bar={progress && progress.total > 0 ? 'determinate' : 'none'}
        pct={progress && progress.total > 0 ? progress.done / progress.total : undefined}
        statusColor="var(--mod-lca)"
        data-testid="single-product-static-progress"
      />

      {hasResults && activeResult && (
        <CollapsibleCard
          title="Results"
          expanded={resultsExpanded}
          onToggle={() => setResultsExpanded((v) => !v)}
          summary={`${activeResult.archetype_name} · ${activeResult.results.length} indicators · ${activeResult.elapsed_seconds.toFixed(1)}s`}
          actions={
            <>
            <button
              type="button"
              data-testid="single-product-run-uncertainty"
              onClick={handleRunUncertainty}
              title="Propagate uncertainty for this computation"
              style={{
                height: 32, padding: '0 12px', marginRight: 8,
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)', fontWeight: 500,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Dice5 size={14} strokeWidth={1.8} />
              Run uncertainty
            </button>
            <button
              type="button"
              data-testid="single-product-static-export"
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
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {isMulti && (
              <ScenarioTabBar
                scenarios={scenarioOrder}
                active={activeScenario}
                onChange={setActiveScenario}
                isInert={isInertCase}
              />
            )}
            {!hasStageBreakdown && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <NumberFormatControl
                  settings={valueFormat.settings}
                  onChange={valueFormat.setSettings}
                />
              </div>
            )}
            {isStale && (
              <div
                data-testid="single-product-static-stale"
                style={{
                  padding: '6px 10px',
                  fontSize: 'var(--text-xs)', color: 'var(--status-warning)',
                  backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--status-warning) 25%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Stage amounts changed since this result was computed. Click Calculate to refresh.
              </div>
            )}
            {activeResult.warnings && activeResult.warnings.length > 0 && (
              <div
                data-testid="single-product-static-warnings"
                style={{
                  padding: '6px 10px',
                  fontSize: 'var(--text-xs)', color: 'var(--status-warning)',
                  backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--status-warning) 25%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {activeResult.warnings.length} warning{activeResult.warnings.length === 1 ? '' : 's'}: {activeResult.warnings.slice(0, 2).join(' · ')}
                {activeResult.warnings.length > 2 ? ' …' : ''}
              </div>
            )}
            {hasStageBreakdown && activeResult.stage_breakdown && (
              <StageBreakdownChart
                stageBreakdown={activeResult.stage_breakdown}
                methods={activeResult.results.map((r) => ({
                  method_label: r.method_label,
                  score: r.score,
                  unit: r.unit,
                }))}
                format={valueFormat}
                filenameBase={activeResult.archetype_name.replace(/\s+/g, '_').toLowerCase()}
                caseLabel={isMulti ? activeScenario : null}
                caseInert={activeScenario ? isInertCase(activeScenario) : false}
              />
            )}

            {/* Sensitivity: range around Base + a tornado of the cases that
                actually move the total. Not grouped-by-stage: a case that
                changes a functional-unit divisor moves every stage by the
                same factor, so per-stage grouping would draw N near-identical
                charts and hide which case matters. */}
            {scenarioOrder.length > 1 && activeResult.results[0] && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <SensitivityRangeChart
                  base={resultsByScenario[BASE_SCENARIO]?.results
                    .find((r) => r.method_label === activeResult.results[0].method_label)?.score
                    ?? activeResult.results[0].score}
                  cases={scenarioOrder
                    .filter((c) => c !== BASE_SCENARIO)
                    .map((c) => ({
                      case: c,
                      value: resultsByScenario[c]?.results
                        .find((r) => r.method_label === activeResult.results[0].method_label)?.score ?? 0,
                    }))}
                  unit={activeResult.results[0].unit}
                  label={activeResult.results[0].method_label}
                  format={valueFormat}
                  filenameBase={activeResult.archetype_name.replace(/\s+/g, '_').toLowerCase()}
                />
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {isMulti && <th style={th}>Sensitivity case</th>}
                  <th style={th}>Indicator</th>
                  <th style={{ ...th, textAlign: 'right' }}>Score</th>
                  <th style={{ ...th, textAlign: 'left' }}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {activeResult.results.map((r) => (
                  <tr key={r.method.join('|')} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {isMulti && (
                      <td
                        data-testid="single-product-static-row-case"
                        style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}
                      >
                        {activeScenario}
                      </td>
                    )}
                    <td style={td}>{r.method_label}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {valueFormat.format(r.score)}
                    </td>
                    <td style={{ ...td, color: 'var(--text-tertiary)' }}>{r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleCard>
      )}
    </div>
  )
}

function ScenarioTabBar({
  scenarios, active, onChange, isInert,
}: {
  scenarios: string[]
  active: string | null
  onChange: (s: string) => void
  isInert?: (s: string) => boolean
}) {
  return (
    <div
      data-testid="single-product-static-scenario-tabs"
      style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)' }}
    >
      {scenarios.map((s) => {
        const isActive = active === s
        const inert = isInert?.(s) ?? false
        return (
          <button
            key={s}
            type="button"
            data-testid={`single-product-static-scenario-${s}`}
            onClick={() => onChange(s)}
            title={inert ? 'No parameter varies in this case — it duplicates Base.' : undefined}
            style={{
              border: 'none', background: 'transparent',
              borderBottom: isActive ? '2px solid var(--mod-lca)' : '2px solid transparent',
              padding: '6px 10px',
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? 600 : 500,
              color: inert
                ? 'var(--text-tertiary)'
                : isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              marginBottom: -1,
              fontFamily: s === BASE_SCENARIO ? 'inherit' : 'var(--font-mono)',
            }}
          >
            {s}
            {inert && <span style={{ fontSize: 9 }}> · inert</span>}
          </button>
        )
      })}
    </div>
  )
}

const topLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
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
