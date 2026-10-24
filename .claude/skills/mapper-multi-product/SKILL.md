---
name: mapper-multi-product
description: "Multi-product LCA comparison (Patch 4AG). Use when working on comparing several products or the comparison UI."
---

## Multi-product LCA comparison (Patch 4AG)

Computes N independent LCAs (mixed archetype + activity items) for
side-by-side comparison. Methodologically distinct from
`/lca/calculate-activities` — that endpoint treats N activities as
a SINGLE combined demand (one LCA, contributions sum to a total);
multi-product treats N items as N SEPARATE LCAs (one LCA per item,
results compared side-by-side).

**Patch 4AG ships in four sub-patches, in dependency order**:

- **4AG.1** (shipped) — Backend: schemas + `POST /lca/calculate-
  multi-product` endpoint + tests. Independently exercisable via
  direct API calls; no frontend yet.
- **4AG.2** (shipped) — Reusable `<MultiItemSelector>` component at
  `src/components/shared/MultiItemSelector.tsx`. Two-pane layout
  (search + filters + results | selected chips), modes
  `'archetype' | 'activity' | 'mixed'`. Pure controlled component —
  parent owns `selectedItems`, data source, and clear-all behaviour.
- **4AG.3** (shipped) — `useMultiProductLCAStore` (standalone),
  Single item / Multi-item sub-mode toggle inside
  `SingleProductImpact.tsx` (visibility-toggle preserves state
  across mode flips), `<MultiProductLCA>` layout wiring selector +
  config + compute dispatch + basic per-item results table.
  Visualisation (chart, Excel export) deferred to 4AG.4.
- **4AG.4** (shipped) — `<MultiProductComparisonChart>` with
  stacked-or-solid mode auto-driven by (scope, presence of
  archetype stage_breakdown), method picker, view toggle
  (Chart/Table), multi-product Excel export builder + endpoint,
  errors banner for partial-success runs.

### Backend architecture (Patch 4AG.1)

**Request shape** — Pydantic discriminated union via
`Annotated[..., Field(discriminator="type")]`:

```python
ProductItem = Annotated[
    ArchetypeProductItem | ActivityProductItem,
    Field(discriminator="type"),
]

class MultiProductLCARequest(BaseModel):
    items: list[ProductItem]
    methods: list[list[str]]
    scope: Literal["inflows", "stock", "outflows", "all"] = "all"
    compute_database: str | None = None
```

**Dispatch**: the endpoint iterates `items` and routes each to the
existing single-product compute handler:

- `ArchetypeProductItem` → builds `ArchetypeLCACalculateRequest`
  with the request-level `scope` + `compute_database` and the
  per-item `stage_amounts` / `parameter_scenario` overrides → calls
  `calculate_archetype_lca(body)` (the existing endpoint handler,
  invoked as a plain async function in-process — no HTTP round-trip).
- `ActivityProductItem` → builds a one-element-list
  `ActivityLCARequest` → calls `calculate_activity_lca(body)`.

**Per-item error isolation**: each dispatched call is wrapped in
`try/except HTTPException + except Exception`. A failing item's
slot in the response carries `status="error"` + `error_message`;
the fan-out continues. Aggregate `success_count` / `error_count`
on the envelope summarise the run.

**Result envelope** — `MultiProductLCAResult.items: list[MultiProductItemResult]`
preserves source order (frontend chart rendering relies on it).
Each `MultiProductItemResult` carries a discriminator (`type`),
identifier (`item_id`), human-readable `label`, status, and the
typed payload (`archetype_result` XOR `activity_result`, both
None when status="error").

**No new compute logic** — the multi-product endpoint is a fan-out
+ envelope assembler. All validation rules (methods required,
biosphere flow rejection, scope-value enum, prospective-database
translation, parameter scenario lookup, etc.) continue to fire
per item inside the existing single-product handlers.

### `<MultiItemSelector>` (Patch 4AG.2)

Reusable selector at `src/components/shared/MultiItemSelector.tsx`.
Three modes (`'archetype' | 'activity' | 'mixed'`) and a two-pane
layout:

- **Left pane**: search box → mode-specific filter chips (Folder
  for archetype/mixed; Location, Unit for activity/mixed) → Sort
  dropdown → Clear filters → matching count → scrollable results
  list with checkbox-style selection state.
- **Right pane**: chips panel showing selected items as removable
  pills, each with a type tag (🅐 archetype, ⚙ activity) and
  metadata (folder for archetypes; location · unit for activities).
  Empty-state message when nothing selected.

**Activity rows show discriminating fields (Patch 5M).** Look-alike
ecoinvent activities share a reference product + location + unit (e.g.
six "electricity, low voltage / DK / kWh"). Both the search-results
rows and the selected chips therefore display, for ACTIVITY items, the
fields that actually tell them apart: the **full activity `name`**
(the title — distinct production routes; rendered untruncated/wrapped),
the reference **`product`** (only when it differs from the name),
`location · unit`, and the unique **`code`** (mono line — the
guaranteed-distinct discriminator of last resort). `ActivityProductItem`
carries `name`/`product` as display metadata (not round-tripped to the
backend, which re-derives from database+code) so the selected chip has
them. Archetype rows are unchanged (distinct names, no collision —
single-line truncated title). Locked by
`tests/multiItemSelectorLookAlikes.test.tsx`.

**Pure controlled component**:
- Parent owns `selectedItems: ProductItem[]`.
- Parent owns the data source — passes `availableArchetypes:
  ArchetypeSummary[]` / `availableActivities: ActivitySummary[]`
  as props. No API calls, no store reads inside the component.
- Filtering and sorting are client-side over the props. Mode-
  switching and filter-chip toggling all happen against the
  in-memory data.
- `onAddItem` / `onRemoveItem` / `onClearAll?` callbacks emit
  fully-typed `ProductItem` values; parent dispatches into its
  store / compute layer.

**`ProductItem` type** lives at `src/components/shared/productItem.ts`
— mirrors the Patch 4AG.1 backend discriminated union plus
display metadata (`display_name`, `folder` / `location`+`unit`)
that the chip and result-row UIs render. Backend re-derives names
from ids at compute time; the display-metadata fields are not
round-tripped to the API. `productItemKey(item)` returns a stable
namespaced id (`arc:{archetype_id}` / `act:{database}|{code}`)
for React keys and dedup checks.

**Mode-specific filter rendering** (anti-pattern guard): folder
filter doesn't appear in pure-activity mode; Location/Unit filters
don't appear in pure-archetype mode. Mixed mode shows the union
plus archetype/activity type toggles that hide whole sections.
This is enforced by the rendering logic AND by the test suite —
showing irrelevant filters confuses users about what the filter
will do.

**`maxItems` cap**: when `selectedItems.length === maxItems`,
unselected result rows render disabled with `title="Max items
selected"`. Selected rows remain clickable (so users can deselect
to make room). The chips-panel header shows `Selected: N / max`
when the cap is set.

#### What NOT to do

- **Don't render archetype filters in activity mode (or vice
  versa).** Filter relevance is mode-specific. The component
  rendering checks `mode === 'archetype' || mode === 'mixed'`
  before showing the folder filter (and the inverse for
  Location/Unit). Tests assert the negative cases.
- **Don't render a selectable list using only collision-prone fields**
  (truncated name + shared metadata). Surface the field that actually
  discriminates the items — for ecoinvent activities the full activity
  `name` plus the unique `code` — or the user can't tell selections
  apart. Patch 5M's bug was keying activity rows on the reference
  `product` (identical across look-alikes) and truncating it. Don't key
  display on `product` alone; don't truncate the discriminator.
- **Don't manage `selectedItems` internally** inside
  `<MultiItemSelector>`. Controlled component — parent owns state.
  Internal state would diverge from compute state (4AG.3 store),
  producing "selected in selector but not in compute" bugs that
  are hard to debug. The selector is purely a window onto
  parent-owned state.
- **Don't fan out compute calls inside the selector.** Compute is
  the parent's responsibility. The selector emits add/remove
  events; nothing more. Mixing compute logic into selection
  couples concerns that should stay separate — 4AG.3 ships the
  store + compute action.
- **Don't import from `DatabaseExplorer.tsx` directly.** Database
  Explorer's filter logic is server-side (via `useActivityStore`)
  and its `<MultiSelectDropdown>` is a local function inside the
  page module — not exported. Reaching across would tightly couple
  unrelated features. The selector reimplements a small inline
  `FilterDropdown` (client-side, multi-select) tuned to its needs.
  Acceptable code duplication for independence.
- **Don't pass async data fetchers as props** to `<MultiItemSelector>`.
  The component's purity is the value proposition — sync data in,
  events out. Async fetching for activity search belongs in the
  parent (4AG.3 will wire `useActivityStore.searchActivities`
  before passing the resulting `availableActivities` array in).
- **Don't restrict `mode` to a single value at the type level**
  unless the consumer truly only ever needs one mode. The mixed
  mode is methodologically valuable; keeping the union open
  preserves the option to render mixed selection in future
  contexts (e.g., AESA scenario-set multi-select that mixes
  saved scenarios and ad-hoc combinations).

### Canonical filter dropdown (`<FilterDropdown>`) — Patches 5T → 5Y → 5AB

`src/components/ui/FilterDropdown.tsx` is the **single canonical multi-select
filter dropdown** for MApper — the default for every Location/Unit/Folder-style
filter and any future one. A pill trigger ("`Label (N)` ⌄") opens a panel with a
threshold-gated **"Search…"** input (`useOptionSearch`), a checkbox list, "No
matches", **Select all / Clear**, autofocus-on-open / reset-on-close,
selection-preserving, multi-select.

**History.** Patch 5T added the option search to the Impact Assessment
`FilterDropdown` (then private in `MultiItemSelector`); 5Y shared the search
*logic* via `useOptionSearch` but kept Database Explorer's `MultiSelectDropdown`
separate. **Patch 5AB superseded that** — extracted `FilterDropdown` to
`components/ui`, migrated BOTH consumers onto it (`MultiItemSelector` Folder/
Location/Unit + Database Explorer Location/Unit), and **deleted
`MultiSelectDropdown`**. Unification decisions (user-confirmed): canonical
**count summary** "`Label (N)`" everywhere (Database Explorer's old "Location:
All locations" verbose summary retired); **Select all / Clear on ALL filters**
(operating on the full option set, not the search-visible subset); `disabled`
prop; `accent` prop (the IA picker passes `var(--mod-lca)` to preserve its look,
default `var(--accent)`). Escape-to-close (from the old MultiSelectDropdown) is
folded into the canonical component.

**API** — `{ label, options, selected, onChange, testId?, disabled?, accent? }`.
testid scheme: `{testId}-toggle/-menu/-search/-option-<opt>/-no-matches/
-select-all/-clear`.

**Still a SIBLING, deferred (not migrated):** AESA's `IndicatorDisplayFilter` —
its `displayed: string[] | null` (null = all, opt-out) selection model + per-
option color swatches + view-only display semantics diverge; migrating it needs
a null-means-all adapter + a color-swatch/label slot. Revisit with an explicit
adapter, don't force it.

The option search itself:

- **Client-side over the in-memory option set** — filters `options` (the
  `distinctValues`/`filterOptions` universe, already loaded). It is NOT an
  activity query and **never triggers a backend call**.
- **Threshold-gated** (`OPTION_SEARCH_THRESHOLD = 8`): the search input renders
  only when `options.length > 8`, so short lists (e.g. a couple of units) stay
  clean.
- **Selection-preserving (view-only)**: typing only changes which options are
  *rendered*. The underlying `options`/`selected` are untouched, so a checked
  option filtered out of view stays in `selected` and reappears checked once the
  search clears. The search never calls `onChange`/`onFiltersChange`.
- **Autofocus on open, reset on close** (fresh each open). The input is pinned
  while the option list below scrolls.
- **Empty state**: a quiet "No matches" line (`{testId}-no-matches`) when
  nothing matches. Search input testid is `{testId}-search`.

Locked by `tests/useOptionSearch.test.tsx` (hook),
`tests/filterDropdownCanonical.test.tsx` (count summary / Select all / Clear /
disabled, 5AB), `tests/multiItemSelectorOptionSearch.test.tsx` (IA consumer),
and `tests/databaseExplorerFilterSearch.test.tsx` (DB Explorer consumer).
Frontend-only; no backend/query/schema change.

#### What NOT to do

- **Use the canonical `<FilterDropdown>` for every new multi-select filter.**
  Don't hand-roll a new dropdown or revive a per-page one — the consolidation
  (5AB) exists to prevent exactly that divergence. The Patch-5Y guidance to
  "share the hook, keep the components separate" is SUPERSEDED: there is now one
  filter component, not two.
- **The in-dropdown search filters the visible OPTIONS client-side — it is not
  an activity query, must never trigger a backend call, and must never drop
  selected-but-filtered options.** The backend-wired search is the activity
  search box (a separate input); this option search is a view filter over the
  already-loaded `distinctValues`.
- **Don't lift the search state into the parent or the filter wiring.** It's
  local to the dropdown (via `useOptionSearch`) and resets on close — it has no
  bearing on the applied filter (`selected` + `onChange`).
- **Don't remove the threshold gate.** Short option lists don't need a search;
  always-on adds chrome where it's useless.
- **Don't fold AESA's `IndicatorDisplayFilter` into `<FilterDropdown>` without an
  adapter.** Its null-means-all opt-out model + color swatches + display-only
  semantics differ; a naive migration would break the saved-session filter and
  the indicator colors. Deferred by 5AB on purpose.
- **Single-select / sort dropdowns are NOT this component.** The database
  picker, "Name A→Z" sort, IAM/SSP generation selects, and DSM scenario chips /
  vertical checklists are different patterns — don't migrate them onto
  `<FilterDropdown>`.

### Bounded results dropdown + filter-as-search (Patch 4AI)

Patch 4AI fixes two `<MultiItemSelector>` bugs surfaced by the LCA
Calculator activity picker (post-Patch-4AH).

**Bug 1 — Results dropdown overflowed parent layout.** Pre-Patch-4AI
the results list relied on the outer selector's `maxHeight: 60vh`
plus the inner pane's `flex: 1, minHeight: 0` chain to engage
scroll. In some parent layouts (LCA Calculator's two-column grid)
the chain didn't resolve to a usable height and the list grew
unbounded, visually overlapping adjacent page sections.

**Fix**: explicit `maxHeight: 400` directly on the inner results
`<div>` (the element bearing `data-testid="multi-item-selector-results"`).
The constraint is now independent of parent flex context — works
regardless of what layout the selector sits inside.

**Patch 5X — same bound on the Selected panel (right).** The Selected
panel (`multi-item-selector-chips`) previously had only `flex: 1,
minHeight: 0, overflowY: 'auto'` and relied on the same grid flex chain
— so many selected items (e.g. 18 activity vintages) overflowed / inflated
the card. It now carries the SAME explicit bound as the results list, via
a shared `PANE_SCROLL_MAX_HEIGHT = 400` const applied to both panes, so
the two columns align and each scrolls INTERNALLY. The selector grid's
`maxHeight: 60vh` (no outer `overflow`) means there's no second outer
scroll — inner panes scroll, the ITEMS TO COMPARE card does not. Locked by
`tests/multiItemSelectorScrollPanes.test.tsx`. Don't add a nested outer
scroll on the card; bound the inner panes instead.

**Bug 2 — Filter dropdown options sourced from currently-loaded
page.** Activity search returns paginated results (first 50 items
by default). The Location / Unit filter dropdowns were populated
from `availableActivities.map(a => a.location)` — i.e., only the
locations present in the loaded page. If a desired location (e.g.
`DK` for "electricity, low voltage") wasn't in those 50, `DK`
never appeared as a filter option. Worse: even when a location DID
appear, applying the filter narrowed the displayed page only — it
didn't dispatch a fresh backend search, so locations elsewhere in
the full result set stayed invisible.

**Fix — two coordinated changes**:

1. New `filterOptions?: { locations?, units? }` prop. When the
   parent knows the full universe (e.g. via `getActivityDistinctValues(db)`
   for ecoinvent), it passes the full list. The dropdown prefers
   parent-supplied options; falls back to deriving from
   `availableActivities` when omitted (preserves Patch 4AG.2's
   client-side default for parents with in-memory data).

2. New `onFiltersChange?: (filters) => void` callback. Fires
   whenever the user toggles a Location / Unit filter. Parent
   re-dispatches the backend search with the new filter
   parameters — composing `(query × locations × units)` at the
   server, not at the client. Without the callback, filters
   apply purely client-side (4AG.2 backward compat).

3. The selector's `Clear filters` action also fires
   `onSearchChange('')` + `onFiltersChange({locations: [], units: []})`
   so the parent can reset its backend query alongside.

**LCA Calculator wiring** (`pages/LCACalculator.tsx`):
- New state: `actSearchQuery`, `actLocationFilter`, `actUnitFilter`
  track the current backend-search inputs.
- `runActivitySearch(q, locations, units)` is the unified backend
  dispatcher; `handleActivitySearch` (search-input changes) and
  `handleActivityFiltersChange` (filter changes) both route through
  it. The debounce window (300ms) applies uniformly.
- `getActivities(db, ..., query, { locations, units })` is the
  backend endpoint — already accepts filter params; LCA Calculator
  previously just didn't pass them.
- `useEffect([selectedDb])` fetches `getActivityDistinctValues(db)`
  to populate `filterOptions`.

#### What NOT to do

- **Don't populate filter dropdown options from currently-displayed
  (paginated) results when the underlying data set is larger.**
  Users can't pick options that exist in the full set; the filter
  is misleading. Either: (a) trigger backend search when filter
  applied with filter parameters, AND (b) populate filter
  dropdown from a database-level metadata source (Patch 4AI does
  both). Pure client-side filtering only works when the parent
  loads the FULL data set in memory.
- **Don't reach for "just increase the pagination cap"** as the
  fix. Ecoinvent has 22k+ activities; raising the limit from 50
  to 500 still misses cases AND inflates the initial fetch
  payload. The architectural fix (backend search composes
  query × filters) handles all cases uniformly.
- **Popup result lists must have bounded max-height with internal
  scroll.** Without an explicit constraint on the scroll
  container itself, the list overflows when the parent layout
  doesn't provide a usable height for `flex: 1`. The Patch 4AI
  fix is `maxHeight: 400` directly on the results `<div>` —
  parent-context-independent.
- **Don't invert the filter predicate.** Selecting "DK" must
  KEEP DK rows and HIDE non-DK rows (`location IS IN selected`,
  not `NOT IN`). The Patch 4AI regression test
  (`multiItemSelectorFiltersBugfix.test.tsx`'s "not inverted"
  case) locks this in.
- **Without `onFiltersChange`, filters still work client-side**
  (Patch 4AG.2 contract). Don't force parents to opt in for
  filtering to do anything; the client-side fallback is the
  right behaviour for parents with full-set-in-memory data.

### Multi-item comparison selector must round-trip search to the backend (bugfix)

The Multi-item comparison selector (`<MultiItemSelector mode="mixed">`
in `MultiProductLCA.tsx`) is fed by `useActivityStore.activities`,
which is **server-paginated** (50 rows/page, the matcher lives in
`bw2_wrapper.list_activities_paginated`: case-insensitive substring
on **name OR reference product OR location**). The selector ALSO
re-filters `availableActivities` client-side over
`name + product + location + code`.

The bug: `MultiProductLCA` passed `availableActivities` but **not**
`onSearchChange` / `onFiltersChange` / `filterOptions`. So typing in
the selector's search box only filtered the loaded first page — the
backend was never re-queried. A valid ecoinvent activity whose name
sorts past the first 50 (e.g. `market for electricity, low voltage`)
matched **0 rows** even though the backend would find it by name.
This is the same class as Patch 4AI's LCA-Calculator fix; the
Multi-item selector was just never wired.

Fix: thread the selector's callbacks into `useActivityStore` exactly
like Database Explorer — a 300 ms-debounced `onSearchChange →
searchActivities(q)`, `onFiltersChange → setLocations/setUnits`, and
`filterOptions={{ locations, units }}` from the store's
`distinctValues` (full DB universe, not the loaded page). Backend
search already matched name + reference product, so no backend
change was needed. Locked by
`tests/multiProductActivitySearch.test.tsx` (name-phrasing round-trip,
reference-product phrasing, archetype regression, stale-page guard).

#### What NOT to do

- **Don't let a paginated, store-backed `<MultiItemSelector>` rely on
  client-side search of the loaded page.** Search the name the user
  knows, not only the loaded slice. If `availableActivities` is a
  server-paginated page, the parent MUST pass `onSearchChange` (and
  `onFiltersChange` + `filterOptions`) so the query reaches the
  backend matcher. The client-side-only fallback is correct ONLY for
  parents that hold the full set in memory (the Patch 4AG.2 contract).
- **Don't "fix" no-results by raising the page size.** ecoinvent has
  22k+ activities; a larger first page still misses the long tail and
  inflates the initial fetch. The architectural fix is the backend
  round-trip on every query/filter change.
- **Don't narrow the client re-filter to reference product (or the
  display field) only.** The selector's `hay` must keep BOTH name and
  product (`${a.name} ${a.product} ${a.location} ${a.code}`) so an
  activity-name phrasing survives the on-top client filter once the
  backend returns it. This is the 5M display-vs-search distinction:
  the row's display title is the activity name, and search must match
  it — not just the reference product.

### `<MultiItemSelector>` extensions for single-item with amount (Patch 4AH)

Patch 4AH extends `<MultiItemSelector>` with three opt-in props so
it can also serve as the single-item activity picker in LCA
Calculator (with parity to Database Explorer / multi-item
comparison: Location filter, Unit filter, Sort, matching count,
Clear filters). Single-item is treated as a special case of
multi-item with `maxItems={1}` + functional-unit amount UI.

**New optional props**:

- `chipAmountField?: boolean` (default `false`) — when `true`,
  renders a `<NumberInput>` + unit label on each ACTIVITY chip.
  **Methodologically meaningful only when the items are
  functional-unit demands.** Archetype chips ignore the prop —
  archetypes have stage amounts managed elsewhere, not a per-item
  scalar.
- `onItemAmountChange?: (item, amount) => void` — controlled
  callback for chip-amount edits. Fires on the NumberInput's blur
  commit (`emptyValue: 0` semantics). Parent updates its
  `selectedItems` array with the new amount on the matching item.
- `onSearchChange?: (q: string) => void` — controlled callback
  for the selector's local search input. Lets the parent drive a
  backend search (e.g. `useActivityStore.searchActivities(q)` /
  direct `getActivities(db, ...)` debounce) so `availableActivities`
  refreshes as the user types. Optional; without it, search is
  purely client-side over the pre-loaded `availableActivities`.

**Backward compatibility** (Patch 4AG.2 / 4AG.3 / 4AG.4 callers
must keep working unchanged):
- All three new props default to off / absent.
- Without `chipAmountField`, chips render with no NumberInput.
- Without `onItemAmountChange`, amount-edit attempts are no-ops
  (controlled-component contract — without a callback, the parent
  can't update; the chip's `item.amount` is still its source of
  truth for the input value).
- Without `onSearchChange`, the selector's internal search input
  filters `availableActivities` client-side (4AG.2 behaviour).

**LCA Calculator integration** (`pages/LCACalculator.tsx`):
- Activity mode's `<ActivitySearch>` + custom chip list retired.
- Replaced by `<MultiItemSelector mode="activity" chipAmountField={true}>`.
- `actDemand: DemandEntry[]` (the existing `{act, amount}` internal
  shape) preserved — downstream code (line 1358 etc.) still reads
  `actDemand[0].act.{name,product,key,...}`. The selector
  boundary uses bridge functions
  (`handleSelectorAddItem` / `handleSelectorRemoveItem` /
  `handleSelectorAmountChange`) that translate between
  `ActivityProductItem` (the selector's wire shape) and
  `DemandEntry`.
- A new local `searchedActivities: ActivitySummary[]` state holds
  the debounced backend search results, fed via `onSearchChange`.
- Biosphere-flow rejection (the methodological-correctness check
  for "functional unit must be technosphere") preserved
  unchanged inside `handleSelectorAddItem`.

#### What NOT to do

- **Don't render `chipAmountField` in multi-item comparison
  mode.** Multi-item comparison compares N items side-by-side;
  per-item amounts are methodologically meaningless when items
  carry different units (`kg battery` vs `kWh electricity`).
  4AG.3's `<MultiProductLCA>` deliberately omits the prop. The
  default-off design ensures past callers keep their behaviour.
- **Don't render an amount input on archetype chips even when
  `chipAmountField={true}`.** Archetypes don't have a per-item
  scalar amount — stage amounts are managed via
  `<StageAmountsEditor>` elsewhere. The selector enforces this
  via `item.type === 'activity'` guard around the NumberInput.
- **Don't drop `onSearchChange` from the LCA Calculator wiring**
  on the assumption that `availableActivities` could be
  pre-loaded. ecoinvent has ~22k activities — server-side
  search-as-you-type via `getActivities(db, ..., query)` is the
  only feasible UX. The callback is the bridge that makes this
  work; without it, the selector's internal search would filter
  an empty `availableActivities` array and never find anything.
- **Don't migrate `actDemand` to `ActivityProductItem[]` purely
  for "consistency".** It's referenced in ~15 downstream sites
  with `.act.{name,product,key,unit,location,database}` field
  access; the bridge functions are 30 lines while the full
  migration would touch hundreds. The Patch 4AH boundary is the
  right granularity — selector emits `ActivityProductItem`,
  parent's bridge converts to/from `DemandEntry`, downstream code
  unchanged.
- **Don't reintroduce a parallel `<ActivitySearch>` component**
  if a future selection context needs activity search.
  `<MultiItemSelector mode="activity" maxItems={1}>` is the
  canonical pattern. The deletion of `<ActivitySearch>` from
  LCACalculator was the whole point.

### Frontend integration layer (Patch 4AG.3)

Ships the end-to-end wiring: store, mode toggle, selector data
sources, compute dispatch, basic results table.

**`useMultiProductLCAStore`** (`src/stores/multiProductLCAStore.ts`) —
**standalone, NOT extending `useSingleProductImpactStore`**.
Different concerns: single-product carries archetype-scoped
per-arc state (stage amounts, results-by-arc, Static/Projected
inheritance); multi-product carries a flat selection list + a
single result envelope. Mixing them would tangle the discriminator-
union backend pattern (Patch 4AG.1) with single-axis frontend
assumptions.

Slots:
- `selectedItems: ProductItem[]` — source order preserved (chart
  rendering in 4AG.4 will depend on it; backend already preserves
  source order in its fan-out per 4AG.1).
- `multiResult: MultiProductLCAResult | null` — last-compute
  envelope.
- `multiLoading: boolean` — fetch-in-flight gate for the Compute
  button.
- `multiError: string | null` — **TOP-LEVEL** error only (network
  / 500). Per-item errors live inside `multiResult.items[i].
  error_message` with `status="error"`. Partial-success runs
  populate `multiResult` AND leave `multiError` null — the
  distinction matters for UI: a partial-success state shows the
  results table with mixed success/error rows; a top-level error
  shows just an error banner.

Actions: `addItem` (idempotent on duplicates, keyed by
`productItemKey`), `removeItem`, `clearItems` (does NOT touch
result/error so users can inspect past results while starting a
fresh selection), `compute({scope, methods, computeDatabase})`,
`reset`.

**Wire-shape conversion** in `compute()`: the UI-side `ProductItem`
carries display metadata (`display_name`, `folder`, `location`,
`unit`) for chip rendering; the wire payload (`MultiProductRequestItem`)
carries only the discriminator + dispatch keys. The store's
internal `toWireItem(item)` strips display metadata before POST.
Backend re-derives names from ids at compute time.

**Sub-mode toggle** in `SingleProductImpact.tsx` — Single item
(existing UX) / Multi-item comparison (new). Top-of-Single-product-
subtree placement, NOT a third top-level toggle. State is preserved
across switches via the **visibility-toggle pattern** (Patch 4AC
discipline): both subtrees stay mounted, `display: none` on the
inactive pane. Users flip back and forth without losing selections
or results.

**`<MultiProductLCA>` layout** (`src/components/impact/MultiProductLCA.tsx`):
- Configuration row (shared across items): Scope buttons,
  `<MethodPicker>`.
- `<MultiItemSelector mode="mixed">` fed by `useBOMStore.archetypes`
  (sync, already loaded) and `useActivityStore.activities` (async,
  populated by the existing search store's `/activities/search-all`
  flow).
- Compute button — disabled with explanatory tooltip when no items
  selected or no methods picked; label reflects selection count.
- Basic per-item results table (4AG.3 ships compute; chart
  visualisation is 4AG.4).

**Activity search reuse caveat**: `useActivityStore` is reused for
the activity data feed. Its `searchQuery` slot is the same one
Database Explorer uses, so switching browser tabs between Database
Explorer and Multi-item LCA erases the other's query. Acceptable
limitation in 4AG.3 (research workflows rarely flip rapidly). If
this surfaces as friction post-distribution, decouple via a
multi-product-local activity search hook.

#### What NOT to do

- **Don't extend `useSingleProductImpactStore` with multi-item
  slots.** Different concerns; mixing tangles the
  discriminator-union backend pattern (Patch 4AG.1) with
  single-axis frontend assumptions. The two stores share a
  ProductItem type but no state.
- **Don't clear `selectedItems` when toggling between Single item
  and Multi-item modes.** Users may switch back and forth while
  exploring; preserving state respects their work. The
  visibility-toggle pattern enforces this — both subtrees stay
  mounted, the store survives, only `display: none` flips.
- **Don't conflate `multiError` (top-level) with per-item errors.**
  `multiError` is set only when the whole POST fails (network
  down, 500, etc.). Per-item failures are surfaced inside
  `multiResult.items[i]` with `status="error"` + `error_message`.
  Partial-success runs populate `multiResult` AND leave
  `multiError` null. The UI must distinguish — show the results
  table with mixed rows for partial-success; show only an error
  banner for top-level failure.
- **Don't include UI-side display metadata in the wire payload.**
  `display_name` / `folder` / `location` / `unit` are for chip
  rendering only. The backend re-derives names from ids at
  compute time. Sending display fields wastes bandwidth and
  invites silent drift between UI-shown names and backend-derived
  names.
- **Don't render the visualization in 4AG.3.** Basic results
  table proves end-to-end works; visualization investment belongs
  in 4AG.4 where chart-shape decisions get full attention.
  Premature chart in 4AG.3 either ships incomplete (e.g. only
  grouped bars, no stacked) or blocks 4AG.3 on visualization
  decisions that don't need to be made yet.
- **Don't show per-item `stage_amounts` editing UI in 4AG.3.**
  Defaults are sufficient for first end-to-end ship. Per-item
  editing is a follow-up if users need it. The store already
  threads `stage_amounts` through the wire payload (backend
  accepts per-item overrides per Patch 4AG.1) — UI plumbing is
  the missing piece, not the data path.
- **Don't reuse `useActivityStore`'s `searchQuery` blindly.**
  It's currently shared with Database Explorer; user-visible
  consequence is a known limitation. When 4AG.4 ships or
  post-distribution friction surfaces, decouple via a
  multi-product-local search hook (or a per-context query slot
  in the activity store).

### Visualisation + Excel export (Patch 4AG.4)

Closes the multi-product LCA arc.

**`<MultiProductComparisonChart>`** (`src/components/impact/MultiProductComparisonChart.tsx`):

Shape mode is determined by `(scope, all-successful-archetypes-have-stage-breakdown)`:
- **Stacked**: when `scope === 'all'` AND at least one successful
  archetype item carries `stage_breakdown` for the selected method.
  Each stage renders as a stacked `<Bar dataKey={stage} stackId="x">`.
  Activity items (no stages) get an additional `ACTIVITY_TOTAL_KEY`
  bar in the same stack — their stage cells are 0, their total
  occupies the activity slot. Mixed mode (archetype + activity)
  shows both: archetype bars layer up stage segments; activity
  bars show a single grey segment.
- **Solid**: when no successful item carries stage_breakdown (specific
  scope, all-activity, or scope='all' but archetype results have
  `stage_breakdown: null`). Single `<Bar dataKey="Total">` per item.

**Method picker** is the parent's responsibility (passed via
`selectedMethodLabel` prop). Different LCIA methods have different
units (`kg CO₂-eq` vs `m³ depriv.` vs `kBq U-235`) and can't share
a y-axis cleanly — one chart per method, switched via the picker.

**Color discipline**:
- Stage colors use `CHART_PALETTE` via positional indexing (Patch 4B
  convention — same colors as `<StageBreakdownChart>`).
- The activity-totals slot uses a neutral grey (`#9ca3af`) distinct
  from any stage color.
- Items don't have their own bar colors in stacked mode (stages
  drive color); in solid mode, a single bar color from
  `CHART_PALETTE[0]`. Per-item-by-ID color is a v2 enhancement,
  deferred.

**Legend** is rendered manually outside Recharts (native HTML/SVG)
so it's reliably observable in jsdom AND captured in chart image
exports via the Patch 4I/4K legend-export pipeline.

**View toggle** (Chart / Table): preserves the basic per-item
results table from Patch 4AG.3 as the alternative numerical-
inspection view. Chart for visual comparison; table for exact
values across all methods at once. State per-render (no
persistence — view choice is a moment-in-time inspection
preference).

**Excel export** (`POST /impact/export-multi-product`, backend
`_build_multi_product_workbook`):

Sheets (in order):
1. **Configuration** — meta block (computed_at, scope,
   compute_database, items counts, methods, elapsed) + Items table
   (row per item, success/error status, notes).
2. **Comparison (wide)** — rows=items, columns=methods + Error.
   Failed items still appear with `—` for method values and the
   error_message in the trailing column. Method scores in
   scientific notation.
3. **Comparison (long)** — one row per (item, method) pair. Only
   successful items contribute. For downstream pandas/R tooling.
4. **Stage breakdown sheets** (`SB_<label>`) — one per archetype
   item carrying `stage_breakdown`. Omitted for activity items and
   stage-less archetypes (specific-scope results). Sheet name
   truncated to 31 chars; duplicates disambiguated with `_n`
   suffix.
5. **Errors** — emitted only when `error_count > 0`. One row per
   failed item with type, identifier, error_message.

Filename: `MApper_MultiProduct_Comparison_<date>.xlsx`.

#### What NOT to do

- **Don't put methods on the x-axis with different units.** A
  single chart can't share a y-axis across `kg CO₂-eq` and
  `m³ depriv.` and `kBq U-235`. The method picker is the cleanest
  UX — one chart per method, user switches. Multi-method-at-once
  with normalised y-axis (% of max) is methodologically problematic
  — normalisation hides absolute magnitudes that are the whole
  point of LCA comparison.
- **Don't render zero successful items as an empty chart.** The
  empty-state message ("No successful computations to display.
  Check the Errors section or table view.") guides users to the
  errors banner. An empty chart with no rows looks like a render
  bug.
- **Don't conflate stage colors with item colors.** Stages
  (Manufacturing / Use / Maintenance / EoL) have an established
  positional convention from Patch 4B's `<StageBreakdownChart>`.
  Items use a separate palette only in solid mode (and only one
  color in v1). Mixing creates false visual correspondences.
- **Don't ship multi-product Excel without an Errors sheet when
  partial success.** Users need to know which items failed and
  why; missing errors silently degrades research outputs. The
  builder emits the Errors sheet whenever `error_count > 0`.
- **Don't put method picker INSIDE the chart container.** Picker
  is configuration, not chart content — render it above the chart
  in the results header alongside the view toggle + export button.
  This also keeps the chart container clean for the export image
  capture.
- **Don't drop the basic results table from 4AG.3 when adding the
  chart.** View toggle preserves both. Visual comparison and
  numerical inspection are methodologically different research
  activities — both have legitimate use cases.
- **Don't assume Recharts internal SVG elements (`<Bar>`,
  `<XAxis>`) are reliably observable in jsdom tests.** Same
  limitation noted in Patch 4AF. Test the LEGEND (rendered as
  native React HTML), empty-state placeholders, the chart wrapper
  testid, and unit text. Bar counts and fill colors per stage are
  visual-inspection territory.
- **Don't bolt a per-item stage_amounts column onto the wide
  sheet.** Stage breakdown sheets exist for that detail — one
  sheet per archetype item, in the per-method-per-stage shape
  appropriate for stage-level inspection. Putting stage subtotals
  inline in the wide sheet would explode the column count past
  readability.

### Architectural decisions (locked by Patch 4AG.1)

1. **Mixed selection allowed.** A single request can contain
   archetypes, activities, or both. Discriminated payload on
   response items distinguishes them downstream.
2. **Server-side fan-out**, not frontend orchestration. Consistent
   with Patches 2A–2G; one endpoint, one response, deterministic
   ordering, no `POST→WS` race.
3. **Comparison-chart shape driven by scope** (will land in 4AG.4):
   `scope="all"` AND all-archetypes → stacked bars per item;
   specific scope OR any-activity → grouped bars per item.
4. **Reusable `<MultiItemSelector>`** (4AG.2) over duplicating
   Database Explorer's selection UI. Future selection contexts
   (multi-item AESA, expanded Material Flows) inherit it.
5. **Mixed → comparison rendering handles both shapes**. Activities
   have no `stage_breakdown`; rendering coalesces to grouped-totals
   when any item lacks stages.
6. **Single endpoint with discriminated-union request**, not two
   endpoints + client-side merge.

### What NOT to do

- **Don't reuse `/lca/calculate-activities` for multi-item
  comparison.** That endpoint treats N activities as a single
  combined demand (their contributions sum to one total); the
  comparison use case needs N independent demands. The two
  endpoints answer methodologically different questions.
- **Don't abort the fan-out when one item fails.** Per-item error
  isolation is a contract — one bad archetype id or unmapped
  activity shouldn't waste the user's other 9 items' compute
  time. The aggregate `success_count` / `error_count` fields and
  per-item `status` + `error_message` make partial results
  consumable.
- **Don't duplicate the single-product validation rules** (methods
  required, scope enum, biosphere rejection, etc.) in the
  multi-product endpoint. The existing handlers are the source of
  truth — call them in-process and let their HTTPExceptions surface
  as per-item errors.
- **Don't change result ordering across the fan-out.** Source
  order from `request.items` MUST be preserved in `response.items`.
  Chart rendering and table column ordering depend on it.
- **Don't restrict to homogeneous types without explicit research-
  tool justification.** Mixed comparison is methodologically valid
  (e.g., "is our compiled BEV-LFP archetype better than ecoinvent's
  market-for-battery activity?"). The discriminated-union shape
  handles both transparently.
- **Don't add a new task-registry / WebSocket pattern for the
  multi-product fan-out.** N is typically small (~3–10 items),
  each item's compute is the same sub-second-to-seconds path as
  single-product. A sync POST returns the assembled envelope.
  Task plumbing would add complexity for no UX gain.
- **Don't ship 4AG.4 (visualisation) before 4AG.2 (selector)** or
  4AG.3 (store + mode toggle). The compute layer is independently
  testable via API; visualisation needs both selection + result
  state to demo. Sub-patch ordering matters — visualization
  built on missing selection UI is unverifiable.

### Deferred (out of scope for the full Patch 4AG)

- **Multi-item AESA characterization**. Compute AESA against N
  items at once. Methodologically possible but adds the cross-
  item-aggregation question; deferrable.
- **Configuration template save for multi-item selections**.
  Patch 4U's two-tier save model (templates vs sessions) doesn't
  yet apply here. A future patch ships if users start saving
  recurring N-item comparison configurations.
- **Saved sessions for multi-item comparisons**. Same.
- **Cross-database direct comparison**. Items from different
  technosphere databases compared in one chart. Adds
  characterisation-factor compatibility questions across LCIA
  methods; deferrable.
- **Static→Projected multi-item inheritance**. Patch 4F shipped
  this for single-item; the multi-item generalisation is a
  follow-up.
