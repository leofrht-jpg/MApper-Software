/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 4AG.3 — Multi-product LCA comparison layout.
//
// Wires together:
//   - Configuration: Scope buttons + MethodPicker (shared across items)
//   - <MultiItemSelector> in mixed mode, fed by useBOMStore.archetypes
//     and useActivityStore.activities
//   - Compute button → useMultiProductLCAStore.compute()
//   - Basic per-item results table (chart visualisation deferred to
//     Patch 4AG.4)
//
// Data wiring rationale (see CLAUDE.md):
//   - Activity feed reuses `useActivityStore` (which already manages
//     /activities/search-all with pagination + filter state). The
//     search-query share with Database Explorer is a known
//     limitation — switching tabs erases the other's query. A
//     future refinement decouples them if research workflows
//     require it.
//   - Archetype feed reads `useBOMStore.archetypes` synchronously
//     (already loaded when the LCA module is entered).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Download, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { MultiItemSelector } from '../shared/MultiItemSelector'
import { ActivityVintagePicker } from './ActivityVintagePicker'
import { GroupedVintagePanel } from './GroupedVintagePanel'
import { MethodPicker } from '../MethodPicker'
import { NumberInput } from '../ui/NumberInput'
import { MultiProductComparisonChart } from './MultiProductComparisonChart'
import { MultiProductLineChart } from './MultiProductLineChart'
import { shortenByCommonPrefix } from '../../utils/labelPrefix'
import { StageAmountsEditor, stageAmountsForPreset, stageAmountsSummary } from './StageAmountsEditor'
import { ComputeProgress } from '../ui/ComputeProgress'
import { useBOMStore } from '../../stores/bomStore'
import { useActivityStore } from '../../stores/activityStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePLCAStore } from '../../stores/plcaStore'
import { useMultiProductLCAStore } from '../../stores/multiProductLCAStore'
import { type AmountPreset, type ArchetypeStageAmounts } from '../../stores/singleProductImpactStore'
import { productItemKey, type ActivityProductItem, type ArchetypeProductItem, type ProductItem } from '../shared/productItem'
import {
  exportMultiProductComparison,
  type MultiProductItemResult,
} from '../../api/client'

type Scope = 'inflows' | 'stock' | 'outflows' | 'all'
// Within-type comparison: a comparison is of ONE type (archetypes OR
// activities), never mixed. The mode toggle drives the MultiItemSelector's
// `mode` prop; switching clears the selection so cross-type items can't linger.
type CompareMode = 'archetype' | 'activity'

// Lifecycle scope applies to ARCHETYPES only (Patch 5X). Activities are single
// ecoinvent processes with no stages — the backend ignores scope for them
// (ActivityLCARequest has no scope field) — so they always compute against Full
// Lifecycle ('all'), the current default. This is the payload rule: it ensures
// a leftover non-'all' archetype scope never leaks into an activity run.
export function scopeForMode(mode: CompareMode, scope: Scope): Scope {
  return mode === 'activity' ? 'all' : scope
}

// Scope-stage labels standardized to the Single item tab's wording/casing
// (Patch 5Q) — same underlying stage map (all/inflows/stock/outflows), so this
// is cosmetic alignment, not a stage-definition change.
const SCOPE_LABELS: Record<Scope, string> = {
  all: 'Full Lifecycle',
  inflows: 'Manufacturing',
  stock: 'Operation',
  outflows: 'End of Life',
}

export function MultiProductLCA() {
  const archetypes = useBOMStore((s) => s.archetypes)
  const fetchArchetypes = useBOMStore((s) => s.fetchArchetypes)
  const activities = useActivityStore((s) => s.activities)
  const searchActivities = useActivityStore((s) => s.searchActivities)
  const selectedDatabase = useActivityStore((s) => s.selectedDatabase)
  const setDatabase = useActivityStore((s) => s.setDatabase)
  const setLocations = useActivityStore((s) => s.setLocations)
  const setUnits = useActivityStore((s) => s.setUnits)
  const distinctValues = useActivityStore((s) => s.distinctValues)
  const databases = useProjectStore((s) => s.databases)
  // pLCA registry — the vintage source (same registry _resolve_prospective_dbs
  // reads). Drives the activity-mode vintage picker.
  const plcaDatabases = usePLCAStore((s) => s.databases)
  const fetchPLCADatabases = usePLCAStore((s) => s.fetchDatabases)

  const selectedItems = useMultiProductLCAStore((s) => s.selectedItems)
  const stageAmountsByItem = useMultiProductLCAStore((s) => s.stageAmountsByItem)
  const setItemStageAmounts = useMultiProductLCAStore((s) => s.setItemStageAmounts)
  const setStageAmountsMap = useMultiProductLCAStore((s) => s.setStageAmountsMap)
  const multiResult = useMultiProductLCAStore((s) => s.multiResult)
  // Results-aligned vintage coords, snapshotted at compute time — the source for
  // the Line gate / chart / export (NOT the live selection).
  const multiVintageCoords = useMultiProductLCAStore((s) => s.multiVintageCoords)
  const multiLoading = useMultiProductLCAStore((s) => s.multiLoading)
  const multiError = useMultiProductLCAStore((s) => s.multiError)
  const addItem = useMultiProductLCAStore((s) => s.addItem)
  const removeItem = useMultiProductLCAStore((s) => s.removeItem)
  const clearItems = useMultiProductLCAStore((s) => s.clearItems)
  const clearResults = useMultiProductLCAStore((s) => s.clearResults)
  const compute = useMultiProductLCAStore((s) => s.compute)

  const [scope, setScope] = useState<Scope>('all')
  const [methods, setMethods] = useState<string[][]>([])

  // Within-type mode. Default 'archetype' (the pre-existing behavior + most
  // common workflow). Switching clears the selection (and any pending activity)
  // so a comparison never mixes types.
  const [compareMode, setCompareMode] = useState<CompareMode>('archetype')
  // Activity mode: the base activity the user picked, awaiting vintage choice.
  // null when no pick is in flight.
  const [pendingActivity, setPendingActivity] = useState<ActivityProductItem | null>(null)

  const switchMode = (next: CompareMode) => {
    if (next === compareMode) return
    setCompareMode(next)
    setPendingActivity(null)
    clearItems()    // within-type: don't carry cross-type items across the switch
    clearResults()  // and don't leave a stale cross-mode chart in the Results panel
  }

  // Selector add is intercepted in activity mode: clicking an activity opens
  // the vintage picker (one activity → N vintage items) instead of adding a
  // single static item. Archetype mode adds directly.
  const handleSelectorAdd = (item: ProductItem) => {
    if (compareMode === 'activity' && item.type === 'activity') {
      setPendingActivity(item)
      return
    }
    addItem(item)
  }

  const selectedKeys = useMemo(
    () => new Set(selectedItems.map(productItemKey)),
    [selectedItems],
  )

  // Global stage-amounts preset — the default applied to every item. Picking
  // a preset applies-to-all (overwrites each item); new items then seed from
  // this preset. Default '1year' matches the prior multi-item behavior
  // (all stages = 1 ≡ no per-item amounts), so existing results don't shift.
  const [globalPreset, setGlobalPreset] = useState<AmountPreset>('1year')
  const [globalLifetime, setGlobalLifetime] = useState(15)
  // Per-item editor collapse state (default collapsed — advanced tweak, the
  // summary line carries the values; mirrors the Single-item card).
  const [stageOpenByItem, setStageOpenByItem] = useState<Record<string, boolean>>({})

  // Collapse state for the three page sections. Local (session) state — it
  // survives sub-tab switches because the Multi-item pane is visibility-
  // toggled (never unmounts). No localStorage persistence. Scope + Items
  // default expanded; Results defaults expanded and only appears post-compute.
  const [scopeOpen, setScopeOpen] = useState(true)
  const [itemsOpen, setItemsOpen] = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)

  // Archetype items only carry stage amounts (activities have no BOM stages).
  const archetypeItems = useMemo(
    () => selectedItems.filter((i): i is ArchetypeProductItem => i.type === 'archetype'),
    [selectedItems],
  )

  // Reconcile per-item stage amounts against the LIVE selection: seed a new
  // item from the current global preset, prune a removed item's entry. Keyed
  // by item id — never a parallel copy of selectedItems. The only-set-if-
  // changed guard keeps this stable (no render loop) once reconciled.
  useEffect(() => {
    const valid = new Set(archetypeItems.map(productItemKey))
    const next = { ...stageAmountsByItem }
    let changed = false
    for (const item of archetypeItems) {
      const key = productItemKey(item)
      if (next[key]) continue
      const arc = archetypes.find((a) => a.id === item.archetype_id)
      if (!arc) continue
      next[key] = { preset: globalPreset, lifetime: globalLifetime, amounts: stageAmountsForPreset(arc, globalPreset, globalLifetime) }
      changed = true
    }
    for (const key of Object.keys(next)) {
      if (!valid.has(key)) { delete next[key]; changed = true }
    }
    if (changed) setStageAmountsMap(next)
  }, [archetypeItems, archetypes, globalPreset, globalLifetime, stageAmountsByItem, setStageAmountsMap])

  // Apply-to-all: a global preset pick overwrites every item's amounts.
  const applyGlobalPreset = (preset: AmountPreset, lifetime: number) => {
    setGlobalPreset(preset)
    setGlobalLifetime(lifetime)
    const next: Record<string, ArchetypeStageAmounts> = { ...stageAmountsByItem }
    for (const item of archetypeItems) {
      const arc = archetypes.find((a) => a.id === item.archetype_id)
      if (!arc) continue
      const key = productItemKey(item)
      next[key] = { preset, lifetime, amounts: stageAmountsForPreset(arc, preset, lifetime, next[key]?.amounts) }
    }
    setStageAmountsMap(next)
  }

  // Per-item stage-amount provenance for the export, keyed by item_id
  // (= archetype_id for archetype items, matching the workbook). Patch 5J.
  const stageAmountsMeta = useMemo(() => {
    const meta: Record<string, ArchetypeStageAmounts> = {}
    for (const item of archetypeItems) {
      const entry = stageAmountsByItem[productItemKey(item)]
      if (entry) meta[item.archetype_id] = entry
    }
    return meta
  }, [archetypeItems, stageAmountsByItem])

  // Per-item vintage provenance for the Line gate / chart / export, keyed by
  // item_id ("{database}|{code}"). Sourced from the COMPUTE-time snapshot
  // (`multiVintageCoords`), NOT the live `selectedItems` — the displayed results
  // can outlive a selection change (e.g. a mode switch), and gating Line on the
  // live selection wrongly disables it on valid line-able results.
  const activityVintageMeta = multiVintageCoords ?? {}

  useEffect(() => {
    if (archetypes.length === 0) fetchArchetypes()
  }, [archetypes.length, fetchArchetypes])

  // The activity-SOURCE picker offers only ORIGINAL/base databases (the
  // user-uploaded ecoinvent + biosphere), NEVER the premise-derived
  // prospective/superstructure DBs. The prospective DBs are the YEAR VINTAGES
  // the user picks AFTER choosing a base-DB activity, and they live solely in
  // the LCI scenarios picker (`<ActivityVintagePicker databases={plcaDatabases}>`).
  // Classification source of truth: `usePLCAStore.databases` (the frontend
  // mirror of plca_storage's registry) — a DB is prospective iff its name is in
  // that set.
  const baseDatabases = useMemo(() => {
    const prospectiveNames = new Set(plcaDatabases.map((d) => d.name))
    return databases.filter((d) => !prospectiveNames.has(d.name))
  }, [databases, plcaDatabases])

  // Initial database for activity search. The selector reads
  // `useActivityStore.activities` (the loaded result list); a
  // database must be selected for the store's loader to populate it. Pick the
  // first BASE DB on mount, and re-pick if the current selection isn't a base
  // DB (so it can never land on a prospective DB, e.g. one persisted earlier).
  useEffect(() => {
    if (baseDatabases.length === 0) return
    const isBase = selectedDatabase != null && baseDatabases.some((d) => d.name === selectedDatabase)
    if (!isBase) setDatabase(baseDatabases[0].name)
  }, [selectedDatabase, baseDatabases, setDatabase])

  // Load the pLCA registry once so the activity-mode vintage picker can offer
  // installed SSP×year vintages.
  useEffect(() => { void fetchPLCADatabases() }, [fetchPLCADatabases])

  // Activity search/filters MUST round-trip to the backend, not just filter the
  // loaded first page. Without this, typing an activity name that lands beyond
  // the first 50 (e.g. "market for electricity, low voltage") matched 0 rows —
  // the selector filtered only the in-memory page, never re-querying. We wire
  // the selector's callbacks to the store (same path as Database Explorer): a
  // debounced `searchActivities` re-queries by name OR reference product OR
  // location (case-insensitive substring, backend-side), and filter changes
  // re-dispatch the search composed with Location/Unit. `filterOptions` comes
  // from the database-level distinct values so the dropdowns offer the FULL
  // universe, not just the loaded page (Patch 4AI parity, via the store).
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleActivitySearch = (q: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => searchActivities(q), 300)
  }
  const handleActivityFiltersChange = (filters: { locations: string[]; units: string[] }) => {
    setLocations(filters.locations)
    setUnits(filters.units)
  }
  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
  }, [])

  const canCompute = selectedItems.length > 0 && methods.length > 0 && !multiLoading
  // Live compute progress (Patch 5AL): the shared <ComputeProgress> card owns
  // the elapsed counter. Multi-item is a synchronous client-side fan-out with no
  // obtainable pct, so the card uses bar='none' (spinner + elapsed) — never a
  // fabricated bar. The compute button morphs to a spinner only; the final
  // precise time still comes from the backend (result.elapsed_seconds) on the
  // Results card.

  // Activities lock to Full Lifecycle ('all'); archetypes use the selected
  // scope. See `scopeForMode` — the payload rule, so a leftover non-'all'
  // archetype scope can't leak into an activity run.
  const effectiveScope = scopeForMode(compareMode, scope)

  const handleCompute = () => {
    void compute({ scope: effectiveScope, methods })
  }

  // Live collapsed-header summary for Configuration. Reads `scope` + `methods`
  // at render (never a value snapshotted when the card collapsed). The bare
  // MethodPicker owns its own selection, so the parent can show the selected
  // family + selected indicator count, not the family's total ("of M"). In
  // Activities mode the scope token is omitted (no stages → no scope).
  const methodsSummary = methods.length > 0
    ? `${methods[0][0]} · ${methods.length} indicator${methods.length === 1 ? '' : 's'}`
    : 'No methods selected'
  const scopeSummary = (
    <span data-testid="multi-product-scope-summary" style={{ fontFamily: 'var(--font-mono)' }}>
      {compareMode === 'activity' ? methodsSummary : `${SCOPE_LABELS[scope]} · ${methodsSummary}`}
    </span>
  )

  return (
    <div data-testid="multi-product-lca" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Within-type mode toggle — a comparison is of ONE type (archetypes OR
          activities), never mixed. */}
      <div data-testid="multi-product-mode-toggle" style={{ display: 'flex', gap: 4 }}>
        {([
          { key: 'archetype' as CompareMode, label: 'Archetypes' },
          { key: 'activity' as CompareMode, label: 'Activities' },
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            data-testid={`multi-product-mode-${m.key}`}
            onClick={() => switchMode(m.key)}
            style={{
              padding: '6px 14px', fontSize: 12, cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              background: compareMode === m.key ? 'var(--mod-lca)' : 'var(--bg-elevated)',
              color: compareMode === m.key ? '#fff' : 'var(--text-secondary)',
              fontWeight: compareMode === m.key ? 600 : 400,
            }}
          >
            {m.label}
          </button>
        ))}
        <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
          {compareMode === 'activity'
            ? 'Compare one activity across vintages (ecoinvent + premise SSP×year), or several activities.'
            : 'Compare archetypes from the MApper database.'}
        </span>
      </div>

      {/* Items to compare — search/filters + selector. DB picker lives in the
          card's actions slot (stop-propagation so it doesn't toggle the card). */}
      <CollapsibleCard
        title="Items to compare"
        expanded={itemsOpen}
        onToggle={() => setItemsOpen((v) => !v)}
        summary={!itemsOpen ? (
          <span data-testid="multi-product-items-summary">
            {selectedItems.length} selected
          </span>
        ) : undefined}
        // Database selector is Activities-mode-only: it scopes the activity
        // search and is the base for the 5R vintages. Archetypes resolve
        // against their BOM's base ecoinvent links (compute_database is null in
        // the payload), so the dropdown is meaningless in Archetypes mode and is
        // omitted there. selectedDatabase is store-backed (useActivityStore), so
        // the Activities selection survives the mode switch.
        actions={compareMode === 'activity' && selectedDatabase && baseDatabases.length > 1 ? (
          <select
            data-testid="multi-product-database-select"
            value={selectedDatabase}
            onChange={(e) => {
              setDatabase(e.target.value)
              // Trigger an initial empty-query search to populate
              // the new database's first-page results.
              searchActivities('')
            }}
            style={{
              fontSize: 11,
              padding: '4px 6px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {baseDatabases.map((d) => (
              <option key={d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
        ) : undefined}
      >
        <div data-testid="multi-product-selection">
          <MultiItemSelector
            mode={compareMode}
            availableArchetypes={archetypes}
            availableActivities={activities}
            selectedItems={selectedItems}
            onAddItem={handleSelectorAdd}
            onRemoveItem={removeItem}
            onClearAll={clearItems}
            onSearchChange={handleActivitySearch}
            onFiltersChange={handleActivityFiltersChange}
            filterOptions={{ locations: distinctValues.locations, units: distinctValues.units }}
            // Reset stale value-filters when the activity DB switches (the
            // filters were keyed to the previous DB's distinctValues).
            sourceKey={selectedDatabase}
            // Activity mode: group vintages of one activity under a single
            // header (display-only). Archetype mode keeps the default chips.
            renderSelectedItems={
              compareMode === 'activity' && selectedItems.length > 0
                ? <GroupedVintagePanel items={selectedItems} onRemove={removeItem} />
                : undefined
            }
          />
          {/* Activity mode: picking an activity opens the vintage picker.
              Each chosen vintage (ecoinvent + premise SSP×year) becomes a
              distinct comparison item with its own DB + stable color. */}
          {compareMode === 'activity' && pendingActivity && (
            <ActivityVintagePicker
              activity={pendingActivity}
              databases={plcaDatabases}
              existingKeys={selectedKeys}
              onAdd={(items) => {
                for (const it of items) addItem(it)
                setPendingActivity(null)
              }}
              onCancel={() => setPendingActivity(null)}
            />
          )}
        </div>
      </CollapsibleCard>

      {/* Stage amounts — one editor per selected archetype item. Reuses the
          Single-item <StageAmountsEditor>; per-item amounts feed compute via
          the shared backend stage-amount logic. Global preset applies to all;
          each item is independently overridable. Activities have no stages. */}
      {archetypeItems.length > 0 && (
        <div data-testid="multi-product-stage-amounts" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Global preset (applies to every item) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Stage amounts</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                { key: '1year' as AmountPreset, label: '1 year' },
                { key: 'lifetime' as AmountPreset, label: `Lifetime (${globalLifetime}yr)` },
                { key: 'custom' as AmountPreset, label: 'Custom' },
              ]).map((p) => (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`multi-product-global-preset-${p.key}`}
                  onClick={() => applyGlobalPreset(p.key, globalLifetime)}
                  style={{
                    padding: '3px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: '1px solid ' + (globalPreset === p.key ? 'var(--mod-lca)' : 'var(--border-default)'),
                    backgroundColor: globalPreset === p.key ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)' : 'var(--bg-elevated)',
                    color: globalPreset === p.key ? 'var(--mod-lca)' : 'var(--text-tertiary)',
                    fontSize: 10, fontWeight: globalPreset === p.key ? 600 : 500,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {globalPreset === 'lifetime' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Lifetime:</span>
                <NumberInput
                  value={globalLifetime}
                  onChange={(lt) => applyGlobalPreset('lifetime', lt)}
                  integerOnly
                  min={1}
                  emptyValue={1}
                  data-testid="multi-product-global-lifetime"
                  style={{ width: 50, height: 22, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', outline: 'none', textAlign: 'right' }}
                />
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>years · applies to all</span>
              </div>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>· per-item overridable below</span>
          </div>

          {/* Per-item editors — elevated variant + 1-based number badge (Patch
              5W) so selected items stand out from the structural cards and
              their order/count reads at a glance. Pre-filter to renderable
              items so the badge index is sequential and re-sequences on
              add/remove. */}
          {archetypeItems
            .map((item) => {
              const key = productItemKey(item)
              const arc = archetypes.find((a) => a.id === item.archetype_id)
              const entry = stageAmountsByItem[key]
              if (!arc || !entry || (arc.stages?.length ?? 0) === 0) return null
              return { item, key, arc, entry }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .map(({ item, key, arc, entry }, idx) => {
              const open = stageOpenByItem[key] ?? false
              return (
                <CollapsibleCard
                  key={key}
                  variant="item"
                  leading={<ItemNumberBadge n={idx + 1} testId={`multi-product-item-badge-${key}`} />}
                  title={item.display_name}
                  expanded={open}
                  onToggle={() => setStageOpenByItem((m) => ({ ...m, [key]: !open }))}
                  summary={!open ? (
                    <span data-testid={`multi-product-stage-summary-${key}`}>
                      {stageAmountsSummary(entry)}
                    </span>
                  ) : undefined}
                >
                  <StageAmountsEditor
                    archetype={arc}
                    value={entry}
                    onChange={(next) => setItemStageAmounts(key, next)}
                    accent="var(--mod-lca)"
                  />
                </CollapsibleCard>
              )
            })}
        </div>
      )}

      {/* Configuration — scope buttons + impact-method picker (shared across
          all items). Named/ordered to mirror the Single item tab's
          CONFIGURATION section (Patch 5Q); sits after selection + stage amounts. */}
      <CollapsibleCard
        title="Configuration"
        expanded={scopeOpen}
        onToggle={() => setScopeOpen((v) => !v)}
        summary={!scopeOpen ? scopeSummary : undefined}
      >
        <div data-testid="multi-product-config" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Lifecycle scope — Archetypes only. Activities are single ecoinvent
              processes with no stages (the backend ignores scope for them), so
              the selector is omitted in Activities mode and activities lock to
              Full Lifecycle. Mirrors the 5V/5W mode-scoping family. */}
          {compareMode === 'archetype' && (
            <div data-testid="multi-product-scope-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span style={labelStyle}>Scope</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { value: 'all', label: 'Full Lifecycle' },
                  { value: 'inflows', label: 'Manufacturing' },
                  { value: 'stock', label: 'Operation' },
                  { value: 'outflows', label: 'End of Life' },
                ] as const).map((s) => (
                  <button
                    key={s.value}
                    data-testid={`multi-product-scope-${s.value}`}
                    onClick={() => setScope(s.value)}
                    disabled={multiLoading}
                    style={{
                      padding: '4px 10px', height: 28,
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${scope === s.value ? 'var(--mod-lca)' : 'var(--border-default)'}`,
                      background: scope === s.value
                        ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)'
                        : 'var(--bg-base)',
                      color: scope === s.value ? 'var(--mod-lca)' : 'var(--text-primary)',
                      fontSize: 11,
                      fontWeight: scope === s.value ? 600 : 500,
                      cursor: multiLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Impact methods</span>
            <MethodPicker
              onChange={setMethods}
              accent="var(--mod-lca)"
              defaultAllSelected
            />
          </div>
        </div>
      </CollapsibleCard>

      {/* Compute action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Button
          variant="primary"
          onClick={handleCompute}
          disabled={!canCompute}
          data-testid="multi-product-compute"
          title={
            selectedItems.length === 0 ? 'Select at least one item'
              : methods.length === 0 ? 'Select at least one impact method'
              : multiLoading ? 'Computing…'
              : `Compute ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`
          }
          style={{ background: 'var(--mod-lca)' }}
        >
          {multiLoading ? (
            <>
              <Loader2 size={14} className="spin" />
              Computing…
            </>
          ) : (
            <>
              <Calculator size={14} />
              {`Compute (${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'})`}
            </>
          )}
        </Button>
        {multiError && (
          <span
            data-testid="multi-product-error"
            style={{
              fontSize: 11,
              color: 'var(--danger)',
              padding: '4px 8px',
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {multiError}
          </span>
        )}
      </div>

      <ComputeProgress
        active={multiLoading}
        label="Computing…"
        bar="none"
        statusColor="var(--mod-lca)"
        data-testid="multi-product-compute-progress"
        style={{ marginTop: 'var(--space-3)' }}
      />

      {/* Results — Patch 4AG.4 ships the chart + view toggle + export.
          The basic table from 4AG.3 is preserved as the alternative
          view (numerical inspection is methodologically different
          from visual comparison). Only rendered post-compute; expanded
          by default when present. */}
      {multiResult && (
        <CollapsibleCard
          title="Results"
          expanded={resultsOpen}
          onToggle={() => setResultsOpen((v) => !v)}
          summary={!resultsOpen ? (
            <span data-testid="multi-product-results-summary">
              {multiResult.success_count} successful, {multiResult.error_count} failed
            </span>
          ) : undefined}
        >
          <ResultsSection result={multiResult} scope={scope} stageAmountsMeta={stageAmountsMeta} activityVintageMeta={activityVintageMeta} />
        </CollapsibleCard>
      )}
    </div>
  )
}

// ── Results section (Patch 4AG.4) ──────────────────────────────────

function ResultsSection({
  result, scope, stageAmountsMeta, activityVintageMeta,
}: {
  result: import('../../api/client').MultiProductLCAResult
  scope: 'inflows' | 'stock' | 'outflows' | 'all'
  stageAmountsMeta: Record<string, ArchetypeStageAmounts>
  activityVintageMeta: Record<string, {
    label: string; database: string
    base_database?: string | null; iam?: string | null; ssp?: string | null; year?: number | null
  }>
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [exporting, setExporting] = useState(false)

  // Available methods — union across successful items in source
  // order. Failed items contribute nothing.
  const methodLabels = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const item of result.items) {
      if (item.status !== 'success') continue
      const methodResults = item.archetype_result?.results ?? item.activity_result?.results ?? []
      for (const m of methodResults) {
        if (!seen.has(m.method_label)) {
          seen.add(m.method_label)
          order.push(m.method_label)
        }
      }
    }
    return order
  }, [result])

  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  // Re-pin to the first method whenever the available list changes
  // (e.g. fresh compute) AND the current pick isn't valid.
  useEffect(() => {
    if (methodLabels.length === 0) {
      setSelectedMethod(null)
    } else if (selectedMethod === null || !methodLabels.includes(selectedMethod)) {
      setSelectedMethod(methodLabels[0])
    }
  }, [methodLabels, selectedMethod])

  // Patch 5S — Bar | Line chart-type toggle (Chart view only). Line is
  // meaningful only when the selection decomposes into a usable YEAR axis:
  // ≥2 distinct years across premise vintages (year + ssp present). Archetype
  // mode and multi-distinct-activity selections have no year axis → Line
  // disabled, Bar only.
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar')
  const lineEnabled = useMemo(() => {
    const years = new Set<number>()
    for (const it of result.items) {
      if (it.status !== 'success') continue
      const c = activityVintageMeta[it.item_id]
      if (c && c.ssp && c.year != null) years.add(c.year)
    }
    return years.size >= 2
  }, [result, activityVintageMeta])
  // The effective chart: never render Line when it's disabled (e.g. user had it
  // selected, then changed the selection to lose the year axis).
  const effectiveChartType = chartType === 'line' && lineEnabled ? 'line' : 'bar'

  // Shared-activity caption for the Line view (Bar computes its own internally).
  const lineSubtitle = useMemo(() => {
    const success = result.items.filter((it) => it.status === 'success')
    return shortenByCommonPrefix(success.map((it) => it.label)).shared
  }, [result])

  const canExport = result.success_count > 0 && !exporting
  const handleExport = async () => {
    setExporting(true)
    try {
      await exportMultiProductComparison(result, scope, { stageAmountsMeta, activityVintageMeta })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Multi-product export failed', e)
    } finally {
      setExporting(false)
    }
  }

  return (
    // Outer chrome is provided by the wrapping <CollapsibleCard> (title
    // "Results" + collapsed "N successful, M failed" summary), so this is a
    // plain flex container — no nested card border/padding.
    <div
      data-testid="multi-product-results"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      {/* Toolbar row: elapsed + method picker + view toggle + export.
          The success/fail counts live in the card title/summary above. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          {result.elapsed_seconds.toFixed(2)}s
        </span>
        <span style={{ flex: 1 }} />
        {/* Method picker (chart view only — table shows all methods at once) */}
        {view === 'chart' && methodLabels.length > 0 && (
          <select
            data-testid="multi-product-method-picker"
            value={selectedMethod ?? ''}
            onChange={(e) => setSelectedMethod(e.target.value)}
            style={{
              fontSize: 11, padding: '4px 6px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)', maxWidth: 280,
            }}
          >
            {methodLabels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        {/* Bar | Line chart-type toggle (chart view only). Line disabled with a
            tooltip when there's no usable year axis. */}
        {view === 'chart' && (
          <div
            data-testid="multi-product-charttype-toggle"
            style={{
              display: 'inline-flex', gap: 2, padding: 2,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {(['bar', 'line'] as const).map((t) => {
              const disabled = t === 'line' && !lineEnabled
              const activeT = effectiveChartType === t
              return (
                <button
                  key={t}
                  data-testid={`multi-product-charttype-${t}`}
                  onClick={() => !disabled && setChartType(t)}
                  disabled={disabled}
                  title={disabled ? 'Line view needs vintages across multiple years' : `${t} chart`}
                  style={{
                    padding: '3px 10px', fontSize: 11, fontWeight: activeT ? 600 : 500,
                    background: activeT ? 'var(--bg-surface)' : 'transparent',
                    border: '1px solid ' + (activeT ? 'var(--mod-lca)' : 'transparent'),
                    borderRadius: 'var(--radius-sm)',
                    color: disabled ? 'var(--text-tertiary)' : activeT ? 'var(--mod-lca)' : 'var(--text-secondary)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {t}
                </button>
              )
            })}
          </div>
        )}
        {/* View toggle */}
        <div
          data-testid="multi-product-view-toggle"
          style={{
            display: 'inline-flex', gap: 2, padding: 2,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              data-testid={`multi-product-view-${v}`}
              onClick={() => setView(v)}
              style={{
                padding: '3px 10px', fontSize: 11, fontWeight: view === v ? 600 : 500,
                background: view === v ? 'var(--bg-surface)' : 'transparent',
                border: '1px solid ' + (view === v ? 'var(--mod-lca)' : 'transparent'),
                borderRadius: 'var(--radius-sm)',
                color: view === v ? 'var(--mod-lca)' : 'var(--text-secondary)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {v}
            </button>
          ))}
        </div>
        {/* Export button */}
        <Button
          variant="secondary"
          onClick={() => void handleExport()}
          disabled={!canExport}
          data-testid="multi-product-export"
          title={
            result.success_count === 0 ? 'No successful results to export'
              : exporting ? 'Exporting…'
              : 'Export comparison as xlsx'
          }
          aria-label="Export comparison as xlsx"
          style={{ padding: '0 10px', height: 28 }}
        >
          {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
        </Button>
      </div>

      {/* Errors banner (when partial / total failure) */}
      {result.error_count > 0 && (
        <ErrorsBanner result={result} />
      )}

      {/* Visualisation pane — chart (bar|line) or table */}
      {view === 'chart' ? (
        effectiveChartType === 'line' ? (
          <MultiProductLineChart
            result={result}
            vintageCoords={activityVintageMeta}
            selectedMethodLabel={selectedMethod}
            filenameBase="multi_product_comparison"
            subtitle={lineSubtitle || undefined}
          />
        ) : (
          <MultiProductComparisonChart
            result={result}
            scope={scope}
            selectedMethodLabel={selectedMethod}
          />
        )
      ) : (
        <ResultsTable result={result} />
      )}
    </div>
  )
}

// Patch 5W — 1-based per-item index badge. Muted accent (mod-lca) so it reads
// as a quiet sequence marker on the elevated per-item card, tying to the panel
// accent without competing with the item name.
function ItemNumberBadge({ n, testId }: { n: number; testId: string }) {
  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 18, height: 18, padding: '0 5px',
        fontSize: 'var(--text-xs)', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: 'var(--mod-lca)',
        background: 'color-mix(in srgb, var(--mod-lca) 15%, transparent)',
        border: '1px solid color-mix(in srgb, var(--mod-lca) 35%, transparent)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {n}
    </span>
  )
}

function ErrorsBanner({ result }: { result: import('../../api/client').MultiProductLCAResult }) {
  const failed = result.items.filter((it) => it.status === 'error')
  return (
    <div
      data-testid="multi-product-errors-banner"
      style={{
        padding: '6px 10px',
        background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11,
        color: 'var(--danger)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {failed.length} item{failed.length === 1 ? '' : 's'} failed to compute:
      </span>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {failed.slice(0, 5).map((it) => (
          <li key={it.item_id}>
            <strong>{it.label}</strong>: {it.error_message ?? '(no detail)'}
          </li>
        ))}
        {failed.length > 5 && (
          <li>… and {failed.length - 5} more — see Errors sheet in the Excel export.</li>
        )}
      </ul>
    </div>
  )
}

function ResultsTable({ result }: { result: import('../../api/client').MultiProductLCAResult }) {
  // Collect all unique method labels across successful items for
  // table columns. Order: first-seen wins. (Failed items contribute
  // none.)
  const allMethodLabels = useMemo(() => {
    const labels: string[] = []
    const seen = new Set<string>()
    for (const it of result.items) {
      if (it.status !== 'success') continue
      const methodResults = it.archetype_result?.results ?? it.activity_result?.results ?? []
      for (const m of methodResults) {
        if (!seen.has(m.method_label)) {
          seen.add(m.method_label)
          labels.push(m.method_label)
        }
      }
    }
    return labels
  }, [result])

  return (
    <div data-testid="multi-product-results-table" style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
              <th style={thStyle}>Item</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
              {allMethodLabels.map((label) => (
                <th key={label} style={{ ...thStyle, textAlign: 'right' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.items.map((it) => (
              <ResultRow key={it.item_id} item={it} methodLabels={allMethodLabels} />
            ))}
          </tbody>
        </table>
    </div>
  )
}

function ResultRow({ item, methodLabels }: { item: MultiProductItemResult; methodLabels: string[] }) {
  const methodResults = item.archetype_result?.results ?? item.activity_result?.results ?? []
  const byLabel = new Map(methodResults.map((m) => [m.method_label, m]))
  return (
    <tr
      data-testid={`multi-product-row-${item.item_id}`}
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <td style={tdStyle}>{item.label}</td>
      <td style={tdStyle}>
        <span style={{
          padding: '1px 6px',
          fontSize: 9,
          fontWeight: 600,
          background: item.type === 'archetype'
            ? 'color-mix(in srgb, var(--mod-lca) 15%, transparent)'
            : 'color-mix(in srgb, var(--mod-plca) 15%, transparent)',
          color: item.type === 'archetype' ? 'var(--mod-lca)' : 'var(--mod-plca)',
          borderRadius: 'var(--radius-sm)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
        }}>
          {item.type}
        </span>
      </td>
      <td style={tdStyle}>
        {item.status === 'success' ? (
          <span
            data-testid={`multi-product-status-${item.item_id}`}
            style={{ color: 'var(--success, #10B981)', fontWeight: 600 }}
          >
            ✓ Success
          </span>
        ) : (
          <span
            data-testid={`multi-product-status-${item.item_id}`}
            title={item.error_message ?? 'Unknown error'}
            style={{ color: 'var(--danger)', fontWeight: 600 }}
          >
            ✗ Error
          </span>
        )}
      </td>
      {methodLabels.map((label) => {
        const m = byLabel.get(label)
        return (
          <td key={label} style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
            {m ? `${m.score.toExponential(3)} ${m.unit}` : item.status === 'success' ? '—' : ''}
          </td>
        )
      })}
    </tr>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left',
  fontSize: 10, fontWeight: 600,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  color: 'var(--text-primary)',
}
