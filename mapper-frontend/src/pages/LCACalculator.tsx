import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2, Download, X } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useBOMStore } from '../stores/bomStore'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ContributionTreemap } from '../components/charts/ContributionTreemap'
import {
  searchAllActivities,
  calculateArchetypeLCA,
  calculateActivityLCA,
  exportArchetypeLCA,
  type ActivitySummary,
  type ActivityDemandItem,
  type ActivityLCAResult,
  type ActivityLCAMethodResult,
  type ArchetypeLCACalculateResult,
  type ArchetypeLCAMethodResult,
  type ArchetypeSummary,
} from '../api/client'
import { MethodPicker } from '../components/MethodPicker'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
  '#e07b53', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981',
]

type FUMode = 'archetype' | 'activity'
type Scope = 'inflows' | 'stock' | 'outflows' | 'all'

const SCOPE_OPTIONS: { value: Scope; label: string; tip: string }[] = [
  { value: 'inflows', label: 'Manufacturing', tip: 'Manufacturing stage only' },
  { value: 'stock', label: 'Operation', tip: 'Use Phase + Maintenance' },
  { value: 'outflows', label: 'End of Life', tip: 'End of Life stage only' },
  { value: 'all', label: 'Full lifecycle', tip: 'All stages combined' },
]

/** Mirror backend stage_to_scope: classify a BOM stage name into a scope. */
function stageToScope(stageName: string): 'inflows' | 'stock' | 'outflows' {
  const n = stageName.toLowerCase()
  const stockKw = ['use', 'operation', 'driving', 'maintenance', 'service', 'repair']
  const outKw = ['end of life', 'end-of-life', 'eol', 'disposal', 'recycl', 'scrap']
  if (stockKw.some((kw) => n.includes(kw))) return 'stock'
  if (outKw.some((kw) => n.includes(kw))) return 'outflows'
  return 'inflows'
}

type AmountPreset = '1year' | 'lifetime' | 'custom'

const fmt = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

// ── Activity autocomplete ──────────────────────────────────────────────────────

function ActivitySearch({ onSelect }: { onSelect: (act: ActivitySummary) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ActivitySummary[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const items = await searchAllActivities(q, 50, true)
      setResults(items)
      setOpen(true)
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = (v: string) => {
    setQuery(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(v), 300)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={16} strokeWidth={1.5} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input
          type="text"
          placeholder="Search for an activity…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ width: '100%', height: 36, paddingLeft: 34, paddingRight: 12, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none' }}
          onFocusCapture={(e) => { e.target.style.borderColor = 'var(--border-focus)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)' }}
          onBlurCapture={(e) => { e.target.style.borderColor = 'var(--border-default)'; e.target.style.boxShadow = 'none' }}
        />
        {searching && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>…</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', zIndex: 50, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          {results.map((act) => (
            <button
              key={act.key}
              onMouseDown={() => { onSelect(act); setQuery(act.product || act.name); setOpen(false) }}
              style={{ width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>{act.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{act.product}</div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {act.database && <Badge label={act.database} variant="default" />}
                {act.location && <Badge label={act.location} variant="default" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main LCACalculator ─────────────────────────────────────────────────────────

interface LCACalculatorProps {
  onNavigateToExplorer?: (activityKey: string) => void
}

export function LCACalculator({ onNavigateToExplorer: _onNavigateToExplorer }: LCACalculatorProps) {
  const { archetypes, fetchArchetypes } = useBOMStore()

  // ── State ──
  const [fuMode, setFuMode] = useState<FUMode>('archetype')
  const [selectedArchetypes, setSelectedArchetypes] = useState<ArchetypeSummary[]>([])
  const [scope, setScope] = useState<Scope>('all')

  // Per-archetype stage amounts (keyed by archetype ID)
  interface PerArchetypeAmounts { preset: AmountPreset; lifetime: number; amounts: Record<string, number> }
  const [arcAmountsMap, setArcAmountsMap] = useState<Record<string, PerArchetypeAmounts>>({})
  const [selectedMethods, setSelectedMethods] = useState<string[][]>([])
  const [vizTab, setVizTab] = useState<'contributions' | 'treemap' | 'sankey'>('contributions')
  const [contribView, setContribView] = useState<'material' | 'stage'>('material')

  // Archetype mode state (multi-archetype)
  const [arcResults, setArcResults] = useState<ArchetypeLCACalculateResult[]>([])
  const [arcResultIndex, setArcResultIndex] = useState(0)
  const [arcCalculating, setArcCalculating] = useState(false)
  const [arcError, setArcError] = useState<string | null>(null)
  const [arcElapsed, setArcElapsed] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const arcTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Activity mode state (multi-activity)
  interface DemandEntry { act: ActivitySummary; amount: number }
  const [actDemand, setActDemand] = useState<DemandEntry[]>([])
  const [actResult, setActResult] = useState<ActivityLCAResult | null>(null)
  const [actResultIndex, setActResultIndex] = useState(0)
  const [actCalculating, setActCalculating] = useState(false)
  const [actError, setActError] = useState<string | null>(null)
  const [actElapsed, setActElapsed] = useState(0)
  const actTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isMultiMode = arcResults.length > 1
  const arcResult = arcResults[0] ?? null
  const activeArcResult: ArchetypeLCAMethodResult | null = arcResult?.results[arcResultIndex] ?? null
  const activeActResult: ActivityLCAMethodResult | null = actResult?.results[actResultIndex] ?? null

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])

  // ── Per-archetype helpers ──
  // Initialise amounts entry for an archetype when it's first selected
  const initArcAmounts = useCallback((arc: ArchetypeSummary): PerArchetypeAmounts => {
    const amounts: Record<string, number> = {}
    for (const s of arc.stages ?? []) amounts[s] = 1
    return { preset: '1year', lifetime: 15, amounts }
  }, [])

  // Ensure every selected archetype has an entry in arcAmountsMap
  useEffect(() => {
    setArcAmountsMap((prev) => {
      const next = { ...prev }
      let changed = false
      for (const arc of selectedArchetypes) {
        if (!next[arc.id]) { next[arc.id] = initArcAmounts(arc); changed = true }
      }
      // Remove entries for deselected archetypes
      for (const id of Object.keys(next)) {
        if (!selectedArchetypes.some((a) => a.id === id)) { delete next[id]; changed = true }
      }
      return changed ? next : prev
    })
  }, [selectedArchetypes, initArcAmounts])

  // Recalculate amounts for a specific archetype when preset/lifetime changes
  const applyPreset = useCallback((arcId: string, preset: AmountPreset, lifetime: number, arc: ArchetypeSummary) => {
    setArcAmountsMap((prev) => {
      const entry = prev[arcId] ?? initArcAmounts(arc)
      const amounts: Record<string, number> = {}
      for (const s of arc.stages ?? []) {
        const annual = arc.stage_annual?.[s] ?? false
        if (preset === '1year') amounts[s] = 1
        else if (preset === 'lifetime') amounts[s] = annual ? lifetime : 1
        else amounts[s] = entry.amounts[s] ?? 1
      }
      return { ...prev, [arcId]: { preset, lifetime, amounts } }
    })
  }, [initArcAmounts])

  const stageInScope = useCallback((stage: string) => {
    if (scope === 'all') return true
    return stageToScope(stage) === scope
  }, [scope])

  // ── Activity demand list management ──
  const addActivity = (act: ActivitySummary) => {
    // Don't add duplicates
    if (actDemand.some((d) => d.act.key === act.key)) return
    // Block biosphere flows
    if (act.database.toLowerCase().includes('biosphere')) {
      setActError('Biosphere flows cannot be used as functional units. Select a technosphere activity from ecoinvent.')
      return
    }
    setActDemand((prev) => [...prev, { act, amount: 1 }])
    setActError(null)
  }
  const removeActivity = (key: string) => setActDemand((prev) => prev.filter((d) => d.act.key !== key))
  const updateActivityAmount = (key: string, amount: number) =>
    setActDemand((prev) => prev.map((d) => d.act.key === key ? { ...d, amount } : d))

  // ── Archetype calculate (supports multi-archetype) ──
  const handleArchetypeCalculate = async () => {
    if (selectedArchetypes.length === 0 || selectedMethods.length === 0) return
    setArcCalculating(true)
    setArcError(null)
    setArcResults([])
    setArcElapsed(0)
    arcTimerRef.current = setInterval(() => setArcElapsed((e) => e + 1), 1000)
    try {
      const results = await Promise.all(
        selectedArchetypes.map((arc) => {
          const entry = arcAmountsMap[arc.id]
          const sa = entry && Object.keys(entry.amounts).length > 0 ? entry.amounts : undefined
          return calculateArchetypeLCA(arc.id, scope, selectedMethods, sa)
        }),
      )
      setArcResults(results)
      setArcResultIndex(0)
    } catch (e: unknown) {
      setArcError(e instanceof Error ? e.message : String(e))
    } finally {
      if (arcTimerRef.current) clearInterval(arcTimerRef.current)
      setArcCalculating(false)
    }
  }

  // ── Activity calculate (multi-activity via REST) ──
  const handleActivityCalculate = async () => {
    if (actDemand.length === 0 || selectedMethods.length === 0) return
    setActCalculating(true)
    setActError(null)
    setActResult(null)
    setActElapsed(0)
    actTimerRef.current = setInterval(() => setActElapsed((e) => e + 1), 1000)
    try {
      const activities: ActivityDemandItem[] = actDemand.map((d) => ({
        database: d.act.database,
        code: d.act.code,
        amount: d.amount,
      }))
      const result = await calculateActivityLCA(activities, selectedMethods)
      setActResult(result)
      setActResultIndex(0)
    } catch (e: unknown) {
      setActError(e instanceof Error ? e.message : String(e))
    } finally {
      if (actTimerRef.current) clearInterval(actTimerRef.current)
      setActCalculating(false)
    }
  }

  const handleExport = async () => {
    if (arcResults.length === 0) return
    setIsExporting(true)
    try {
      const names = arcResults.map((r) => r.archetype_name.replace(/[^\w.-]+/g, '_')).join('_')
      const date = new Date().toISOString().slice(0, 10)
      await exportArchetypeLCA(arcResults, `MApper_LCA_${names}_${scope}_${date}.xlsx`)
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setIsExporting(false)
    }
  }

  const toggleArchetype = (arc: ArchetypeSummary) => {
    setSelectedArchetypes((prev) => {
      const exists = prev.find((a) => a.id === arc.id)
      if (exists) return prev.filter((a) => a.id !== arc.id)
      if (prev.length >= 6) return prev
      return [...prev, arc]
    })
  }

  const handleReset = () => {
    setArcResults([])
    setArcError(null)
    setArcResultIndex(0)
    setActResult(null)
    setActError(null)
    setActResultIndex(0)
  }

  const canCalculateArchetype = selectedArchetypes.length > 0 && selectedMethods.length > 0 && !arcCalculating
  const canCalculateActivity = actDemand.length > 0 && selectedMethods.length > 0 && !actCalculating

  // ── Archetype contribution data for treemap ──
  const arcTreemapItems = useMemo(() => {
    if (!activeArcResult) return null
    const items = activeArcResult.contributions.slice(0, 15).map((c) => ({
      activity_name: c.name,
      activity_key: '',
      location: c.stage,
      amount: c.impact,
      unit: activeArcResult.unit,
      percentage: c.percentage,
    }))
    const restImpact = activeArcResult.score - items.reduce((s, i) => s + i.amount, 0)
    return {
      items,
      rest_amount: restImpact,
      rest_percentage: activeArcResult.score ? (Math.abs(restImpact) / Math.abs(activeArcResult.score) * 100) : 0,
    }
  }, [activeArcResult])

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  const headCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)',
    color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)',
    position: 'sticky', top: 0,
  }

  const numCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
  }

  const hasAnyResult = (fuMode === 'archetype' && arcResults.length > 0) || (fuMode === 'activity' && actResult !== null)

  // ── Stage aggregation (for "by stage" view) ──
  const stageData = useMemo(() => {
    if (!activeArcResult) return []
    const map: Record<string, { stage: string; impact: number; topName: string; topImpact: number }> = {}
    for (const c of activeArcResult.contributions) {
      const s = c.stage || '(unknown)'
      if (!map[s]) map[s] = { stage: s, impact: 0, topName: '', topImpact: 0 }
      map[s].impact += c.impact
      if (Math.abs(c.impact) > Math.abs(map[s].topImpact)) {
        map[s].topName = c.name
        map[s].topImpact = c.impact
      }
    }
    const arr = Object.values(map)
    const total = arr.reduce((s, v) => s + Math.abs(v.impact), 0)
    return arr
      .map((v) => ({ ...v, percentage: total ? (Math.abs(v.impact) / total) * 100 : 0 }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  }, [activeArcResult])

  // ── Multi-archetype comparison data ──
  const comparisonData = useMemo(() => {
    if (arcResults.length < 2 || arcResults[0]?.results.length === 0) return null
    const methodIdx = arcResultIndex
    return arcResults.map((ar, i) => {
      const r = ar.results[methodIdx]
      return { name: ar.archetype_name, score: r?.score ?? 0, unit: r?.unit ?? '', color: CHART_COLORS[i % CHART_COLORS.length] }
    })
  }, [arcResults, arcResultIndex])

  const comparisonTable = useMemo(() => {
    if (arcResults.length < 2) return null
    return arcResults.map((ar) => ({
      name: ar.archetype_name,
      scores: ar.results.map((r) => ({ score: r.score, unit: r.unit })),
    }))
  }, [arcResults])

  const comparisonStageData = useMemo(() => {
    if (arcResults.length < 2) return null
    const methodIdx = arcResultIndex
    return arcResults.map((ar, i) => {
      const r = ar.results[methodIdx]
      if (!r) return { name: ar.archetype_name, stages: {} as Record<string, number>, color: CHART_COLORS[i % CHART_COLORS.length] }
      const stages: Record<string, number> = {}
      for (const c of r.contributions) {
        const s = c.stage || '(unknown)'
        stages[s] = (stages[s] ?? 0) + c.impact
      }
      return { name: ar.archetype_name, stages, color: CHART_COLORS[i % CHART_COLORS.length] }
    })
  }, [arcResults, arcResultIndex])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>LCA Calculator</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>Calculate life cycle assessment impacts</p>
        </div>
        {hasAnyResult && <Button variant="ghost" onClick={handleReset}>New Calculation</Button>}
      </div>

      {/* Setup form */}
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
          {/* Left: Functional unit */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>
              Functional Unit
            </label>

            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {(['archetype', 'activity'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFuMode(m)}
                  style={{
                    flex: 1, padding: '6px 12px', border: 'none', cursor: 'pointer',
                    backgroundColor: fuMode === m ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: fuMode === m ? 'white' : 'var(--text-secondary)',
                    fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'capitalize',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Mode A: Archetype (multi-select) */}
            {fuMode === 'archetype' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-elevated)' }}>
                  {archetypes.length === 0 && (
                    <div style={{ padding: 10, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>No archetypes available</div>
                  )}
                  {archetypes.map((a) => {
                    const checked = selectedArchetypes.some((s) => s.id === a.id)
                    return (
                      <label
                        key={a.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                          cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--text-primary)',
                          backgroundColor: checked ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                        }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleArchetype(a)} style={{ accentColor: 'var(--accent)' }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.name}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                          {a.material_count}m{a.unlinked_count > 0 ? ` · ${a.unlinked_count}u` : ''}
                        </span>
                      </label>
                    )
                  })}
                </div>
                {selectedArchetypes.length > 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    {selectedArchetypes.length} archetype{selectedArchetypes.length === 1 ? '' : 's'} selected
                    {selectedArchetypes.length >= 6 && ' (max)'}
                  </div>
                )}

                {/* Scope */}
                <div>
                  <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
                    Scope
                  </label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SCOPE_OPTIONS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setScope(s.value)}
                        title={s.tip}
                        style={{
                          padding: '5px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                          border: '1px solid ' + (scope === s.value ? 'var(--accent)' : 'var(--border-default)'),
                          backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-elevated)',
                          color: scope === s.value ? 'var(--accent)' : 'var(--text-primary)',
                          fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Per-archetype stage amounts */}
                {selectedArchetypes.length > 0 && selectedArchetypes.some((a) => (a.stages?.length ?? 0) > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: selectedArchetypes.length > 1 ? 8 : 0 }}>
                    <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                      Stage amounts
                    </label>
                    {selectedArchetypes.map((arc) => {
                      const entry = arcAmountsMap[arc.id]
                      if (!entry) return null
                      const stages = arc.stages ?? []
                      if (stages.length === 0) return null
                      const showCard = selectedArchetypes.length > 1
                      return (
                        <div
                          key={arc.id}
                          style={showCard ? {
                            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                            padding: 8, backgroundColor: 'var(--bg-surface)',
                          } : {}}
                        >
                          {showCard && (
                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                              {arc.name}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                            {([
                              { key: '1year' as AmountPreset, label: '1 year' },
                              { key: 'lifetime' as AmountPreset, label: `Lifetime (${entry.lifetime}yr)` },
                              { key: 'custom' as AmountPreset, label: 'Custom' },
                            ]).map((p) => (
                              <button
                                key={p.key}
                                onClick={() => applyPreset(arc.id, p.key, entry.lifetime, arc)}
                                style={{
                                  padding: '3px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                  border: '1px solid ' + (entry.preset === p.key ? 'var(--accent)' : 'var(--border-default)'),
                                  backgroundColor: entry.preset === p.key ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-elevated)',
                                  color: entry.preset === p.key ? 'var(--accent)' : 'var(--text-tertiary)',
                                  fontSize: 10, fontWeight: entry.preset === p.key ? 600 : 500,
                                }}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          {entry.preset === 'lifetime' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Lifetime:</span>
                              <input
                                type="number"
                                value={entry.lifetime}
                                onChange={(e) => {
                                  const lt = Math.max(1, parseInt(e.target.value) || 1)
                                  applyPreset(arc.id, 'lifetime', lt, arc)
                                }}
                                min="1" step="1"
                                style={{ width: 50, height: 22, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', outline: 'none', textAlign: 'right' }}
                              />
                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>years</span>
                            </div>
                          )}
                          <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            {stages.map((stage) => {
                              const inScope = stageInScope(stage)
                              const annual = arc.stage_annual?.[stage] ?? false
                              return (
                                <div
                                  key={stage}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                                    borderBottom: '1px solid var(--border-subtle)',
                                    backgroundColor: inScope ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                                    opacity: inScope ? 1 : 0.4,
                                  }}
                                >
                                  <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontWeight: 500 }}>
                                    {stage}
                                  </span>
                                  {annual && (
                                    <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                      annual
                                    </span>
                                  )}
                                  <input
                                    type="number"
                                    value={entry.amounts[stage] ?? 1}
                                    onChange={(e) => {
                                      setArcAmountsMap((prev) => ({
                                        ...prev,
                                        [arc.id]: {
                                          ...entry,
                                          preset: 'custom',
                                          amounts: { ...entry.amounts, [stage]: parseFloat(e.target.value) || 0 },
                                        },
                                      }))
                                    }}
                                    disabled={!inScope}
                                    min="0" step="any"
                                    style={{
                                      width: 60, height: 22, padding: '0 6px',
                                      backgroundColor: inScope ? 'var(--bg-surface)' : 'transparent',
                                      border: '1px solid ' + (inScope ? 'var(--border-default)' : 'transparent'),
                                      borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                                      fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                                      outline: 'none', textAlign: 'right',
                                    }}
                                  />
                                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', minWidth: 12 }}>×</span>
                                </div>
                              )
                            })}
                          </div>
                          {entry.preset === 'lifetime' && (
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'right' }}>
                              = 1 vehicle over {entry.lifetime} year{entry.lifetime !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Mode B: Activity (multi-activity) */}
            {fuMode === 'activity' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ActivitySearch onSelect={addActivity} />
                {actDemand.length > 0 && (
                  <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {actDemand.map((d) => (
                      <div key={d.act.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.act.product || d.act.name}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                            ({d.act.location}) — {d.act.database}
                          </div>
                        </div>
                        <input
                          type="number"
                          value={d.amount}
                          onChange={(e) => updateActivityAmount(d.act.key, parseFloat(e.target.value) || 0)}
                          style={{ width: 65, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', outline: 'none', textAlign: 'right' }}
                          min="0" step="any"
                        />
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: 28 }}>{d.act.unit}</span>
                        <button
                          onClick={() => removeActivity(d.act.key)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-tertiary)', display: 'flex' }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {actDemand.length > 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    {actDemand.length} activit{actDemand.length === 1 ? 'y' : 'ies'} selected
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Method */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>
              LCIA Method
            </label>
            <MethodPicker onChange={setSelectedMethods} />
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-5)', display: 'flex', justifyContent: 'flex-end' }}>
          {fuMode === 'archetype' ? (
            <Button
              variant="primary"
              onClick={handleArchetypeCalculate}
              disabled={!canCalculateArchetype}
              style={{ height: 44, fontSize: 'var(--text-base)', paddingLeft: 28, paddingRight: 28 }}
            >
              {arcCalculating ? (
                <><Loader2 size={16} style={{ animation: 'lca-spin 1s linear infinite' }} /> Calculating…</>
              ) : (
                selectedMethods.length > 1 ? `Calculate (${selectedMethods.length} indicators)` : 'Calculate'
              )}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleActivityCalculate}
              disabled={!canCalculateActivity}
              style={{ height: 44, fontSize: 'var(--text-base)', paddingLeft: 28, paddingRight: 28 }}
            >
              {actCalculating ? (
                <><Loader2 size={16} style={{ animation: 'lca-spin 1s linear infinite' }} /> Calculating…</>
              ) : (
                selectedMethods.length > 1 ? `Calculate (${selectedMethods.length} indicators)` : 'Calculate'
              )}
            </Button>
          )}
        </div>
      </div>

      <style>{`@keyframes lca-spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Activity mode: loading + error + results ── */}
      {fuMode === 'activity' && (
        <>
          {actCalculating && (
            <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 size={16} style={{ animation: 'lca-spin 1s linear infinite', color: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Running LCA for {selectedMethods.length} indicator{selectedMethods.length === 1 ? '' : 's'} on {actDemand.length} activit{actDemand.length === 1 ? 'y' : 'ies'}…
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                {actElapsed}s
              </span>
            </div>
          )}

          {actError && (
            <div style={{ backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
              {actError}
            </div>
          )}

          {actResult && activeActResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>Activity LCA Results</h3>
                  {actResult.elapsed_seconds > 0 && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {actDemand.length} activit{actDemand.length === 1 ? 'y' : 'ies'} | {actResult.elapsed_seconds}s
                    </p>
                  )}
                </div>
              </div>

              {/* Sidebar + content */}
              <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                {/* Vertical indicator sidebar */}
                {actResult.results.length > 1 && (
                  <div style={{
                    width: 200, minWidth: 200, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)', overflow: 'hidden', flexShrink: 0,
                  }}>
                    <div style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', borderBottom: '1px solid var(--border-subtle)' }}>
                      Indicators
                    </div>
                    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                      {actResult.results.map((r, i) => {
                        const active = i === actResultIndex
                        const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                        return (
                          <button
                            key={i}
                            onClick={() => setActResultIndex(i)}
                            title={r.method.join(' › ')}
                            style={{
                              display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                              textAlign: 'left', borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                              backgroundColor: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                            }}
                          >
                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {label}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                              {fmt(r.score)} {r.unit}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Main content */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {/* Score card */}
                  <div style={cardStyle}>
                    <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                      {activeActResult.method.join(' › ')}
                    </p>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                        {fmt(activeActResult.score)}
                      </span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{activeActResult.unit}</span>
                    </div>
                  </div>

                  {/* Per-activity contribution bar chart */}
                  {activeActResult.contributions.length > 0 && (
                    <div style={cardStyle}>
                      <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                        Contributions by activity
                      </h4>
                      <div style={{ height: Math.max(activeActResult.contributions.length * 42, 100) }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={activeActResult.contributions.map((c) => ({
                              name: `${c.name} (${c.demand_amount} ${c.demand_unit})`,
                              impact: c.impact,
                              percentage: c.percentage,
                            }))}
                            layout="vertical"
                            margin={{ left: 10, right: 30, top: 5, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                            <YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                            <Tooltip
                              formatter={(v: number, _n: string, props: { payload: { percentage: number } }) => [
                                `${fmt(v)} (${props.payload.percentage.toFixed(1)}%)`,
                                activeActResult.unit,
                              ]}
                              contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
                            />
                            <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                              {activeActResult.contributions.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Contribution table */}
                      <div style={{ overflow: 'auto', maxHeight: 400, marginTop: 'var(--space-3)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={headCell}>Activity</th>
                              <th style={headCell}>Location</th>
                              <th style={{ ...headCell, textAlign: 'right' }}>Demand</th>
                              <th style={headCell}>Unit</th>
                              <th style={{ ...headCell, textAlign: 'right' }}>Impact ({activeActResult.unit})</th>
                              <th style={{ ...headCell, textAlign: 'right' }}>%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeActResult.contributions.map((c, i) => (
                              <tr key={`${c.code}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{c.name}</td>
                                <td style={{ padding: '6px 10px' }}><Badge label={c.location} variant="default" /></td>
                                <td style={{ ...numCell, color: 'var(--text-secondary)' }}>{fmt(c.demand_amount)}</td>
                                <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.demand_unit}</td>
                                <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{fmt(c.impact)}</td>
                                <td style={{ ...numCell, color: 'var(--text-tertiary)' }}>{c.percentage.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* All indicators summary */}
                  {actResult.results.length > 1 && (
                    <div style={cardStyle}>
                      <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                        All indicators
                      </h4>
                      <div style={{ overflow: 'auto', maxHeight: 400 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={headCell}>Indicator</th>
                              <th style={{ ...headCell, textAlign: 'right' }}>Total</th>
                              <th style={headCell}>Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {actResult.results.map((r, i) => {
                              const label = r.method[r.method.length - 1] || r.method_label
                              return (
                                <tr
                                  key={i}
                                  onClick={() => setActResultIndex(i)}
                                  style={{
                                    borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                                    backgroundColor: i === actResultIndex ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                                  }}
                                >
                                  <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{label}</td>
                                  <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{fmt(r.score)}</td>
                                  <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{r.unit}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Archetype mode: loading + error + results ── */}
      {fuMode === 'archetype' && (
        <>
          {arcCalculating && (
            <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 size={16} style={{ animation: 'lca-spin 1s linear infinite', color: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Running LCA for {selectedMethods.length} indicator{selectedMethods.length === 1 ? '' : 's'} on {selectedArchetypes.map((a) => a.name).join(', ')}…
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                {arcElapsed}s
              </span>
            </div>
          )}

          {arcError && (
            <div style={{ backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
              {arcError}
            </div>
          )}

          {arcResult && activeArcResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Header: title + export */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {isMultiMode ? 'Multi-Archetype Comparison' : arcResult.archetype_name}
                  </h3>
                  {arcResult.stages_included.length > 0 && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      Scope: {arcResult.scope} | Stages: {arcResult.stages_included.join(', ')}
                      {arcResult.elapsed_seconds > 0 && ` | ${arcResult.elapsed_seconds}s`}
                    </p>
                  )}
                </div>
                <Button variant="ghost" onClick={handleExport} disabled={isExporting} style={{ gap: 6 }}>
                  <Download size={14} /> {isExporting ? 'Exporting…' : 'Export XLSX'}
                </Button>
              </div>

              {/* Sidebar + content layout */}
              <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                {/* Vertical indicator sidebar */}
                {arcResult.results.length > 1 && (
                  <div style={{
                    width: 200, minWidth: 200, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)', overflow: 'hidden', flexShrink: 0,
                  }}>
                    <div style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', borderBottom: '1px solid var(--border-subtle)' }}>
                      Indicators
                    </div>
                    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                      {arcResult.results.map((r, i) => {
                        const active = i === arcResultIndex
                        const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                        return (
                          <button
                            key={i}
                            onClick={() => setArcResultIndex(i)}
                            title={r.method.join(' › ')}
                            style={{
                              display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                              textAlign: 'left', borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                              backgroundColor: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                            }}
                          >
                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {label}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                              {fmt(isMultiMode ? arcResults.reduce((s, ar) => s + (ar.results[i]?.score ?? 0), 0) : r.score)} {r.unit}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Main content panel */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {/* ── Single archetype view ── */}
                  {!isMultiMode && (
                    <>
                      {/* Score card */}
                      <div style={cardStyle}>
                        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                          {activeArcResult.method.join(' › ')}
                        </p>
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                          <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                            {fmt(activeArcResult.score)}
                          </span>
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{activeArcResult.unit}</span>
                        </div>
                        <p style={{ marginTop: 6, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                          {Object.keys(arcResult.stage_amounts ?? {}).length > 0
                            ? `${arcResult.archetype_name} — ${Object.entries(arcResult.stage_amounts).map(([s, v]) => `${s}: ${v}×`).join(', ')}`
                            : `${arcResult.amount} unit(s) of ${arcResult.archetype_name}`}
                        </p>
                      </div>

                      {/* Contributions with material/stage toggle + treemap */}
                      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
                          {(['contributions', 'treemap'] as const).map((t) => (
                            <button key={t} onClick={() => setVizTab(t)} style={{ padding: '0 var(--space-5)', height: 42, background: 'none', border: 'none', borderBottom: vizTab === t ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 500, color: vizTab === t ? 'var(--text-primary)' : 'var(--text-secondary)', textTransform: 'capitalize' }}>
                              {t}
                            </button>
                          ))}
                          {vizTab === 'contributions' && (
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 0, marginRight: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                              {(['material', 'stage'] as const).map((v) => (
                                <button
                                  key={v}
                                  onClick={() => setContribView(v)}
                                  style={{
                                    padding: '4px 10px', border: 'none', cursor: 'pointer',
                                    backgroundColor: contribView === v ? 'var(--accent)' : 'var(--bg-elevated)',
                                    color: contribView === v ? 'white' : 'var(--text-secondary)',
                                    fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'capitalize',
                                  }}
                                >
                                  By {v}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ padding: 'var(--space-5)' }}>
                          {vizTab === 'contributions' && contribView === 'material' && (
                            <div style={{ overflow: 'auto', maxHeight: 500 }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr>
                                    <th style={headCell}>Material</th>
                                    <th style={headCell}>Stage</th>
                                    <th style={headCell}>Component</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>Quantity</th>
                                    <th style={headCell}>Unit</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>Impact ({activeArcResult.unit})</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>%</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activeArcResult.contributions.map((c, i) => (
                                    <tr key={`${c.name}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{c.name}</td>
                                      <td style={{ padding: '6px 10px' }}>{c.stage && <Badge label={c.stage} variant="lca" />}</td>
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{c.component}</td>
                                      <td style={{ ...numCell, color: 'var(--text-secondary)' }}>{fmt(c.quantity)}</td>
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.unit}</td>
                                      <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{fmt(c.impact)}</td>
                                      <td style={{ ...numCell, color: 'var(--text-tertiary)' }}>{c.percentage.toFixed(1)}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {vizTab === 'contributions' && contribView === 'stage' && (
                            <div style={{ overflow: 'auto', maxHeight: 500 }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr>
                                    <th style={headCell}>Stage</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>Impact ({activeArcResult.unit})</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>%</th>
                                    <th style={headCell}>Top contributor</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stageData.map((s, i) => (
                                    <tr key={s.stage} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                      <td style={{ padding: '6px 10px' }}><Badge label={s.stage} variant="lca" /></td>
                                      <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{fmt(s.impact)}</td>
                                      <td style={{ ...numCell, color: 'var(--text-tertiary)' }}>{s.percentage.toFixed(1)}%</td>
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{s.topName}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {/* Stage bar chart */}
                              {stageData.length > 0 && (
                                <div style={{ marginTop: 'var(--space-4)', height: Math.max(stageData.length * 40, 100) }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stageData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                                      <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                                      <YAxis type="category" dataKey="stage" width={120} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                                      <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} />
                                      <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                                        {stageData.map((_, i) => (
                                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              )}
                            </div>
                          )}
                          {vizTab === 'treemap' && arcTreemapItems && (
                            <ContributionTreemap
                              items={arcTreemapItems.items}
                              restAmount={arcTreemapItems.rest_amount}
                              restPercentage={arcTreemapItems.rest_percentage}
                              unit={activeArcResult.unit}
                            />
                          )}
                        </div>
                      </div>

                      {/* All indicators summary table */}
                      {arcResult.results.length > 1 && (
                        <div style={cardStyle}>
                          <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                            All indicators
                          </h4>
                          <div style={{ overflow: 'auto', maxHeight: 400 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={headCell}>Indicator</th>
                                  <th style={{ ...headCell, textAlign: 'right' }}>Total</th>
                                  <th style={headCell}>Unit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {arcResult.results.map((r, i) => {
                                  const label = r.method[r.method.length - 1] || r.method_label
                                  return (
                                    <tr
                                      key={i}
                                      onClick={() => setArcResultIndex(i)}
                                      style={{
                                        borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                                        backgroundColor: i === arcResultIndex ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                                      }}
                                    >
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{label}</td>
                                      <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{fmt(r.score)}</td>
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{r.unit}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Multi-archetype comparison view ── */}
                  {isMultiMode && (
                    <>
                      {/* Grouped bar chart */}
                      {comparisonData && (
                        <div style={cardStyle}>
                          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                            {activeArcResult.method[activeArcResult.method.length - 1]} — {activeArcResult.unit}
                          </h4>
                          <div style={{ height: Math.max(comparisonData.length * 48, 120) }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={comparisonData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                                <Tooltip formatter={(v: number) => [fmt(v), activeArcResult.unit]} contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                                  {comparisonData.map((d, i) => (
                                    <Cell key={i} fill={d.color} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Stage breakdown per archetype */}
                      {comparisonStageData && (() => {
                        const allStages = Array.from(new Set(comparisonStageData.flatMap((d) => Object.keys(d.stages))))
                        const stageChartData = allStages.map((stage) => {
                          const row: Record<string, string | number> = { stage }
                          for (const d of comparisonStageData) {
                            row[d.name] = d.stages[stage] ?? 0
                          }
                          return row
                        })
                        return stageChartData.length > 0 ? (
                          <div style={cardStyle}>
                            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                              Stage breakdown
                            </h4>
                            <div style={{ height: Math.max(allStages.length * 50, 120) }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stageChartData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                                  <YAxis type="category" dataKey="stage" width={120} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmt(v)} />
                                  {comparisonStageData.map((d, i) => (
                                    <Bar key={d.name} dataKey={d.name} fill={d.color} radius={[0, 4, 4, 0]} />
                                  ))}
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        ) : null
                      })()}

                      {/* Comparison table: archetype × indicators with min/max highlight */}
                      {comparisonTable && arcResult.results.length > 0 && (
                        <div style={cardStyle}>
                          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                            All indicators
                          </h4>
                          <div style={{ overflow: 'auto', maxHeight: 500 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={headCell}>Indicator</th>
                                  <th style={headCell}>Unit</th>
                                  {comparisonTable.map((ct) => (
                                    <th key={ct.name} style={{ ...headCell, textAlign: 'right' }}>{ct.name}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {arcResult.results.map((r, mi) => {
                                  const label = r.method[r.method.length - 1] || r.method_label
                                  const scores = comparisonTable.map((ct) => ct.scores[mi]?.score ?? 0)
                                  const minVal = Math.min(...scores)
                                  const maxVal = Math.max(...scores)
                                  return (
                                    <tr
                                      key={mi}
                                      onClick={() => setArcResultIndex(mi)}
                                      style={{
                                        borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                                        backgroundColor: mi === arcResultIndex ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                                      }}
                                    >
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: mi === arcResultIndex ? 600 : 400 }}>{label}</td>
                                      <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{r.unit}</td>
                                      {comparisonTable.map((ct, ci) => {
                                        const sc = ct.scores[mi]?.score ?? 0
                                        const isMin = scores.length > 1 && sc === minVal
                                        const isMax = scores.length > 1 && sc === maxVal
                                        return (
                                          <td
                                            key={ci}
                                            style={{
                                              ...numCell,
                                              fontWeight: 600,
                                              color: isMin ? 'var(--success, #10b981)' : isMax ? 'var(--danger, #ef4444)' : 'var(--accent)',
                                              backgroundColor: isMin ? 'color-mix(in srgb, #10b981 6%, transparent)' : isMax ? 'color-mix(in srgb, #ef4444 6%, transparent)' : 'transparent',
                                            }}
                                          >
                                            {fmt(sc)}
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                            <span><span style={{ color: 'var(--success, #10b981)', fontWeight: 600 }}>Green</span> = lowest (best)</span>
                            <span><span style={{ color: 'var(--danger, #ef4444)', fontWeight: 600 }}>Red</span> = highest (worst)</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
