import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Calculator, Download, Loader2, Info, AlertCircle, Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useMFAStore } from '../../stores/mfaStore'
import { useBOMStore } from '../../stores/bomStore'
import { usePLCAStore } from '../../stores/plcaStore'
import { useImpactStore } from '../../stores/impactStore'
import { exportImpact, type ProspectiveScenarioRef } from '../../api/client'
import { IndicatorChecklist, MethodFamilySelect, useMethodSelection } from '../MethodPicker'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
]

const COHORT_SEP = '|'

const fmt = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

const fmtCount = (n: number) => {
  if (n === 0) return '0'
  return Math.round(n).toLocaleString()
}
const fmtAxis = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(2)
  return String(n)
}
// ── Panel ─────────────────────────────────────────────────────────────────────

function parseCohortKey(key: string, dims: { is_age: boolean }[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return nads.map((_, i) => parts[i] ?? '')
}

export function ProjectedImpactPanel() {
  const { activeSystem, simulationResult, selectedYear, cohortMappings, fetchCohortMappings } = useMFAStore()
  const { archetypes, fetchArchetypes } = useBOMStore()
  const { databases, fetchDatabases } = usePLCAStore()
  const { projectedJob, projectedResult, run, error: storeError } = useImpactStore()

  const { staticResult } = useImpactStore()

  const [scope, setScope] = useState<'inflows' | 'outflows' | 'stock' | 'all'>('stock')
  const [methods, setMethods] = useState<string[][]>([])
  const methodSelection = useMethodSelection(setMethods)
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  const [scenarioKey, setScenarioKey] = useState<string>('')  // `${base_db}|${iam}|${ssp}`
  const [selectedResultIdx, setSelectedResultIdx] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const startRef = useRef<number | null>(null)

  const isRunning = !!projectedJob && !projectedJob.done

  const handleExport = async () => {
    if (!projectedResult || !activeSystem) return
    setIsExporting(true)
    try {
      const sysName = activeSystem.name.replace(/[^\w.-]+/g, '_') || 'system'
      await exportImpact(
        {
          result: projectedResult,
          year: selectedYear ?? null,
          compare_result: staticResult ?? null,
        },
        `${sysName}_projected_impact.xlsx`,
      )
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => { fetchDatabases() }, [fetchDatabases])
  useEffect(() => { if (activeSystem) fetchCohortMappings() }, [activeSystem?.id, fetchCohortMappings])

  const scenarios = useMemo(() => {
    const map = new Map<string, { base_db: string; iam: string; ssp: string; years: number[] }>()
    for (const d of databases) {
      const key = `${d.base_db}|${d.iam}|${d.ssp}`
      const entry = map.get(key) ?? { base_db: d.base_db, iam: d.iam, ssp: d.ssp, years: [] }
      entry.years.push(d.year)
      map.set(key, entry)
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v, years: v.years.sort((a, b) => a - b) }))
  }, [databases])

  useEffect(() => {
    if (!scenarioKey && scenarios.length > 0) setScenarioKey(scenarios[0].key)
  }, [scenarios, scenarioKey])

  // Elapsed timer while running
  useEffect(() => {
    if (!isRunning) { startRef.current = null; setElapsed(0); return }
    startRef.current = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => {
      if (startRef.current != null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [isRunning])

  // Default detailYear from results
  useEffect(() => {
    if (projectedResult && projectedResult.results[0]?.years.length) {
      const yrs = projectedResult.results[0].years
      setDetailYear(yrs[Math.floor(yrs.length / 2)]?.year ?? yrs[0].year)
    }
  }, [projectedResult])

  const selectedScenario = scenarios.find((s) => s.key === scenarioKey)
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

  const mappedCount = Object.values(cohortMappings).filter((v) => v?.archetype_id).length
  const unlinkedArchetypes = useMemo(() => new Set(archetypes.filter((a) => a.unlinked_count > 0).map((a) => a.id)), [archetypes])
  const mappedUnlinked = Object.values(cohortMappings).filter((v) => v?.archetype_id && unlinkedArchetypes.has(v.archetype_id)).length

  const preflightIssues = useMemo(() => {
    const issues: string[] = []
    if (!activeSystem) issues.push('Select an MFA system.')
    if (!simulationResult) issues.push('Run the MFA simulation first (Simulation tab).')
    if (mappedCount === 0) issues.push('Save at least one cohort → archetype mapping (Static LCI tab).')
    if (methods.length === 0) issues.push('Select at least one impact indicator below.')
    if (!selectedScenario) issues.push('Pick a prospective scenario.')
    if (mappedUnlinked > 0) issues.push(`Resolve unlinked materials in ${mappedUnlinked} mapped archetype(s).`)
    return issues
  }, [activeSystem, simulationResult, mappedCount, methods.length, selectedScenario, mappedUnlinked])

  const canRun = preflightIssues.length === 0

  const handleRun = async () => {
    console.log('[Projected LCI] Calculate clicked', {
      canRun, preflightIssues,
      activeSystemId: activeSystem?.id, hasSimulation: !!simulationResult,
      mappedCount, methods: methods.length, scenario: selectedScenario,
    })
    if (!canRun) {
      useImpactStore.setState({
        error: 'Cannot run: ' + preflightIssues.join(' '),
      })
      return
    }
    if (!activeSystem || !selectedScenario) return
    const fullStart = availableYears[0]
    const fullEnd = availableYears[availableYears.length - 1]
    const ys = yearStart != null && yearStart !== fullStart ? yearStart : null
    const ye = yearEnd != null && yearEnd !== fullEnd ? yearEnd : null
    const scenarioRef: ProspectiveScenarioRef = {
      base_db: selectedScenario.base_db,
      iam: selectedScenario.iam,
      ssp: selectedScenario.ssp,
    }
    const payload = {
      mode: 'projected' as const,
      mfa_system_id: activeSystem.id,
      scope,
      methods,
      year_start: ys,
      year_end: ye,
      scenario: scenarioRef,
    }
    console.log('[Projected LCI] POST /impact/calculate', payload)
    try {
      await run(payload)
    } catch (e) {
      console.error('[Projected LCI] run() threw', e)
    }
  }

  const selectedResult = projectedResult?.results[selectedResultIdx] ?? null

  const areaData = useMemo(() => {
    if (!selectedResult) return []
    return selectedResult.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const [ck, impact] of Object.entries(yr.impact_by_cohort)) row[ck] = impact
      return row
    })
  }, [selectedResult])

  const cohortStackKeys = useMemo(() => {
    if (!selectedResult) return []
    const all = new Set<string>()
    selectedResult.years.forEach((yr) => Object.keys(yr.impact_by_cohort).forEach((k) => all.add(k)))
    return Array.from(all)
  }, [selectedResult])

  const yearBreakdown = useMemo(() => {
    if (!selectedResult || detailYear == null) return null
    const yr = selectedResult.years.find((y) => y.year === detailYear) ?? selectedResult.years[0]
    if (!yr) return null
    const countData = yr.count_by_cohort ?? {}
    const rows = Object.entries(yr.impact_by_cohort).map(([ck, impact]) => {
      const cnt = countData[ck] ?? 0
      return {
        cohort_key: ck,
        count: cnt,
        total: impact,
        perUnit: cnt > 0 ? impact / cnt : 0,
        pct: yr.total_impact > 0 ? (impact / yr.total_impact) * 100 : 0,
      }
    }).sort((a, b) => b.total - a.total)
    return { yr, rows }
  }, [selectedResult, detailYear])

  const materialBars = useMemo(() => {
    if (!selectedResult || detailYear == null) return []
    const yr = selectedResult.years.find((y) => y.year === detailYear) ?? selectedResult.years[0]
    if (!yr) return []
    return Object.entries(yr.impact_by_material)
      .map(([name, impact]) => ({ name, impact }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 12)
  }, [selectedResult, detailYear])

  const card: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  if (!activeSystem) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Select an MFA system first.</div>
  }

  if (scenarios.length === 0) {
    return (
      <div style={{
        ...card,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, textAlign: 'center', padding: 'var(--space-8)', minHeight: 240,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'color-mix(in srgb, var(--mod-plca) 12%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={20} color="var(--mod-plca)" />
        </div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
          No prospective databases generated yet
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', maxWidth: 440 }}>
          Go to <b>pLCA Developer</b> to generate premise databases for future years, then come back here to run the projected LCI against your MFA system.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Preflight */}
      <div style={{
        padding: '10px 14px',
        backgroundColor: 'color-mix(in srgb, var(--mod-plca) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--mod-plca) 30%, transparent)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <Info size={14} color="var(--mod-plca)" />
        <span>
          Cohort mappings ({mappedCount} mapped) are shared across Static and Projected LCI — one per MFA system. Each year is matched to a prospective database via premise (exact → nearest earlier → earliest available).
        </span>
      </div>

      {/* Controls */}
      <div style={card}>
        {/* Top row: Impact Method · Scope · Years */}
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
            <label style={labelS}>Impact Method</label>
            <MethodFamilySelect selection={methodSelection} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 280px' }}>
            <label style={labelS}>Scope</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { value: 'inflows', label: 'Manufacturing', tip: 'Manufacturing stage × inflows (units produced each year).' },
                { value: 'stock', label: 'Operation', tip: 'Use Phase + Maintenance × in-service stock (units active each year).' },
                { value: 'outflows', label: 'End of Life', tip: 'End of Life stage × outflows (units retired each year).' },
                { value: 'all', label: 'Full lifecycle', tip: 'Sum of all three scope-paired passes (Manufacturing × inflows + Operation × stock + EoL × outflows).' },
              ] as const).map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScope(s.value)}
                  disabled={isRunning}
                  title={s.tip}
                  style={{
                    padding: '0 12px', height: 36, borderRadius: 'var(--radius-md)', cursor: isRunning ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (scope === s.value ? 'var(--mod-plca)' : 'var(--border-default)'),
                    backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--mod-plca) 12%, transparent)' : 'var(--bg-elevated)',
                    color: scope === s.value ? 'var(--mod-plca)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelS}>Years</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={yearStart ?? ''} onChange={(e) => setYearStart(Number(e.target.value))} disabled={isRunning} style={selS}>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>to</span>
              <select value={yearEnd ?? ''} onChange={(e) => setYearEnd(Number(e.target.value))} disabled={isRunning} style={selS}>
                {availableYears.filter((y) => yearStart == null || y >= yearStart).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Second row: Scenario (Projected LCI only) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--space-4)' }}>
          <label style={labelS}>Scenario</label>
          <select
            value={scenarioKey}
            onChange={(e) => setScenarioKey(e.target.value)}
            disabled={isRunning}
            style={{ ...selS, height: 36, minWidth: 360, maxWidth: 560 }}
          >
            {scenarios.map((s) => (
              <option key={s.key} value={s.key}>
                {s.base_db} · {s.iam.toUpperCase()} / {s.ssp} ({s.years.length} year{s.years.length === 1 ? '' : 's'})
              </option>
            ))}
          </select>
          {selectedScenario && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Years: {selectedScenario.years.join(', ')}
            </div>
          )}
        </div>

        {/* Middle: indicator selection */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ ...labelS, marginBottom: 8, display: 'block' }}>Indicator selection</label>
          <IndicatorChecklist selection={methodSelection} accent="var(--mod-plca)" maxHeight={320} />
        </div>

        {/* Preflight checklist + Calculate pinned right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {preflightIssues.length > 0 && (
              <div style={{
                padding: '8px 10px', backgroundColor: 'var(--warning-muted, color-mix(in srgb, var(--warning) 10%, transparent))',
                border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
                borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--warning)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <AlertCircle size={13} /> Cannot calculate yet — fix the following:
                </div>
                <ul style={{ margin: 0, paddingLeft: 22 }}>
                  {preflightIssues.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              </div>
            )}
          </div>
          <Button variant="primary" onClick={handleRun} disabled={isRunning} style={{ backgroundColor: 'var(--mod-plca)', height: 36, flexShrink: 0, opacity: canRun ? 1 : 0.6 }}>
            {isRunning ? <><Loader2 size={14} style={{ animation: 'impact-spin 1s linear infinite' }} /> Calculating…</> : <><Calculator size={14} /> {methods.length > 1 ? `Calculate (${methods.length} methods)` : 'Calculate'}</>}
          </Button>
        </div>

        {isRunning && (
          <div style={{ marginTop: 'var(--space-3)', padding: '10px 12px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              <span>{projectedJob?.stage || 'running…'}{methods.length > 0 ? ` × ${methods.length} indicator${methods.length === 1 ? '' : 's'}` : ''}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                {Math.round((projectedJob?.pct ?? 0) * 100)}% · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </span>
            </div>
            <div style={{ height: 4, backgroundColor: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round((projectedJob?.pct ?? 0) * 100)}%`, backgroundColor: 'var(--mod-plca)', transition: 'width 0.2s ease' }} />
            </div>
            <style>{`@keyframes impact-spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {(projectedJob?.error || storeError) && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
            {projectedJob?.error || storeError}
          </div>
        )}
      </div>

      {/* Results */}
      {projectedResult && selectedResult && (
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          {/* Vertical indicator sidebar */}
          {projectedResult.results.length > 1 && (
            <div style={{ width: 220, minWidth: 220, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 0 }}>
              <div style={card}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 'var(--space-3)' }}>
                  Indicators
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 600, overflowY: 'auto' }}>
                  {projectedResult.results.map((r, i) => {
                    const active = i === selectedResultIdx
                    const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedResultIdx(i)}
                        title={r.method.join(' › ')}
                        style={{
                          width: '100%', textAlign: 'left', padding: '8px 10px',
                          background: active ? 'color-mix(in srgb, var(--mod-plca) 10%, transparent)' : 'transparent',
                          border: 'none', borderLeft: active ? '3px solid var(--mod-plca)' : '3px solid transparent',
                          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.3 }}>
                          {label}
                        </div>
                        {r.unit && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>{r.unit}</div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Right content panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          {/* Year→Database mapping strip */}
          {Object.keys(projectedResult.meta.year_to_database).length > 0 && (
            <div style={{ ...card, padding: 'var(--space-3) var(--space-5)' }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 6 }}>
                Year → database
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(projectedResult.meta.year_to_database)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([y, db]) => (
                    <div key={y} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: 'var(--mod-plca)', fontWeight: 600 }}>{y}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{db}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                  Cumulative impact ({selectedResult.scope}, {selectedResult.method.join(' › ')})
                </div>
                {selectedResult.stages_included && selectedResult.stages_included.length > 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Stages: {selectedResult.stages_included.join(', ')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {projectedResult.elapsed_seconds != null && (
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', padding: '2px 8px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    Calculated in {Math.floor(projectedResult.elapsed_seconds / 60) > 0 ? `${Math.floor(projectedResult.elapsed_seconds / 60)}m ` : ''}{Math.round(projectedResult.elapsed_seconds % 60)}s
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={handleExport} disabled={isExporting}>
                  {isExporting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                  Export
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-plca)' }}>
                {fmt(selectedResult.summary.total_impact)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{selectedResult.unit}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 16 }}>
                Peak in {selectedResult.summary.peak_year}: {fmt(selectedResult.summary.peak_impact)} {selectedResult.unit}
              </span>
            </div>
          </div>

          {/* Stacked area */}
          <div style={card}>
            <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Impact over time, by cohort
            </h4>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={fmtAxis}
                    label={{ value: selectedResult.unit, angle: -90, position: 'insideLeft', style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                    formatter={(v) => (typeof v === 'number' ? fmt(v) : String(v))}
                  />
                  {cohortStackKeys.map((k, i) => (
                    <Area key={k} type="monotone" dataKey={k} stackId="1"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.7} isAnimationActive={false}
                    />
                  ))}
                  <ReferenceLine x={detailYear ?? undefined} stroke="var(--mod-plca)" strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Year detail selector */}
          {selectedResult.years.length > 0 && (
            <div style={{ ...card, padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Year detail
              </span>
              <select
                value={detailYear ?? ''}
                onChange={(e) => setDetailYear(Number(e.target.value))}
                style={selS}
              >
                {selectedResult.years.map((yr) => (
                  <option key={yr.year} value={yr.year}>{yr.year}</option>
                ))}
              </select>
              {detailYear != null && yearBreakdown && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Total: {fmt(yearBreakdown.yr.total_impact)} {selectedResult.unit}
                </span>
              )}
            </div>
          )}

          {/* Year breakdown + material bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 'var(--space-4)' }}>
            {yearBreakdown && (
              <div style={card}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                  Impact by cohort in {yearBreakdown.yr.year}
                </h4>
                <div style={{ overflow: 'auto', maxHeight: 320 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thS}>Cohort</th>
                        <th style={{ ...thS, textAlign: 'right' }}>Count</th>
                        <th style={{ ...thS, textAlign: 'right' }}>Per unit</th>
                        <th style={{ ...thS, textAlign: 'right' }}>Total ({selectedResult.unit})</th>
                        <th style={{ ...thS, textAlign: 'right' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearBreakdown.rows.map((row) => (
                        <tr key={row.cohort_key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)' }}>
                            {parseCohortKey(row.cohort_key, activeSystem.dimensions).map((p, i) => (
                              <span key={i} style={{ marginRight: 4 }}><Badge label={p} variant="mfa" /></span>
                            ))}
                          </td>
                          <td style={tdR}>{fmtCount(row.count)}</td>
                          <td style={tdR}>{fmt(row.perUnit)}</td>
                          <td style={{ ...tdR, color: 'var(--mod-plca)', fontWeight: 600 }}>{fmt(row.total)}</td>
                          <td style={{ ...tdR, color: 'var(--text-tertiary)' }}>{row.pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={card}>
              <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                Material contribution {detailYear != null ? `(${detailYear})` : ''}
              </h4>
              <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={materialBars} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 12 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={fmtAxis}
                      label={{ value: selectedResult.unit, position: 'insideBottom', offset: -6, style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                    />
                    <YAxis type="category" dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={120} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                      formatter={(v) => (typeof v === 'number' ? fmt(v) : String(v))}
                    />
                    <Bar dataKey="impact" fill="var(--mod-plca)" fillOpacity={0.85} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

const labelS: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6,
}
const selS: React.CSSProperties = {
  height: 36, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
}
const thS: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)',
}
const tdR: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
}
