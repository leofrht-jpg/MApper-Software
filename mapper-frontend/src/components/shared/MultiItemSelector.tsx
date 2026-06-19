// Patch 4AG.2 — reusable two-pane multi-item selector for the
// multi-product LCA comparison feature. Future selection contexts
// (Material Flows multi-archetype, multi-item AESA, etc.) inherit
// this component.
//
// Design choices (recorded in CLAUDE.md):
//   - Pure presentational / controlled — parent owns `selectedItems`.
//   - Parent owns the data source (`availableArchetypes` /
//     `availableActivities` props). Component does NOT call APIs
//     or read stores. Client-side filter + sort only. This keeps
//     the component testable in isolation and parent-flexible
//     (different parents may pull data from different stores or
//     pre-filter before passing).
//   - Filters are mode-specific (archetype: folder; activity:
//     Location, Unit; mixed: type-toggle + shared search). Don't
//     show irrelevant filter chips in a mode where they make no
//     sense.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import type { ActivitySummary, ArchetypeSummary } from '../../api/client'
import { NumberInput } from '../ui/NumberInput'
import { FilterDropdown } from '../ui/FilterDropdown'
import {
  type ProductItem, type ArchetypeProductItem, type ActivityProductItem,
  productItemKey,
} from './productItem'

type SelectorMode = 'archetype' | 'activity' | 'mixed'
type SortKey = 'name-asc' | 'name-desc'

// Shared bounded height for BOTH scroll panes (left results list, right
// Selected panel) so the two columns align and each scrolls INTERNALLY,
// independent of parent flex context (Patch 4AI established this for the
// results list; Patch 5X applies the same bound to the Selected panel).
const PANE_SCROLL_MAX_HEIGHT = 400

export interface MultiItemSelectorProps {
  mode: SelectorMode
  selectedItems: ProductItem[]
  onAddItem: (item: ProductItem) => void
  onRemoveItem: (item: ProductItem) => void
  onClearAll?: () => void
  /** Cap on selection count. When reached, result rows are
   *  disabled (with tooltip) and the chip panel shows "max". */
  maxItems?: number
  /** Archetype data source. Required for `mode === 'archetype'`
   *  or `mode === 'mixed'`; ignored otherwise. */
  availableArchetypes?: ArchetypeSummary[]
  /** Activity data source. Required for `mode === 'activity'` or
   *  `mode === 'mixed'`; ignored otherwise. Parent is responsible
   *  for any backend search before passing — typically the
   *  results of `searchActivitiesAll(query, ...)`. */
  availableActivities?: ActivitySummary[]
  /** Patch 4AH — fires whenever the selector's internal search
   *  input changes. Lets the parent drive a backend search (e.g.
   *  `useActivityStore.searchActivities(q)`) so the activity data
   *  feed updates as the user types. Optional — if absent, the
   *  search is purely client-side over `availableActivities`. */
  onSearchChange?: (query: string) => void
  /** Patch 4AI — fires whenever the activity Location / Unit
   *  filters change. Lets the parent re-dispatch a backend search
   *  with the new filter parameters, so the filter composes with
   *  the full result set (not just the currently-loaded page).
   *
   *  Without this callback, filters apply client-side over
   *  `availableActivities` only — which can mislead users when
   *  search results are paginated (the filter dropdown shows
   *  locations present in the loaded page, not in all matching
   *  activities). Parent receiving the callback should dispatch
   *  e.g. `getActivities(db, ..., q, { locations, units })`.
   *  Pure client-side mode (4AG.2 callers without paginated
   *  data) continues to work unchanged when the prop is omitted. */
  onFiltersChange?: (filters: {
    locations: string[]
    units: string[]
  }) => void
  /** Patch 4AI — supplement to `availableActivities`: full set of
   *  Location options (and Unit options) the filter dropdown
   *  should offer, regardless of which page is currently loaded.
   *  When provided, the dropdown uses these instead of deriving
   *  from `availableActivities`. Lets parents that know the
   *  full universe (e.g. all locations in a database) expose
   *  ALL options even when only a subset of activities is
   *  loaded. Omit to fall back to the derive-from-loaded
   *  behaviour (4AG.2 default). */
  filterOptions?: {
    locations?: string[]
    units?: string[]
  }
  /** Patch 4AH — opt-in: render a NumberInput on each ACTIVITY
   *  chip for the functional-unit amount. Methodologically
   *  meaningful in single-item-as-functional-unit contexts (LCA
   *  Calculator); deliberately OFF by default in multi-item
   *  comparison (where N items are compared, not summed). */
  chipAmountField?: boolean
  /** Patch 4AH — controlled handler for chip-amount changes.
   *  Fires when the user edits an activity chip's amount input.
   *  Parent is expected to update its `selectedItems` array
   *  with the new `amount` on the matching item. */
  onItemAmountChange?: (item: ActivityProductItem, amount: number) => void
  /** Patch 5S — optional display-only override for the selected-items panel.
   *  When provided (and ≥1 item is selected), this node replaces the default
   *  flat `<SelectedChip>` list — e.g. the multi-item Activities mode groups
   *  vintages of one activity under a single header. ABSENT → unchanged default
   *  behavior (archetype mode, LCA Calculator). The override is presentational
   *  only: selection state, item identity, removal (still via `onRemoveItem`),
   *  and the compute payload are untouched. The empty-state is still owned by
   *  the selector. */
  renderSelectedItems?: React.ReactNode
  /** Identity of the data source the value-filters belong to (e.g. the
   *  selected activity database). When it changes, the DB-specific value
   *  filters (folders / locations / units) are reset — they were keyed to the
   *  old source's distinct-value universe and would otherwise filter the new
   *  source's rows to nothing. The SEARCH TEXT is deliberately preserved
   *  (DB-independent user intent — switching DB is often done to re-find the
   *  same term). Omit when the source never changes (filters then persist). */
  sourceKey?: string | null
}

export function MultiItemSelector({
  mode, selectedItems, onAddItem, onRemoveItem, onClearAll,
  maxItems, availableArchetypes = [], availableActivities = [],
  onSearchChange, chipAmountField = false, onItemAmountChange,
  onFiltersChange, filterOptions, renderSelectedItems, sourceKey,
}: MultiItemSelectorProps) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('name-asc')
  const [foldersFilter, setFoldersFilter] = useState<string[]>([])
  const [locationsFilter, setLocationsFilter] = useState<string[]>([])
  const [unitsFilter, setUnitsFilter] = useState<string[]>([])

  // Reset the DB-specific value filters whenever the data source changes
  // (e.g. the activity database switches). These filters were keyed to the old
  // source's distinct-value universe; left stale, they filter the new source's
  // rows to zero client-side (the "no matches after switching DB" bug). The
  // search text is intentionally NOT cleared — it's DB-independent user intent.
  // Re-emit the cleared filters so the parent store stays in parity. Skip the
  // very first run (mount): a mount-time onFiltersChange could clobber an
  // intentionally pre-set filter, and there's nothing stale to clear yet.
  const sourceKeyMountedRef = useRef(false)
  useEffect(() => {
    if (!sourceKeyMountedRef.current) {
      sourceKeyMountedRef.current = true
      return
    }
    setFoldersFilter([])
    setLocationsFilter([])
    setUnitsFilter([])
    onFiltersChange?.({ locations: [], units: [] })
    // Deliberately keyed on sourceKey only; onFiltersChange identity must not
    // re-trigger a filter wipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])
  // Mixed mode: which types appear in the results list. Default
  // both on; turning off filters one type from the results.
  const [mixedShowArchetypes, setMixedShowArchetypes] = useState(true)
  const [mixedShowActivities, setMixedShowActivities] = useState(true)

  const selectedKeys = useMemo(
    () => new Set(selectedItems.map(productItemKey)),
    [selectedItems],
  )
  const atMax = typeof maxItems === 'number' && selectedItems.length >= maxItems

  // Distinct values for filter dropdowns. Client-side derivation
  // since the data is already loaded in the parent.
  const distinctFolders = useMemo(() => {
    const s = new Set<string>()
    for (const a of availableArchetypes) {
      if (a.folder) s.add(a.folder)
    }
    return Array.from(s).sort()
  }, [availableArchetypes])
  // Patch 4AI — prefer parent-supplied full-set options when
  // available. Fall back to deriving from the loaded page if the
  // parent doesn't know the full universe (the Patch 4AG.2 default
  // for in-memory data sources).
  const distinctLocations = useMemo(() => {
    if (filterOptions?.locations && filterOptions.locations.length > 0) {
      return [...filterOptions.locations].sort()
    }
    const s = new Set<string>()
    for (const a of availableActivities) {
      if (a.location) s.add(a.location)
    }
    return Array.from(s).sort()
  }, [availableActivities, filterOptions?.locations])
  const distinctUnits = useMemo(() => {
    if (filterOptions?.units && filterOptions.units.length > 0) {
      return [...filterOptions.units].sort()
    }
    const s = new Set<string>()
    for (const a of availableActivities) {
      if (a.unit) s.add(a.unit)
    }
    return Array.from(s).sort()
  }, [availableActivities, filterOptions?.units])

  // Patch 4AI — wrap filter setters so a parent that opts into
  // server-side filtering (via `onFiltersChange`) is notified
  // whenever Location or Unit selections change. Pure client-side
  // mode (no callback) keeps the existing setState path.
  const setLocationsFilterAndNotify = (next: string[]) => {
    setLocationsFilter(next)
    onFiltersChange?.({ locations: next, units: unitsFilter })
  }
  const setUnitsFilterAndNotify = (next: string[]) => {
    setUnitsFilter(next)
    onFiltersChange?.({ locations: locationsFilter, units: next })
  }

  // Filtered + sorted result lists. Archetypes vs activities live
  // separately so mixed mode can render them in two sections.
  const filteredArchetypes = useMemo(() => {
    if (mode === 'activity') return []
    if (mode === 'mixed' && !mixedShowArchetypes) return []
    const q = search.trim().toLowerCase()
    const matches = (a: ArchetypeSummary): boolean => {
      if (foldersFilter.length > 0 && !foldersFilter.includes(a.folder ?? '')) return false
      if (q) {
        const hay = `${a.name} ${a.category ?? ''} ${a.folder ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }
    const out = availableArchetypes.filter(matches)
    out.sort((x, y) => {
      const cmp = x.name.localeCompare(y.name)
      return sortBy === 'name-asc' ? cmp : -cmp
    })
    return out
  }, [
    mode, mixedShowArchetypes, availableArchetypes,
    foldersFilter, search, sortBy,
  ])

  const filteredActivities = useMemo(() => {
    if (mode === 'archetype') return []
    if (mode === 'mixed' && !mixedShowActivities) return []
    const q = search.trim().toLowerCase()
    const matches = (a: ActivitySummary): boolean => {
      if (locationsFilter.length > 0 && !locationsFilter.includes(a.location)) return false
      if (unitsFilter.length > 0 && !unitsFilter.includes(a.unit)) return false
      if (q) {
        const hay = `${a.name} ${a.product} ${a.location} ${a.code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }
    const out = availableActivities.filter(matches)
    out.sort((x, y) => {
      const cmp = (x.name || x.product).localeCompare(y.name || y.product)
      return sortBy === 'name-asc' ? cmp : -cmp
    })
    return out
  }, [
    mode, mixedShowActivities, availableActivities,
    locationsFilter, unitsFilter, search, sortBy,
  ])

  const totalMatching = filteredArchetypes.length + filteredActivities.length
  const hasActiveFilters =
    search.trim() !== ''
    || foldersFilter.length > 0
    || locationsFilter.length > 0
    || unitsFilter.length > 0
    || (mode === 'mixed' && (!mixedShowArchetypes || !mixedShowActivities))
  const clearFilters = () => {
    setSearch('')
    setFoldersFilter([])
    setLocationsFilter([])
    setUnitsFilter([])
    setMixedShowArchetypes(true)
    setMixedShowActivities(true)
    // Patch 4AI — notify the parent so it can re-dispatch the
    // backend search with cleared filters too. Without this the
    // parent's loaded page stays stuck on the previous filter.
    onSearchChange?.('')
    onFiltersChange?.({ locations: [], units: [] })
  }

  const addArchetype = (a: ArchetypeSummary) => {
    if (atMax) return
    const item: ArchetypeProductItem = {
      type: 'archetype',
      archetype_id: a.id,
      display_name: a.name,
      folder: a.folder,
    }
    onAddItem(item)
  }
  const addActivity = (a: ActivitySummary) => {
    if (atMax) return
    const item: ActivityProductItem = {
      type: 'activity',
      database: a.database,
      code: a.code,
      amount: 1.0,
      // display_name is the full activity name — the discriminator for
      // look-alikes (same reference product). product/name carried for the
      // chip's secondary lines.
      display_name: a.name || a.product,
      location: a.location,
      unit: a.unit,
      name: a.name,
      product: a.product,
    }
    onAddItem(item)
  }

  return (
    <div
      data-testid="multi-item-selector"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 280px',
        gap: 12,
        // Bounded so the inner panes can scroll independently.
        minHeight: 360, maxHeight: '60vh',
      }}
    >
      {/* ── Left pane: search + filters + results ────────────── */}
      <div style={paneStyle}>
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{
              position: 'absolute', top: 9, left: 8,
              color: 'var(--text-tertiary)', pointerEvents: 'none',
            }} />
            <input
              data-testid="multi-item-selector-search"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                // Patch 4AH — notify parent so server-side
                // search can fire (e.g. useActivityStore search).
                onSearchChange?.(e.target.value)
              }}
              placeholder={
                mode === 'archetype' ? 'Search archetypes…'
                  : mode === 'activity' ? 'Search activities…'
                  : 'Search items…'
              }
              style={{
                width: '100%',
                padding: '6px 8px 6px 26px',
                fontSize: 12,
                background: 'var(--bg-base)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>

          {/* Filter chips row (mode-specific) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {(mode === 'archetype' || mode === 'mixed') && distinctFolders.length > 0 && (
              <FilterDropdown
                label="Folder"
                options={distinctFolders}
                selected={foldersFilter}
                onChange={setFoldersFilter}
                testId="multi-item-selector-folder-filter"
                accent="var(--mod-lca)"
              />
            )}
            {(mode === 'activity' || mode === 'mixed') && distinctLocations.length > 0 && (
              <FilterDropdown
                label="Location"
                options={distinctLocations}
                selected={locationsFilter}
                onChange={setLocationsFilterAndNotify}
                testId="multi-item-selector-location-filter"
                accent="var(--mod-lca)"
              />
            )}
            {(mode === 'activity' || mode === 'mixed') && distinctUnits.length > 0 && (
              <FilterDropdown
                label="Unit"
                options={distinctUnits}
                selected={unitsFilter}
                onChange={setUnitsFilterAndNotify}
                testId="multi-item-selector-unit-filter"
                accent="var(--mod-lca)"
              />
            )}
            {/* Mixed-mode: type toggles */}
            {mode === 'mixed' && (
              <>
                <TypeToggle
                  label="Archetypes"
                  on={mixedShowArchetypes}
                  onChange={setMixedShowArchetypes}
                  testId="multi-item-selector-toggle-archetypes"
                />
                <TypeToggle
                  label="Activities"
                  on={mixedShowActivities}
                  onChange={setMixedShowActivities}
                  testId="multi-item-selector-toggle-activities"
                />
              </>
            )}

            {/* Sort + Clear */}
            <select
              data-testid="multi-item-selector-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              style={{
                fontSize: 11,
                padding: '4px 6px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              <option value="name-asc">Name A→Z</option>
              <option value="name-desc">Name Z→A</option>
            </select>
            {hasActiveFilters && (
              <button
                data-testid="multi-item-selector-clear-filters"
                onClick={clearFilters}
                style={{
                  fontSize: 11,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Matching count */}
          <div
            data-testid="multi-item-selector-count"
            style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
          >
            {totalMatching} matching
          </div>
        </div>

        {/* Results list — Patch 4AI: explicit bounded height +
            internal scroll. Pre-Patch-4AI the list relied on
            `flex: 1, minHeight: 0` plus the outer selector's
            `maxHeight: 60vh` to engage scroll. In some parent
            layouts (notably LCA Calculator's two-column grid) the
            chain didn't resolve to a usable height and the list
            grew unbounded, visually overlapping adjacent page
            sections. Setting `maxHeight: 400px` directly on the
            scroll container makes the constraint independent of
            parent flex context. */}
        <div
          data-testid="multi-item-selector-results"
          style={{
            flex: 1, minHeight: 0, maxHeight: PANE_SCROLL_MAX_HEIGHT, overflowY: 'auto',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {mode === 'mixed' && filteredArchetypes.length > 0 && (
            <SectionHeader label={`Archetypes (${filteredArchetypes.length})`} />
          )}
          {filteredArchetypes.map((a) => {
            const key = `arc:${a.id}`
            const selected = selectedKeys.has(key)
            const disabled = atMax && !selected
            return (
              <ResultRow
                key={key}
                testId={`multi-item-selector-result-${key}`}
                selected={selected}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return
                  if (selected) {
                    onRemoveItem({ type: 'archetype', archetype_id: a.id, display_name: a.name, folder: a.folder })
                  } else {
                    addArchetype(a)
                  }
                }}
                tag={mode === 'mixed' ? '🅐' : null}
                title={a.name}
                subtitle={a.folder ?? a.category ?? '—'}
              />
            )
          })}
          {mode === 'mixed' && filteredActivities.length > 0 && (
            <SectionHeader label={`Activities (${filteredActivities.length})`} />
          )}
          {filteredActivities.map((a) => {
            const key = `act:${a.database}|${a.code}`
            const selected = selectedKeys.has(key)
            const disabled = atMax && !selected
            return (
              <ResultRow
                key={key}
                testId={`multi-item-selector-result-${key}`}
                selected={selected}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return
                  if (selected) {
                    onRemoveItem({
                      type: 'activity', database: a.database, code: a.code,
                      amount: 1.0, display_name: a.name || a.product,
                      location: a.location, unit: a.unit, name: a.name, product: a.product,
                    })
                  } else {
                    addActivity(a)
                  }
                }}
                tag={mode === 'mixed' ? '⚙' : null}
                // Full activity name (the discriminator) as the title; reference
                // product shown only when it differs; location · unit · db on the
                // meta line; the unique code as a guaranteed-distinct mono line.
                title={a.name || a.product}
                subtitle={
                  [a.product && a.product !== a.name ? a.product : null, a.location, a.unit, a.database]
                    .filter(Boolean).join(' · ')
                }
                code={a.code}
                wrap
              />
            )
          })}
          {totalMatching === 0 && (
            <div style={{
              padding: 'var(--space-4)', textAlign: 'center',
              fontSize: 11, color: 'var(--text-tertiary)',
            }}>
              {hasActiveFilters ? 'No matches — adjust filters' : 'No items available'}
            </div>
          )}
        </div>
      </div>

      {/* ── Right pane: selected chips ─────────────────────────── */}
      <div style={paneStyle}>
        <div style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Selected: {selectedItems.length}
            {typeof maxItems === 'number' ? ` / ${maxItems}` : ''}
          </span>
          {selectedItems.length > 0 && onClearAll && (
            <button
              data-testid="multi-item-selector-clear-all"
              onClick={onClearAll}
              style={{
                fontSize: 11,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Clear all
            </button>
          )}
        </div>
        <div
          data-testid="multi-item-selector-chips"
          style={{
            // Patch 5X — explicit bound (same as the results list) so many
            // selected items (e.g. 18 vintages) scroll internally instead of
            // inflating the card. Independent of parent flex context.
            flex: 1, minHeight: 0, maxHeight: PANE_SCROLL_MAX_HEIGHT, overflowY: 'auto',
            padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          {selectedItems.length === 0 ? (
            <div
              data-testid="multi-item-selector-chips-empty"
              style={{
                padding: 'var(--space-4)', textAlign: 'center',
                fontSize: 11, color: 'var(--text-tertiary)',
              }}
            >
              No items selected. Click results on the left to add.
            </div>
          ) : renderSelectedItems !== undefined ? (
            // Patch 5S — display-only override (e.g. grouped vintages). Selection
            // state + removal are still parent-owned; this only changes layout.
            renderSelectedItems
          ) : (
            selectedItems.map((item) => (
              <SelectedChip
                key={productItemKey(item)}
                item={item}
                onRemove={() => onRemoveItem(item)}
                showAmountField={chipAmountField}
                onAmountChange={
                  item.type === 'activity' && onItemAmountChange
                    ? (n) => onItemAmountChange(item, n)
                    : undefined
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: '6px 10px',
      fontSize: 10, fontWeight: 600,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
      backgroundColor: 'var(--bg-elevated)',
      borderTop: '1px solid var(--border-subtle)',
      borderBottom: '1px solid var(--border-subtle)',
      position: 'sticky', top: 0,
    }}>
      {label}
    </div>
  )
}

function ResultRow({
  testId, selected, disabled, onClick, tag, title, subtitle, code, wrap = false,
}: {
  testId: string
  selected: boolean
  disabled: boolean
  onClick: () => void
  tag: string | null
  title: string
  subtitle: string
  // Patch 5M — optional unique code (rendered as a mono line) + wrap flag so
  // the full discriminating name shows untruncated. Activity rows set both;
  // archetype rows omit them (unchanged: truncated single-line title).
  code?: string
  wrap?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Max items selected' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', textAlign: 'left',
        padding: '6px 10px',
        background: selected
          ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)'
          : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border-subtle)',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled || selected) return
        e.currentTarget.style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = selected
          ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)'
          : 'transparent'
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, flexShrink: 0,
        border: `1px solid ${selected ? 'var(--mod-lca)' : 'var(--border-default)'}`,
        background: selected ? 'var(--mod-lca)' : 'transparent',
        color: selected ? 'white' : 'transparent',
        borderRadius: 3,
      }}>
        {selected ? <Check size={10} /> : null}
      </span>
      {tag && (
        <span style={{
          fontSize: 11, width: 14, textAlign: 'center',
          color: 'var(--text-tertiary)',
        }} aria-hidden>
          {tag}
        </span>
      )}
      <span style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        <span style={{
          fontSize: 12, fontWeight: selected ? 600 : 500,
          ...(wrap
            ? { whiteSpace: 'normal', wordBreak: 'break-word' }
            : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 10, color: 'var(--text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {subtitle}
        </span>
        {code && (
          <span
            title={code}
            style={{
              fontSize: 9, color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {code}
          </span>
        )}
      </span>
    </button>
  )
}

function SelectedChip({
  item, onRemove, showAmountField = false, onAmountChange,
}: {
  item: ProductItem
  onRemove: () => void
  /** Patch 4AH — render NumberInput for activity functional-unit
   *  amount. Archetypes ignore this prop (no amount semantics). */
  showAmountField?: boolean
  onAmountChange?: (n: number) => void
}) {
  const isArchetype = item.type === 'archetype'
  const tag = isArchetype ? '🅐' : '⚙'
  const accent = isArchetype ? 'var(--mod-lca)' : 'var(--mod-plca)'
  const meta = isArchetype
    ? item.folder ?? '—'
    : [item.location, item.unit].filter(Boolean).join(' · ') || '—'
  const showAmount = showAmountField && item.type === 'activity'
  return (
    <div
      data-testid={`multi-item-selector-chip-${productItemKey(item)}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 6px',
        background: 'var(--bg-elevated)',
        border: `1px solid ${accent}`,
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }} aria-hidden>{tag}</span>
      <span style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        {/* Title = full activity name (the discriminator). For activities it
            wraps untruncated so look-alikes are tellable apart; archetypes
            (no collision) keep the single-line truncated title. */}
        <span style={{
          fontSize: 11, fontWeight: 600, color: accent,
          ...(isArchetype
            ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            : { whiteSpace: 'normal', wordBreak: 'break-word' }),
        }}>
          {item.display_name}
        </span>
        {/* Reference product, shown only when it differs from the name. */}
        {!isArchetype && item.product && item.product !== item.display_name && (
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
            {item.product}
          </span>
        )}
        <span style={{
          fontSize: 10, color: 'var(--text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {meta}
        </span>
        {/* Guaranteed-unique code (mono) — the discriminator of last resort. */}
        {!isArchetype && item.code && (
          <span
            data-testid={`multi-item-selector-chip-code-${productItemKey(item)}`}
            title={item.code}
            style={{
              fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {item.code}
          </span>
        )}
      </span>
      {showAmount && (
        <>
          <NumberInput
            data-testid={`multi-item-selector-chip-amount-${productItemKey(item)}`}
            value={item.amount}
            onChange={(n) => onAmountChange?.(n)}
            min={0}
            emptyValue={0}
            aria-label={`Amount for ${item.display_name}`}
            style={{
              width: 60, height: 22, padding: '0 6px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', minWidth: 24 }}>
            {item.unit ?? ''}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        data-testid={`multi-item-selector-chip-remove-${productItemKey(item)}`}
        aria-label={`Remove ${item.display_name}`}
        title={`Remove ${item.display_name}`}
        style={{
          background: 'transparent', border: 'none',
          color: 'var(--text-tertiary)', cursor: 'pointer',
          padding: 2, display: 'flex',
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function TypeToggle({
  label, on, onChange, testId,
}: {
  label: string
  on: boolean
  onChange: (next: boolean) => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      data-testid={testId}
      style={{
        fontSize: 11,
        padding: '4px 8px',
        background: on
          ? 'color-mix(in srgb, var(--mod-lca) 10%, transparent)'
          : 'var(--bg-elevated)',
        border: '1px solid ' + (on ? 'var(--mod-lca)' : 'var(--border-subtle)'),
        borderRadius: 'var(--radius-sm)',
        color: on ? 'var(--mod-lca)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontWeight: on ? 600 : 500,
      }}
    >
      {label}
    </button>
  )
}

// ── Styles ─────────────────────────────────────────────────────────

const paneStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  minHeight: 0,
  overflow: 'hidden',
}
