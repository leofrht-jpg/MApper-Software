import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Layers, Loader2 } from 'lucide-react'
import {
  calculateArchetypeLCA,
  exportSingleProductProspective,
  getMethods,
  type ProspectiveDB,
} from '../../api/client'
import { usePLCAStore } from '../../stores/plcaStore'
import {
  useSingleProductImpactStore,
  type ProjectedRun as StoreProjectedRun,
} from '../../stores/singleProductImpactStore'
import { MethodPicker } from '../MethodPicker'
import { useNumberFormatter } from '../charts/numberFormat'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { ProjectedTimeSeriesChart } from '../charts/ProjectedTimeSeriesChart'
import { ScenarioYearPicker } from './ScenarioYearPicker'
import { Button } from '../ui/Button'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ComputeProgress } from '../ui/ComputeProgress'
import { ViewToggle } from './ViewToggle'
import { MethodSelector } from './MethodSelector'
import { stageAmountsEqual } from './StageAmountsEditor'

interface Props {
  archetypeId: string | null
}

type Scope = 'inflows' | 'stock' | 'outflows' | 'all'

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'all', label: 'Full Lifecycle' },
  { value: 'inflows', label: 'Manufacturing' },
  { value: 'stock', label: 'Operation' },
  { value: 'outflows', label: 'End of Life' },
]

type ProjectedRun = StoreProjectedRun

// Single-product Projected LCI panel (Patch 3, M5).
// Computes one archetype against N prospective databases (each tied to a
// year/IAM/SSP), one sequential call per database via the extended
// /lca/calculate-archetype endpoint. Multi-parameter axis is intentionally
// not exposed here — see Static panel for parameter sensitivity. The
// 3-way axisConflict rule reduces to "single axis" in single-product
// mode (no DSM, no paired); only LCI fan-out is meaningful here.
export function SingleProductProjectedPanel({ archetypeId }: Props) {
  const [scope, setScope] = useState<Scope>('all')
  const [selectedMethods, setSelectedMethods] = useState<string[][]>([])

  const databases = usePLCAStore((s) => s.databases)
  const [selectedDbs, setSelectedDbs] = useState<string[]>([])

  // Patch 4D — picker seed for re-mounting MethodPicker on archetype change
  // (and on first-visit inheritance from Static). The skip ref suppresses
  // the synthetic onChange that fires from the picker's mount-time effect.
  const [pickerSeed, setPickerSeed] = useState(0)
  // Initialize true so the picker's mount-time onChange (fires with the
  // seed value before our archetype-change effect runs) doesn't write
  // back to the store and incorrectly mark the panel customized.
  const skipNextMethodsChangeRef = useRef(true)
  // Tracks the last archetypeId that the [archetypeId] restore effect has
  // committed for. On rerender with a new archetypeId, the picker's
  // [selected, onChange] effect re-fires (onChange identity changes via
  // useCallback) BEFORE the parent's archetype-restore effect runs — its
  // `selected` map is still the previous archetype's. Detect that race
  // and skip the write so we don't pollute the new archetype's slot.
  const lastArchetypeIdRef = useRef<string | null>(null)
  // Banner appears once per inheritance event and auto-dismisses.
  const [showInheritBanner, setShowInheritBanner] = useState(false)

  // Patch 4F — tracks the archetype that has already shown the
  // inheritance banner, so the banner only appears the FIRST time
  // Static→Projected mirroring kicks in for that archetype. The picker
  // re-seed itself fires every time staticCfg slice changes (the live-
  // mirror semantic — see effect comments).
  const bannerShownForArcRef = useRef<string | null>(null)

  const [configExpanded, setConfigExpanded] = useState(true)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const [isCalculating, setIsCalculating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<ProjectedRun[]>([])
  const [activeRunIdx, setActiveRunIdx] = useState<number>(0)

  const valueFormat = useNumberFormatter()
  const setStoreProjectedRuns = useSingleProductImpactStore((s) => s.setProjectedRuns)
  const viewMode = useSingleProductImpactStore((s) => s.projectedViewMode)
  const setViewMode = useSingleProductImpactStore((s) => s.setProjectedViewMode)
  const stageAmountsByArc = useSingleProductImpactStore((s) => s.stageAmountsByArc)
  const setProjectedConfigForArc = useSingleProductImpactStore((s) => s.setProjectedConfigForArc)
  const setProjectedCustomized = useSingleProductImpactStore((s) => s.setProjectedCustomized)
  // Sliced selector: subscribes only to THIS archetype's static config so a
  // change there re-fires the inherit effect, while changes to other
  // archetypes' configs (or to other slots in the store) don't churn it.
  // Required to fix the bug where the inherit effect was keyed on
  // [archetypeId] only and missed Static→Projected mid-session sync.
  const staticCfgForArc = useSingleProductImpactStore((s) =>
    archetypeId ? s.staticConfigByArc[archetypeId] : null,
  )
  const currentStageAmounts = archetypeId ? stageAmountsByArc[archetypeId]?.amounts ?? null : null
  const [chartMethodKey, setChartMethodKey] = useState<string | null>(null)

  // Patch 5AY — the full default indicator set (all-N), fetched directly so
  // Prospective can seed it on a COLD load (opened without visiting Static, so
  // the Static→Projected mirror has no source yet). Mirrors MethodPicker's
  // cold default: EF v3.1 if present, else the first family. This is the
  // mirror SOURCE seeded to all-N — Prospective inherits the full set
  // regardless of visit order, WITHOUT a customizing change (the seed flows
  // through the same single-echo + skip-ref path the mirror uses).
  const [allMethods, setAllMethods] = useState<string[][]>([])
  useEffect(() => {
    let cancelled = false
    getMethods().then((fams) => {
      if (cancelled) return
      const fam = fams.find((f) => f.family.startsWith('EF v3.1'))?.family ?? fams[0]?.family
      const target = fams.find((f) => f.family === fam)
      if (!target) return
      const all: string[][] = []
      for (const cat of target.categories) for (const ind of cat.indicators) all.push(ind.tuple)
      setAllMethods(all)
    }).catch(() => { /* surfaces nowhere; cold-seed simply won't fire */ })
    return () => { cancelled = true }
  }, [])

  // Publish runs to the cross-panel store so Comparison can read them.
  useEffect(() => {
    setStoreProjectedRuns(runs)
  }, [runs, setStoreProjectedRuns])

  // Patch 4D — per-archetype config restore + first-visit inheritance.
  // Patch 4E — subscribed to staticCfgForArc slice so Static→Projected
  // sync fires when Static is configured AFTER Projected mounted (not
  // just at archetype-pick time). Both panels are visibility-toggle-
  // mounted, so archetypeId is not the only state transition that
  // matters.
  // Patch 4F — flipped to LIVE-MIRROR semantic until the user
  // customizes Projected. Patch 4E's "one-shot at first slice change"
  // semantic broke the real workflow: user adds 4 indicators on Static
  // sequentially, but only the FIRST inheritance trigger fired (the
  // others hit Path 1's isArchetypeChange early-return). Live mirror
  // fixes this and matches the user's mental model — "Projected
  // follows Static until I touch Projected directly." The
  // `projectedCustomizedByArc[arc]` flag is the contract: false →
  // mirror, true → frozen at user's last edit.
  //
  //   customized=true, projCfg exists → restore-only-on-archetype-change.
  //   staticCfg has methods (regardless of projCfg)              → mirror.
  //   no staticCfg, projCfg exists                              → restore.
  //   nothing                                                   → defaults.
  //
  // The banner shows only on the FIRST mirror per arc per session
  // (bannerShownForArcRef). Subsequent mirror updates for the same arc
  // re-bump the picker silently.
  //
  // projectedConfigByArc and projectedCustomizedByArc are read fresh
  // via getState() rather than subscribed-to, because writing the
  // mirror result to projectedConfigByArc would otherwise re-fire the
  // effect from its own write.
  useEffect(() => {
    if (!archetypeId) return
    const state = useSingleProductImpactStore.getState()
    const projCfg = state.projectedConfigByArc[archetypeId]
    const customized = state.projectedCustomizedByArc[archetypeId]
    const staticCfg = staticCfgForArc

    const isArchetypeChange = archetypeId !== lastArchetypeIdRef.current

    let target: { scope: Scope; selectedMethods: string[][]; selectedDbs: string[] }
    let mirrored = false
    if (customized && projCfg) {
      // User has drifted Projected from Static. Restore the customized
      // config ONLY on archetype change; same-arc staticCfg slice
      // changes are no-ops (the user's customization is the source of
      // truth from here on).
      if (!isArchetypeChange) return
      target = projCfg
    } else if (staticCfg && staticCfg.selectedMethods.length > 0) {
      // Live mirror: copy Static → Projected. Preserve any
      // user-selected LCI databases (selectedDbs is Projected-only and
      // doesn't have a Static counterpart).
      target = {
        scope: staticCfg.scope,
        selectedMethods: staticCfg.selectedMethods,
        selectedDbs: projCfg?.selectedDbs ?? [],
      }
      mirrored = true
    } else if (projCfg) {
      // Static was cleared but a prior projCfg exists (e.g., user
      // configured Projected directly with no Static, then nuked
      // Static). Restore on archetype change only.
      if (!isArchetypeChange) return
      target = projCfg
    } else {
      // Defaults. Don't write to projectedConfigByArc — would block a
      // future mirror trigger for this arc.
      if (!isArchetypeChange) return
      target = { scope: 'all', selectedMethods: [], selectedDbs: [] }
    }

    skipNextMethodsChangeRef.current = true
    setScope(target.scope)
    setSelectedMethods(target.selectedMethods)
    setSelectedDbs(target.selectedDbs)
    setPickerSeed((s) => s + 1)

    if (mirrored) {
      setProjectedConfigForArc(archetypeId, target)
      // Banner shows only on the first mirror per arc per session.
      // Subsequent mirror updates (e.g., user adds indicator #2 on
      // Static) re-seed the picker silently.
      if (bannerShownForArcRef.current !== archetypeId) {
        setShowInheritBanner(true)
        bannerShownForArcRef.current = archetypeId
      }
    } else if (isArchetypeChange) {
      setShowInheritBanner(false)
    }
    lastArchetypeIdRef.current = archetypeId
  }, [archetypeId, staticCfgForArc, setProjectedConfigForArc])

  // Patch 5AY — cold-load default seed. When the panel is truly cold for this
  // arc (no Static source published yet, no prior Projected config, not
  // customized, nothing selected) and the full method list has loaded, seed
  // all-N as a NON-customizing default so a Prospective-FIRST visit lands on
  // the full indicator set (image-1's 0/N fix) instead of empty. Uses the
  // SAME single-echo + skip-ref mechanism the mirror uses — so
  // projectedCustomized stays false, and a later Static publish still mirrors
  // over this default (the staticCfg guard yields to the mirror once Static
  // publishes). Distinct from the naive `defaultAllSelected` (rejected): that
  // fires an ASYNC second onChange the single-use skip can't cover, which the
  // mirror reads as a user edit and freezes the mirror. Seeding via
  // initialSelected fires exactly one echo, which the skip absorbs.
  useEffect(() => {
    if (!archetypeId || allMethods.length === 0) return
    if (staticCfgForArc && staticCfgForArc.selectedMethods.length > 0) return // mirror owns it
    const state = useSingleProductImpactStore.getState()
    if (state.projectedConfigByArc[archetypeId]) return
    if (state.projectedCustomizedByArc[archetypeId]) return
    if (selectedMethods.length > 0) return // already seeded / inherited
    skipNextMethodsChangeRef.current = true
    setSelectedMethods(allMethods)
    setPickerSeed((s) => s + 1)
  }, [archetypeId, allMethods, staticCfgForArc, selectedMethods])

  // Auto-dismiss banner ~6s after it appears. User can also dismiss it
  // manually via the × button.
  useEffect(() => {
    if (!showInheritBanner) return
    const t = setTimeout(() => setShowInheritBanner(false), 6000)
    return () => clearTimeout(t)
  }, [showInheritBanner])

  const handleScopeClick = useCallback((next: Scope) => {
    setScope(next)
    // Race guard: see handleMethodsChange.
    if (archetypeId !== lastArchetypeIdRef.current) return
    if (archetypeId) {
      setProjectedConfigForArc(archetypeId, { scope: next, selectedMethods, selectedDbs })
      setProjectedCustomized(archetypeId, true)
    }
  }, [archetypeId, selectedMethods, selectedDbs, setProjectedConfigForArc, setProjectedCustomized])

  const handleMethodsChange = useCallback((m: string[][]) => {
    setSelectedMethods(m)
    // Suppress the seed-fired onChange after the picker remount. Same
    // motivation as Static — its value matches what we just set, so it'd
    // be a no-op write that also incorrectly marks the panel customized.
    if (skipNextMethodsChangeRef.current) {
      skipNextMethodsChangeRef.current = false
      return
    }
    // Race guard: archetypeId changed since the last committed restore
    // effect, so the picker's `selected` map (about to be replaced by the
    // restore) is still the previous archetype's. Skip the write.
    if (archetypeId !== lastArchetypeIdRef.current) return
    if (archetypeId) {
      setProjectedConfigForArc(archetypeId, { scope, selectedMethods: m, selectedDbs })
      // Per spec: only scope and selectedMethods user-edits flip the
      // customized flag. selectedDbs (LCI scenarios) does not.
      setProjectedCustomized(archetypeId, true)
    }
  }, [archetypeId, scope, selectedDbs, setProjectedConfigForArc, setProjectedCustomized])

  const toggleDb = useCallback((name: string, on: boolean) => {
    setSelectedDbs((prev) => {
      const next = on ? [...prev, name] : prev.filter((n) => n !== name)
      if (archetypeId) {
        setProjectedConfigForArc(archetypeId, { scope, selectedMethods, selectedDbs: next })
      }
      return next
    })
  }, [archetypeId, scope, selectedMethods, setProjectedConfigForArc])

  // Patch 4E — per-trajectory batch toggles. Selecting all years for a
  // single (iam, ssp) trajectory is the canonical multi-year sweep — the
  // user typically wants every available year to compare a full
  // trajectory shape, not a single point. The plain checklist made that
  // 6 clicks per trajectory.
  const setTrajectoryDbs = useCallback((dbNames: string[], on: boolean) => {
    setSelectedDbs((prev) => {
      const set = new Set(prev)
      if (on) for (const n of dbNames) set.add(n)
      else for (const n of dbNames) set.delete(n)
      const next = Array.from(set)
      if (archetypeId) {
        setProjectedConfigForArc(archetypeId, { scope, selectedMethods, selectedDbs: next })
      }
      return next
    })
  }, [archetypeId, scope, selectedMethods, setProjectedConfigForArc])

  // Selected DB names as a Set for the shared ScenarioYearPicker.
  const selectedDbsSet = useMemo(() => new Set(selectedDbs), [selectedDbs])

  // Group databases by (base_db, iam, ssp) so the picker reads as scenario
  // trajectories (one row per year per trajectory) rather than a flat list.
  const groupedDbs = useMemo(() => {
    const map = new Map<string, ProspectiveDB[]>()
    for (const db of databases) {
      const k = `${db.base_db}|${db.iam}|${db.ssp}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(db)
    }
    for (const list of map.values()) list.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [databases])

  const handleCalculate = useCallback(async () => {
    if (!archetypeId || selectedMethods.length === 0 || selectedDbs.length === 0) return
    setIsCalculating(true)
    setError(null)
    setRuns([])
    setActiveRunIdx(0)

    const dbsToRun = selectedDbs
      .map((name) => databases.find((d) => d.name === name))
      .filter((d): d is ProspectiveDB => !!d)
      // Sort by year ascending so the scenario tab bar reads chronologically.
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))

    setProgress({ done: 0, total: dbsToRun.length })
    const acc: ProjectedRun[] = []
    try {
      for (let i = 0; i < dbsToRun.length; i++) {
        const db = dbsToRun[i]
        const result = await calculateArchetypeLCA(archetypeId, scope, selectedMethods, {
          computeDatabase: db.name,
          stageAmounts: currentStageAmounts ?? undefined,
        })
        acc.push({ dbName: db.name, year: db.year, iam: db.iam, ssp: db.ssp, result })
        setProgress({ done: i + 1, total: dbsToRun.length })
      }
      setRuns(acc)
      setActiveRunIdx(0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsCalculating(false)
      setProgress(null)
    }
  }, [archetypeId, scope, selectedMethods, selectedDbs, databases, currentStageAmounts])

  const isMulti = runs.length > 1
  const activeRun = runs[activeRunIdx]
  const hasResults = runs.length > 0 && activeRun != null

  // Patch 4G — Excel export.
  const [isExporting, setIsExporting] = useState(false)
  const handleExport = useCallback(async () => {
    if (!activeRun || runs.length === 0) return
    setIsExporting(true)
    try {
      await exportSingleProductProspective(
        activeRun.result.archetype_name,
        scope,
        runs.map((r) => ({
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
  }, [activeRun, runs, scope, archetypeId, stageAmountsByArc])
  const isStale =
    runs.length > 0 &&
    runs.some((r) => !stageAmountsEqual(r.result.stage_amounts, currentStageAmounts))

  // Default the chart method to the first available method whenever the
  // run set changes; keep the user's selection if it's still valid.
  useEffect(() => {
    if (!activeRun) return
    const validKeys = activeRun.result.results.map((r) => r.method.join('|'))
    if (validKeys.length === 0) return
    if (chartMethodKey == null || !validKeys.includes(chartMethodKey)) {
      setChartMethodKey(validKeys[0])
    }
  }, [activeRun, chartMethodKey])

  if (archetypeId == null) {
    return (
      <div
        data-testid="single-product-projected-empty"
        style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
        }}
      >
        Pick an archetype above to compute its projected impact.
      </div>
    )
  }

  if (databases.length === 0) {
    return (
      <div
        data-testid="single-product-projected-no-databases"
        style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
          padding: 'var(--space-4)', textAlign: 'center',
        }}
      >
        No prospective databases available. Generate at least one in the pLCA Developer first.
      </div>
    )
  }

  const configSummary = `${SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope} · ${selectedMethods.length} indicators · ${selectedDbs.length} LCI scenario${selectedDbs.length === 1 ? '' : 's'}`

  const calculateButton = (
    <Button
      variant="primary"
      data-testid="single-product-projected-calculate"
      onClick={handleCalculate}
      disabled={selectedMethods.length === 0 || selectedDbs.length === 0 || isCalculating}
      style={{ backgroundColor: 'var(--mod-plca)', height: 32 }}
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
      data-testid="single-product-projected-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      {showInheritBanner && (
        <div
          data-testid="single-product-projected-inherit-banner"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            fontSize: 'var(--text-xs)', color: 'var(--text-primary)',
            backgroundColor: 'color-mix(in srgb, var(--mod-plca) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--mod-plca) 25%, transparent)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <span style={{ flex: 1 }}>
            Inherited Static Background configuration. Changes here are independent.
          </span>
          <button
            type="button"
            data-testid="single-product-projected-inherit-banner-dismiss"
            onClick={() => setShowInheritBanner(false)}
            aria-label="Dismiss"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)',
              padding: '0 4px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
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
                    data-testid={`single-product-projected-scope-${s.value}`}
                    onClick={() => handleScopeClick(s.value)}
                    style={{
                      padding: '6px 10px',
                      border: '1px solid ' + (isActive ? 'var(--mod-plca)' : 'var(--border-default)'),
                      backgroundColor: isActive
                        ? 'color-mix(in srgb, var(--mod-plca) 12%, transparent)'
                        : 'var(--bg-elevated)',
                      color: isActive ? 'var(--mod-plca)' : 'var(--text-primary)',
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
              {/* No defaultAllSelected on Projected (it fires an async second
                  onChange the single-use skip can't cover → reads as a user
                  edit → freezes the mirror). Instead: it inherits "all" from
                  Static via the 4F live-mirror, AND on a COLD load (Prospective
                  first, no Static source yet) the Patch-5AY cold-seed effect
                  seeds all-N via initialSelected (one echo, absorbed by the
                  skip ref) — non-customizing, mirror stays live. */}
              <MethodPicker
                key={pickerSeed}
                onChange={handleMethodsChange}
                accent="var(--mod-plca)"
                initialSelected={selectedMethods}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 480 }}>
            <span style={{
              fontSize: 'var(--text-xs)', fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <Layers size={11} /> LCI scenarios
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 2 }}>
                · {selectedDbs.length}/{databases.length}
              </span>
            </span>
            <div
              data-testid="single-product-projected-db-list"
              style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: '8px 10px',
                maxHeight: 200, overflowY: 'auto',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {/* Patch 5Z — grouped scenario-year picker, extracted to a shared
                  component. Behavior + testids unchanged; the parent still owns
                  selectedDbs / toggleDb / setTrajectoryDbs. */}
              <ScenarioYearPicker
                groups={groupedDbs.map(([key, items]) => ({
                  key,
                  label: `${items[0].iam} · ${items[0].ssp}`,
                  years: items.map((d) => ({ id: d.name, year: d.year })),
                }))}
                selected={selectedDbsSet}
                onToggleYear={(id, on) => toggleDb(id, on)}
                onSetGroup={(ids, on) => setTrajectoryDbs(ids, on)}
                disabled={isCalculating}
                testIds={{
                  allYears: (k) => `single-product-projected-traj-all-${k}`,
                  clear: (k) => `single-product-projected-traj-clear-${k}`,
                  yearItem: (id) => `single-product-projected-db-${id}`,
                }}
              />
            </div>
          </div>

          {error && (
            <div
              data-testid="single-product-projected-error"
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
        statusColor="var(--mod-plca)"
        data-testid="single-product-projected-progress"
      />

      {hasResults && activeRun && (
        <CollapsibleCard
          title="Results"
          expanded={resultsExpanded}
          onToggle={() => setResultsExpanded((v) => !v)}
          summary={`${activeRun.result.archetype_name} · ${runs.length} scenario${runs.length === 1 ? '' : 's'} · ${activeRun.result.results.length} indicators`}
          actions={
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ViewToggle
                mode={viewMode}
                onChange={setViewMode}
                accent="var(--mod-plca)"
              />
              <button
                type="button"
                data-testid="single-product-projected-export"
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
            {isStale && (
              <div
                data-testid="single-product-projected-stale"
                style={{
                  padding: '6px 10px',
                  fontSize: 'var(--text-xs)', color: 'var(--status-warning)',
                  backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--status-warning) 25%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Stage amounts changed since these results were computed. Click Calculate to refresh.
              </div>
            )}
            {activeRun.result.warnings && activeRun.result.warnings.length > 0 && (
              <div
                data-testid="single-product-projected-warnings"
                style={{
                  padding: '6px 10px',
                  fontSize: 'var(--text-xs)', color: 'var(--status-warning)',
                  backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--status-warning) 25%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {activeRun.result.warnings.length} warning{activeRun.result.warnings.length === 1 ? '' : 's'}: {activeRun.result.warnings.slice(0, 2).join(' · ')}
                {activeRun.result.warnings.length > 2 ? ' …' : ''}
              </div>
            )}

            {/*
             * Both views stay mounted via visibility-toggle (display: none).
             * Local state in either view (chart hover, scroll position, etc.)
             * survives the user round-tripping through the toggle. Same
             * discipline as the impact-tab-pane visibility-toggle (see CLAUDE.md
             * "Visibility-toggle vs. conditional mount").
             */}
            <div
              data-testid="single-product-projected-view-chart"
              style={{ display: viewMode === 'chart' ? 'block' : 'none' }}
            >
              {chartMethodKey && (
                <ProjectedTimeSeriesChart
                  runs={runs}
                  activeMethodKey={chartMethodKey}
                  format={valueFormat}
                  filenameBase={activeRun.result.archetype_name.replace(/\s+/g, '_').toLowerCase()}
                  methodSelector={
                    <MethodSelector
                      methods={activeRun.result.results.map((r) => ({
                        key: r.method.join('|'),
                        label: r.method_label,
                      }))}
                      activeKey={chartMethodKey}
                      onChange={setChartMethodKey}
                      testId="single-product-projected-chart-method-select"
                    />
                  }
                />
              )}
            </div>

            <div
              data-testid="single-product-projected-view-table"
              style={{ display: viewMode === 'table' ? 'block' : 'none' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {isMulti && (
                  <ProjectedScenarioTabBar
                    runs={runs}
                    activeIdx={activeRunIdx}
                    onChange={setActiveRunIdx}
                  />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <NumberFormatControl
                    settings={valueFormat.settings}
                    onChange={valueFormat.setSettings}
                  />
                </div>
                <div style={{
                  fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  LCI: {activeRun.dbName}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                      <th style={th}>Indicator</th>
                      <th style={{ ...th, textAlign: 'right' }}>Score</th>
                      <th style={{ ...th, textAlign: 'left' }}>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRun.result.results.map((r) => (
                      <tr key={r.method.join('|')} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
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
            </div>
          </div>
        </CollapsibleCard>
      )}
    </div>
  )
}

function ProjectedScenarioTabBar({
  runs, activeIdx, onChange,
}: { runs: ProjectedRun[]; activeIdx: number; onChange: (i: number) => void }) {
  return (
    <div
      data-testid="single-product-projected-scenario-tabs"
      style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}
    >
      {runs.map((r, i) => {
        const isActive = i === activeIdx
        const label = `${r.iam}/${r.ssp} ${r.year ?? '—'}`
        return (
          <button
            key={r.dbName}
            type="button"
            data-testid={`single-product-projected-scenario-${i}`}
            onClick={() => onChange(i)}
            style={{
              border: 'none', background: 'transparent',
              borderBottom: isActive ? '2px solid var(--mod-plca)' : '2px solid transparent',
              padding: '6px 10px',
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              marginBottom: -1,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {label}
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

