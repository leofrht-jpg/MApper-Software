---
name: mapper-single-product
description: "Single-product mode in Impact Assessment (Patch 3): behavior and invariants. Use when working on single-product LCA runs or UI."
---

## Single product mode in Impact Assessment (Patch 3)

Impact Assessment now ships with a top-level `Single product / System` mode
toggle (`impact-mode-toggle` testid in `pages/ImpactAssessment.tsx`). System
mode is the canonical fleet-level surface (DSM × archetypes × pLCA pipeline,
Patch 2A–2I). Single product mode operates on a single archetype picked at
the top of its subtree and computes through the extended
`/lca/calculate-archetype` endpoint — no DSM, no fleet dynamics.

### System-level assessment requires a SELECTED DSM — guidance helper (Patch 5AA → 5AC)

System-level assessment runs on the **selected** DSM's fleet — so it can't do
anything until a DSM is active/selected for the project. When none is active,
`ImpactAssessment` renders a guidance empty-state (`<DSMRequiredHelper>`, testid
`system-assessment-dsm-required`) **in place of** the Static/Prospective/
Comparison sub-tab content (once, at the system-pane level — all three require a
DSM, so not three copies). Icon + heading + body + a primary CTA
(`system-assessment-goto-dsm`) → `onNavigate('dsm')` (same nav prop
`DSMImpactPanel` uses).

**Gate (Patch 5AC, revises 5AA): `useDSMStore(s => s.activeSystem != null)` — an
ACTIVE/selected DSM, NOT mere existence.** 5AA originally gated on
`activeSystem != null || systems.length > 0`, which hid the helper as soon as
any DSM existed — but a project can have DSM systems with **none selected**
(`activeSystem == null`), and an unselected DSM has no fleet to assess, so the
panels rendered blank. 5AC drops the `|| systems.length > 0`: the helper shows
whenever no DSM is active. Copy adapts via `hasAnyDSM` (`systems.length > 0`):
**"Select and run a Dynamic Stock Model"** when DSMs exist (just none picked) vs
**"Create and run…"** when none exist — both CTAs go to the DSM tab. Once a DSM
is selected (`activeSystem` non-null) the helper yields and the panels render;
the panels own the subsequent run flow (`simulationResult` is their slot — we do
NOT gate on it, or the run controls would be hidden). Display-only — no change
to the DSM, the assessment compute, or single-product. Locked by
`tests/impactAssessment.dsmRequired.test.tsx`.

#### What NOT to do

- **Gate the system-level helper on the active/selected DSM (activeSystem) — not
  on systems.length; a DSM that exists but isn't selected still has no fleet to
  assess, so the helper must show.** (5AC corrected exactly this — 5AA's
  `|| systems.length > 0` hid the helper in the DSMs-exist-but-none-selected
  state.)
- **Don't gate on `simulationResult`** (too strict — it would hide the panels'
  own run/compute flow once a DSM is selected). Don't render a blank system-level
  tab; don't duplicate the helper across the three sub-tabs (place it once at the
  system-pane level).

**Cross-mode mounting**. Both subtrees stay mounted simultaneously via
mode-level visibility-toggle (`display: none` on the inactive pane), same
discipline as the per-tab visibility-toggle that lives inside the
system-mode subtree. This preserves system-mode's tab + selection state
across a round-trip into single-product mode and back, AND preserves
single-product's archetype + tab state across a round-trip into system
mode and back. The structural guarantee is locked in by
`tests/impactAssessment.modeToggle.test.tsx`.

**Backend extension**.
`mapper.models.schemas.ArchetypeLCACalculateRequest` accepts two optional
fields, `compute_database: str | None` and `parameter_scenario: str | None`.
The handler at `mapper/api/lca.py:calculate_archetype_lca` resolves
`parameter_scenario` against the active project's `ParameterTable` BEFORE
scope filtering, then drives the demand dict translation through
`_translate_demand_to_database` for the prospective key remap and per-key
characterisation loop. The result echoes both fields plus a `warnings: list[str]`
carrying any database-translation messages. Schema-level acceptance is
covered by `mapper-backend/tests/test_archetype_lca_extended.py`.

**Frontend topology**. `components/impact/SingleProductImpact.tsx` is the
subtree wrapper — archetype picker (`<ArchetypeSelect>`), tab bar, three
tab panes via visibility-toggle (Static / Projected / Comparison). Each
panel is a separate file in `components/impact/SingleProduct{Static,
Projected,Comparison}Panel.tsx`.

- **Static** picks scope + methods + sensitivity cases. N=1 = one POST,
  `parameter_scenario: null`. **N>1 = sequential client-side calls**, one
  per scenario, with `Calculating i/N` progress label. No orchestrator —
  each call is its own `/lca/calculate-archetype` task. The Patch 2A
  multi-task orchestrator (`/impact/calculate-scenarios`) does NOT apply
  here because the single-product endpoint isn't a long-running WS task.
- **Projected** picks scope + methods + N prospective databases (grouped
  by IAM/SSP, ordered by year within group). One sequential POST per
  database with `compute_database: db.name`. Result is an ordered list
  of `(dbName, year, iam, ssp, result)` runs, sorted chronologically;
  scenario tab bar mirrors Static's pattern. **Multi-parameter axis is
  intentionally not exposed here** — Static is the home for parameter
  sensitivity. The 3-way `axisConflict` rule reduces to "single axis"
  in single-product mode (no DSM, no paired) so a per-panel guard isn't
  needed — only one axis per panel is ever offered.
- **Comparison** reads both Static (active scenario result) and
  Projected (full run list) from `useSingleProductImpactStore` —
  cross-panel results store keyed off archetype id. Computes
  per-method, per-scenario `Δ = P(scenario) − S` deltas. **Sign
  convention**: green when `Δ < 0` (projected improves on static), red
  when `Δ > 0`. Headline counts indicator-scenarios that improved vs.
  worsened.

**`useSingleProductImpactStore`** (`stores/singleProductImpactStore.ts`)
is a tiny zustand store carrying `staticResult`, `projectedRuns`, and
the current `archetypeId`. The `setArchetypeId` setter clears both
result slots when the id changes — comparing Static for archetype A
against Projected for archetype B would produce a meaningless delta, so
the store enforces alignment at the boundary. Static and Projected
panels write into this store via `useEffect`s that mirror their local
result state; Comparison reads both slots.

**Patch 4B — stage breakdown**. `ArchetypeLCACalculateResult` carries an
optional `stage_breakdown: dict[str, dict[str, float]] | None` keyed
`method_label → stage → score`. Populated only when `scope == "all"` —
specific-stage scopes return `None` because the result is already that
one stage and a breakdown would be redundant. Aggregated in a single
pass alongside the existing per-material × per-method loop in
`mapper/api/lca.py:calculate_archetype_lca`, so it costs no extra LCA
calls. Per-method invariant: stage subtotals sum to method total within
float epsilon (asserted by
`tests/test_archetype_lca_stage_breakdown.py`). Static panel renders it
via `<StageBreakdownChart>` (horizontal stacked bar, one row per
method, segments per stage) above the indicators table — only when
`activeResult.stage_breakdown` is non-empty.

**Patch 4C — chart views for Projected and Comparison**. Both panels
default to a chart view, with a Chart/Table `<ViewToggle>` in the
CollapsibleCard `actions` slot. View mode persists per-panel via
`useSingleProductImpactStore` (`projectedViewMode`,
`comparisonViewMode`) — independent slots so the user can leave
Projected in chart view and Comparison in table view, or vice versa.
View modes survive an archetype change (data clears, chart/table
preference doesn't). Both views stay mounted via the visibility-toggle
pattern (`display: none` on the inactive view) so chart-local state
(hover, format setting) and table-local state survive a round-trip.

**Two new chart components, both single-active-method**:

- `<ProjectedTimeSeriesChart>` (`components/charts/`) — Recharts
  `LineChart` with one line per `(iam, ssp)` trajectory through
  per-year scores for the active method. Years are the union of run
  years across trajectories. Uses `SCENARIO_PALETTE` (Okabe-Ito) keyed
  by sorted trajectory order. Custom tooltip lists trajectories at the
  hovered year sorted by value descending.
- `<ComparisonReferenceLineChart>` + `<ComparisonDeltaChart>`
  (`components/charts/ComparisonReferenceLineChart.tsx`, two exports
  from one file). Reference-line chart: `ComposedChart` with a dashed
  `<ReferenceLine y={S}>` plus per-trajectory `<Line>`; custom dot
  render colors each marker green when projected < static
  (improvement), red when projected > static (worsening), trajectory
  color when equal. Delta chart: `AreaChart` of `P − S` per
  trajectory, centered at `<ReferenceLine y={0}>`, three-stop
  gradient (red top → trajectory mid → green bottom) so the eye reads
  the sign of the delta from the fill direction.

**Method selection on charts**. Both chart views use
`<MethodSelector>` (`components/impact/MethodSelector.tsx`) — a single
`<select>` of methods, scoped per-panel. The chart side renders ONE
method at a time; tables continue to show all methods at once. The
default method auto-pins to the first valid one shared by Static and
the first projected run; if the active method becomes invalid (e.g.
Static was recomputed against a different method set) the effect
re-pins to the first valid one.

**Comparison summary framing**. Single-product Comparison's headline
counts indicator-scenarios that improved vs. worsened ("`{N}`
indicator-scenarios show impact reduction; `{M}` show increase vs.
base ecoinvent at the projected scenario year"). Don't reuse system-
mode's "cumulative emissions" framing — the latter is bound to fleet-
level GWP integration over time and is meaningless at a per-product,
per-scenario delta.

**Patch 4D — Static → Projected inherit-on-first-visit**.
`useSingleProductImpactStore` carries three per-archetype slots:
`staticConfigByArc: {scope, selectedMethods}`, `projectedConfigByArc:
{scope, selectedMethods, selectedDbs}`, and `projectedCustomizedByArc:
boolean`. When the user opens Projected on an archetype that (a) has
no entry in `projectedConfigByArc`, (b) is not flagged customized, and
(c) has a Static config with at least one method selected, Projected
copies `scope` and `selectedMethods` from Static (selectedDbs starts
empty — Projected's LCI scenario list is a Projected-only axis with
no Static counterpart). The inherited config is written to
`projectedConfigByArc` immediately so future visits hit the restore
path and don't re-fire the inheritance banner.

**One-time inherit, not a live mirror.** Inheritance is a single-shot
copy at first visit. The user's edits in Projected drift independently
from then on — Static changes do NOT auto-update Projected, even if
Projected hasn't been touched since inheritance. The
`projectedCustomizedByArc` flag flips on the first user edit to scope
or selectedMethods (NOT selectedDbs — LCI scenarios are
Projected-only, so editing them isn't a "customization away from
Static") and prevents re-inheritance forever. A visual cue — the
inline banner "Inherited Static Background configuration. Changes here are
independent." — appears once at the inheritance moment and
auto-dismisses after ~6s (manual × also available).

**Three-path archetype-change effect**:
1. **Restore** — `projectedConfigByArc[arc]` exists → load it as-is.
2. **Inherit** — no projCfg, not customized, `staticConfigByArc[arc]`
   has ≥1 method → copy scope + selectedMethods, set selectedDbs=[],
   write to `projectedConfigByArc`, show banner.
3. **Defaults** — fall through → scope='all', methods=[], dbs=[].
   **Do NOT write defaults to `projectedConfigByArc`** — that would
   block path 2 if the user later configures Static and revisits.

**MethodPicker is uncontrolled**, so re-seeding requires bumping a
`pickerSeed` state used as `key` to remount it. The `initialSelected`
prop seeds `useState` once per mount. Two race-guard refs prevent the
picker's mount-time onChange and re-render onChange from polluting
the store: `skipNextMethodsChangeRef` (initialized true so the very
first onChange after mount is suppressed; re-armed before each
re-seed) and `lastArchetypeIdRef` (set in the [archetypeId] effect;
when it differs from the current `archetypeId` in `handleMethodsChange`,
the parent's restore effect hasn't run yet, so the picker's `selected`
map is still the previous archetype's — skip the write).

**Reset behaviour**. Project change or `reset()` clears all three
slots (`staticConfigByArc`, `projectedConfigByArc`,
`projectedCustomizedByArc`). Switching archetypes within a project
preserves other archetypes' state — only the active archetype's
panels re-read their slots.

#### What NOT to do (Patch 4D)

- **Don't make inheritance a live mirror.** The user's mental model
  is "Projected starts where Static left off, then evolves on its
  own." A live mirror would silently revert Projected edits whenever
  Static changes — confusing, and there's no UI affordance to
  re-inherit on demand if the user actually wants to. One-time at
  first visit is the contract.
- **Don't include selectedDbs in the inheritance copy.** Static has
  no LCI scenarios (it's base ecoinvent only), so there's nothing to
  copy from. Defaulting selectedDbs=[] forces the user to pick at
  least one before computing — that's fine; Projected without
  selectedDbs makes no sense anyway and Calculate is gated.
- **Don't include sensitivity cases (parameter scenarios) in
  inheritance.** Projected does not expose the parameter axis (LCI
  scenario × parameter scenario fan-out is intentionally not
  supported — the 3-way axisConflict rule reduces to "single axis"
  in single-product mode, but the parameter axis lives in Static
  only). There's no equivalent slot to inherit into.
- **Don't flip `projectedCustomizedByArc` on selectedDbs changes.**
  selectedDbs is a Projected-only axis; varying it isn't drifting
  away from Static. Only scope and selectedMethods edits — the two
  fields that ARE inherited — flip the flag. This keeps the
  semantics tight: customized means "the user has touched something
  Static configured."
- **Don't write defaults to `projectedConfigByArc` on path 3.**
  Path 3 fires when Static has nothing yet AND projCfg is undefined.
  Writing defaults would shadow the slot, and a future Static
  configuration wouldn't trigger path 2 anymore. Path 3 is a
  read-only fallback.
- **Don't try to fix the picker-onChange race by lifting MethodPicker
  state into the store.** The picker is a shared component used in
  multiple panels; its `selected` map is panel-local by design. The
  two-ref race guard (`skipNextMethodsChangeRef` + `lastArchetypeIdRef`)
  is the right fix at the panel level. State-lifting would force every
  picker consumer to provide a controlled-mode adapter for one
  panel's needs.

### What NOT to do

- **Don't merge `LCACalculator` (LCA Architect → Calculator) into the
  single-product Impact Assessment subtree.** They look superficially
  similar — both compute one archetype's impact — but the workflows and
  audiences differ. Calculator is a workshop tool for BOM sanity-checking
  during archetype authoring (linked to the BOM editor, scoped to
  authoring iterations); single-product Impact Assessment is the
  canonical computation surface for analysis (sits next to system-mode
  and Comparison, surfaces multi-axis fan-out and the Method Library).
  Merging them would force one workflow's audience to navigate the
  other's affordances. Keep them separate.
- **Don't expose multi-DSM scenarios chip or paired DSM × LCI editor in
  single-product mode.** DSM has no per-product meaning — a fleet
  trajectory applied to one archetype is a category error. Those
  affordances live in `DSMImpactPanel` / `ProjectedImpactPanel` and are
  scoped to system mode by file separation, not by a runtime guard.
  Don't lift them into a shared component thinking they'll be reused;
  they won't. The absence is enforced by the modeToggle test
  (`expect(within(spPane).queryByTestId('dsm-scenarios-chip')).toBeNull()`).
- **Don't fan out single-product multi-LCI / multi-parameter through
  `/impact/calculate-scenarios`.** That endpoint is the system-mode
  orchestrator with WS progress, task registry, and cancellation
  threading. Single-product fan-out is N sequential client-side calls
  to `/lca/calculate-archetype`. The endpoint is sync-fast (no WS) and
  the typical N is small (≤6). If a workflow ever needs N=20+
  scenarios with cancellation, that's the point at which a sibling
  multi-archetype WS endpoint becomes worth the cost — not before.
- **Don't reuse `useImpactStore` for single-product results.** That
  store carries DSM/cohort-aware shapes (`projectedMultiResult`'s
  `scenarios[].cohorts`, etc.) that don't exist for single-product.
  Folding single-product slots in would either bloat the system-mode
  shape with optional cohort-y fields or force every system-mode
  consumer to defend against undefined cohorts. The single-product
  store is narrow on purpose.
- **Don't read `useSingleProductImpactStore.archetypeId` as a
  load-bearing signal in panels** other than the wrapper. The wrapper
  (`SingleProductImpact.tsx`) is the source of truth for the picker;
  panels receive `archetypeId` via prop. The store's archetype field
  exists only to clear stale results on archetype change — its
  purpose is invariant maintenance, not state propagation.
- **Don't emit a `cumulative emissions` framing in the single-product
  Comparison summary.** That language belongs to fleet-level GWP
  integration over time, which is meaningless at a per-product,
  per-scenario delta. Each scenario already carries a year, so the
  natural framing is "indicator change at {year}" or "indicator-scenarios
  improved vs. worsened" (the headline currently shipped). If a
  user-requested feature ever needs an "impact-years saved" summation,
  scope it carefully — it's only meaningful when the user explicitly
  pairs a stock duration with the per-product delta, which the
  single-product surface doesn't model.
- **Don't bend `<MultiScenarioImpactChart>` to handle single-product
  Projected results.** The system-mode chart consumes
  `ImpactAssessmentResult` per scenario, each carrying a built-in
  `years` time series (DSM × archetypes × cohorts). Single-product
  Projected returns scalar method scores per `(iam, ssp, year)` — no
  inner time series exists. The two shapes differ at the dataset
  level; bending one onto the other forces shape-detection branching
  that obscures both callers. `<ProjectedTimeSeriesChart>` is the
  separate, narrower component for the single-product shape. Same
  reasoning applies to the Comparison reference-line chart — single-
  product Static vs. Projected is "scalar S vs. scalar P per scenario
  year"; system-mode comparison is "year-aligned cumulative-difference
  curve". Different shapes, different components.
- **Don't conditionally mount the inactive view** when toggling
  Chart/Table on Projected or Comparison. Both views stay rendered
  with `display: none` on the inactive one — same visibility-toggle
  rule as the per-tab and per-mode wrappers. Conditional mount kills
  chart-local state (hover, format setting, method selection) silently
  on every switch.
- **Don't add per-method overlay** on the single-product chart views.
  The chart side is single-active-method by design (per Patch 4C
  scope). Multiple methods at once on one chart conflates units and
  scales — methods like GWP (kg CO₂-eq) and water depletion (m³)
  cannot share an axis. The table view already shows all methods at
  once; that's where multi-method comparison belongs.

### AESA display filter (Patch 4T)

A view-state-only filter on the AESA result body that subsets which
indicators (`pb_id`) appear in the radar / timeline / detail-table /
box-plot views and in the Excel export. Compute is unaffected — the
Sala 2020 framework requires evaluating ALL 16 EF v3.1 indicators for
methodological soundness, so filtering at compute time would silently
break the framework's coverage requirement. The filter is the answer
when a user wants to focus a chart on a single dimension (e.g.
"climate change only") or compare a small subset across views without
re-configuring + re-running the whole pipeline.

**Store slot**: `useAESAStore.displayedIndicators: string[] | null`.
`null` = "show all" (the default after every fresh compute). An
explicit list narrows the displayed indicators. Actions:
`setDisplayedIndicators(ids)`, `toggleDisplayedIndicator(id, fullList)`,
`clearDisplayedIndicators(fullList)`, `selectAllDisplayedIndicators()`.

**Toggle invariant**: when the user explicitly toggles every
indicator on (one-by-one), the slot collapses back to `null`. This
keeps the saved-session shape clean — `null` is the canonical "show
all" representation, distinct from "the user happens to have
selected exactly these N indicators today, pin this id list across
future computes". Without the collapse, a session saved with a
filter of `[a,b,c,d]` (full set today) would silently hide indicator
`e` if a future schema or boundary-set update added one — surprising
behaviour. The collapse only happens via `toggleDisplayedIndicator`;
an explicit `setDisplayedIndicators([a,b,c,d])` from the API does
NOT collapse, because the caller has signalled intent to pin.

**Color stability** (`utils/aesaIndicatorColors.ts`):
`buildIndicatorColorMap(pbIds)` is called once on the FULL ordered
indicator list (typically the unique pb_ids in
`result.results`, in result order). It returns a `pb_id → hex` map;
`colorForIndicatorById(map, pb_id, fallbackIdx)` looks up the
indicator's color. Filtering subsets the indicator set but NEVER
rebuilds the color map from the subset's index — otherwise a 3-
indicator subset would shuffle every color. Patch 4S's
index-based `colorForIndicator(_pb_id, idx)` is preserved unchanged
for backward compatibility (TimelineView still calls it with the
filtered-array index AND that test asserts index-driven semantics);
the new `colorForIndicatorById` is the right primitive for new code
that wants id-stable color across full vs. filtered displays.

**Filtering happens at the parent (`AESADashboard`), not in each
chart**. `filteredResult` is computed once via `useMemo` —
shallow-cloned `AESAComputeResult` with `results`, `summary_by_year`,
and `sensitivity` subset to the displayed pb_ids; `summary_by_year`
is recomputed from the filtered set so the zone-count cards reflect
what's on screen. All four chart components receive filtered inputs
and need no internal filter awareness. Same approach for chart image
export — the rendered DOM is already filtered, so PNG/SVG capture
naturally produces filtered images.

**Excel export** (`exportAESA(config, result, filename,
displayedIndicators?)`): when `displayedIndicators` is provided AND
strictly smaller than the full result, the result is filtered
client-side BEFORE POSTing to `/aesa/export`. The backend route is
untouched — same `_build_aesa_workbook` runs against whatever
payload it receives. This keeps the export shape identical to the
chart shape (one source of truth, no risk of "the chart shows X but
the spreadsheet contains X+Y" drift). The dashboard renders a split
button: default click honours the filter; the caret menu offers
"Export all computed indicators" as an explicit one-shot override
(`exportAllIndicators` ref flag, reset after firing). Without an
override the user always exports what they see.

**Saved sessions (Patch 4R) carry the filter**.
`AESASession.displayed_indicators: list[str] | None = None` is
backward-compat: pre-Patch-4T sessions deserialize cleanly with the
field absent, restored as `null` (= show all). On `loadSession`,
the slot is populated from `session.displayed_indicators ?? null`.
On `saveCurrentSession` the current slot is sent through.

**Empty state** (zero indicators visible): `<EmptyFilterState>` in
`AESADashboard.tsx` renders "No indicators displayed" with a
"Select all indicators" button that calls
`selectAllDisplayedIndicators()`. The chart slot is otherwise blank
— no misleading "no data computed" message that could be confused
with a real compute failure. The zone-count cards above the chart
slot fall back to the unfiltered `yearSummary` so they don't all
read 0/0 (which would also look like a compute failure).

**1-indicator edge case**: `RadarView` already gates on
`yearResults.length < 3` and renders an inline note ("Need at least
3 mapped boundaries for the radar view"). No special handling
required for N=1 or N=2 — the existing guard is the correct UX. The
detail table and timeline both render fine with a single indicator;
the box-plot renders one row.

#### What NOT to do

- **Don't move the filter into compute.** AESA's methodological
  contract is that EVERY indicator in the boundary set is evaluated
  (Sala 2020 framework requires full 16-indicator coverage). A
  compute-time filter would silently break that contract and
  produce "results" that aren't comparable to the published
  framework. The filter is view-state ONLY.
- **Don't index-key the color map after filtering.** A 3-indicator
  subset built with `buildIndicatorColorMap(['climate_change',
  'biosphere_integrity', 'fresh_water_use'])` would assign
  `climate_change` → palette[0], `biosphere_integrity` → palette[1],
  `fresh_water_use` → palette[2] — but the FULL view assigns those
  ids to slots 0, 1, and 3 respectively. Always build the map from
  the full ordered list and look up by id.
- **Don't auto-restore the filter from the previous compute** to a
  fresh result. Compute clearance (`displayedIndicators: null` in
  the `compute` worker's success path) is deliberate — a stale
  filter could silently hide newly-computed indicators (e.g. a
  user who switched boundary sets) that the user has had no chance
  to opt in to. If a future workflow needs "remember filter across
  recomputes against the same configuration," gate it on the
  configuration id being unchanged.
- **Don't pin the saved-session filter to the at-the-time full
  set.** When the user toggles every indicator on, the slot
  collapses back to `null`. Saving an explicit "all selected"
  list would mean reload-on-a-different-system shows the (possibly
  different) full set as filtered — confusing. `null` is the
  canonical "show all" representation; the toggle-collapse contract
  preserves it.
- **Don't subset `result.results` with a redundant copy at every
  chart**. The dashboard does the filter once via `useMemo`; charts
  receive ready-to-render data. Pushing the filter into each chart
  duplicates the work, drifts on edge cases (e.g. one chart honours
  zero-indicators, another doesn't), and adds boilerplate to every
  future chart that consumes AESA results.
- **Don't add a backend `displayed_indicators` field on
  `AESAExportRequest`.** Filtering on the wire keeps the backend
  route unchanged and ensures export-shape == chart-shape. If a
  future use case needs server-side filtering (e.g. very large
  results), revisit — but today's results are kilobytes, not
  megabytes.
- **Don't gate filter UI on session-loaded mode being read-only.**
  The configuration cascade is read-only in session-loaded mode
  (Patch 4R), but the display filter is view-state, not
  configuration. Users LOOKING at a saved session benefit from
  being able to focus on a subset of its indicators just as much as
  users looking at a live result.

### Floating UI must portal out of stacking contexts (Patch 4X)

Confirmation modals, popovers, dropdowns whose menu may overflow the
parent, tooltips that anchor outside their parent — any **floating
UI** must portal to `document.body` via `createPortal(...,
document.body)`. Rendering floating UI inside the component tree of
the page that triggered it is unreliable: ancestor stacking contexts
can trap z-index, and `position: fixed` is NOT enough to escape on
its own.

The AESA page in particular has multiple stacking contexts:
`position: sticky` configuration sidebar (Patch 4V), chart containers
with absolute-positioned legends, the `<main>` scroll wrapper. A
modal rendered inside any of these stacking contexts can be visually
covered by sibling elements in a different stacking context even
with `z-index: 9999` — because z-index resolves per-stacking-context,
not globally.

**Failure mode this rule fixes** (Patch 4X): the Patch 4R
`<DeleteSessionModal>` was rendered inside `<SavedSessionsList>`,
which lives inside the sticky-positioned `<aside>` config sidebar.
The modal's `position: fixed, zIndex: 100` was trapped in the
sidebar's local stacking context; the sibling `<main>` containing
the Timeline chart painted OVER the modal at the root stacking
context, making the Delete / Cancel buttons unreachable.

**Rule** for any new floating UI:

```tsx
import { createPortal } from 'react-dom'

function MyModal({ ... }) {
  if (!open) return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, ... }}>
      {/* modal content */}
    </div>,
    document.body,
  )
}
```

Use `z-index: 9999` as the conventional modal layer in MApper. The
AESA Save Session modal, AESA Delete Session modal, and any future
modal/dialog uses this pattern.

#### What NOT to do

- **Don't render modals/popovers inside a sticky/absolute/fixed/
  transformed parent without `createPortal`**. The parent's
  stacking context will trap the modal. Even `position: fixed`
  with `z-index: 9999` is not enough to escape — `z-index` resolves
  inside the parent's stacking context.
- **Don't trust that "it works today" means the pattern is safe.**
  The pre-Patch-4X `<SaveSessionModal>` worked because it happened
  to be rendered at the AESA page-root level (outside the sticky
  sidebar). One layout refactor that moves it inside a
  stacking-context-creating parent would break it silently. Patch
  4X portals both modals defensively so the placement is
  invariant.
- **Don't reach for higher z-index values to "fix" stacking
  problems.** z-index inside a stacking context only competes with
  siblings; it can't promote the element above siblings in a
  different stacking context. The fix is the portal, not the
  z-index value.
- **Don't forget to update tests when adding `createPortal`.**
  `render(...)`'s `container` is the test root; portalled content
  lives in `document.body` instead. Test assertions that query
  `container.querySelector(...)` will return null. Query
  `document.body.querySelector(...)` (or `screen.getByTestId(...)`).

### AESA configuration template name vs. session name (Patch 4Y)

The AESA Configuration sidebar's text input is **`Configuration
template name`** (Patch 4Y label, post-rename from bare "Name").
It binds to `draft.name` in `useAESAStore`, which:

- **`saveConfig`** writes onto the persisted `AESAConfiguration`
  → surfaces as the pill in the top-right `<ConfigurationsDropdown>`
  (Patch 4U).
- **`saveCurrentSession`** embeds in the session's
  `configuration_snapshot` (frozen snapshot, Patch 4R).

This is the **template name** — distinct from the **session name**,
which `<SaveSessionModal>` builds via `buildDefaultSessionName()` as
a timestamp + system + scenario + background string, then lets the
user edit at save time.

Pre-Patch-4Y the input was labelled "Name" with no hint of which
concern it belonged to. Users (including the spec author of Patch
4Y) conflated it with session-name auto-generation and proposed
removing it. **Removal would silently degrade UX**: configurations
saved via the footer button would all carry the default
`"New AESA configuration"` label, making dropdown pills
indistinguishable. The current label + inline hint
("Names the reusable template (the pill in the top-right
Configurations dropdown). Sessions get their own timestamped name
at Save session.") is the fix.

#### What NOT to do

- **Don't remove the Configuration template name input** "because
  the session name is auto-generated." That's a different field on
  a different lifecycle (Patch 4U two-tier save model). Configuration
  templates need a user-controlled name to be distinguishable in the
  dropdown.
- **Don't rename it back to bare "Name"** without context — the
  unambiguous "Configuration template name" label is the
  user-facing fix for the conflation that led to the removal
  proposal in the first place.

### AESA Configurations dropdown owns all configuration management (Patch 4Y)

The top-right `<ConfigurationsDropdown>` is the **single surface**
for switching, renaming, deleting, AND creating configurations.
Pre-Patch-4Y the page header had a sibling `<Button>+ New
configuration</Button>`; Patch 4Y consolidated it into the dropdown
menu's first item.

Consolidation rationale:
- **Single discoverable surface.** Users find configuration actions
  in one place rather than scanning the page header for related
  buttons.
- **The first-config path stays in the sidebar empty state**
  (Patch 4Q). Since walkthrough 4 the dropdown ALSO renders with zero
  configurations ("Configurations (0)", "No saved templates in this
  project yet") — a pill that vanishes read as "this project lost its
  templates".
- **It lists every template of the CURRENT project**, each row saying
  what it was saved for (a DSM system, or single product). It used to
  list only the active DSM system's and to hide without one, so after
  a project switch, or in a project with no DSM system, templates
  looked lost. The list is reloaded on a project switch (the AESA page
  stays mounted, so the sidebar's mount effect does not re-run), and
  AESA requests go through `_withProjectHeader` like every other call.
- **The action remains methodologically necessary** even when
  hidden in a menu. `saveConfig` UPDATES the loaded configuration
  in place (calls `updateAESAConfiguration` when `activeConfigId`
  is set); without `startNewConfig`, users have no path from
  "config A loaded" → "fork to config B." Removing the action
  entirely (the user's initial proposal) would trap users —
  hiding-in-dropdown is the right compromise.

#### What NOT to do

- **Don't remove the "+ New configuration" action entirely** even
  if it feels redundant after the dropdown exists. `saveConfig`'s
  update-in-place semantics mean that editing a loaded config
  mutates it rather than forking. The action is the only path to
  fork.
- **Don't add a separate page-header "+ New" button back.** Two
  surfaces compete and confuse — the dropdown is the consolidated
  home.
- **Don't hide the dropdown** — not with zero templates, not without a
  DSM system, not after a project switch. Locked by
  `tests/aesaConfigurationsPillProjectSwitch.test.tsx`.

### AESA Configuration sidebar is drag-resizable (Patch 4Y)

The `<aside>` configuration sidebar's width is **user-controlled
via a 6px drag handle on the right edge**, with the width persisted
to localStorage at key `mapper.aesa.sidebarWidth`.

Bounds (from `ConfigSidebar.tsx`):
- Min: `SIDEBAR_MIN_WIDTH = 300` (matches the pre-Patch-4Y fixed
  width — never smaller than before)
- Max: `SIDEBAR_MAX_WIDTH = 600`, additionally viewport-clamped at
  runtime to `Math.floor(innerWidth * 0.5)` to prevent the sidebar
  from consuming more than half the screen
- Default: `SIDEBAR_DEFAULT_WIDTH = 300`

**Architecture note** (stale-closure avoidance): the drag handlers
are bound ONCE via refs and a mount-time `useEffect`. `addEventListener`
and `removeEventListener` reference the same function identity
throughout the drag's lifetime, even across `setSidebarWidth`
re-renders. `widthRef` mirrors state so the persist step (writing
to localStorage on `mouseup`) sees the at-drag-end value rather
than the at-drag-start closure value.

#### What NOT to do

- **Don't drive the drag from React state in the listeners.**
  Listeners are bound at `mousedown` time; their closures capture
  the state value at THAT render, which becomes stale as
  `setSidebarWidth` updates state during the drag. Use refs for
  mutable drag state.
- **Don't define the move/up listeners inline on every render.**
  `addEventListener` captures the function reference at click
  time; if `setSidebarWidth` re-renders and the listener identity
  changes, `removeEventListener` from inside the (older-identity)
  listener won't actually remove the listener. Bind once via
  `useRef` + `useEffect([])`.
- **Don't allow stored widths outside the bounds.** Treat
  `localStorage` as untrusted: validate against
  `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` and fall back to the
  default if the stored value is invalid. A corrupted localStorage
  entry shouldn't break the sidebar.

### AESA config draft must be rebuilt when defaults are cached (Patch 5AP)

The ConfigSidebar config-form BODY is gated on
`!showEmptyState && draft && defaults && boundarySet`. `reset()` (fired on
project change — including the bw2-project re-sync after a backend restart)
nulls `draft` **but keeps `defaults`** (defaults are project-independent
reference data). `loadDefaults`'s early-return (`if (get().defaults) return`)
then skipped rebuilding the draft, so a **null draft + cached defaults** gated
the whole body off — leaving only the header, with no error banner (it's not a
fetch failure). Fix: rebuild the draft from cached defaults whenever it's
missing — in **both** `loadDefaults` (the mount path: `if (defaults) { if
(!draft) rebuild; return }`) and `reset()` (`draft: defaults ?
draftFromDefaults(defaults, presets) : null`). The invariant: **a null `draft`
with non-null `defaults` must never persist** — that state hides the body.

Tests that seed `draft`/`defaults` directly (e.g. `aesaComputeSourceCascade`)
do NOT exercise this; the regression guard
(`tests/aesaConfigBodyRenders.test.tsx`) renders ConfigSidebar through the real
load path with `draft: null` + cached `defaults` AND the real non-null 5AO
carbon-budget shape (so `CarbonBudgetEditor` actually renders), asserting the
`aesa-config-fieldset` body appears.

### AESA config-fetch resilience + named retry banner (Patch 5AM)

The ConfigSidebar's mount loads (`loadDefaults` → `loadPresets`,
`loadConfigurations`, and `loadSessions`) fired eagerly with no
connection-ready gate and no retry, so a first-paint network race
(backend/connection not ready, sleep-wake) surfaced a bare
**"Failed to fetch"** — non-fatal (AESA compute still runs) and cleared by a
refresh. Two-part fix:

- **Transient retry (client.ts).** `withTransientRetry(fn, {attempts, baseDelayMs})`
  retries ONLY a network-level failure — `isTransientNetworkError` is true for
  a `fetch` `TypeError` ("Failed to fetch" / "NetworkError" / "Load failed") and
  **false for `HttpError`** (a real 4xx/5xx server response is never retried, so
  genuine endpoint failures still surface). Opt-in per caller — the global
  `request()` is intentionally NOT wrapped, so other tabs are unaffected and
  real failures aren't masked. The four AESA loads wrap their API call in it.
- **Named retry banner.** Config-load failures route to a dedicated
  `aesaStore.configLoadError: { kind, message } | null` slot — separate from the
  general `error` (which carries compute/save errors), so the banner can name
  the failure and re-run just it. `kind ∈ {defaults, presets, configurations,
  sessions}`; each load clears only its own kind on success (never clobbers
  another kind's error). ConfigSidebar renders a non-blocking, dismissible
  danger banner (`data-testid="aesa-config-load-error"`) showing a human label
  (`CONFIG_LOAD_LABELS[kind]`, e.g. "Couldn't load saved configurations." — never
  the raw URL/error) + a **Retry** button (`retryConfigLoad` re-invokes just the
  failed load) + a dismiss. Results keep rendering. Locked by
  `tests/aesaConfigLoadResilience.test.tsx`.

**Contract**: a config-load failure shows a NAMED, dismissible banner with a
targeted Retry — never a bare network error. Network-transient loads self-retry;
only `HttpError`s (and exhausted transients) reach the banner.

**The σ control (Patch 5AM clarification).** The compact `σ` checkbox in the
Configuration header is ONE control — the whole `aesa-run-sensitivity-toggle`
label (checkbox + the "σ" glyph) toggles `runSensitivity`, sent as
`run_sensitivity` to `POST /aesa/compute`. When ON, Compute ALSO evaluates the
Sustainability Ratio under all five uniform sharing principles (EpC, IN, AGR,
LA, AR) — the per-principle spread that powers the box-plot view; OFF computes
the primary principle only. σ = the sensitivity (sigma) glyph; it now carries a
spelled-out `title` + `aria-label` (the glyph alone was undiscoverable).

### AESA Configuration header owns primary actions (Patch 4AC)

Compute, Save (configuration template), and the Run-sensitivity
toggle live in the **Configuration sidebar header row**, alongside
the collapse chevron. Pre-Patch-4AC these affordances lived in a
separate `<footer style={footerStyle}>` at the sidebar bottom; the
footer created a spatial gap between the configuration being
adjusted and the action that consumed it. Patch 4AC removed the
footer entirely; the header now hosts:

```
[ Configuration ]  [ σ ] [ ▷ Compute ] [ 💾 Save ] [ ‹ collapse ]
```

All buttons are icon-only following the Patch 4Z convention:
`padding: '0 10px'`, `height: 28` (tighter than the page header's
`height: 36` to fit comfortably alongside the 24-px collapse
toggle), `title` + `aria-label` carry the affordance text. The
sensitivity flag is a single-character inline checkbox label
(`σ`) with the full text in the `title` — methodologically
coupled to Compute (it changes what Compute does), so they sit
together.

**Session-loaded mode swap** (Patch 4R semantics, repositioned by
Patch 4AC): when `activeSessionId !== null`, the
σ/Compute/Save trio collapses to a single icon-only
`Return-to-live view` button in the header position.

**Contextual hint / error row** (`data-testid="aesa-sidebar-hint"`):
a thin strip directly below the header surfaces "why Compute is
disabled" — `Select a DSM system to enable Compute`, `Run the
{Static|Projected} LCI first`. Same row is the home for error
messages (danger color background). Hidden when there's nothing
to communicate AND in session-loaded mode (cascade is read-only;
no Compute path to gate).

The footer is removed entirely. `footerStyle` and `footerHint`
style consts deleted with it.

#### What NOT to do

- **Don't place primary action buttons in a separate footer when
  the section they apply to has its own header.** The spatial
  gap between configuration and action obscures the relationship.
  Header-co-location is the rule for sidebars that have a clear
  primary action.
- **Don't restore the standalone footer "for the hint message."**
  The hint row directly under the header serves the same role
  with less visual real estate. Putting it back at the bottom
  re-introduces the gap.
- **Don't drop the icon-only convention for these header
  buttons.** Patch 4Z established it for the page header; Patch
  4AC continues it here. Text labels in the constrained header
  row would force either truncation or pushing the chevron off
  screen on narrow sidebar widths.
- **Don't drop the Run-sensitivity checkbox from the header.**
  Moving Compute up without bringing sensitivity makes the flag
  visually orphaned and erodes the methodological coupling
  (sensitivity changes what Compute does). They must move together.
- **Don't surface compute gating via `title` on the disabled
  button alone.** Hover-only is invisible on touch devices and
  to keyboard users who don't focus the disabled button. The
  hint row below the header is the always-visible path.

### DSM scenario displays don't append "(base)" suffix (Patch 4AB)

DSM scenario name strings render as the **bare scenario name** —
no parenthetical `(base)` / `(Base)` suffix annotation, even when
the scenario's `is_base` flag is true. The flag stays in the data
model (drives inheritance, scenario-management UI, etc.) but is
not visually surfaced as a name suffix.

Two distinct uses of the word "Base" in MApper that must not be
conflated:

- **DSM scenario "base"** — the canonical reference scenario in a
  `DSMScenario` set; `is_base: true` marks the inheritance root.
  Patch 4AB removes the visible `(base)` / `(Base)` suffix from
  scenario name displays for visual consistency: all DSM scenario
  rows render identically; the base's role is methodological, not
  decorative.
- **Sensitivity Cases "Base"** — the parameter set without
  perturbations. Standard LCA terminology referring to the
  reference parameter values used as the comparison baseline for
  Optimistic / Pessimistic / user-defined sensitivity cases. This
  label is preserved unchanged — it's methodologically meaningful
  in its own right.

**Visually-distinct base-scenario badges that are kept**:
discrete `<span>` pills like `<DSMScenariosChip>` / `<DSMScenarioChip>` /
`<ScenarioManagerModal>`'s "Base" / "Current Base" pills are
separate visual elements (not suffix appending) and are retained.
The rule targets the **parenthetical-suffix pattern**, not all
mention of "Base" in DSM UI.

Source-level invariant test (`dsmScenarioBaseSuffix.test.tsx`)
greps the codebase for the deleted construction patterns
(`is_base ? ' (base)' :`, `is_base ? ' (Base)' :`) and fails if
any reappear. Audit-and-fix-all is enforced by source-text
invariance, not just per-component render assertions.

#### What NOT to do

- **Don't append `(base)` / `(Base)` to a DSM scenario name in
  any render path.** The audit-and-fix-all rule applies across
  Impact Assessment (paired DSM × LCI editor), DSM Dashboard
  (single + multi-select scenario lists), Material Flows, AESA
  cascade, and any future scenario-list view. The source-grep
  test catches reintroduction.
- **Don't conflate the DSM-scenario "base" with the Sensitivity
  Cases "Base" label.** Different methodological concepts: DSM
  scenarios vary stock evolution, parameter sensitivity cases
  vary numeric inputs. The Sensitivity Cases checklist's "Base"
  label is preserved precisely because it carries
  methodologically-meaningful semantics that the DSM scenario
  suffix did not.
- **Don't remove the `is_base` flag from the data model.** The
  flag drives inheritance logic (`SlotDataViewer`, scenario
  management, default-fallback resolutions). Patch 4AB targets
  the **visual annotation**, not the underlying data.
- **Don't remove the standalone "Base" badge pills in
  scenario-management surfaces** (`<DSMScenariosChip>`,
  `<DSMScenarioChip>`, `<ScenarioManagerModal>`). Those are
  visually-discrete pills, not name-string suffixes; they
  legitimately surface the base's role in management contexts
  where the distinction is the point.

### Cascade-derived displays read from `draft`, not the DSM store (Patch 4AA)

The AESA cascade's source of truth is **`useAESAStore.draft`**.
Patch 4O established this explicitly: the cascade scenario dropdown
writes to `draft.dsm_scenario_id` and **DOES NOT** touch the DSM
store's `active_scenario_id` (the DSM Architect's notion of "active"
must stay independent — switching scenarios for AESA review must not
clobber the DSM page's own view state).

Any cascade-adjacent display string that incorporates the picked
scenario MUST derive from `draft.dsm_scenario_id` — NOT from
`useDSMStore.activeView?.scenarioId` or
`useDSMStore.systemState.active_scenario_id`. Pre-Patch-4AA the
`dsmScenarioName` memo skipped `draft.dsm_scenario_id` entirely and
went straight to the DSM store; the Background-option descriptions
("LCI: ... · DSM scenario: X · Parameters: Y") stayed pinned to the
DSM page's active scenario while the cascade dropdown showed a
different one. Compute was always correct (Patch 4O wired it through
`draft.dsm_scenario_id` from the start), so the bug was **cosmetic
display desync, not methodological compute drift** — but the
appearance of a decorative dropdown was confusing.

**Resolution chain** for `dsmScenarioName`:

```ts
const sid = draft?.dsm_scenario_id
  ?? activeView?.scenarioId
  ?? systemState.active_scenario_id
```

`draft.dsm_scenario_id` wins when the cascade has pinned a scenario;
`activeView`/`active_scenario_id` are backward-compat fallbacks for
pre-Patch-4O saved configs that carry `dsm_scenario_id = null` ("use
whatever's active when this draft is loaded").

#### What NOT to do

- **Don't derive any cascade-visible display from
  `useDSMStore.active_scenario_id` directly.** That slot is the DSM
  page's view state and is deliberately independent of the AESA
  cascade. Reading from it produces the cascade-vs-display desync
  Patch 4AA fixes.
- **Don't omit `draft.dsm_scenario_id` from the `useMemo` deps**
  when computing scenario-name strings. Even if the memo USES
  `draft?.dsm_scenario_id`, missing it from deps means React won't
  re-derive when the cascade changes — same observable bug.
- **Don't treat the DSM store's active flag as the AESA cascade's
  source of truth even for "convenience" displays.** Any path that
  ends in a user-visible scenario name MUST read through `draft`
  first. The DSM store's flag is for the DSM page; AESA has its
  own picker, its own state slot.
- **When implementing any new cascade-adjacent display** (LCI
  database name, parameter set, system name, anything scenario-
  conditional), audit its data source: does it read from `draft`
  or from a sibling store? If sibling, swap to `draft` before
  shipping. The single-source-of-truth rule generalises: anything
  the cascade visually represents must be a pure function of
  `draft`.
- **Compute payloads must always include `draft.dsm_scenario_id`
  verbatim** (or `null` to mean "use whatever's active server-
  side"). If a refactor ever derives compute's `dsm_scenario_id`
  field from anywhere OTHER than `draft.dsm_scenario_id`, this
  becomes methodological — not cosmetic — and the
  `aesaCascadeDescriptionReactivity` test's
  `body.config.dsm_scenario_id` assertion will catch it.

### Collapsed AESA sidebar fills the sticky area (Patch 4Z)

The expanded `<aside>` carries `maxHeight: 'calc(100vh - 96px)'`
(Patch 4V) so its internal body — which has `overflow: auto` —
engages scroll when content exceeds viewport height. The
**collapsed variant has no scrollable content** (just the expand
chevron and a rotated `"AESA CONFIGURATION"` label) so the
`maxHeight` clamp was wrong for it: the slim bar would visibly
truncate around the viewport's bottom-third, leaving a gap below.

Patch 4Z replaces `maxHeight` with `minHeight: 'calc(100vh - 96px)'`
on `collapsedStyle`. The bar's intrinsic content height is small,
but `minHeight` grows it to fill the sticky's available range —
the chevron + rotated label live at the top, the rest of the bar
is empty surface that visually extends to the bottom of the
viewport (and beyond as the page scrolls, thanks to the sticky
anchor).

#### What NOT to do

- **Don't carry the `maxHeight` clamp into the collapsed variant.**
  The clamp is for internal-scroll engagement on the expanded
  variant; collapsed has nothing to scroll. Symptom: bar truncates
  awkwardly mid-viewport.
- **Don't reach for `height: 100%` on the collapsed variant.**
  The parent flex container uses `alignItems: flex-start`
  (Patch 4V precondition for sticky), so `height: 100%` resolves
  against an `auto` parent height and becomes meaningless.
  `minHeight: 'calc(100vh - 96px)'` is the right unit — relative
  to the viewport, matching the sticky's anchoring frame.

### Header buttons: icon-only when universally recognizable, full-label when state-carrying (Patch 4Z)

The AESA top-right action row balances two rules:

- **Icon-only** for **universally-recognizable actions** where
  the icon alone communicates intent: Save (floppy), Export
  (download). The button's `title` and `aria-label` carry the
  text for hover tooltip + screen-reader use.
- **Full-label** for buttons that **surface state-carrying
  information** the icon can't convey. The Configurations
  dropdown shows `"Configurations (N) · {active config name}"`
  — the active configuration name IS the information. Reducing
  to icon-only would hide which configuration is loaded.

After Patch 4Z, the AESA header row reads (left to right):
`Save (icon) · Export (icon) ▾ · Configurations (N) · {name}`.

**Icon-only button geometry**: override the default `<Button>`
`padding: '0 16px'` (text-sized) with `padding: '0 10px'`
(square-ish for ~14px-icon buttons). The button height stays at
36px, the icon sits centered, the row looks compact.

**Split-button geometry for Export** (Patch 4Z + 4T): the
left `<Button>` overrides `borderRadius` to
`var(--radius-md) 0 0 var(--radius-md)` (rounded LEFT only);
the caret sibling already rounds the RIGHT only
(`0 var(--radius-md) var(--radius-md) 0`). The two visually join
into one pill. Both halves remain icon-only.

#### What NOT to do

- **Don't reduce all header buttons to icons reflexively for
  visual cleanliness.** Icon-only is right when (a) the action is
  universally recognizable AND (b) the button doesn't carry
  state-bearing information. The Configurations dropdown
  surfaces the active configuration name — reducing to icon
  loses that signal. Apply the rule selectively.
- **Don't drop `title` and `aria-label` from icon-only buttons.**
  Without them the action is invisible to hover discovery AND
  to assistive technology. Title carries the tooltip; aria-label
  is the SR-friendly version (sometimes more verbose).
- **Don't keep the Button's default `padding: '0 16px'`** on
  icon-only buttons. The horizontal padding is sized for text +
  icon; icon-only with text padding looks stretched and
  inconsistent with other compact icon affordances in the app.
- **Don't update text-content assertions in tests when a button
  goes icon-only without also adding title/aria-label
  assertions.** The button identity must remain testable — the
  text-content path is gone, but title + aria-label provide an
  equally stable selector.

### AESA method → PB mapping is exact-match only (Patch 4W)

`mapper.core.aesa_engine.suggest_method_mapping` maps LCIA method
tuples to Sala 2020 Planetary Boundaries by **exact case-insensitive
match against `method[1]`** against each PB's `ef_indicator` string.
The boundary set's `ef_indicator` strings (`mapper-backend/mapper/
data/aesa/boundary_sets.json`) are intentionally authored to match
BW2's `method[1]` directly:

- `climate_change.ef_indicator = "climate change"` ↔ aggregate method's `method[1] = "climate change"`
- `human_toxicity_non_cancer.ef_indicator = "human toxicity: non-carcinogenic"` ↔ method's `method[1] = "human toxicity: non-carcinogenic"`

Methods with no exact match are silently skipped — sub-component
methods (`"climate change: biogenic"`, `"climate change: fossil"`,
`"climate change: land use and land use change"`) have no
exact-match PB and are correctly excluded from PB
characterization. Sub-components are diagnostic decomposition for
Impact Assessment's per-stage breakdown, not sources for AESA SR
computation.

The PB mapping rule, by convention: **each AESA indicator points
at exactly one Impact Assessment method, and that method is the
EF v3.1 aggregate where applicable**. The auto-mapper enforces
this; manual overrides via `AESAConfiguration.method_mapping` can
break it (and the engine doesn't validate).

#### What NOT to do

- **Don't pull AESA values from EF v3.1 sub-component methods**
  (e.g. `("EF v3.1", "climate change: fossil", ...)`) when an
  aggregate exists. Sub-components are useful for diagnostic
  Impact Assessment breakdown but produce methodologically
  invalid AESA values when used in PB characterization. The Sala
  2020 framework defines one PB per category; characterizing it
  against a partial slice (one source) is invalid.
- **Don't use substring/token matching in `suggest_method_mapping`.**
  The pre-Patch-4W token-substring approach
  (`tok in label`, Python substring containment) produced two
  silent failure modes:
    1. Climate change aggregate + 3 sub-components all matched the
       single `climate_change` PB → 4 SR rows per
       (year, climate_change), frontend's `Map.set` keyed by
       (year, pb_id) silently kept the LAST one — users saw a
       sub-component's curve thinking it was the aggregate.
    2. `"carcinogenic" in "non-carcinogenic"` substring match
       cross-mapped non-cancer methods to the cancer PB; the
       non-cancer PB then surfaced as "1 method unmapped" while
       its impact was silently characterized against the wrong
       boundary.
  Exact match against `method[1]` is the only methodologically
  defensible auto-mapping rule.
- **Audit the PB mapping against the full EF v3.1 method set when
  adding new indicators or modifying mappings.** The "X methods
  unmapped" banner is a red flag — confirm each unmapped PB is
  deliberate (Sala 2020 doesn't define a PB for it) or a gap to
  fill. For EF v3.1 + Sala 2020, the audit should produce zero
  unmapped PBs.
- **When ALL PBs are unmapped** in a result that previously worked,
  suspect that the boundary set's `ef_indicator` strings drifted
  from BW2's `method[1]`. Recheck the `boundary_sets.json` file —
  it's the alignment surface; LCIA registries change over time
  (e.g. premise database updates) and exact match is sensitive to
  drift.
- **Existing user-saved AESAConfigurations may carry stale
  `method_mapping` lists** produced under a buggy auto-mapper.
  Loading such a config does NOT trigger re-suggestion; it uses
  the saved (potentially wrong) mapping. Surface this via the
  sidebar's "Re-suggest from impact methods" affordance — clicking
  it regenerates the mapping with the correct logic. Don't
  silently auto-migrate saved configs; that rewrites user data.

### AESA UX polish (Patch 4U)

Four conventions established by the polish patch on top of Patches
4O / 4Q / 4R / 4T:

**Cascade "no run cached" annotation suppressed in session mode.**
The Patch 4O cascade scenario `<select>` annotates each `<option>`
with `· no Static run` / `· no Prospective run` when the live
`useImpactStore` runs map lacks an entry for the scenario id. Saved
sessions (Patch 4R) write the result directly to
`useAESAStore.result` without populating the runs map — the live
maps stay empty even though the rendered AESA result is fully
populated. The cascade therefore reads the empty map and
erroneously concludes "no run cached." Fix: gate the badge on
`activeSessionId === null` (live mode only). In session mode the
session IS the result; the badge is methodologically irrelevant.

**Sidebar collapsibles.** AESA configuration sidebar splits into
**always-expanded** (Compute Source, Name, Planetary Boundary set —
frequently changed or small) and **collapsible** (Sharing preset,
Downscaling chain, Sharing principles, Category assignments, Carbon
budget, Method → PB mapping — infrequently changed once
configured). Collapsibles default closed; the title row carries a
one-line summary so users see the active values without expanding
("Ferhati 2026 Multi-D", "2 layers", "AGR (16/16)", "250 Gt · SSP2",
"16/16 mapped"). Per-session reset: every collapsible re-collapses
when `activeSessionId ?? activeConfigId` changes. The reset uses
the `useEffect([openKey])` pattern in `<CollapsibleSection>` —
loading session A then B doesn't carry A's expansion state into B.

**Numbered stage groups are collapsible too (Patch 5AX).** The two numbered
configuration groups — `1 LCIA configuration` and `2 AESA configuration
(carrying capacity)` (plus `3 Saved sessions`, same primitive) — are collapsible
via `<StageGroup>` using the SAME visibility-toggle convention: the numbered
header (badge + chevron, `aesa-stage-{n}-toggle`) toggles `open`; the body
(`aesa-stage-{n}-body`) hides with `display:none` and **stays mounted**. Default
**expanded** (these wrap the primary workflow; collapse is opt-in), each
independent (local `useState`). Do NOT conditional-unmount the body — that is
the same failure class as a control "vanishing" because an ancestor stopped
rendering it; every config control (the carbon-budget basis toggle included)
must remain in the DOM when its group is collapsed. Locked by
`tests/aesaStageGroupCollapse.test.tsx`.

> **The CO₂/CO₂-eq budget-basis toggle (`aesa-config-budget-basis`) lives inside
> the default-collapsed "Carbon budget" `CollapsibleSection`** — present in the
> DOM, reachable by expanding (deliberate, per the default-closed convention
> above; NOT a regression). `tests/aesaConfigBudgetBasis.test.tsx` guards its
> DOM presence under the live default budget (2°C/50, 1150 Gt, SSP1-2.6, CO₂-eq)
> on a fresh load with no compute, so it can't silently be removed from source.
> A `queryByTestId`/visibility-toggle gotcha: that guard asserts DOM presence,
> not on-screen visibility (a `display:none` collapsed ancestor still satisfies
> `queryByTestId`).

**Configurations move from inline pills to a top-right dropdown.**
Pre-Patch-4U the saved AESA configurations rendered as a row of
pills directly under the page header. As the user accumulated
configurations the row crowded the header and pushed the chart
slot down. Replaced with `<ConfigurationsDropdown>` next to "Save
session" / Export / "+ New configuration" in the header right.
Dropdown scales naturally to N configurations, shows the active
configuration name on the trigger button. Disabled in session-
loaded mode (consistent with pre-existing "+ New configuration"
gating).

**Two distinct save concerns, kept separate, labeled clearly.**
Footer save in the sidebar (`data-testid="aesa-save-config"`)
persists the **`AESAConfiguration`** template — the cascade +
sharing preset + method mapping the user names and reuses across
runs. Page-header "Save session" (`data-testid="aesa-save-session"`,
Patch 4R) persists an **`AESASession`** — a frozen snapshot of one
compute event (config snapshot + result + display filter +
upstream IA task id). These are different lifecycles (template
vs. historical record), different storage paths
(`STORAGE_DIR/{project}/{config_id}.json` vs
`.../sessions/{session_id}.json`). The two save buttons coexist
deliberately; the footer save's `title` and `aria-label` both
explicitly say "Save configuration template" so users don't
conflate them with the session save.

#### What NOT to do

- **Don't show "no run cached" annotations on the cascade in
  session mode OR in the all-empty live state.** The badge is
  comparative information ("this scenario has no run while others
  do"); it's only meaningful when SOME scenarios have runs and
  others don't. Three states, three behaviours (Patch 4W Issue 1):
    1. Session mode (`activeSessionId !== null`) → suppress (the
       session is self-contained; the live runs map is empty by
       design).
    2. Empty runs map in live mode (just-arrived state) →
       suppress (no scenario has a run; annotating EVERY scenario
       with "no run" is noise).
    3. Partial runs map (multi-DSM fan-out, some scenarios cached)
       → show the badge for missing scenarios (comparative info IS
       useful: "SSP1 has a cached run, SSP2 doesn't").
- **Don't merge the configuration save (footer) with the session
  save (header).** They serve different purposes: configurations
  are reusable input templates that users name and revisit;
  sessions are immutable historical records of one compute event.
  Two surfaces, two lifecycles, two storage paths. Merging them
  would force users to choose between "save my template" and
  "save this run" — both are valid, frequently-needed
  affordances. Keep both; clarify labels via `title` /
  `aria-label`.
- **Don't render saved configurations as inline pills** in the
  page header. The pill row pattern doesn't scale past ~3
  configurations — pills push wider with each new config and
  crowd both the title and other header buttons. Use the
  dropdown pattern (`<ConfigurationsDropdown>`); it scales to N
  configurations without changing the header's vertical rhythm.
- **Don't apply per-session reset via store-mutation effects on
  every collapsible.** The `useEffect([openKey])` pattern inside
  `<CollapsibleSection>` is the right shape — drive collapse from
  the `openKey` prop, let the helper own its own toggle state.
  Lifting collapse state into a store creates a shared mutable
  slot that every section has to coordinate writes against; the
  prop-driven local-state pattern keeps each section
  self-contained.
- **Don't leave Compute Source, Name, or Planetary Boundary set
  collapsible.** Compute Source is the cascade — users change
  scenarios between runs, hiding it adds clicks to the primary
  workflow. Name is two-character-wide; collapsing saves no
  space. Planetary Boundary set is small and load-bearing (the
  framework selection drives the entire compute). The
  collapsibles are for sections that are configured ONCE and
  rarely revisited — not for sections in the daily-use path.

### Page composition is the integration point — test it explicitly

Component-level tests don't substitute for integration tests on the
page that assembles them. A new component can ship with green unit
tests but not actually be visible in the running app — the
composition file (e.g. `AESADashboard.tsx`, `ImpactAssessment.tsx`,
`DSMDashboard.tsx`) is where missing imports, wrong conditional
gates, or rendering-order issues hide. Patches 4R + 4T shipped with
26 green unit tests apiece and a passing isolated `<ConfigSidebar>`
+ `<IndicatorDisplayFilter>` render — but a screenshot showed neither
"Save session" nor the filter chip in the running app. Root cause
in that case turned out to be dev-server cache (the components WERE
correctly composed in source), but the diagnostic gap was real:
unit tests couldn't have distinguished "components composed but
build-cache stale" from "components never composed at all."

The rule: **for any feature that ships across multiple files
(component + store + page integration), add at least one assertion
in the page-level render test that the component appears.** The
existing `tests/aesaDashboardIntegration.test.tsx` is the template
— renders the FULL `<AESADashboard>` against minimal store stubs
and asserts:

- "Save session" button present in live mode with a result
- "Return to live view" replaces it when a session is loaded
- `<IndicatorDisplayFilter>` renders ABOVE the view selector
  (DOM-order assertion via `compareDocumentPosition`)
- Split Export button + caret menu both render
- Empty filter state is reachable via store mutation

Mirror this pattern for new page-level integrations. **Manual
verification in the running app remains the final acceptance** —
HMR / browser cache / wrong tab open cases that automated tests
can't catch.

#### What NOT to do

- **Don't claim a feature shipped on the strength of unit tests
  alone.** Unit tests on `<NewComponent>` in isolation pass even if
  the parent page never imports it. Add a page-level assertion or
  manually click through the running app — ideally both.
- **Don't write a page-level integration test that stubs every
  child to a no-op.** That defeats the purpose: the bug class this
  test catches is "real child component never reached because
  parent forgot to import it." Stubs go on data sources (zustand
  state, API client, ResizeObserver), NOT on the components under
  composition test.
- **Don't conditional-mount entire panels behind a flag that no
  test covers.** If `{flag && <ComponentTree />}` exists in a page,
  there must be a render test that sets `flag = true` AND a render
  test that sets `flag = false` — both states are real user paths.
- **Don't drop the integration test when refactoring the page
  layout.** Locking down "Component X is in the DOM at position Y
  relative to Component Z" is the contract being asserted. Layout
  refactors that move the components are exactly when the
  assertion needs to keep firing.
