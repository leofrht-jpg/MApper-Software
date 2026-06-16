import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Download } from 'lucide-react'
import { NumberInput } from '../components/ui/NumberInput'
import { ComputeProgress } from '../components/ui/ComputeProgress'
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
import { CollapsibleCard } from '../components/ui/CollapsibleCard'
import { Badge } from '../components/ui/Badge'
import { ChartExportButton } from '../components/charts/ChartExportButton'
import { ChartExportContainer } from '../components/charts/ChartExportContainer'
import { ContributionAnalysisPanel } from '../components/lca/ContributionAnalysisPanel'
import { DatabaseSelector, buildDatabasePatterns } from '../components/lca/DatabaseSelector'
import { MultiYearTrajectoryPanel } from '../components/lca/MultiYearTrajectoryPanel'
import {
  searchAllActivities,
  getActivities,
  getActivityDistinctValues,
  getDatabases,
  calculateArchetypeLCA,
  calculateActivityLCA,
  exportArchetypeLCA,
  runContributionAnalysis,
  startMultiYearContribution,
  getMultiYearContribution,
  subscribeMultiYearProgress,
  type ActivitySummary,
  type ActivityDemandItem,
  type ActivityLCAResult,
  type ActivityLCAMethodResult,
  type ArchetypeLCACalculateResult,
  type ArchetypeLCAMethodResult,
  type ArchetypeSummary,
  type ContributionAnalysisResult,
  type DatabaseResponse,
  type MultiYearContributionRequest,
  type MultiYearContributionResult,
} from '../api/client'
import { MethodPicker } from '../components/MethodPicker'
import { ArchetypeCheckboxTree } from '../components/archetypes/ArchetypeCheckboxTree'
import { MultiItemSelector } from '../components/shared/MultiItemSelector'
import type {
  ActivityProductItem, ProductItem,
} from '../components/shared/productItem'
import { CHART_PALETTE as CHART_COLORS } from '../utils/chartColors'
import { StopButton } from '../components/ui/StopButton'
import { useCancellableTask } from '../hooks/useCancellableTask'

type FUMode = 'archetype' | 'activity'
type Scope = 'inflows' | 'stock' | 'outflows' | 'all'

const SCOPE_OPTIONS: { value: Scope; label: string; tip: string }[] = [
  { value: 'all', label: 'Full Lifecycle', tip: 'All stages combined' },
  { value: 'inflows', label: 'Manufacturing', tip: 'Manufacturing stage only' },
  { value: 'stock', label: 'Operation', tip: 'Use Phase + Maintenance' },
  { value: 'outflows', label: 'End of Life', tip: 'End of Life stage only' },
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

// Patch 4AH — local <ActivitySearch> retired. Activity-mode picker
// now uses the shared <MultiItemSelector> (Patch 4AG.2 / 4AH-extended)
// for Location / Unit filtering parity with Database Explorer +
// multi-item comparison.

// ── Main Single-product LCA component ──────────────────────────────────────────

interface LCACalculatorProps {
  onNavigateToExplorer?: (activityKey: string) => void
}

export function LCACalculator({ onNavigateToExplorer: _onNavigateToExplorer }: LCACalculatorProps) {
  const { archetypes, folders, fetchArchetypes } = useBOMStore()

  // ── State ──
  const [fuMode, setFuMode] = useState<FUMode>('archetype')
  const [selectedArchetypes, setSelectedArchetypes] = useState<ArchetypeSummary[]>([])
  const [scope, setScope] = useState<Scope>('all')

  // Per-archetype stage amounts (keyed by archetype ID)
  interface PerArchetypeAmounts { preset: AmountPreset; lifetime: number; amounts: Record<string, number> }
  const [arcAmountsMap, setArcAmountsMap] = useState<Record<string, PerArchetypeAmounts>>({})
  const [selectedMethods, setSelectedMethods] = useState<string[][]>([])

  // Collapsible Configuration / Results sections (Patch 5N — mirrors 5H/5K).
  // Session-local; survives the LCA tab's visibility-toggle; no persistence.
  const [configOpen, setConfigOpen] = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)

  // Contribution analysis cache + loading state, keyed by `${targetSig}::${methodSig}`.
  const [caCache, setCaCache] = useState<Record<string, ContributionAnalysisResult>>({})
  const [caLoadingKey, setCaLoadingKey] = useState<string | null>(null)
  const [caPhase, setCaPhase] = useState<string | null>(null)
  const [caStartedAt, setCaStartedAt] = useState<number | null>(null)
  const [caError, setCaError] = useState<string | null>(null)

  // Archetype mode state (multi-archetype)
  const [arcResults, setArcResults] = useState<ArchetypeLCACalculateResult[]>([])
  const [arcResultIndex, setArcResultIndex] = useState(0)
  const [arcCalculating, setArcCalculating] = useState(false)
  const [arcError, setArcError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Activity mode state (multi-activity)
  interface DemandEntry { act: ActivitySummary; amount: number }
  const [actDemand, setActDemand] = useState<DemandEntry[]>([])
  // Patch 4AH — activity feed for the new <MultiItemSelector>. Parent
  // owns the result of the debounced backend search (kept as plain
  // ActivitySummary[] so downstream code that consumes
  // actDemand[].act.{name,product,key,...} keeps working unchanged).
  const [searchedActivities, setSearchedActivities] = useState<ActivitySummary[]>([])
  const actSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Patch 4AI — track the current activity-mode search inputs so
  // filter changes can re-fire the backend search with the right
  // query AND filter params. Filter change without re-search would
  // narrow only the loaded page; the goal is the full set matching
  // (query × filters).
  const [actSearchQuery, setActSearchQuery] = useState('')
  const [actLocationFilter, setActLocationFilter] = useState<string[]>([])
  const [actUnitFilter, setActUnitFilter] = useState<string[]>([])
  // Patch 4AI — distinct locations / units across the database
  // (independent of the currently-loaded page) so the filter
  // dropdowns offer all valid options, not just the ones in the
  // first 50 results.
  const [dbLocations, setDbLocations] = useState<string[]>([])
  const [dbUnits, setDbUnits] = useState<string[]>([])
  const [actResult, setActResult] = useState<ActivityLCAResult | null>(null)
  const [actResultIndex, setActResultIndex] = useState(0)
  const [actCalculating, setActCalculating] = useState(false)
  const [actError, setActError] = useState<string | null>(null)

  // Activity-mode database selector
  const [databases, setDatabases] = useState<DatabaseResponse[]>([])
  const [selectedDb, setSelectedDb] = useState<string | null>(null)

  // Compute-against database (the DB the contribution analysis runs through).
  // Stored as a *pattern* (year-stripped for prospective; equal to the DB
  // name for static). The fully-qualified compute_database is built by
  // appending ``_<computeYear>`` for prospective patterns. Defaults to the
  // first static technosphere DB once databases are loaded.
  const [computePattern, setComputePattern] = useState<string | null>(null)
  const [computeYear, setComputeYear] = useState<number | null>(null)

  // Year mode: 'single' = current behaviour (one ContributionAnalysisResult);
  // 'multi'  = MultiYearTrajectoryPanel computed across selected years.
  const [yearMode, setYearMode] = useState<'single' | 'multi'>('single')
  const [multiYears, setMultiYears] = useState<number[]>([])
  const [myResult, setMyResult] = useState<MultiYearContributionResult | null>(null)
  const [myLoading, setMyLoading] = useState(false)
  const [myProgress, setMyProgress] = useState<{ stage: string; pct: number } | null>(null)
  const [myError, setMyError] = useState<string | null>(null)

  // ── Compute-database derivation ─────────────────────────────────────────
  // Patterns are computed once per ``databases`` change and used by both the
  // selector and the year picker. The fully-qualified compute_database is
  // built by combining the active pattern with the active year (for
  // prospective) or just the pattern (for static).
  const computePatterns = useMemo(() => buildDatabasePatterns(databases), [databases])
  const computePatternInfo = useMemo(
    () => computePatterns.find((p) => p.pattern === computePattern) ?? null,
    [computePatterns, computePattern],
  )
  const isComputeProspective = computePatternInfo?.isProspective ?? false
  const computeAvailableYears = computePatternInfo?.availableYears ?? []

  // Fully-qualified DB name to send as ``compute_database``. None when no
  // pattern is selected, or when prospective + no year selected (Calculate
  // is gated in that case).
  const computeDatabase = useMemo<string | null>(() => {
    if (!computePattern) return null
    if (!isComputeProspective) return computePattern
    if (computeYear == null) return null
    return `${computePattern}_${computeYear}`
  }, [computePattern, isComputeProspective, computeYear])

  // Keep ``computeYear`` consistent with the active pattern: clear it on
  // static, snap to the first available year on prospective.
  useEffect(() => {
    if (!isComputeProspective) {
      if (computeYear != null) setComputeYear(null)
      return
    }
    if (computeYear == null || !computeAvailableYears.includes(computeYear)) {
      setComputeYear(computeAvailableYears[0] ?? null)
    }
  }, [isComputeProspective, computeAvailableYears, computeYear])

  // When the user switches to multi-year mode, default the selection to all
  // available years for the active pattern. Filter out invalid years on
  // pattern change so the chip set doesn't carry stale selections.
  useEffect(() => {
    if (yearMode !== 'multi') return
    setMultiYears((prev) => {
      const valid = prev.filter((y) => computeAvailableYears.includes(y))
      if (valid.length > 0) return valid
      return [...computeAvailableYears]
    })
  }, [yearMode, computeAvailableYears])

  // Group databases for the dropdown: technosphere static, prospective, biosphere.
  const dbGroups = useMemo(() => {
    const tStatic: DatabaseResponse[] = []
    const tProspective: DatabaseResponse[] = []
    const bio: DatabaseResponse[] = []
    for (const d of databases) {
      const isBio = d.name.toLowerCase().includes('biosphere')
      if (isBio) bio.push(d)
      else if (d.is_prospective) tProspective.push(d)
      else tStatic.push(d)
    }
    const cmp = (a: DatabaseResponse, b: DatabaseResponse) => a.name.localeCompare(b.name)
    return {
      tStatic: tStatic.sort(cmp),
      tProspective: tProspective.sort(cmp),
      bio: bio.sort(cmp),
    }
  }, [databases])

  // Chart export refs
  const actContribRef = useRef<HTMLDivElement>(null)
  const comparisonBarRef = useRef<HTMLDivElement>(null)
  const comparisonStageRef = useRef<HTMLDivElement>(null)

  const isMultiMode = arcResults.length > 1
  const arcResult = arcResults[0] ?? null
  const activeArcResult: ArchetypeLCAMethodResult | null = arcResult?.results[arcResultIndex] ?? null
  const activeActResult: ActivityLCAMethodResult | null = actResult?.results[actResultIndex] ?? null

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])

  // Load databases for the Activity-mode selector. Default to the first
  // non-biosphere DB so the search has somewhere to look immediately.
  useEffect(() => {
    let cancelled = false
    getDatabases()
      .then((dbs) => {
        if (cancelled) return
        setDatabases(dbs)
        setSelectedDb((cur) => {
          if (cur && dbs.some((d) => d.name === cur)) return cur
          const firstStatic = dbs.find((d) => !d.is_prospective && !d.name.toLowerCase().includes('biosphere'))
          const firstAny = dbs.find((d) => !d.name.toLowerCase().includes('biosphere'))
          return firstStatic?.name ?? firstAny?.name ?? dbs[0]?.name ?? null
        })
        // Seed compute pattern to the first static technosphere DB. The user
        // can later switch to a prospective pattern via DatabaseSelector.
        setComputePattern((cur) => {
          if (cur) return cur
          const firstStatic = dbs.find(
            (d) => !d.is_prospective && !d.name.toLowerCase().includes('biosphere'),
          )
          return firstStatic?.name ?? null
        })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

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

  // Patch 4AH — activity-demand management is now wired through
  // `<MultiItemSelector>`'s callbacks (`handleSelectorAddItem` /
  // `handleSelectorRemoveItem` / `handleSelectorAmountChange`
  // below). The pre-Patch-4AH `addActivity` / `removeActivity` /
  // `updateActivityAmount` helpers were removed — their logic is
  // re-implemented at the selector boundary.

  // Switching the database while activities are selected clears the selection
  // (results were computed against the previous database). Confirm first.
  const handleDatabaseChange = (next: string) => {
    if (next === selectedDb) return
    if (actDemand.length > 0) {
      const ok = window.confirm('Switching database will clear the selected activity. Continue?')
      if (!ok) return
      setActDemand([])
      setActResult(null)
      setActError(null)
    }
    // Patch 4AH — clear stale search results when database flips.
    setSearchedActivities([])
    setSelectedDb(next)
  }

  // Patch 4AH+4AI — debounced activity search. Now composes
  // (query × locationsFilter × unitsFilter) at the backend so
  // results reflect the full set matching the user's filters
  // (not just the first page of the unfiltered search). The
  // pre-Patch-4AI version applied filters client-side over the
  // 50-item page, which silently hid options when the matching
  // location didn't happen to land in the first page (e.g. "DK
  // electricity" for "electricity, low voltage" — DK rows exist
  // in ecoinvent but might be on page 2 of the unfiltered
  // pagination, so the Location dropdown didn't even offer DK).
  const runActivitySearch = (
    q: string,
    locations: string[],
    units: string[],
  ) => {
    if (actSearchTimerRef.current) clearTimeout(actSearchTimerRef.current)
    actSearchTimerRef.current = setTimeout(async () => {
      const query = q.trim()
      // The "≥2 chars" guard preserves the pre-Patch-4AI behaviour
      // for the unscoped case (cheaper than firing a query on
      // every keystroke), but a filter-only refine (no query
      // text) is still useful — render the first page of all
      // activities matching the chosen Location/Unit.
      const hasFilters = locations.length > 0 || units.length > 0
      if (query.length < 2 && !hasFilters) {
        setSearchedActivities([])
        return
      }
      try {
        if (selectedDb) {
          const page = await getActivities(selectedDb, 0, 50, query, {
            locations: locations.length > 0 ? locations : undefined,
            units: units.length > 0 ? units : undefined,
          })
          setSearchedActivities(page.items)
        } else if (query.length >= 2) {
          // searchAllActivities doesn't support location/unit
          // filters today; fall back to the legacy unfiltered
          // search. Acceptable because the picker requires a
          // database selection in practice (selectedDb is set
          // on mount).
          const items = await searchAllActivities(query, 50, true)
          setSearchedActivities(items)
        } else {
          setSearchedActivities([])
        }
      } catch {
        setSearchedActivities([])
      }
    }, 300)
  }

  const handleActivitySearch = (q: string) => {
    setActSearchQuery(q)
    runActivitySearch(q, actLocationFilter, actUnitFilter)
  }

  const handleActivityFiltersChange = (filters: {
    locations: string[]
    units: string[]
  }) => {
    setActLocationFilter(filters.locations)
    setActUnitFilter(filters.units)
    runActivitySearch(actSearchQuery, filters.locations, filters.units)
  }

  // Patch 4AI — load database-level distinct values when the
  // selected database changes. Feeds the filter dropdowns with
  // the FULL universe of locations/units, not just those in the
  // current page. (Database Explorer already uses this same
  // endpoint via useActivityStore — we hit it directly here to
  // avoid sharing the store's filter state across pages.)
  useEffect(() => {
    if (!selectedDb) {
      setDbLocations([])
      setDbUnits([])
      return
    }
    let cancelled = false
    getActivityDistinctValues(selectedDb)
      .then((dv) => {
        if (cancelled) return
        setDbLocations(dv.locations ?? [])
        setDbUnits(dv.units ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setDbLocations([])
        setDbUnits([])
      })
    return () => { cancelled = true }
  }, [selectedDb])

  // Patch 4AH — bridge functions between the selector's
  // ActivityProductItem and LCA Calculator's DemandEntry.

  const handleSelectorAddItem = (item: ProductItem) => {
    if (item.type !== 'activity') return  // Calculator's activity mode never offers archetypes here.
    // Biosphere guard — same rule as the legacy addActivity path.
    if (item.database.toLowerCase().includes('biosphere')) {
      setActError('Biosphere flows cannot be used as functional units. Select a technosphere activity from ecoinvent.')
      return
    }
    // Look up the full ActivitySummary from the search feed so the
    // chip + downstream rendering retains every field the existing
    // compute path expects (e.g. `act.name`, `act.product`).
    const match = searchedActivities.find(
      (a) => a.database === item.database && a.code === item.code,
    )
    if (!match) return
    if (actDemand.some((d) => d.act.key === match.key)) return
    setActDemand((prev) => [...prev, { act: match, amount: 1 }])
    setActError(null)
  }

  const handleSelectorRemoveItem = (item: ProductItem) => {
    if (item.type !== 'activity') return
    setActDemand((prev) => prev.filter(
      (d) => !(d.act.database === item.database && d.act.code === item.code),
    ))
  }

  const handleSelectorAmountChange = (item: ActivityProductItem, amount: number) => {
    setActDemand((prev) => prev.map(
      (d) => (d.act.database === item.database && d.act.code === item.code)
        ? { ...d, amount }
        : d,
    ))
  }

  // Derive ActivityProductItem[] from actDemand for the selector.
  // Keeps actDemand as the canonical state shape (existing downstream
  // code references actDemand[].act.{name,product,key,...} unchanged).
  const selectorSelectedItems: ActivityProductItem[] = useMemo(
    () => actDemand.map((d) => ({
      type: 'activity' as const,
      database: d.act.database,
      code: d.act.code,
      amount: d.amount,
      // Patch 5M — full activity name as the chip title (discriminator);
      // product/name threaded so the chip can show ref product + code and
      // tell look-alikes apart.
      display_name: d.act.name || d.act.product,
      location: d.act.location,
      unit: d.act.unit,
      name: d.act.name,
      product: d.act.product,
    })),
    [actDemand],
  )

  // ── Archetype calculate (supports multi-archetype) ──
  const handleArchetypeCalculate = async () => {
    if (selectedArchetypes.length === 0 || selectedMethods.length === 0) return
    setArcCalculating(true)
    setArcError(null)
    setArcResults([])
    try {
      const results = await Promise.all(
        selectedArchetypes.map((arc) => {
          const entry = arcAmountsMap[arc.id]
          const sa = entry && Object.keys(entry.amounts).length > 0 ? entry.amounts : undefined
          return calculateArchetypeLCA(arc.id, scope, selectedMethods, { stageAmounts: sa })
        }),
      )
      setArcResults(results)
      setArcResultIndex(0)
    } catch (e: unknown) {
      setArcError(e instanceof Error ? e.message : String(e))
    } finally {
      setArcCalculating(false)
    }
  }

  // ── Activity calculate (multi-activity via REST) ──
  const handleActivityCalculate = async () => {
    if (actDemand.length === 0 || selectedMethods.length === 0) return
    setActCalculating(true)
    setActError(null)
    setActResult(null)
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

  const toggleArchetypeFolder = (arcs: ArchetypeSummary[], targetChecked: boolean) => {
    setSelectedArchetypes((prev) => {
      const ids = new Set(arcs.map((a) => a.id))
      if (!targetChecked) return prev.filter((a) => !ids.has(a.id))
      const existing = new Set(prev.map((a) => a.id))
      const toAdd = arcs.filter((a) => !existing.has(a.id))
      const room = Math.max(0, 6 - prev.length)
      return [...prev, ...toAdd.slice(0, room)]
    })
  }

  const handleReset = () => {
    setArcResults([])
    setArcError(null)
    setArcResultIndex(0)
    setActResult(null)
    setActError(null)
    setActResultIndex(0)
    setCaCache({})
    setCaError(null)
    setCaPhase(null)
    setCaLoadingKey(null)
    setCaStartedAt(null)
  }

  const archetypesWithErrors = useMemo(
    () => selectedArchetypes.filter((a) => (a.validation_error_rows ?? 0) > 0),
    [selectedArchetypes],
  )
  const canCalculateArchetype =
    selectedArchetypes.length > 0 &&
    selectedMethods.length > 0 &&
    !arcCalculating &&
    archetypesWithErrors.length === 0
  const archetypeCalculateBlockedReason = archetypesWithErrors.length > 0
    ? `Cannot calculate: ${archetypesWithErrors.length} selected archetype${archetypesWithErrors.length === 1 ? ' has' : 's have'} unresolved ecoinvent links (${archetypesWithErrors.map((a) => a.name).join(', ')}). Fix the validation errors and re-import the BOM.`
    : null
  const canCalculateActivity = actDemand.length > 0 && selectedMethods.length > 0 && !actCalculating

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

  // ── Contribution-analysis target signature for the active result ──
  const caTarget = useMemo(() => {
    if (fuMode === 'archetype' && arcResult && activeArcResult && !isMultiMode) {
      const stageAmounts = arcResult.stage_amounts ?? null
      const sig = `arc:${arcResult.archetype_id}:${arcResult.scope}:${JSON.stringify(stageAmounts)}`
      return {
        sig,
        methodSig: activeArcResult.method.join('|'),
        request: {
          target_type: 'archetype' as const,
          archetype_id: arcResult.archetype_id,
          scope: arcResult.scope as 'inflows' | 'stock' | 'outflows' | 'all',
          stage_amounts: stageAmounts,
          method: activeArcResult.method,
          compute_database: computeDatabase,
          year: computeYear,
          limit: 20,
          cutoff: 0.001,
          max_depth: 5,
        },
      }
    }
    if (fuMode === 'activity' && actDemand.length === 1 && activeActResult) {
      const d = actDemand[0]
      const sig = `act:${d.act.database}:${d.act.code}:${d.amount}`
      return {
        sig,
        methodSig: activeActResult.method.join('|'),
        request: {
          target_type: 'activity' as const,
          database: d.act.database,
          code: d.act.code,
          amount: d.amount,
          method: activeActResult.method,
          compute_database: computeDatabase,
          year: computeYear,
          limit: 20,
          cutoff: 0.001,
          max_depth: 5,
        },
      }
    }
    return null
  }, [fuMode, arcResult, activeArcResult, isMultiMode, actDemand, activeActResult, computeDatabase, computeYear])

  // Cache key includes compute_database so switching DB invalidates instead
  // of serving the previous DB's cached result.
  const caKey = caTarget
    ? `${caTarget.sig}::${caTarget.methodSig}::${computeDatabase ?? 'auto'}`
    : null

  useEffect(() => {
    if (!caTarget || !caKey) return
    if (caCache[caKey]) { setCaError(null); return }
    let cancelled = false
    const phases = [
      'Computing inventory…',
      'Top processes…',
      'Top emissions…',
      'Building supply chain tree…',
    ]
    let phaseIdx = 0
    setCaLoadingKey(caKey)
    setCaPhase(phases[0])
    setCaStartedAt(Date.now())
    setCaError(null)
    const phaseTimer = setInterval(() => {
      phaseIdx = Math.min(phaseIdx + 1, phases.length - 1)
      setCaPhase(phases[phaseIdx])
    }, 700)
    runContributionAnalysis(caTarget.request)
      .then((res) => {
        if (cancelled) return
        setCaCache((prev) => ({ ...prev, [caKey]: res }))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setCaError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        clearInterval(phaseTimer)
        setCaLoadingKey((k) => (k === caKey ? null : k))
        setCaPhase(null)
        setCaStartedAt(null)
      })
    return () => {
      cancelled = true
      clearInterval(phaseTimer)
    }
  }, [caKey, caTarget, caCache])

  const caResult = caKey ? caCache[caKey] ?? null : null
  const caLoading = caKey != null && caLoadingKey === caKey

  // ── Multi-year contribution analysis (Session 3 backend) ──────────────────
  const myCancel = useCancellableTask()
  const handleRunMultiYear = useCallback(async () => {
    if (!caTarget) return
    if (multiYears.length === 0) {
      setMyError('Pick at least one year.')
      return
    }
    if (!isComputeProspective) {
      setMyError('Multi-year trajectory requires a prospective database family. '
        + 'Select a premise-generated pattern in the Database row.')
      return
    }
    const req: MultiYearContributionRequest = {
      ...caTarget.request,
      compute_database_pattern: computePattern,
      // Per-year compute_database is built server-side from pattern + year;
      // MultiYearContributionRequest has no single-year compute_database/year
      // fields, so they're intentionally omitted here.
      years: [...multiYears].sort((a, b) => a - b),
      // Multi-year is for trajectory comparison, not deep contribution
      // analysis. Override single-year's deeper defaults so a 6-year run
      // doesn't take 9 min on ecoinvent 3.10. Depth=5 captures convergence
      // on long-tailed methods (toxicity, ecotox); single-year request
      // keeps its cutoff=0.001 / max_depth=5 for the detailed view.
      cutoff: 0.01,
      max_depth: 5,
    }
    setMyLoading(true)
    setMyError(null)
    setMyResult(null)
    setMyProgress({ stage: 'queued', pct: 0 })
    let ws: WebSocket | null = null
    try {
      const started = await startMultiYearContribution(req)
      myCancel.begin(started.task_id)
      ws = subscribeMultiYearProgress(started.task_id, async (msg) => {
        if (msg.type === 'progress') {
          setMyProgress({ stage: msg.stage ?? '…', pct: msg.pct ?? 0 })
        } else if (msg.type === 'error') {
          setMyError(msg.error ?? 'Multi-year run failed.')
          setMyLoading(false)
          myCancel.finish(started.task_id)
          ws?.close()
        } else if (msg.type === 'cancelled') {
          setMyError('Cancelled.')
          setMyLoading(false)
          setMyProgress(null)
          myCancel.finish(started.task_id)
          ws?.close()
        } else if (msg.type === 'done') {
          try {
            const full = await getMultiYearContribution(started.task_id)
            setMyResult(full)
          } catch (e) {
            setMyError(e instanceof Error ? e.message : String(e))
          } finally {
            setMyLoading(false)
            setMyProgress(null)
            myCancel.finish(started.task_id)
            ws?.close()
          }
        }
      })
    } catch (e) {
      setMyError(e instanceof Error ? e.message : String(e))
      setMyLoading(false)
      setMyProgress(null)
    }
  }, [caTarget, multiYears, isComputeProspective, computePattern, myCancel])

  // Drop the multi-year result whenever the target / method / DB pattern
  // changes — the result no longer matches what the config panel claims.
  useEffect(() => {
    setMyResult(null)
    setMyError(null)
  }, [caTarget?.sig, caTarget?.methodSig, computePattern])

  // Multi-year run banner / panel. Rendered above the single-year contribution
  // panel in both archetype and activity modes when yearMode === 'multi'.
  const multiYearSection = yearMode === 'multi' ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {!myResult && (
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
              Multi-year trajectory
            </strong>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {multiYears.length === 0
                ? 'Pick at least one year to compute a trajectory.'
                : `${multiYears.length} year${multiYears.length === 1 ? '' : 's'} selected · ${multiYears.slice().sort((a, b) => a - b).join(', ')}`}
            </span>
            {myError && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
                {myError}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StopButton taskId={myCancel.taskId} state={myCancel.state} onClick={myCancel.requestStop} />
            <Button
              variant="primary"
              onClick={handleRunMultiYear}
              disabled={myLoading || multiYears.length === 0 || !caTarget}
            >
              {myLoading ? (
                <><Loader2 size={14} style={{ animation: 'lca-spin 1s linear infinite' }} /> Running…</>
              ) : (
                'Run trajectory'
              )}
            </Button>
          </div>
        </div>
      )}
      {/* Patch 5AN — multi-year exposes a real backend pct (myProgress.pct,
          0–100), so the shared progress card is determinate. The StopButton +
          Run controls stay in the row above; this only consolidates the
          progress text + elapsed. */}
      <ComputeProgress
        active={myLoading}
        label={myProgress?.stage ?? 'Running trajectory…'}
        bar="determinate"
        pct={(myProgress?.pct ?? 0) / 100}
        statusColor="var(--accent)"
        data-testid="multi-year-progress"
        style={{ marginTop: 'var(--space-3)' }}
      />
      {myResult && (
        <MultiYearTrajectoryPanel result={myResult} loadingPhase={null} loadingStartedAt={null} />
      )}
    </div>
  ) : null

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
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>Single-product LCA</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>Calculate life cycle assessment impacts for a single archetype or activity</p>
        </div>
        {/* Start-over/reset (clears results) — secondary, subordinate to the
            primary "Calculate" CTA (Patch 5G). */}
        {hasAnyResult && (
          <Button type="button" variant="secondary" data-testid="lca-new-calculation" onClick={handleReset}>
            New Calculation
          </Button>
        )}
      </div>

      {/* Setup form (Configuration) — collapsible (Patch 5N). CollapsibleCard
          provides the chrome; inner body is a plain wrapper. */}
      <CollapsibleCard
        title="Configuration"
        expanded={configOpen}
        onToggle={() => setConfigOpen((v) => !v)}
        summary={!configOpen ? (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {computeDatabase || 'base ecoinvent'}
            {' · '}{selectedMethods[0]?.[0] ?? 'No method'}
            {' · '}{selectedMethods.length} indicator{selectedMethods.length === 1 ? '' : 's'}
          </span>
        ) : undefined}
      >
      <div data-testid="lca-config-body" style={{ flexShrink: 0 }}>
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
                <ArchetypeCheckboxTree
                  archetypes={archetypes}
                  folders={folders}
                  selectedIds={selectedArchetypes.map((a) => a.id)}
                  onToggle={toggleArchetype}
                  onToggleFolder={toggleArchetypeFolder}
                  maxHeight={220}
                />
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
                              <NumberInput
                                value={entry.lifetime}
                                onChange={(lt) => applyPreset(arc.id, 'lifetime', lt, arc)}
                                integerOnly
                                min={1}
                                emptyValue={1}
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
                                  <NumberInput
                                    value={entry.amounts[stage] ?? 1}
                                    onChange={(v) => {
                                      setArcAmountsMap((prev) => ({
                                        ...prev,
                                        [arc.id]: {
                                          ...entry,
                                          preset: 'custom',
                                          amounts: { ...entry.amounts, [stage]: v },
                                        },
                                      }))
                                    }}
                                    disabled={!inScope}
                                    min={0}
                                    emptyValue={0}
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
                              = 1 unit over {entry.lifetime} year{entry.lifetime !== 1 ? 's' : ''}
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
                <div>
                  <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
                    Database
                  </label>
                  <select
                    value={selectedDb ?? ''}
                    onChange={(e) => handleDatabaseChange(e.target.value)}
                    disabled={databases.length === 0}
                    style={{ width: '100%', height: 36, padding: '0 12px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                  >
                    {databases.length === 0 && <option value="">Loading…</option>}
                    {dbGroups.tStatic.length > 0 && (
                      <optgroup label="Technosphere — Static">
                        {dbGroups.tStatic.map((d) => (
                          <option key={d.name} value={d.name}>{d.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {dbGroups.tProspective.length > 0 && (
                      <optgroup label="Technosphere — Prospective">
                        {dbGroups.tProspective.map((d) => (
                          <option key={d.name} value={d.name}>{d.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {dbGroups.bio.length > 0 && (
                      <optgroup label="Biosphere">
                        {dbGroups.bio.map((d) => (
                          <option key={d.name} value={d.name}>{d.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
                    Activity
                  </label>
                  {/* Patch 4AH — single-item activity picker now uses
                      the same <MultiItemSelector> as the multi-item
                      comparison feature (Patch 4AG). Brings Location /
                      Unit filters + Sort + matching count + Clear
                      filters to parity with Database Explorer +
                      MultiProductLCA. Functional-unit semantics
                      preserved via `chipAmountField` (renders the
                      NumberInput + unit on each chip). */}
                  <MultiItemSelector
                    mode="activity"
                    availableActivities={searchedActivities}
                    selectedItems={selectorSelectedItems}
                    onAddItem={handleSelectorAddItem}
                    onRemoveItem={handleSelectorRemoveItem}
                    onItemAmountChange={handleSelectorAmountChange}
                    onSearchChange={handleActivitySearch}
                    onFiltersChange={handleActivityFiltersChange}
                    filterOptions={{ locations: dbLocations, units: dbUnits }}
                    chipAmountField={true}
                  />
                  {actError && (
                    <div style={{
                      marginTop: 6, padding: '6px 10px',
                      fontSize: 11, color: 'var(--danger)',
                      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
                      borderRadius: 'var(--radius-sm)',
                    }}>
                      {actError}
                    </div>
                  )}
                </div>
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

        {/* DATABASE × YEAR — applies to both archetype and activity modes.
            Static = compute against the activity's source DB (current
            behavior). Prospective = translate keys to the chosen
            premise-generated DB for the chosen year. */}
        <div style={{ marginTop: 'var(--space-5)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
          {(() => {
            // Shared row structure — both columns mirror the same three rows
            // (label-row → control → helper-text) so the column tops and
            // bottoms align even as the toggle/helper content changes.
            const labelRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }
            const labelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }
            const helperStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.4 }
            const yearModeToggle = (
              <div style={{ display: 'inline-flex', borderRadius: 999, border: '1px solid var(--border-default)', padding: 2, backgroundColor: 'var(--bg-elevated)' }}>
                {(['single', 'multi'] as const).map((m) => {
                  const active = yearMode === m
                  const disabled = m === 'multi' && !isComputeProspective
                  return (
                    <button
                      key={m}
                      onClick={() => !disabled && setYearMode(m)}
                      disabled={disabled}
                      title={disabled ? 'Select a prospective database to enable multi-year mode.' : undefined}
                      style={{
                        padding: '2px 10px',
                        borderRadius: 999,
                        border: 'none',
                        backgroundColor: active ? 'var(--accent)' : 'transparent',
                        color: active ? '#0a1414' : (disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)'),
                        fontSize: 'var(--text-xs)',
                        fontWeight: active ? 700 : 500,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            )
            return (
              <>
                <div>
                  <div style={labelRowStyle}>
                    <label style={labelStyle}>Database</label>
                    {/* Invisible mirror of the YEAR toggle so the label-row
                        height matches across columns without magic numbers. */}
                    <div aria-hidden style={{ visibility: 'hidden', pointerEvents: 'none' }}>{yearModeToggle}</div>
                  </div>
                  <DatabaseSelector
                    databases={databases}
                    value={computePattern}
                    onChange={(next) => {
                      if (next === computePattern) return
                      if (hasAnyResult) {
                        const ok = window.confirm('Switching database will require recomputation. Continue?')
                        if (!ok) return
                        // Drop the contribution-analysis cache so the result panel
                        // doesn't briefly flash stale data from the previous DB.
                        setCaCache({})
                      }
                      setComputePattern(next)
                    }}
                  />
                  <div style={helperStyle}>
                    {computePatternInfo?.isProspective ? (
                      <>Prospective LCI — premise-generated background.</>
                    ) : (
                      <>Static — only BOM expressions vary by year. Switch to a prospective database to see LCI evolution.</>
                    )}
                  </div>
                </div>

                <div>
                  <div style={labelRowStyle}>
                    <label style={labelStyle}>Year</label>
                    {/* Single ↔ Multi toggle. Multi requires a prospective pattern. */}
                    {yearModeToggle}
                  </div>
            {!isComputeProspective ? (
              <div style={{ height: 32, display: 'flex', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                Year picker is disabled for static databases.
              </div>
            ) : yearMode === 'single' ? (
              <select
                value={computeYear ?? ''}
                onChange={(e) => setComputeYear(parseInt(e.target.value, 10))}
                disabled={computeAvailableYears.length === 0}
                style={{
                  width: '100%',
                  height: 32,
                  padding: '0 8px',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  cursor: computeAvailableYears.length === 0 ? 'not-allowed' : 'pointer',
                }}
                title={computeAvailableYears.length === 0
                  ? 'No prospective database generated for this pattern. Generate one in pLCA Developer.'
                  : undefined}
              >
                {computeAvailableYears.length === 0 && (
                  <option value="">— no generated years —</option>
                )}
                {computeAvailableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 32, padding: '4px 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
                {computeAvailableYears.length === 0 ? (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                    No generated years for this pattern.
                  </span>
                ) : computeAvailableYears.map((y) => {
                  const active = multiYears.includes(y)
                  return (
                    <button
                      key={y}
                      onClick={() => setMultiYears((prev) => (
                        prev.includes(y) ? prev.filter((p) => p !== y) : [...prev, y]
                      ))}
                      style={{
                        padding: '2px 10px',
                        borderRadius: 999,
                        border: '1px solid',
                        borderColor: active ? 'var(--accent)' : 'var(--border-default)',
                        backgroundColor: active ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'transparent',
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {y}
                    </button>
                  )
                })}
              </div>
            )}
            {/* Invisible helper-text placeholder so the YEAR column ends at
                the same baseline as the DATABASE column's helper text. */}
            <div aria-hidden style={{ ...helperStyle, visibility: 'hidden' }}>&nbsp;</div>
                </div>
              </>
            )
          })()}
        </div>

        <div style={{ marginTop: 'var(--space-5)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {fuMode === 'archetype' ? (
            <>
              {archetypeCalculateBlockedReason && (
                <span style={{
                  fontSize: 'var(--text-xs)', color: 'var(--danger)',
                  maxWidth: 460, textAlign: 'right',
                }}>
                  {archetypeCalculateBlockedReason}
                </span>
              )}
              <Button
                variant="primary"
                onClick={handleArchetypeCalculate}
                disabled={!canCalculateArchetype}
                title={archetypeCalculateBlockedReason ?? undefined}
                style={{ height: 44, fontSize: 'var(--text-base)', paddingLeft: 28, paddingRight: 28 }}
              >
                {arcCalculating ? (
                  <><Loader2 size={16} style={{ animation: 'lca-spin 1s linear infinite' }} /> Calculating…</>
                ) : (
                  selectedMethods.length > 1 ? `Calculate (${selectedMethods.length} indicators)` : 'Calculate'
                )}
              </Button>
            </>
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
      </CollapsibleCard>

      <style>{`@keyframes lca-spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Activity mode: loading + error + results ── */}
      {fuMode === 'activity' && (
        <>
          <ComputeProgress
            active={actCalculating}
            label={`Running LCA for ${selectedMethods.length} indicator${selectedMethods.length === 1 ? '' : 's'} on ${actDemand.length} activit${actDemand.length === 1 ? 'y' : 'ies'}…`}
            bar="none"
            data-testid="activity-lca-progress"
          />

          {actError && (
            <div style={{ backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
              {actError}
            </div>
          )}

          {actResult && activeActResult && (
            <CollapsibleCard
              title="Results"
              expanded={resultsOpen}
              onToggle={() => setResultsOpen((v) => !v)}
              summary={!resultsOpen ? (
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {actDemand[0]?.act.name ?? `${actDemand.length} activities`}
                  {' · '}{actResult.results.length} indicator{actResult.results.length === 1 ? '' : 's'}
                  {actResult.elapsed_seconds > 0 ? ` · ${actResult.elapsed_seconds.toFixed(2)}s` : ''}
                </span>
              ) : undefined}
            >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>Activity LCA Results</h3>
                  {actDemand.length === 1 && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {[actDemand[0].act.name, actDemand[0].act.location, actDemand[0].act.database].filter(Boolean).join(' | ')}
                    </p>
                  )}
                  {actResult.elapsed_seconds > 0 && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {actDemand.length} activit{actDemand.length === 1 ? 'y' : 'ies'} | {actResult.elapsed_seconds.toFixed(2)}s
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
                  {/* Single-activity: full contribution analysis panel.
                      Multi-activity: per-activity bar chart (CA only runs for n=1). */}
                  {actDemand.length === 1 ? (
                    yearMode === 'multi' ? (
                      multiYearSection
                    ) : caResult ? (
                      <ContributionAnalysisPanel
                        result={caResult}
                        loadingPhase={caLoading ? caPhase : null}
                        loadingStartedAt={caLoading ? caStartedAt : null}
                      />
                    ) : caError ? (
                      <div style={{ ...cardStyle, color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
                        Contribution analysis failed: {caError}
                      </div>
                    ) : (
                      <ComputeProgress
                        active
                        label={caPhase ?? 'Loading contribution analysis…'}
                        bar="none"
                        data-testid="lca-activity-contribution-progress"
                      />
                    )
                  ) : (
                    <>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                        <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                          Contributions by activity
                        </h4>
                        <ChartExportButton chartRef={actContribRef} filename={`calc_activity_contributions_${activeActResult.method.join('_')}`} />
                      </div>
                      <ChartExportContainer ref={actContribRef} style={{ height: Math.max(activeActResult.contributions.length * 42, 100) }}>
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
                              formatter={(v, _n, props) => [
                                `${fmt(Number(v))} (${(props.payload as { percentage: number }).percentage.toFixed(1)}%)`,
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
                      </ChartExportContainer>

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
                    </>
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
            </CollapsibleCard>
          )}
        </>
      )}

      {/* ── Archetype mode: loading + error + results ── */}
      {fuMode === 'archetype' && (
        <>
          <ComputeProgress
            active={arcCalculating}
            label={`Running LCA for ${selectedMethods.length} indicator${selectedMethods.length === 1 ? '' : 's'} on ${selectedArchetypes.map((a) => a.name).join(', ')}…`}
            bar="none"
            data-testid="archetype-lca-progress"
          />

          {arcError && (
            <div style={{ backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
              {arcError}
            </div>
          )}

          {arcResult && activeArcResult && (
            <CollapsibleCard
              title="Results"
              expanded={resultsOpen}
              onToggle={() => setResultsOpen((v) => !v)}
              summary={!resultsOpen ? (
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {isMultiMode ? `${arcResults.length} archetypes` : arcResult.archetype_name}
                  {' · '}{arcResult.results.length} indicator{arcResult.results.length === 1 ? '' : 's'}
                  {arcResult.elapsed_seconds > 0 ? ` · ${arcResult.elapsed_seconds.toFixed(2)}s` : ''}
                </span>
              ) : undefined}
            >
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

                      {/* Contribution analysis (top activities / flows / supply chain / by stage) */}
                      {yearMode === 'multi' ? (
                        multiYearSection
                      ) : caResult ? (
                        <ContributionAnalysisPanel
                          result={caResult}
                          loadingPhase={caLoading ? caPhase : null}
                          loadingStartedAt={caLoading ? caStartedAt : null}
                          stageBreakdown={stageData}
                        />
                      ) : caError ? (
                        <div style={{ ...cardStyle, color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
                          Contribution analysis failed: {caError}
                        </div>
                      ) : (
                        <ComputeProgress
                          active
                          label={caPhase ?? 'Loading contribution analysis…'}
                          bar="none"
                          data-testid="lca-archetype-contribution-progress"
                        />
                      )}

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
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {activeArcResult.method[activeArcResult.method.length - 1]} — {activeArcResult.unit}
                            </h4>
                            <ChartExportButton chartRef={comparisonBarRef} filename={`calc_comparison_${activeArcResult.method.join('_')}`} />
                          </div>
                          <ChartExportContainer ref={comparisonBarRef} style={{ height: Math.max(comparisonData.length * 48, 120) }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={comparisonData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                                <Tooltip formatter={(v) => [fmt(Number(v)), activeArcResult.unit]} contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                                  {comparisonData.map((d, i) => (
                                    <Cell key={i} fill={d.color} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </ChartExportContainer>
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                              <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                Stage breakdown
                              </h4>
                              <ChartExportButton chartRef={comparisonStageRef} filename={`calc_comparison_stages_${activeArcResult.method.join('_')}`} />
                            </div>
                            <ChartExportContainer ref={comparisonStageRef} style={{ height: Math.max(allStages.length * 50, 120) }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stageChartData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                                  <YAxis type="category" dataKey="stage" width={120} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} formatter={(v) => fmt(Number(v))} />
                                  {comparisonStageData.map((d) => (
                                    <Bar key={d.name} dataKey={d.name} fill={d.color} radius={[0, 4, 4, 0]} />
                                  ))}
                                </BarChart>
                              </ResponsiveContainer>
                            </ChartExportContainer>
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
            </CollapsibleCard>
          )}
        </>
      )}
    </div>
  )
}
