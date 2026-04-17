import { useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Save, Zap, AlertCircle, CheckSquare, Square, Wand2, Loader2, Download, ChevronDown } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useMFAStore, type CohortMappingValue } from '../../stores/mfaStore'
import { useBOMStore } from '../../stores/bomStore'
import { useImpactStore } from '../../stores/impactStore'
import { getMethods, type DimensionDef, type MethodFamily } from '../../api/client'

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

// Size-based scale defaults for auto-match. Keys are lowercase tokens looked up
// inside the cohort key parts — first match wins. Values approximate kerb-weight
// ratios vs a ~1,200 kg compact reference (ICCT/IEA).
const SIZE_SCALES: Array<[string, number]> = [
  ['small', 1.0],
  ['sedan', 1.30],
  ['medium', 1.30],
  ['suv', 1.55],
  ['large', 1.55],
  ['truck', 1.8],
]

function scaleFromCohortKey(ck: string): number {
  const lower = ck.toLowerCase()
  for (const [token, scale] of SIZE_SCALES) {
    if (lower.includes(token)) return scale
  }
  return 1.0
}

// Simple fuzzy score: count of cohort tokens that appear in archetype name.
function fuzzyScore(cohortKey: string, archetypeName: string): number {
  const an = archetypeName.toLowerCase()
  const tokens = cohortKey.toLowerCase().split(/[|\s_\-/]+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0
  let hits = 0
  for (const t of tokens) if (an.includes(t)) hits++
  return hits / tokens.length
}

function parseCohortKey(key: string, dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return nads.map((_, i) => parts[i] ?? '')
}

function enumerateCohortKeys(dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  if (nads.length === 0) return []
  const labelLists = nads.map((d) => d.labels)
  const out: string[][] = [[]]
  for (const labels of labelLists) {
    const next: string[][] = []
    for (const acc of out) for (const l of labels) next.push([...acc, l])
    out.length = 0
    out.push(...next)
  }
  return out.map((parts) => parts.join(COHORT_SEP))
}

const indicatorKey = (t: string[]) => t.join('|')

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

  useEffect(() => {
    onChange(Object.values(selected))
  }, [selected, onChange])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (tuple: string[]) => {
    const k = indicatorKey(tuple)
    setSelected((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]
      else next[k] = tuple
      return next
    })
  }

  const selectAll = () => {
    setSelected((prev) => {
      const next = { ...prev }
      for (const i of indicators) next[indicatorKey(i.tuple)] = i.tuple
      return next
    })
  }

  const deselectCurrent = () => {
    setSelected((prev) => {
      const next = { ...prev }
      for (const i of indicators) delete next[indicatorKey(i.tuple)]
      return next
    })
  }

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
      // Fallback: pick all indicators from the first family
      const fam = methods.find((m) => m.family === family)
      if (fam) for (const cat of fam.categories) for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
    }
    setSelected(next)
  }

  const count = Object.keys(selected).length
  const triggerLabel = count === 0 ? 'Select indicators…' : `${count} indicator${count === 1 ? '' : 's'} selected`

  const sty: React.CSSProperties = {
    height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'relative' }}>
      <select value={family} onChange={(e) => setFamily(e.target.value)} style={sty}>
        {methods.map((m) => <option key={m.family} value={m.family}>{m.family}</option>)}
      </select>
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={sty}>
        {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
      </select>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...sty,
          minWidth: 200, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 6, cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{triggerLabel}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          ref={popRef}
          style={{
            position: 'absolute', top: 36, right: 0, zIndex: 10, width: 320, maxHeight: 320, overflow: 'auto',
            backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.2))',
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
            borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0,
            backgroundColor: 'var(--bg-elevated)', fontSize: 'var(--text-xs)', gap: 8,
          }}>
            <button type="button" onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--mod-lca)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
              All
            </button>
            <button type="button" onClick={selectRecommended} style={{ background: 'none', border: 'none', color: 'var(--mod-lca)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
              Recommended
            </button>
            <button type="button" onClick={deselectCurrent} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
              Clear
            </button>
          </div>
          {indicators.length === 0 && (
            <div style={{ padding: 12, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>No indicators for this category.</div>
          )}
          {indicators.map((i) => {
            const k = indicatorKey(i.tuple)
            const checked = !!selected[k]
            return (
              <label
                key={k}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  fontSize: 'var(--text-xs)', color: 'var(--text-primary)', cursor: 'pointer',
                  backgroundColor: checked ? 'color-mix(in srgb, var(--mod-lca) 10%, transparent)' : 'transparent',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(i.tuple)} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.indicator}>
                  {i.indicator}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MFAImpactPanel() {
  const {
    activeSystem,
    simulationResult,
    selectedYear,
    cohortMappings,
    mfaLCAResults,
    selectedResultIndex,
    isCalculatingLCA,
    error,
    fetchCohortMappings,
    saveCohortMappings,
    runMFALCA,
    selectResultIndex,
    exportMFALCAResults,
  } = useMFAStore()

  const { archetypes, fetchArchetypes } = useBOMStore()

  const [draftMappings, setDraftMappings] = useState<Record<string, CohortMappingValue>>({})
  const [scope, setScope] = useState<'inflows' | 'outflows' | 'stock' | 'all'>('stock')
  const [methods, setMethods] = useState<string[][]>([])
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [mappingToast, setMappingToast] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [completedElapsed, setCompletedElapsed] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const startRef = useRef<number | null>(null)

  const mfaLCAResult = mfaLCAResults[selectedResultIndex] ?? null
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

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => { if (activeSystem) fetchCohortMappings() }, [activeSystem?.id, fetchCohortMappings])
  useEffect(() => { setDraftMappings({ ...cohortMappings }) }, [cohortMappings])

  useEffect(() => {
    if (!activeSystem || mfaLCAResults.length === 0) return
    const first = mfaLCAResults[0]
    useImpactStore.getState().setStaticFromMFA({
      mfaSystemId: activeSystem.id,
      results: mfaLCAResults,
      scope: first.scope,
      yearStart: yearStart ?? null,
      yearEnd: yearEnd ?? null,
    })
  }, [mfaLCAResults, activeSystem?.id, yearStart, yearEnd])

  useEffect(() => {
    if (!isCalculatingLCA) {
      if (startRef.current != null) {
        setCompletedElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }
      startRef.current = null
      setElapsed(0)
      return
    }
    setCompletedElapsed(null)
    startRef.current = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => {
      if (startRef.current != null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [isCalculatingLCA])

  // Default detailYear from results
  useEffect(() => {
    if (mfaLCAResult && mfaLCAResult.years.length > 0) {
      const yrs = mfaLCAResult.years
      setDetailYear(yrs[Math.floor(yrs.length / 2)]?.year ?? yrs[0].year)
    }
  }, [mfaLCAResult])

  const cohortKeys = useMemo(() => activeSystem ? enumerateCohortKeys(activeSystem.dimensions) : [], [activeSystem])
  const nonAgeDims = useMemo(() => activeSystem?.dimensions.filter((d) => !d.is_age) ?? [], [activeSystem])

  const dirty = useMemo(() => {
    const a = JSON.stringify(draftMappings)
    const b = JSON.stringify(cohortMappings)
    return a !== b
  }, [draftMappings, cohortMappings])

  const mappedCount = Object.values(draftMappings).filter((v) => v?.archetype_id).length
  const archetypesWithIssues = useMemo(() => {
    return new Set(archetypes.filter((a) => a.unlinked_count > 0).map((a) => a.id))
  }, [archetypes])

  const handleSaveMappings = async () => {
    await saveCohortMappings(draftMappings)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  const handleCalculate = async () => {
    if (methods.length === 0 || mappedCount === 0) return
    const ys = yearStart ?? undefined
    const ye = yearEnd ?? undefined
    const fullStart = availableYears[0]
    const fullEnd = availableYears[availableYears.length - 1]
    const effectiveYs = ys != null && ys !== fullStart ? ys : null
    const effectiveYe = ye != null && ye !== fullEnd ? ye : null
    await runMFALCA(methods, scope, { yearStart: effectiveYs, yearEnd: effectiveYe })
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await exportMFALCAResults(selectedYear)
    } finally {
      setIsExporting(false)
    }
  }

  const showToast = (msg: string) => {
    setMappingToast(msg)
    window.setTimeout(() => setMappingToast(null), 2500)
  }

  const handleSelectAll = () => {
    if (archetypes.length === 0) return
    const first = archetypes[0]
    const next = { ...draftMappings }
    let added = 0
    for (const ck of cohortKeys) {
      if (next[ck]?.archetype_id) continue
      next[ck] = { archetype_id: first.id, scaling_factor: scaleFromCohortKey(ck) }
      added++
    }
    setDraftMappings(next)
    showToast(added === 0 ? 'All cohorts already mapped' : `Assigned "${first.name}" to ${added} unmapped cohort${added === 1 ? '' : 's'}`)
  }

  const handleClearAll = () => {
    if (Object.keys(draftMappings).length === 0) return
    setDraftMappings({})
    showToast('Cleared all mappings')
  }

  const handleAutoMatch = () => {
    if (archetypes.length === 0) return
    const next = { ...draftMappings }
    let matched = 0
    for (const ck of cohortKeys) {
      let best: { id: string; score: number } | null = null
      for (const a of archetypes) {
        const s = fuzzyScore(ck, a.name)
        if (s > 0 && (!best || s > best.score)) best = { id: a.id, score: s }
      }
      if (best && best.score >= 0.5) {
        next[ck] = { archetype_id: best.id, scaling_factor: scaleFromCohortKey(ck) }
        matched++
      }
    }
    setDraftMappings(next)
    showToast(`Auto-matched ${matched} of ${cohortKeys.length} cohorts`)
  }

  const yearCount = useMemo(() => {
    if (yearStart != null && yearEnd != null) return Math.max(0, yearEnd - yearStart + 1)
    if (activeSystem) return activeSystem.time_horizon.end_year - activeSystem.time_horizon.start_year + 1
    return 0
  }, [yearStart, yearEnd, activeSystem])

  // Stacked area: years × cohort impact
  const areaData = useMemo(() => {
    if (!mfaLCAResult) return []
    return mfaLCAResult.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const [ck, impact] of Object.entries(yr.impact_by_cohort)) row[ck] = impact
      return row
    })
  }, [mfaLCAResult])

  const cohortStackKeys = useMemo(() => {
    if (!mfaLCAResult) return []
    const all = new Set<string>()
    mfaLCAResult.years.forEach((yr) => Object.keys(yr.impact_by_cohort).forEach((k) => all.add(k)))
    return Array.from(all)
  }, [mfaLCAResult])

  // Selected year breakdown
  const yearBreakdown = useMemo(() => {
    if (!mfaLCAResult || detailYear == null) return null
    const yr = mfaLCAResult.years.find((y) => y.year === detailYear) ?? mfaLCAResult.years[0]
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
  }, [mfaLCAResult, detailYear])

  const materialBars = useMemo(() => {
    if (!mfaLCAResult || detailYear == null) return []
    const yr = mfaLCAResult.years.find((y) => y.year === detailYear) ?? mfaLCAResult.years[0]
    if (!yr) return []
    return Object.entries(yr.impact_by_material)
      .map(([name, impact]) => ({ name, impact }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 12)
  }, [mfaLCAResult, detailYear])

  if (!activeSystem) return null

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Cohort mapping table ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>Cohort → Archetype</h3>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Map each cohort to an archetype and optionally tune the scale (Small ≈ 1.00, Sedan ≈ 1.30, SUV ≈ 1.55 based on ICCT/IEA kerb weight). {mappedCount} of {cohortKeys.length} mapped.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {mappingToast && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{mappingToast}</span>}
            {savedFlash && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--success)' }}>Saved ✓</span>}
            <Button variant="ghost" onClick={handleAutoMatch} disabled={archetypes.length === 0} title="Guess mappings by fuzzy-matching cohort names to archetype names">
              <Wand2 size={14} /> Auto-match
            </Button>
            <Button variant="ghost" onClick={handleSelectAll} disabled={archetypes.length === 0} title="Assign the first archetype to every unmapped cohort">
              <CheckSquare size={14} /> Select all
            </Button>
            <Button variant="ghost" onClick={handleClearAll} disabled={Object.keys(draftMappings).length === 0} title="Remove all archetype assignments">
              <Square size={14} /> Clear all
            </Button>
            <Button variant="primary" onClick={handleSaveMappings} disabled={!dirty} style={{ backgroundColor: 'var(--mod-mfa)' }}>
              <Save size={14} /> Save mappings
            </Button>
          </div>
        </div>

        {archetypes.length === 0 ? (
          <div style={{ padding: 12, fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            No archetypes defined. Create one in the LCA → Archetypes tab first.
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: 320 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {nonAgeDims.map((d) => (
                    <th key={d.name} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0 }}>
                      {d.display_name || d.name}
                    </th>
                  ))}
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0 }}>
                    Archetype
                  </th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0 }}>
                    Scale
                  </th>
                </tr>
              </thead>
              <tbody>
                {cohortKeys.map((ck) => {
                  const parts = parseCohortKey(ck, activeSystem.dimensions)
                  const current = draftMappings[ck]
                  const archetypeId = current?.archetype_id ?? ''
                  const scalingFactor = current?.scaling_factor ?? 1.0
                  const issue = archetypeId && archetypesWithIssues.has(archetypeId)
                  return (
                    <tr key={ck} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {nonAgeDims.map((d, i) => (
                        <td key={d.name} style={{ padding: '6px 10px' }}>
                          <Badge label={parts[i] ?? ''} variant="mfa" />
                        </td>
                      ))}
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            value={archetypeId}
                            onChange={(e) => {
                              const nextId = e.target.value
                              const next = { ...draftMappings }
                              if (!nextId) {
                                delete next[ck]
                              } else {
                                next[ck] = { archetype_id: nextId, scaling_factor: scalingFactor || 1.0 }
                              }
                              setDraftMappings(next)
                            }}
                            style={{
                              height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                              color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none', minWidth: 220,
                            }}
                          >
                            <option value="">— unmapped —</option>
                            {archetypes.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}{a.unlinked_count > 0 ? ` (${a.unlinked_count} unlinked)` : ''}
                              </option>
                            ))}
                          </select>
                          {issue && (
                            <span title="This archetype has unlinked materials" style={{ color: 'var(--warning)', display: 'flex' }}>
                              <AlertCircle size={14} />
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <input
                          type="number"
                          step={0.05}
                          min={0.01}
                          value={archetypeId ? scalingFactor : ''}
                          disabled={!archetypeId}
                          placeholder="1.00"
                          onChange={(e) => {
                            const raw = e.target.value
                            const parsed = raw === '' ? 1.0 : Number(raw)
                            const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0
                            setDraftMappings({
                              ...draftMappings,
                              [ck]: { archetype_id: archetypeId, scaling_factor: safe },
                            })
                          }}
                          title="Multiplier applied to every material quantity for this cohort. Defaults: Small ≈ 1.00 (~1,200 kg compact), Sedan ≈ 1.30 (~1,560 kg mid-size), SUV ≈ 1.55 (~1,860 kg crossover)."
                          style={{
                            width: 72, height: 28, padding: '0 6px',
                            backgroundColor: archetypeId ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                            color: 'var(--text-primary)', fontSize: 'var(--text-sm)',
                            fontFamily: 'var(--font-mono)', textAlign: 'right', outline: 'none',
                            opacity: archetypeId ? 1 : 0.4,
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Calculate environmental impact ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
          <Zap size={16} color="var(--mod-lca)" />
          <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>Calculate Environmental Impact</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.5fr) 1fr 1fr auto', gap: 'var(--space-4)', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Impact Method
            </label>
            <MethodPicker onChange={setMethods} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Scope
            </label>
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
                  disabled={isCalculatingLCA}
                  title={s.tip}
                  style={{
                    padding: '6px 12px', borderRadius: 'var(--radius-md)', cursor: isCalculatingLCA ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (scope === s.value ? 'var(--mod-lca)' : 'var(--border-default)'),
                    backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)' : 'var(--bg-elevated)',
                    color: scope === s.value ? 'var(--mod-lca)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                    opacity: isCalculatingLCA ? 0.5 : 1, whiteSpace: 'nowrap',
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
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Years
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={yearStart ?? ''}
                onChange={(e) => setYearStart(Number(e.target.value))}
                disabled={isCalculatingLCA || availableYears.length === 0}
                style={{
                  height: 32, padding: '0 6px', backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
                }}
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>to</span>
              <select
                value={yearEnd ?? ''}
                onChange={(e) => setYearEnd(Number(e.target.value))}
                disabled={isCalculatingLCA || availableYears.length === 0}
                style={{
                  height: 32, padding: '0 6px', backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
                }}
              >
                {availableYears.filter((y) => yearStart == null || y >= yearStart).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={handleCalculate}
            disabled={methods.length === 0 || mappedCount === 0 || isCalculatingLCA}
            style={{ backgroundColor: 'var(--mod-lca)', height: 36 }}
          >
            {isCalculatingLCA ? (
              <>
                <Loader2 size={14} style={{ animation: 'mfa-spin 1s linear infinite' }} />
                Calculating…
              </>
            ) : (
              <>
                <Calculator size={14} />
                {methods.length > 1 ? ` Calculate (${methods.length} methods)` : ' Calculate'}
              </>
            )}
          </Button>
        </div>

        {isCalculatingLCA && (
          <div style={{ marginTop: 'var(--space-3)', padding: '10px 12px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              <span>Running LCA for {yearCount} year{yearCount === 1 ? '' : 's'} × {mappedCount} cohort{mappedCount === 1 ? '' : 's'} × {methods.length} indicator{methods.length === 1 ? '' : 's'}…</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                Elapsed: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </span>
            </div>
            <div style={{ height: 4, backgroundColor: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
              <div
                style={{
                  position: 'absolute', top: 0, bottom: 0, width: '33%',
                  backgroundColor: 'var(--mod-lca)',
                  animation: 'mfa-progress 1.6s ease-in-out infinite',
                }}
              />
            </div>
            <style>
              {`@keyframes mfa-spin { to { transform: rotate(360deg); } }
                @keyframes mfa-progress { 0% { left: -33%; } 100% { left: 100%; } }`}
            </style>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Results ─── */}
      {mfaLCAResult && (
        <>
          {/* Method tab bar (only when multiple methods) + export */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {mfaLCAResults.length > 1 ? (
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', flex: 1, overflowX: 'auto' }}>
                {mfaLCAResults.map((r, i) => {
                  const active = i === selectedResultIndex
                  const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                  return (
                    <button
                      key={i}
                      onClick={() => selectResultIndex(i)}
                      style={{
                        padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500,
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        borderBottom: active ? '2px solid var(--mod-lca)' : '2px solid transparent',
                        whiteSpace: 'nowrap',
                      }}
                      title={r.method.join(' › ')}
                    >
                      {label}{r.unit ? ` (${r.unit})` : ''}
                    </button>
                  )
                })}
              </div>
            ) : <span />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {completedElapsed != null && completedElapsed > 0 && (
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', padding: '2px 8px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  Calculated in {Math.floor(completedElapsed / 60) > 0 ? `${Math.floor(completedElapsed / 60)}m ` : ''}{completedElapsed % 60}s
                </span>
              )}
              <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
                <Download size={14} /> {isExporting ? 'Exporting…' : 'Export Excel'}
              </Button>
            </div>
          </div>

          {/* Summary card */}
          <div style={cardStyle}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              Cumulative impact ({mfaLCAResult.scope}, {mfaLCAResult.method.join(' › ')})
            </div>
            {mfaLCAResult.stages_included && mfaLCAResult.stages_included.length > 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                Stages: {mfaLCAResult.stages_included.join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-lca)' }}>
                {fmt(mfaLCAResult.summary.total_impact)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{mfaLCAResult.unit}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 16 }}>
                Peak in {mfaLCAResult.summary.peak_year}: {fmt(mfaLCAResult.summary.peak_impact)} {mfaLCAResult.unit}
              </span>
            </div>
          </div>

          {/* Stacked area chart */}
          <div style={cardStyle}>
            <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Impact over time, by cohort
            </h4>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis
                    stroke="var(--text-tertiary)"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    tickFormatter={fmtAxis}
                    label={{ value: mfaLCAResult.unit, angle: -90, position: 'insideLeft', style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                    formatter={(v) => (typeof v === 'number' ? fmt(v) : String(v))}
                  />
                  {cohortStackKeys.map((k, i) => (
                    <Area
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stackId="1"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.7}
                      isAnimationActive={false}
                    />
                  ))}
                  <ReferenceLine x={detailYear ?? undefined} stroke="var(--mod-mfa)" strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Year detail selector */}
          {mfaLCAResult.years.length > 0 && (
            <div style={{ ...cardStyle, padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Year detail
              </span>
              <select
                value={detailYear ?? ''}
                onChange={(e) => setDetailYear(Number(e.target.value))}
                style={{
                  height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
                }}
              >
                {mfaLCAResult.years.map((yr) => (
                  <option key={yr.year} value={yr.year}>{yr.year}</option>
                ))}
              </select>
              {detailYear != null && yearBreakdown && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Total: {fmt(yearBreakdown.yr.total_impact)} {mfaLCAResult.unit}
                </span>
              )}
            </div>
          )}

          {/* Year breakdown + material bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 'var(--space-4)' }}>
            {yearBreakdown && (
              <div style={cardStyle}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                  Impact by cohort in {yearBreakdown.yr.year}
                </h4>
                <div style={{ overflow: 'auto', maxHeight: 320 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Cohort</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Count</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Per unit</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Total ({mfaLCAResult.unit})</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>%</th>
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
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{fmtCount(row.count)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{fmt(row.perUnit)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--mod-lca)', fontWeight: 600 }}>{fmt(row.total)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{row.pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={cardStyle}>
              <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                Material contribution {detailYear != null ? `(${detailYear})` : ''}
              </h4>
              <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={materialBars} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 12 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      stroke="var(--text-tertiary)"
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      tickFormatter={fmtAxis}
                      label={{ value: mfaLCAResult.unit, position: 'insideBottom', offset: -6, style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                    />
                    <YAxis type="category" dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={120} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                      formatter={(v) => (typeof v === 'number' ? fmt(v) : String(v))}
                    />
                    <Bar dataKey="impact" fill="var(--mod-lca)" fillOpacity={0.85} isAnimationActive={false} />
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
