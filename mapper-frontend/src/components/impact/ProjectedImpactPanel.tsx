import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Calculator, ChevronDown, Download, Loader2, Telescope, Info, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useMFAStore } from '../../stores/mfaStore'
import { useBOMStore } from '../../stores/bomStore'
import { usePLCAStore } from '../../stores/plcaStore'
import { useImpactStore } from '../../stores/impactStore'
import { exportImpact, getMethods, type MethodFamily, type ProspectiveScenarioRef } from '../../api/client'

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
const indicatorKey = (t: string[]) => t.join('|')

// ── Compact method picker (mirrors the one in MFAImpactPanel but standalone) ──

function MethodPicker({ onChange }: { onChange: (methods: string[][]) => void }) {
  const [methods, setMethods] = useState<MethodFamily[]>([])
  const [family, setFamily] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { getMethods().then((m) => { setMethods(m); if (m[0]) setFamily(m[0].family) }) }, [])
  const categories = methods.find((m) => m.family === family)?.categories ?? []
  const indicators = categories.find((c) => c.category === category)?.indicators ?? []
  useEffect(() => { if (categories.length > 0 && !category) setCategory(categories[0].category) }, [categories, category])
  useEffect(() => { onChange(Object.values(selected)) }, [selected, onChange])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (t: string[]) => setSelected((prev) => {
    const k = indicatorKey(t); const next = { ...prev }
    if (next[k]) delete next[k]; else next[k] = t
    return next
  })

  const selectRecommended = () => {
    const keywords = [
      'climate change', 'acidification', 'eutrophication, freshwater',
      'ozone depletion', 'photochemical ozone formation',
      'particulate matter', 'resource use, minerals', 'resource use, fossils',
      'resource use, energy', 'water use',
    ]
    const next: Record<string, string[]> = {}
    for (const fam of methods) {
      for (const cat of fam.categories) {
        const cl = cat.category.toLowerCase()
        if (keywords.some((k) => cl.includes(k) || k.includes(cl))) {
          for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
        }
      }
    }
    if (Object.keys(next).length === 0) {
      const fam = methods.find((m) => m.family === family)
      if (fam) for (const cat of fam.categories) for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
    }
    setSelected(next)
  }

  const sty: React.CSSProperties = {
    height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
  }
  const count = Object.keys(selected).length
  const triggerLabel = count === 0 ? 'Select indicators…' : `${count} indicator${count === 1 ? '' : 's'} selected`

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'relative' }}>
      <select value={family} onChange={(e) => setFamily(e.target.value)} style={sty}>
        {methods.map((m) => <option key={m.family} value={m.family}>{m.family}</option>)}
      </select>
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={sty}>
        {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
      </select>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...sty, minWidth: 220, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{triggerLabel}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div ref={popRef} style={{
          position: 'absolute', top: 36, right: 0, zIndex: 10, width: 320, maxHeight: 320, overflow: 'auto',
          backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
            borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0,
            backgroundColor: 'var(--bg-elevated)', fontSize: 'var(--text-xs)', gap: 8,
          }}>
            <button type="button" onClick={() => setSelected((prev) => { const n = { ...prev }; for (const i of indicators) n[indicatorKey(i.tuple)] = i.tuple; return n })} style={{ background: 'none', border: 'none', color: 'var(--mod-plca)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>All</button>
            <button type="button" onClick={selectRecommended} style={{ background: 'none', border: 'none', color: 'var(--mod-plca)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600 }}>Recommended</button>
            <button type="button" onClick={() => setSelected((prev) => { const n = { ...prev }; for (const i of indicators) delete n[indicatorKey(i.tuple)]; return n })} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>Clear</button>
          </div>
          {indicators.length === 0 && (
            <div style={{ padding: 12, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>No indicators.</div>
          )}
          {indicators.map((i) => {
            const k = indicatorKey(i.tuple)
            const checked = !!selected[k]
            return (
              <label key={k} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                fontSize: 'var(--text-xs)', color: 'var(--text-primary)', cursor: 'pointer',
                backgroundColor: checked ? 'color-mix(in srgb, var(--mod-plca) 12%, transparent)' : 'transparent',
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(i.tuple)} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.indicator}>{i.indicator}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
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
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  const [scenarioKey, setScenarioKey] = useState<string>('')  // `${base_db}|${iam}|${ssp}`
  const [selectedResultIdx, setSelectedResultIdx] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const startRef = useRef<number | null>(null)

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

  const canRun = !!(activeSystem && simulationResult && mappedCount > 0 && methods.length > 0 && selectedScenario && !mappedUnlinked)

  const handleRun = async () => {
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
    try {
      await run({
        mode: 'projected',
        mfa_system_id: activeSystem.id,
        scope,
        methods,
        year_start: ys,
        year_end: ye,
        scenario: scenarioRef,
      })
    } catch (e) {
      /* handled via store */
    }
  }

  const isRunning = !!projectedJob && !projectedJob.done
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
          Uses cohort mappings from <strong>Static LCI</strong> ({mappedCount} mapped). Matches every year to a prospective database via premise (exact → nearest earlier → earliest available).
        </span>
      </div>

      {/* Controls */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
          <Telescope size={16} color="var(--mod-plca)" />
          <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>Projected LCI run</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1.2fr) minmax(240px, 1.4fr) 1fr 1fr auto', gap: 'var(--space-4)', alignItems: 'flex-end' }}>
          <div>
            <label style={labelS}>Scenario</label>
            {scenarios.length === 0 ? (
              <div style={{ padding: '8px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                No prospective DBs. Generate some in pLCA Developer.
              </div>
            ) : (
              <select
                value={scenarioKey}
                onChange={(e) => setScenarioKey(e.target.value)}
                disabled={isRunning}
                style={selS}
              >
                {scenarios.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.base_db} · {s.iam.toUpperCase()} / {s.ssp} ({s.years.length} year{s.years.length === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            )}
            {selectedScenario && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                Years: {selectedScenario.years.join(', ')}
              </div>
            )}
          </div>

          <div>
            <label style={labelS}>Impact method</label>
            <MethodPicker onChange={setMethods} />
          </div>

          <div>
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
                    padding: '6px 12px', borderRadius: 'var(--radius-md)', cursor: isRunning ? 'not-allowed' : 'pointer',
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
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '6px 0 0 0', lineHeight: 1.4 }}>
              Each scope filters the BOM to the relevant lifecycle stage: Manufacturing → inflows, Use Phase + Maintenance → stock, End of Life → outflows.
            </p>
          </div>

          <div>
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

          <Button variant="primary" onClick={handleRun} disabled={!canRun || isRunning} style={{ backgroundColor: 'var(--mod-plca)', height: 36 }}>
            {isRunning ? <><Loader2 size={14} style={{ animation: 'impact-spin 1s linear infinite' }} /> Calculating…</> : <><Calculator size={14} /> {methods.length > 1 ? `Calculate (${methods.length} methods)` : 'Calculate'}</>}
          </Button>
        </div>

        {mappedCount === 0 && (
          <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} /> No cohorts mapped. Set them in Static LCI first.
          </div>
        )}
        {mappedUnlinked > 0 && (
          <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} /> {mappedUnlinked} mapped archetype{mappedUnlinked === 1 ? '' : 's'} still ha{mappedUnlinked === 1 ? 's' : 've'} unlinked materials.
          </div>
        )}

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
        <>
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

          {/* Method tabs */}
          {projectedResult.results.length > 1 && (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
              {projectedResult.results.map((r, i) => {
                const active = i === selectedResultIdx
                const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedResultIdx(i)}
                    style={{
                      padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500,
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderBottom: active ? '2px solid var(--mod-plca)' : '2px solid transparent',
                      whiteSpace: 'nowrap',
                    }}
                    title={r.method.join(' › ')}
                  >
                    {label}{r.unit ? ` (${r.unit})` : ''}
                  </button>
                )
              })}
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
        </>
      )}
    </div>
  )
}

const labelS: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6,
}
const selS: React.CSSProperties = {
  height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
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
