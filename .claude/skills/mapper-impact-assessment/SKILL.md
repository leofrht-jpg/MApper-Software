---
name: mapper-impact-assessment
description: "Impact Assessment (LCA/LCIA) module reference: calculation flow, result shapes, contracts. Use when changing impact assessment code, its routes, stores or tests."
---

## Impact Assessment

Two tabs, two distinct LCI sources:

- **Static Background** computes against the active project's base ecoinvent only — no IAM scenario axis. The source chip in `DSMImpactPanel.tsx` displays each coordinate with an explicit label (`LCI:`, `DSM scenario:`, `Parameters:`). Don't use bare `A × B` typography for non-SSP coordinates — it visually mimics the SSP × climate format on Prospective Background and invites misreading (a user-named DSM scenario "SSP1" would look like an IAM coordinate).
- **Prospective Background** runs against year-matched premise databases keyed by `(base_db, iam, ssp)`. The scenario picker reads from `usePLCAStore.databases` and groups by `(base_db, iam, ssp)`. The picker is a **multi-select chip dropdown** (Patch 2A) — picking N>1 LCI scenarios runs them sequentially under one task_id.

The Static tab does **not** gain a database selector. If we ever want a "fixed prospective LCI" mode (one premise DB applied uniformly across years, not year-matched), it goes in as a third mode — see Future Features. Don't redefine Static semantics to support it.

### Prospective temporal handling — block vs interpolate (Patch 6A)

Prospective per-year impact has two temporal modes, set by
`ImpactAssessmentRequest.temporal_mode ∈ {'block','interpolate'}`, **default
`'interpolate'`** (Stage 2; Prospective Background tab toggle,
`temporal-mode-block|interpolate`, initial state Interpolate):

- **`block`** (pre-interpolation behaviour, retained for reproducibility): each
  fleet year takes its nearest-earlier premise anchor db
  (`resolve_database_for_year`), held constant within the 5-year block → **step
  discontinuities** at each anchor (2030, 2035, …).
- **`interpolate`** (default): for a non-anchor year bracketed by anchors a<Y<b,
  solve the **SAME year-Y demand** against **both** db_a and db_b and **linearly
  blend the per-category scalar scores** by `frac=(Y−a)/(b−a)` → smooth
  piecewise-linear profile. Exact-anchor / clamped (before-first / after-last,
  **no extrapolation**) years do a **single** solve. `resolve_bracket`
  (`dsm_lca_engine.py`) returns the bracket; missing interior anchors bracket
  across the wider gap.

**Why this is rigorous, and the key gotcha:** the LCIA CFs are **year-invariant**
(EF v3.1 etc., static), so interpolating the scalar score == characterising an
interpolated inventory — a defensible piecewise-linear model. BUT the per-year
impact is **aggregate-then-solve** (one solve on the count-weighted year-Y demand
vs db(Y), attributed by mass share) — **NOT** per-unit. There is **no
per-unit-per-anchor score** to interpolate, so the cheap "~6 anchor solves" shape
does **not** apply; interpolation issues ~2 solves per bracket year (db_a + db_b).
**Score interpolation ≠ matrix blending** — we blend two scalar solves, not a
blended technosphere (the matrix inverse is nonlinear); that's intentional and is
the proposed methodology.

**Anchor-runner reuse (Patch 6B) — the speed fix.** A single
`PersistentLCARunner` caches ONE factorization; interpolation alternates db_a/db_b
year-to-year, and the other db's activities aren't in the cached `product_dict`,
so `redo_lci` raises and it **re-factorizes on every call** (thrashing → ~2
factorizations per bracket year, ~138 over 26 yr × 3 scopes, minutes). Fix:
`MultiDBPersistentRunner` (`bw2_wrapper.py`) routes each demand to a per-db
`PersistentLCARunner` (keyed by the demand's db-set), so **each anchor db
factorizes ONCE** and every later call to it is a back-substitution — interpolate
lands at/under block speed. Used **only** when projected + interpolate; block
keeps the single `PersistentLCARunner` (byte-identical, untouched). Scores are
byte-identical to the naive single-runner path (same per-db factorization math;
only the caching changes) — locked by the reuse==naive + factorize-once-per-db
tests.

**Progress counter (Patch 6B).** The unit counted is the **LCA solve**. Block:
`total = years × scopes × subsystems` (one solve each). Interpolate: bracket years
cost two solves, so the caller passes the exact solve count via
`_progress_runner(total_override=…)` and `simple_label=True` (the year/scope can't
be derived from a uniform divisor → the tick shows `solve n/total`). The counter
clamps `n ≤ total`, so the bar never overruns (the old block-count denominator
showed 98/78) and reaches 100% cleanly.

**Architecture:** the block path is unchanged and **byte-identical** — the
`_build_aggregated` / `_compute_year_scores` extraction in `DSMLCAPipeline` is
behaviour-preserving; `ProjectedDSMLCAPipeline._compute_year_scores` overrides only
the interpolate branch. `_flatten`/`_rewrite_db` take an explicit `db` so the
solve site can pin db_a / db_b. `meta.year_to_database`: block → year→single db
(unchanged); interpolate → bracket years carry `"interpolated between {db_a} and
{db_b}"` (the Year→Database panel renders the string as-is — no panel change). DSM
flows untouched; AESA SR timeline + impact charts smooth as a downstream
consequence. Contribution tree/sankey is a **separate** on-demand path
(`/api/lca/contribution`), not the per-year profile — out of scope. Locked by
`tests/test_prospective_temporal_interpolation.py` (bracket resolver; block step;
blend math; anchor/clamp single-solve; block==interpolate at anchors/clamps;
reuse==naive byte-identical + factorize-once-per-db).

**Shared prospective primitives — reuse, don't replicate (Stage B.1):** the interpolation blend is `blend_method_scores` (`mapper/core/dsm_lca_engine.py`), prospective-db resolution is `plca_storage.resolve_prospective_dbs(project, base_db, iam, ssp)`, and the single-product archetype source-demand build is `_build_archetype_source_demand` (`mapper/api/lca.py`) — both the system-level projected path and the single-product continuous-horizon trajectory endpoint (`POST /lca/calculate-archetype-trajectory`) call these same fns, so by construction the trajectory curve passes through the discrete single-db values at anchor years.

#### What NOT to do

- **Don't assume a per-unit-per-anchor "~6 solves" shape.** The compute is
  aggregate-then-solve; interpolation blends two scalar solves of the year-Y
  demand. Don't refactor to per-unit (that's the deferred Option B).
- **Don't extrapolate beyond the anchor range.** Before-first / after-last →
  clamp to the endpoint anchor (single solve), matching `resolve_database_for_year`.
- **Interpolate is the default (Stage 2); block is retained via the toggle for
  reproducibility.** The block path must stay byte-identical to pre-interpolation
  behaviour — don't "tidy" it. When adding a test that COMPUTES a projected
  result and expects stepped/block numbers, set `temporal_mode='block'`
  explicitly (the default is now interpolate).
- **Don't interpolate the contribution tree/sankey** under this patch — it's a
  separate endpoint; the profile scores are the target.

DSM scenario is selectable from the Configuration chip on both Static Background and Prospective Background tabs (`DSMScenarioChip` in `components/dsm/DSMScenarioChip.tsx`). Click the chip's DSM scenario coordinate to switch. Selection is per-tab — Static and Projected can compute against different DSM scenarios independently if the user chooses. Picking a scenario calls `dsmStore.simulate(scenarioId)` (no `activateScenario`), so the server-side `active_scenario_id` flag stays put — DSM Architect's notion of "active" is unaffected. Caveat: there is one shared `simulationResult` slot per system, so re-picking on one tab refreshes the sim consumed by the other; per-tab independence is a UX promise about selection state, not about backend caching. Default Impact Method is **EF v3.1** (with graceful fallback to the first available family if EF v3.1 isn't installed); default Scope is **Full lifecycle**.

### Multi-LCI-scenario projected runs (Patch 2A)

`POST /api/impact/calculate` accepts `lci_scenarios: list[ProspectiveScenarioRef]` on `ImpactAssessmentRequest`. Contract:

- `lci_scenarios` takes precedence over the legacy `scenario` (singular). The backend does `lci_scenarios = body.lci_scenarios or [body.scenario]` and 400s if neither is set.
- `len(lci_scenarios) == 1` collapses to **single-scenario semantics**: the response is the legacy `ImpactAssessmentResult` (no `result_type` field, equivalent to `"system_level"`). N=1 backward compat is non-negotiable — every existing single-scenario consumer (DSM mirror, AESA pipeline, Static-vs-Projected compare, single-scenario export) must keep working.
- `len(lci_scenarios) > 1` enters the **multi-scenario branch** which returns `MultiScenarioProjectedImpactResult` with `result_type: "multi_scenario_projected"`. Sequential per-scenario worker (`_calc_one_scenario`) inside `_run()`. Each scenario gets its own `PersistentLCARunner` (different technosphere matrix → different factorisation). Pct progress is sliced into `[pct_lo, pct_hi]` ranges so the multi-scenario progress bar advances smoothly. Cancellation is honoured at scenario boundaries AND inside each LCA call.

The discriminator `result_type` is the narrowing key on the frontend — `isMultiScenarioProjected()` in `client.ts` is the type guard. Treat the absence of the field as `"system_level"`. The WS `done` frame likewise carries `result_type: "multi_scenario_projected"` for multi runs (with `scenarios_calculated` instead of `methods_calculated`).

Pre-resolution: per-scenario prospective DB lookup happens **before** the worker thread spins up. Missing prospective DBs 400 fast on the request, not after wasting wall time on earlier scenarios.

Result cache: there isn't one. Each `POST /impact/calculate` allocates a fresh `task_id` under `mapper.api.impact._TASKS`. No disambiguation key changes were needed for Patch 2A — documented for the next person who reaches for "but doesn't this need a cache key bump?"

Cancellation: the multi-LCI loop registers ONE `task_id` and runs scenarios sequentially. `is_cancelled(task_id)` is checked (a) at every scenario boundary in `_run()` before calling `_calc_one_scenario`, AND (b) inside `_progress_runner` per (scope × year × method) iteration via the existing single-scenario checkpoint. Practically: a cancel arrives within seconds, never minutes — there's no "must finish the current scenario" gap. The N≤5 typical-usage caveat referenced elsewhere applies to parameter-scenario fan-out (`/impact/calculate-scenarios`, parallel tasks), not to multi-LCI (one task, sequential).

**Static vs Projected compare** (`POST /impact/compare`) refuses multi-scenario tasks with a 400 — comparison across N×N is meaningless without a UI to pick "which LCI scenario do you mean". Pick one scenario at a time when comparing.

**Excel export** routes through a sibling builder `_build_multi_scenario_workbook` (in `mapper/api/impact.py`) when `multi_result` is provided on `ImpactExportRequest`. The workbook has `LCI Scenario` as a leading column on every data sheet (Summary, Annual totals, By indicator) plus an `LCI Scenarios` index sheet. Per-cohort and contribution-style sheets are deliberately **omitted** in multi-LCI mode — re-run a single scenario to get those.

### What NOT to do

- Don't split the multi-scenario worker into N parallel tasks. The single-task-id sequential topology sidesteps the `POST returns → client opens WS` race that affects parameter-scenario fan-out (`/impact/calculate-scenarios`). One WS, one cancel button, deterministic ordering.
- Don't allow multi-LCI × multi-parameter sweep in the same request. The frontend errors out before launch with "Pick one parameter scenario or one LCI scenario." If you want N×M, ship the matrix UI first.
- Don't bolt LCI-scenario column onto `_build_mfa_lca_workbook` via conditionals. That builder targets single-scenario rich detail (9 sheets including cohort × material × contribution). The multi-scenario builder is a separate, narrower 4-sheet shape — refactor only if the two shapes start sharing real logic.
- **Don't trust tsc to catch declaration-order bugs in the impact panels.** When adding new state slots or memoized values to `DSMImpactPanel.tsx` / `ProjectedImpactPanel.tsx`, verify with a render test (not just tsc) — TypeScript does not catch temporal dead zone (TDZ) ordering issues, and the panels are dense enough (1000+ lines, dozens of `useMemo`/`useEffect` blocks) that hand-tracing declaration order is unreliable. A `useEffect` dep array referencing a `const` declared later in the render body throws `Cannot access 'X' before initialization` at runtime, blocking the entire panel from rendering. Run `npm run test:run` after panel changes — `tests/dsmImpactPanel.render.test.tsx` is the smoke catch.

### Multi-scenario chart rendering (Patch 2B)

When `projectedMultiResult.scenarios.length > 1`, the "Impact over time" chart
in `ProjectedImpactPanel.tsx` swaps to `<MultiScenarioImpactChart>`
(`components/charts/MultiScenarioImpactChart.tsx`). The single-scenario
`AreaChart` path stays in place for N=1 — backward compatibility, no toggle
visible.

**Two views**, exposed via a "Total / By cohort" button group above the chart:

- **Total** (default) — Recharts `LineChart` with one line per (base_db, iam,
  ssp) scenario, plotting `total_impact` per year. Custom tooltip lists all
  scenarios at the hover year sorted by value descending. Avoids the cohort ×
  scenario double-stacking problem.
- **By cohort** — pure-SVG small multiples drawn manually in a single root
  `<svg>` (so the existing chart-export pipeline captures the whole grid as
  one image). Each facet is one scenario's cohort-stacked area chart. All
  facets share Y-axis domain (`max(total_impact)` across scenarios) and X-axis
  (union of years). 2 columns × ⌈N/2⌉ rows.

**6-facet upper bound on faceted view**. If the user selects N > 6, faceted
view shows a banner "Faceted view supports up to 6 scenarios; showing first 6
of N" and renders only the first 6. Total view has no cap. Don't lift the
faceted cap — beyond 6 each cell becomes illegible at the panel width.

**Shared formatter rule**. Multi-chart panels (faceted small multiples,
overlaid lines + legend) use ONE `<NumberFormatControl>` driving all visible
charts. Per-chart formatters break cross-chart comparison. The component takes
the parent panel's `summaryFormat` and threads it into every facet.

**Scenario palette**: `SCENARIO_PALETTE` in `utils/chartColors.ts` — Okabe-Ito
colorblind-safe categorical, 7 colors. Deliberately distinct from
`CHART_PALETTE` (cohort colors) so a user mentally mapping colors across views
doesn't get false correspondences. Scenarios assigned by selection order
(modulo palette length); the chip multi-select order is the legend order — do
not auto-sort.

**Year-detail panels** ("Impact by cohort in {year}", "Material contribution")
intentionally remain single-scenario, driven by `selectedResult` =
`projectedResult.results[selectedResultIdx]` which Patch 2A pins to
`scenarios[0]`. Multi-scenario detail tables would be too dense to read; if
users need per-scenario detail, the Excel export's `LCI Scenario` column is
the answer.

**ChartExportButton scope**: one button per view, file suffix `_total` vs
`_facets` so a user exporting both can tell them apart.

**N=1 path is unchanged**. AESA, DSM-mirror, and Compare flows keep reading
`projectedResult` (= `scenarios[0].result` in multi-mode); none of them have
been adapted for multi-scenario reading yet, and the brief explicitly defers
that.

**Per-scenario line visibility — display filter (Patch 5O).** The Total view
supports toggling individual scenario lines on/off via a **clickable legend**
(same family as the AESA PB-indicator display filter, Patch 4T —
display/export only, never compute). Visibility is session-local `useState`
(`hidden: Set<label>`) inside `MultiScenarioImpactChart`; default all visible.
A toggle NEVER recomputes/refetches/changes the computed scenario set, and
NEVER recolors — color is resolved from the ORIGINAL index in `perScenario`
(`scenarioColor(idx)`), so hiding the middle scenario doesn't shift the
others' palette slots. The filter also drops hidden scenarios' facets in the
By-cohort view (FACET_MAX applies to the visible subset); all-hidden renders a
graceful empty state, not a broken chart. **Legend export = visible only**:
the visible entries live inside `legendRef` (what the native-SVG legend
exporter reads), while the greyed/struck toggle-back entries render in a
SIBLING outside `legendRef` — because `extractLegendItems` emits one item per
`legendRef` child and does not skip hidden rows. The chart export already
reflects visible lines (only visible `<Line>`s render). The YEAR DETAIL inset
is **single-scenario** (pinned to `scenarios[0]`, Patch 2B) and independent of
line visibility — no propagation needed. Locked by
`tests/multiScenarioVisibility.test.tsx`.

**Isolate-one-line for download + discoverability (Patch 5AE).** The 5O
mechanism (clickable legend + visible-only export) was intact; users just
couldn't tell the legend toggled lines. 5AE adds a controls row **OUTSIDE
`legendRef`** (so the visible-only legend export is untouched): a hint ("Click a
… to hide it — the download includes only visible …"), a per-visible-scenario
**Isolate** button (solos one = hides all others, for a single-line download),
and a **Show all** reset (when any hidden). Isolate buttons show only while >1
scenario is visible. Colors stay original-index stable through isolate/show-all
(soloed scenario keeps its slot). End state: the chart-image and legend exports
contain only the visible line(s). Locked by `tests/multiScenarioIsolate.test.tsx`.

#### What NOT to do

- **On the scenario impact chart, hidden lines are kept outside `legendRef` so
  the export emits only visible series — the download must honor the legend's
  visibility toggles and never export hidden lines.** The discoverability
  controls (hint / Isolate / Show all, Patch 5AE) live OUTSIDE `legendRef`;
  don't move them inside it or `extractLegendItems` would emit blank/extra
  legend rows. Don't recompute on toggle/isolate, and don't recolor (original
  `perScenario` index).

**System-level Prospective "Year → Database" is a default-collapsed
CollapsibleCard (Patch 5AE).** The per-year Year→Database mapping (a long list,
2025–2050) is wrapped in the shared `<CollapsibleCard>` with `expanded` defaulting
to **false** and an informative collapsed summary (year range · count, e.g.
"2025–2050 · 26 years"). Visibility-toggle body (state preserved); no mapping/data
change. Locked by `tests/yearDatabaseCollapsible.test.tsx`.

**Scenario impact ordering SSP1 > SSP2 > SSP5 (PkBudg1150) is EXPECTED — do
not re-investigate as a bug (Patch 5P diagnosis).** On Prospective Background
with a fixed fleet, the "Impact over time, total per scenario" lines can rank
SSP1-PkBudg1150 > SSP2 > SSP5-PkBudg1150 (SSP5 *lowest*). This looks
counterintuitive but is a faithful reflection of the audited premise/REMIND
databases, **not** a pipeline defect. It was diagnosed with evidence:

- **Pipeline is swap-proof.** Each scenario is computed against its own
  `(base_db, iam, ssp)`-matched, year-matched premise DBs
  (`_resolve_prospective_dbs` → `per_scenario_prospective[idx]`), with its own
  `PersistentLCARunner`; the result stamps `meta.scenario` + `meta.year_to_database`;
  the envelope pairs `ScenarioProjectedResult(scenario=sc, result=…for sc)`;
  the chart reads label and result from the SAME object
  (`ProjectedImpactPanel.tsx`: `s.scenario.iam/ssp` ↔ `s.result`). No
  label/color/DB decoupling exists.
- **Decisive evidence** — intrinsic per-kWh GWP of DK low-voltage electricity,
  queried directly from the premise DBs, ranks SSP1 > SSP2 > SSP5 at every
  year (2030: 0.110 / 0.095 / 0.072; 2040: 0.031 / 0.023 / 0.020; 2050:
  0.023 / 0.019 / 0.017 kg CO₂-eq/kWh) — matching the fleet ordering exactly.

Why expected: under the common stringent PkBudg1150 budget, SSP5 decarbonizes
the supply side aggressively from a higher baseline while SSP1 leans on demand
reduction, so SSP1's *per-unit* background intensity stays higher; a fixed
fleet's impact tracks that. The steppy curve shape is year-matched premise DB
vintages switching — also expected. **Never "fix" this ordering or adjust
numbers to make SSP5 > SSP1** — the databases are audited and the ordering is
correct.

**What NOT to do**:
- Don't apply Total view's color palette to cohorts (or vice versa). The
  separation is the whole point of having two palettes.
- Don't render the banner "Showing 1 of N scenarios" anywhere — it's obsolete
  as of Patch 2B since both views show all scenarios.
- Don't sort the legend by value. Selection order is the convention; sorting
  shifts colors when totals change, which is more confusing than helpful.
- Don't add per-facet `NumberFormatControl`s. Single shared formatter is the
  rule for any panel where cross-chart comparison is the point.
- **Don't recompute or recolor on a display-only visibility toggle (Patch
  5O).** A per-scenario series filter changes what's *shown and exported*, not
  the computed scenario set or the per-series colors. Resolve color from the
  scenario's original index (stable), not from its position in a filtered
  array. And to keep the legend export visible-only, the visible legend
  entries must be the `legendRef` children; put toggle-back (hidden) entries in
  a sibling outside the ref.

### Sensitivity-cases selector — canonical label + Static is Base-only (Patch 5AW)

Two conventions for the parameter-scenario (Base / Optimistic / Pessimistic …)
selector, superseding the Patch-2C placement:

- **Canonical display label is "Sensitivity cases" everywhere it renders.**
  Never "Scenarios" — that string collides with the **LCI Scenarios** picker on
  the Prospective tab and invites the misreading that a parameter case is an IAM
  coordinate. The Prospective system-level box (`ProjectedImpactPanel.tsx`,
  `projected-sensitivity-cases-label` testid) was relabelled "Scenarios" →
  "Sensitivity cases". Leave **"LCI SCENARIOS"** untouched (different axis).
- **The Static Background tabs do NOT expose the sensitivity-cases selector —
  static = Base only.** Static computes one base-ecoinvent run with no scenario
  variation, so the multi-select box was removed from the system-level Static
  panel (`DSMImpactPanel.tsx`) and the single-product Static panel
  (`SingleProductStaticPanel.tsx`). After removal, static compute still resolves
  on Base: `selectedParamSetId = BASE_SCENARIO` and `effectiveSelected = []`
  (no fan-out branch), byte-equivalent to the pre-removal N=1 default. The
  parameter (sensitivity) axis lives on the **Prospective** tab only.
- **The AESA sharing-principle sweep is "Sharing sensitivity" — a DIFFERENT
  axis, and the two labels must stay distinct (Patch 5AS).** The toggle in the
  AESA Configuration header (`aesa-run-sensitivity-toggle`, `runSensitivity` →
  `run_sensitivity`) makes Compute ALSO evaluate the Sustainability Ratio under
  each uniform sharing principle (EpC, IN, AGR, LA, AR) — the spread the
  box-plot view draws. It varies the **sharing principle**, not parameter
  cases. It was previously an unlabelled checkbox + "σ" glyph, whose accessible
  name was literally "σ"; the obvious replacement, "Sensitivity analysis",
  would have reintroduced one axis over exactly the collision the "Scenarios" →
  "Sensitivity cases" rename removed — a user who has just picked
  Base/Optimistic/Pessimistic on Impact Assessment reads a bare "Sensitivity …"
  on the next tab as the same axis carried forward. **Name the axis, not the
  technique.** Three distinct axis labels, none interchangeable: **LCI
  Scenarios** (IAM/SSP background), **Sensitivity cases** (parameter values),
  **Sharing sensitivity** (AESA sharing principles). Locked by
  `tests/aesaSensitivityToggleLabel.test.tsx`, which asserts the label contains
  "sharing" and does NOT match `/sensitivity (analysis|cases)/i`.
- Locked by `tests/impactSensitivityCasesLabel.test.tsx` (Static renders no box;
  Prospective label is "Sensitivity cases").

The historical Patch-2C fan-out plumbing below is retained for the **Prospective**
axis; only the Static placement + the label string changed.

### Multi-parameter sensitivity fan-out on Static Background (Patch 2C)

The Static Background tab now mirrors Projected's multi-select pattern for the
**Sensitivity case** axis. The previous single `<select>` is replaced by a
checklist of parameter scenarios (Base + user-defined sets), driven by the
shared `useParameterStore.selectedScenarios` / `toggleSelectedScenario` state.

- **N=1** (default — typically `[BASE_SCENARIO]`): unchanged. `useDSMStore.runDSMLCA(...)` runs single-scenario; results land in `dsmLCAResults`; the Static mirror via `setStaticFromMFA` continues to work.
- **N>1**: branches to `useImpactStore.runScenarios(payload, selected)` with `mode: 'static'`. The orchestrator (`POST /api/impact/calculate-scenarios`) fans out one task per scenario name; `runScenarios` in the impact store populates the **static slot** (`staticScenarioOrder`, `staticScenarioRuns`, `activeStaticScenario`). Each spawned task carries `mode='static'` end-to-end — verified by `tests/test_impact_multi_scenario.py::test_calculate_scenarios_static_mode_preserves_mode_per_task`.

`displayResults` in `DSMImpactPanel.tsx` switches source based on N: it reads from `staticScenarioRuns[activeStaticScenario].result.results` when N>1 and from `dsmLCAResults` otherwise. A scenario tab bar (mirrors Projected's pattern, uses `--mod-lca` accent) sits before the Results card and lets the user switch active scenario.

### 3-way axis-conflict rule (Patch 2C)

Multi-scenario fan-out is only allowed on **one axis at a time**. The rule is symmetric across both panels (`DSMImpactPanel.tsx`, `ProjectedImpactPanel.tsx`):

```
const lciAxisN   = projected ? selectedScenarioObjs.length : 1
const dsmAxisN   = 1   // pinned until multi-DSM ships
const paramAxisN = effectiveSelected.length
const axisConflict =
  [lciAxisN > 1, dsmAxisN > 1, paramAxisN > 1].filter(Boolean).length > 1
```

When `axisConflict` is true, the Calculate button is disabled and the panel shows a banner: *"Cannot run multiple axes (LCI × DSM × Parameter) simultaneously. Pick one axis at a time."*

Today only the **LCI × Parameter** combination can actually fire (DSM axis pinned to 1). Keeping the rule expressed as a count of axes >1 means it'll pick up multi-DSM automatically when that axis ships — no rewrite needed. The user-facing message names all three axes deliberately so users understand the constraint applies regardless of which two are picked.

**Multi-DSM-scenario fan-out backend ships in Patch 2E.1; frontend wiring is Patch 2E.2.** Backend contract surfaces are live now: `ImpactAssessmentRequest.dsm_scenario_id` (singular, in-task), `ImpactAssessmentRequest.dsm_scenario_ids` (list, fan-out), `MultiDSMImpactResult` envelope schema, and `/impact/calculate-scenarios` extended to spawn one task per DSM scenario id. Frontend still pins `dsmAxisN = 1`. When 2E.2 lands, lift `dsmAxisN` to read from a DSM scenario multi-select; the rest of the rule + branch already accommodates it.

### Multi-parameter Excel export (Patch 2D)

`_build_multi_param_workbook` in `mapper/api/impact.py` is the sibling builder
to `_build_multi_scenario_workbook`. It targets multi-parameter fan-out runs
(both Static and Projected), which spawn N parallel single-scenario tasks
under `/impact/calculate-scenarios` rather than returning one envelope under
one task_id.

**Discriminator column**: `Sensitivity case` — matches the UI label
(`Sensitivity cases` checklist, `Sensitivity case` chip coord). Naming drift
between UI and exports is an unforced error; the column header is the same
string the user sees in-app.

**Sheet inventory** (4 sheets, mirrors multi-LCI minus the LCI-specific
index):
- `Summary` — meta block + `(Sensitivity case × Indicator)` rows with
  cumulative impact, peak year, peak impact.
- `Annual totals` — `Year`, `Sensitivity case`, then one column per indicator.
- `By indicator` — `Year`, `Sensitivity case`, then triplets per indicator
  (Annual / Cumulative / YoY %).
- `Parameter Scenarios` — index. Lists **only parameters whose values vary**
  across the selected scenarios — invariants are dropped because they don't
  distinguish anything. Parameter ordering follows
  `ParameterTable.parameters` insertion order (deterministic, preserves any
  user-meaningful grouping; alpha-sort would erase that). When no parameters
  vary (or no table is loaded), the sheet renders a stub with the scenario
  list and a one-line note explaining the invariance.

**Input shape**: the frontend assembles a `MultiParamImpactResult` envelope
client-side from the per-scenario task results and POSTs it to
`/impact/export`. There is no backend `task_id` for the envelope — the
backend resolves the project's `ParameterTable` server-side to compute the
varying-parameter columns.

**Filename**:
`MApper_Impact_MultiParam_<system>_<scope>_<date>.xlsx` (mirrors multi-LCI's
`MApper_Impact_MultiLCI_...` so a downloads folder distinguishes the two at
a glance).

**Per-cohort and contribution-style sheets are deliberately omitted** in the
multi-param export to keep the file readable. Re-run a single scenario for
that detail — the legacy 9-sheet workbook still produces it.

**Mutual exclusion**: `multi_param_result` and `multi_result` cannot both
be set on `ImpactExportRequest`. The 3-way axisConflict rule on the
frontend prevents the combination from running, but the route 400s server-
side as defence in depth.

### What NOT to do

- **Don't bolt a `Sensitivity case` column onto `_build_multi_scenario_workbook`** — that builder targets the multi-LCI envelope (`MultiScenarioProjectedImpactResult`), not a flat list of single-scenario results keyed by parameter set. Different shapes; keep the builders narrow.
- **Don't ship a multi-LCI × multi-parameter combined export.** The 3-way axisConflict rule prevents this combination from running upstream, so the export doesn't need to handle it. If we ever ship a matrix UI for N×M, the workbook design becomes its own design problem (likely a third sibling builder, not a conditional on either existing one).
- **Don't include parameters that don't vary** in the Parameter Scenarios index. A column where every row reads `1.5` is visual noise — the index exists to *distinguish* scenarios. The varying-only filter happens server-side in `_resolve_varying_parameters`.
- **Don't sort the index by parameter name.** `ParameterTable.parameters` insertion order may carry user-meaningful grouping (e.g. category or input order); alpha-sort would erase that. Insertion order is the convention.

### Multi-DSM-scenario fan-out — backend (Patch 2E.1)

Multi-DSM is the third axis of the 3-way axisConflict rule. Patch 2E.1 ships
the **backend half** end-to-end (request schema, simulate-fresh-per-task
plumbing, fan-out orchestrator, envelope schema, server-side axisConflict).
The frontend chip + chart wiring is Patch 2E.2; the Excel builder is 2E.3.
Until 2E.2 lands, the field is reachable only via direct API calls.

**Request surface** — two new fields on `ImpactAssessmentRequest`:

- `dsm_scenario_id: str | None` — singular, in-task. When set,
  `post_calculate` resolves the scenario via `dsm.simulate_for_scenario`
  and runs the pipeline against that fresh sim (instead of reading the
  cached active-scenario sim from `_proj_results`). When unset (default),
  the cached-sim path is used — backward compat preserved for every
  existing single-scenario caller.
- `dsm_scenario_ids: list[str] | None` — fan-out. Consumed by
  `/impact/calculate-scenarios` to spawn one task per id, threading each
  into the spawned per-task body via `dsm_scenario_id`.

**Fresh simulate per task, not cached.** `simulate_for_scenario(system_id,
scenario_id)` in `mapper/api/dsm.py` is a pure helper that materializes the
scenario via `materialize_scenario` and runs `DynamicStockModel.simulate()`
**without** writing to `_proj_results` or persisted storage. This lets
multi-DSM impact runs compute against arbitrary scenarios without
clobbering what the DSM Dashboard considers "active" (the
`active_scenario_id` flag is untouched). DSM sim is sub-3s in practice, so
running it once per impact task is acceptable cost; if it ever becomes a
bottleneck, add a per-(system, scenario) sim cache keyed off scenario
content hash — but don't reach for the singleton `_proj_results` slot.

**Meta echo.** `ImpactAssessmentMeta.dsm_scenario_id` is stamped on every
per-task result so the frontend can tag tabs and the Excel builder (Patch
2E.3) can label rows. Defaults to `None` for backward compat — Pydantic
accepts old-shape responses unchanged.

**Envelope** — `MultiDSMImpactResult`:

```python
result_type: Literal["multi_dsm"] = "multi_dsm"
meta: ImpactAssessmentMeta
scenarios: list[DSMScenarioImpactResult]   # scenario_id, scenario_name, result
elapsed_seconds: float | None = None
```

Frontend-assembled (mirrors `MultiParamImpactResult`'s topology), not
backend-emitted. Each `DSMScenarioImpactResult` carries both `scenario_id`
(stable id) AND `scenario_name` (human-readable label, echoed from
`DSMScenario.name` at fan-out time) so the envelope is self-contained for
downstream consumers without round-tripping back to the DSM state.

**Orchestrator branch.** `/impact/calculate-scenarios` now branches on
which axis is set:

```
if scenarios AND dsm_scenario_ids → 400 axisConflict
elif dsm_scenario_ids             → fan out by DSM, spawn per-id tasks
else                               → fan out by parameter (legacy path)
```

The per-task body for the DSM branch sets `dsm_scenario_id` (singular) and
clears `dsm_scenario_ids` (list) so the spawned worker doesn't recurse into
another fan-out. Acceptance: see
`tests/test_impact_multi_dsm.py::test_calculate_scenarios_dsm_axis_fans_out_per_id`.

**Export route guard.** `multi_dsm_result` is accepted on
`ImpactExportRequest`. As of Patch 2E.3 the workbook builder is wired in;
posting a lone `multi_dsm_result` returns a real
`MApper_Impact_MultiDSM_<system>_<scope>_<date>.xlsx`. The
defence-in-depth axisConflict guard still applies: 400 if
multi_dsm + multi_param or multi_dsm + multi_lci are set together.

#### What NOT to do

- **Don't write `simulate_for_scenario` results into `_proj_results`.** That
  slot is the canonical "active scenario sim" used by the DSM Dashboard,
  Static-LCI mirror, and AESA pipeline. Multi-DSM impact runs must not
  clobber it — they're a parallel computation, not a re-activation.
- **Don't read `body.dsm_scenario_id` and ALSO read `_proj_results` in the
  same code path.** They're two different sources of truth: one is "this
  request's scenario", the other is "the system's active scenario". The
  branch is at the top of `post_calculate` — keep them mutually exclusive.
- **Don't cache the simulate result by `system_id` alone.** If we add a
  cache, the key must include the DSM scenario id (and ideally a content
  hash of the materialized state) so swapping scenarios doesn't serve
  stale data. The naive `_proj_results[system_id]` shape is single-slot
  and would silently mask scenario differences.
- **Don't emit a multi-DSM envelope from a single backend task.** Unlike
  multi-LCI (one task, sequential scenarios), multi-DSM follows the
  multi-parameter pattern: N parallel tasks under
  `/impact/calculate-scenarios`, frontend assembles the envelope
  client-side. Keeping the topologies parallel between multi-DSM and
  multi-parameter means one set of UI patterns covers both axes.
- **Don't drop the singular `dsm_scenario_id` field in favour of always
  using the list.** The singular field is the in-task contract; the list
  is the orchestrator-only fan-out surface. Conflating them would force
  every backward-compat caller to rewrite, and the singular form is what
  `meta.dsm_scenario_id` echoes back.

### Multi-DSM-scenario fan-out — frontend (Patch 2E.2)

Frontend half of multi-DSM. Both `DSMImpactPanel.tsx` (Static Background tab) and
`ProjectedImpactPanel.tsx` (Prospective Background tab) now expose a multi-select
DSM scenario chip via `<DSMScenariosChip>` (sibling to the existing LCI
`<ScenarioChip>` multi-select). With Patch 2E.2 the third axis of the
3-way axisConflict rule is live end-to-end — the rule itself was already
written generically in Patch 2C, so no rewrite was needed; just lifting
`dsmAxisN` from the new selection state.

**Store slot.** `useImpactStore` gained four multi-DSM fields paralleling
the multi-parameter slot: `dsmScenarioOrder: string[]`,
`dsmScenarioRuns: Record<sid, ScenarioRun & {scenarioName}>`,
`activeDsmScenario: string | null`, and
`dsmScenarioMode: 'static' | 'projected' | null`. The mode field is the
bridge that tells the per-tab display state (`staticJob/Result` or
`projectedJob/Result`) which slot to mirror the active scenario to —
without it, the same multi-DSM run would render in both tabs.

**Calculate-time branch order** (in both panels): multi-DSM →
multi-Param → single. axisConflict prevents multi-DSM × multi-Param × N>1
combinations from reaching this branch at all.

- N=1 (single DSM scenario, default) keeps the legacy single-task path:
  `useDSMStore.runDSMLCA` / `useImpactStore.run` with the singular
  `dsm_scenario_id` threaded through. The active-scenario `_proj_results`
  cache continues to be used.
- N>1 (DSM fan-out) calls `useImpactStore.runDSMScenarios(body, ids,
  names)` which posts `dsm_scenario_ids` to `/impact/calculate-scenarios`,
  spawns N parallel tasks (one per DSM scenario), populates the multi-DSM
  slot, and bridges scenario `[0]` to the per-tab display state. Each
  spawned task uses its own fresh `simulate_for_scenario` (Patch 2E.1) so
  the active-scenario sim cache is never clobbered.

**Generalized chart prop boundary.** `<MultiScenarioImpactChart>` no
longer hard-codes `LCIScenarioRef`; its prop is now
`scenarios: Array<{label: string, result: ImpactAssessmentResult}>` plus
`axisLabel?: string` (defaults to `'scenarios'`). Same component now
serves both multi-LCI (axis label "LCI scenarios") and multi-DSM (axis
label "DSM scenarios"), with the headline `{N} {axisLabel}` and the
6-facet banner adopting the axis name. When multi-DSM and multi-LCI both
ship results, multi-DSM wins the chart slot (multi-LCI is
projected-only).

**axisConflict helper.** The inline rule in both panels now flows through
`evaluateAxisConflict` in `src/utils/axisConflict.ts`. Pure function,
single source of truth, covered by `tests/axisConflict.test.ts` (9
cases: all single-axis allowances, three pairwise conflicts, three-way
conflict, N=0 boundary). This is also the **first vitest landing** — the
runner was scaffolded in 2E prep but had no test file until now.

**Scenario tab bar.** Multi-DSM uses the same tab bar pattern as
multi-Param (Patch 2C) — sits above the Results card, lets the user
switch the active DSM scenario for detail panels (year breakdown, top
materials). Accent color is `--mod-dsm` (red) to distinguish from the
LCI multi-select pill.

**Excel export wiring.** Both panels post `multi_dsm_result` envelopes to
`/api/impact/export` when `dsmScenarioOrder.length > 1`. The backend route
currently 501s for `multi_dsm_result` (Patch 2E.3 ships the workbook
builder); the frontend wiring is in place so the route's contract is
exercisable end-to-end as soon as the builder lands.

#### What NOT to do

- **Don't bypass `dsmScenarioMode` and write to both per-tab slots
  directly.** The mode-based bridge exists because Static Background and
  Prospective Background display states are independent — a multi-DSM run on
  Static must not silently render results on Projected (or vice versa).
  The mode field is set when `runDSMScenarios` is called; clear it on
  reset.
- **Don't drop the multi-DSM-wins precedence in the chart slot.** When
  N>1 DSM scenarios complete on the Projected tab and the LCI axis is
  also non-trivial (still N=1 in valid cases), multi-DSM is the more
  informative axis for the chart. Multi-LCI × multi-DSM is blocked
  upstream by axisConflict.
- **Don't regress the LCI `axisLabel` to bare "scenarios".** The
  generalized chart now ships in two contexts; the labelled noun is
  load-bearing for tooltip and headline disambiguation.
- **Don't add per-DSM-scenario detail panels** (year breakdown × scenario
  matrix). Year-detail UI stays single-scenario, driven by the active
  DSM scenario via the tab bar — same convention as multi-LCI's
  single-result-pinned year detail. Multi-scenario detail tables become
  illegible past 3-4 scenarios; the Excel export's Scenario column is
  the answer.

### Multi-DSM-scenario fan-out — Excel export (Patch 2E.3)

`_build_multi_dsm_workbook` in `mapper/api/impact.py` is the third
sibling builder, completing the multi-DSM end-to-end path. Targets
multi-DSM fan-out runs (Static OR Projected mode), which spawn N
parallel single-scenario tasks under `/impact/calculate-scenarios` and
are assembled into a `MultiDSMImpactResult` envelope frontend-side
before posting to `/impact/export`.

**Discriminator column**: `DSM scenario` — matches the UI chip label
(`DSMScenariosChip`, scenario tab bar). Naming drift between UI and
exports is an unforced error; the column header is the same string the
user sees in-app.

**Sheet inventory** (4 sheets, parallel to multi-param):
- `Summary` — meta block + `(DSM scenario × Indicator)` rows with
  cumulative impact, peak year, peak impact.
- `Annual totals` — `Year`, `DSM scenario`, then one column per indicator.
- `By indicator` — `Year`, `DSM scenario`, then triplets per indicator
  (Annual / Cumulative / YoY %).
- `DSM Scenarios` — index. **Per-scenario simulation summary stats**
  derived from `count_by_cohort` in the impact result: first-year fleet,
  last-year fleet, peak year + count, distinct cohorts active. No
  re-simulation needed — the data is already in the envelope.

**Why summary stats, not a varying-parameter filter.** Multi-param's
index uses `_resolve_varying_parameters` because parameters have a flat
numeric `(name → value)` shape. **DSM scenarios are structurally
opaque** — each `DSMScenario` carries 6 nested data slots
(`initial_stock` dict, `inflows`/`stock_targets`/`outflows`/`mode_configs`/
`scaling_rules` lists), all complex nested structures. There is no flat
parameter table to varying-filter. The fallback is to surface what
*actually differed* across scenarios in their simulation output, which
is the most informative thing the export can say without re-running
sims at export time.

**Empty-results stub**. If every selected DSM scenario produced no
per-year data (e.g. user exported a stale envelope), the index sheet
emits a stub note rather than rendering an empty header. Symmetrical
with the multi-param "no varying parameters" stub.

**Filename**: `MApper_Impact_MultiDSM_<system>_<scope>_<date>.xlsx` —
parallels `MApper_Impact_MultiLCI_*` and `MApper_Impact_MultiParam_*`
so a downloads folder distinguishes all three multi-axis exports at a
glance.

**Per-cohort and contribution-style sheets are deliberately omitted**
in the multi-DSM export to keep the file readable. Re-run a single DSM
scenario for that detail (the legacy 9-sheet workbook still produces
it).

**Mutual exclusion**: `multi_dsm_result` cannot be combined with
`multi_param_result` or `multi_result` on `ImpactExportRequest`. The
3-way axisConflict rule on the frontend prevents the combination from
running, but the route 400s server-side as defence in depth (covered by
`tests/test_impact_multi_dsm_export.py::
test_export_rejects_multi_dsm_with_multi_param` and `..._with_multi_lci`).

#### What NOT to do

- **Don't bolt a `DSM scenario` column onto `_build_multi_param_workbook`
  via conditionals.** Three sibling builders, three narrow shapes — the
  duplication is small enough not to warrant a conditional fan-out, and
  conditionals would couple the builders. Refactor only when a fourth
  axis ships.
- **Don't re-simulate at export time to enrich the index sheet.**
  `_dsm_scenario_summary_stats` derives everything from
  `count_by_cohort` already present in the impact result. Calling
  `simulate_for_scenario` per scenario at export time would add
  seconds-per-scenario latency and risks divergence if anything changed
  between calculate and export.
- **Don't try to flatten DSM scenarios into a varying-parameter table.**
  The slots aren't flat — `inflows` is a list of cohort-keyed yearly
  rows, `mode_configs` is a list of typed config objects. Any flattening
  would either be lossy or produce a column explosion that defeats the
  purpose of an index sheet.
- **Don't ship a multi-LCI × multi-DSM combined export** (cartesian
  product). The 3-way axisConflict rule prevents this combination from
  running upstream. If we ever ship a matrix UI for N×M, the workbook
  design becomes its own design problem (likely a fourth sibling
  builder, not a conditional on any existing one).

### Paired DSM × LCI co-variation (Patch 2F)

The fourth axis. Independent multi-axis fan-out runs N tasks varying ONE
dimension (LCI, DSM, or Parameter); paired runs N tasks varying TWO
dimensions in lockstep — one (DSM scenario × LCI scenario) pair per task.
Each pair represents one coherent SSP-N future (e.g. a "SSP1" DSM
trajectory paired with the REMIND/SSP1 LCI database). Pairs are 1:1, not
Cartesian: 3 pairs = 3 tasks, never 9.

**Backend topology** (Patch 2F.1) parallels the multi-DSM and
multi-parameter pattern: N parallel tasks under
`/impact/calculate-scenarios`, frontend assembles the envelope
client-side. Request surface on `ImpactAssessmentRequest`:
`paired_scenarios: list[PairedDSMLCIRef] | None`, where
`PairedDSMLCIRef = {dsm_scenario_id: str, lci_scenario:
ProspectiveScenarioRef}`. Orchestrator pre-validates pair-key uniqueness
in a first pass *before* spawning any task — the duplicate check has to
run before iteration so a duplicate doesn't race with a 404 on missing
system. Pair key format is the deterministic
`<dsm_scenario_id>::<base_db>::<iam>::<ssp>` and serves as the assignment
map key in the `{scenarios: {pair_key: task_id}}` response.

**Mode is always `projected`.** Paired co-variation requires a
prospective LCI on each pair, so the frontend forces `mode: 'projected'`
in the payload regardless of which tab the user clicked from. (In
practice the UI is gated to the Prospective Background tab anyway.)

**Frontend store slot** (Patch 2F.2): `pairedScenarioOrder: string[]`,
`pairedScenarioRuns: Record<pairKey, ScenarioRun & {dsmScenarioId,
dsmScenarioName, lciScenario}>`, `activePairedScenario: string | null`.
The paired bridge is to `projectedJob/Result` (paired is projected-only).
Mutually exclusive with the multi-DSM slot — `runPairedScenarios` clears
`dsmScenarioOrder/Runs/Active/Mode` on launch.

**axisConflict generalised to 4 axes.** `evaluateAxisConflict` in
`utils/axisConflict.ts` now takes an optional `paired?: number` count;
`AxisName = 'LCI' | 'DSM' | 'Parameter' | 'Paired'`. The rule is still
"at most one axis with N>1"; symmetric across all four, so adding a
fifth axis later won't require a rewrite. In paired mode the panel
collapses LCI/DSM/parameter selections to N=1 for conflict purposes — the
pair list IS the axis.

**UI surface** in `ProjectedImpactPanel.tsx`:
- Mode toggle (Independent / Paired DSM × LCI) at the top of the
  Configuration card.
- `<PairListEditor>` replaces the LCI Scenarios row + DSM coordinate
  chip in paired mode. Each row: [DSM scenario ▾] × [LCI scenario ▾]
  [Remove]. Add row + Auto-pair-by-SSP buttons below.
- **Auto-pair-by-SSP** matches DSM scenario names containing `SSP[1-5]`
  with LCI scenarios whose `ssp` field includes the same token. Disabled
  with explanatory tooltip ("No matching SSP names…") when no DSM
  scenario carries an SSP token. Opt-in convention — users naming their
  DSM scenarios with SSP prefix get the affordance for free; everyone
  else builds pairs row-by-row.
- Parameter sensitivity chips disabled in paired mode (cannot vary two
  axes); inline "Disabled in paired mode" note.
- Inline duplicate detection on the pair list — a duplicate row is
  highlighted red and a banner blocks Calculate.
- Paired tab bar above the chart slot mirrors the multi-DSM tab bar
  (Patch 2E.2 pattern); pair short label `<dsmName> × <iam>/<ssp>`.
- Chart slot: `<MultiScenarioImpactChart>` reused with
  `axisLabel="paired scenarios"`. Paired branch wins precedence over
  multi-DSM and multi-LCI (mutually exclusive by axisConflict).

**Excel export** routes through `_build_multi_paired_workbook` (Patch
2F.1, in `mapper/api/impact.py`). Discriminator column on every data
sheet is `Pair`, displaying the full pair label
(`<dsmName> stock × <base_db>/<iam>/<ssp>`). Filename pattern
`MApper_Impact_MultiPaired_<system>_<scope>_<date>.xlsx`. Sibling
builder; do NOT bolt onto multi-DSM or multi-param via conditionals.

**Comparison tab compatibility** (Patch 2F.2): when paired projected and
multi-DSM static are both loaded, the Comparison tab intersects the two
axes by DSM scenario id and shows a DSM-scenario tab bar over the
existing comparison charts. Each tab swaps both `staticResult` (via
`selectDsmScenario`) and `projectedResult` (via `selectPairedScenario`)
to keep the comparison aligned. Empty intersection or single static
shows an EmptyState pointing the user at the right action.

#### What NOT to do

- **Don't add a multi-LCI × paired matrix UI.** The whole point of
  paired is that LCI varies *with* DSM, not *over* DSM. A separate
  multi-LCI selector in paired mode would invite confusion. If a future
  workflow needs LCI-on-top-of-paired (e.g. comparing two policy
  scenarios per pair), the design problem is its own — likely a fifth
  axis or an explicit Cartesian-product UI, not a layered pair list.
- **Don't make Auto-pair-by-SSP the default behaviour.** It's a
  convenience for the SSP-naming convention; defaulting to it would
  silently skip pairs the user expected. Always require an explicit
  click. The disabled tooltip is the contract — if it's disabled, the
  user knows why and how to enable it.
- **Don't share the multi-DSM store slot for paired.** Paired carries a
  fused (dsm_scenario_id + lci_scenario) per task; the multi-DSM slot
  only carries `dsm_scenario_id`. Folding them would force every paired
  consumer to look up the LCI scenario externally, breaking the
  self-contained envelope contract.
- **Don't auto-resolve pair keys on the frontend** by hashing the pair
  contents. The deterministic
  `<dsm_scenario_id>::<base_db>::<iam>::<ssp>` format is shared with the
  backend orchestrator and the export Excel; reinventing it on the
  frontend is an invitation to drift.
- **Don't validate pair lists in `runPairedScenarios`** beyond what the
  backend already does. Both the frontend (inline duplicate detection,
  preflight) and the backend (pre-validation in
  `post_calculate_scenarios`) check; trying to push more checks into the
  store action duplicates logic and slows the path. Keep the store
  action a thin POST + WS-fan-out.

### Comparison tab DSM-scenario intersection (Patch 2G)

Generalises the Patch 2F.2 paired-Comparison shim into a symmetric
intersection over both per-side multi-DSM runs. Two cases produce a
DSM-scenario tab bar above Comparison's Cumulative Difference chart:

(a) **multi-DSM Static × multi-DSM Projected**: intersect the two
per-side ordered lists; tab click swaps both sides via
`selectStaticDsmScenario(id)` + `selectProjectedDsmScenario(id)`.

(b) **paired Projected × multi-DSM Static** (legacy 2F.2): intersect
paired DSM ids with Static-side DSM ids; tab click swaps Static via
`selectStaticDsmScenario` and Projected via `selectPairedScenario`.

The DSM scenario id is the alignment dimension; the load-bearing axis is
still Static-vs-Projected. Independent per-side scenario picks would make
"is this delta because the LCI database moved or because the DSM
trajectory differs?" unanswerable, so a single shared tab is the rule.

**Per-side multi-DSM slot convention.** `useImpactStore` carries TWO
parallel multi-DSM slots — `staticDsmScenarioOrder/Runs` +
`activeStaticDsmScenario`, and `projectedDsmScenarioOrder/Runs` +
`activeProjectedDsmScenario` — with corresponding selectors
`selectStaticDsmScenario` and `selectProjectedDsmScenario`. Running a
multi-DSM fan-out on one side never clobbers the other; Comparison
intersects the two lists for the tab bar.

**Inline non-intersection note.** When `staticOnlyDsmIds` or
`projectedOnlyDsmIds` is non-empty, Comparison renders a warning-tinted
banner (`data-testid="comparison-non-intersection-note"`) listing which
ids ran on only one side. Empty intersection routes to a dedicated
EmptyState ("No comparable DSM scenarios").

**Excel export filename embeds the active DSM scenario** when applicable:
`{system}_comparison_{dsmName}_impact.xlsx`. Per-tab — re-click + re-export
each scenario the user wants on disk.

#### What NOT to do

- **Don't reintroduce the `dsmScenarioMode` shared-slot pattern.** The
  pre-2G design used one multi-DSM slot with a `'static' | 'projected'`
  discriminator that flipped per run, clobbering the other side. Patch
  2G retired it because Comparison needs both lists alive
  simultaneously. Multi-axis fan-out slots must be per-side
  (`staticDsm*` / `projectedDsm*`) when both Static and Projected need
  to retain results in parallel — never re-fold them onto one slot
  with a tab discriminator.
- **Don't allow per-side independent DSM scenario picks on
  Comparison.** A single DSM-scenario tab bar applied to both sides is
  the rule. Independent picks (e.g. comparing Static SSP1 against
  Projected SSP2) make the Static-vs-Projected delta uninterpretable.
- **Don't auto-pick the first id outside the intersection.**
  `compare()` is gated on the active DSM scenario being inside
  `commonDsmIds` (and on the two sides being aligned for the
  multi-DSM-both case). If the user lands on a scenario that ran on
  only one side, surface guidance rather than silently swapping to a
  comparable one.
- **Don't drop the non-intersection note when only one side has
  extras.** The asymmetric case (static-only or projected-only
  populated, not both) is exactly when the user needs to know what's
  missing. Note renders whenever `staticOnlyDsmIds.length > 0 ||
  projectedOnlyDsmIds.length > 0`.

### Comparison DSM tab switch + Results collapsibility (Patch 2H + 2I)

**2H — DSM tab switch must clear `compareResult`.** The Patch 2G tab bar
swaps `staticResult` / `projectedResult` via the per-side selectors
(`selectStaticDsmScenario`, `selectProjectedDsmScenario`,
`selectPairedScenario`). Each selector now also sets `compareResult: null`
so the Comparison panel's `useEffect` recompute gate (`!compareResult &&
compare()`) actually fires. Without this clear, the gate kept the original
tab's `compareResult` alive and tab switching was cosmetic — the active-tab
border swapped but Cumulative Difference, totals, and charts stayed
frozen on the first scenario. `compare()` is sync client-side
(`buildCompareClientSide`), so the clear-then-recompute is single-frame
flicker-free.

Regression coverage: `tests/comparisonPanel.dsmTabSwitch.test.tsx` seeds
multi-DSM both with distinct projected totals, asserts the formatted
`total_delta` text in `container.textContent` flips between scenarios on
selector calls, plus a lower-level guard that the selector clears
`compareResult` directly.

**2I — Comparison Results use `<CollapsibleCard>`.** The Comparison
results section follows the same vertical config/results pattern as
Static and Prospective Background panels (DSM scenario tab bar above, Results
card below). The collapsed-state summary shows `Cumulative difference:
{value} {unit} ({pct}%) · {N} comparable scenarios` so users know what
they're collapsing without expanding.

**The DSM tab bar and non-intersection note stay OUTSIDE the
collapsible.** When the Results card is collapsed, the tab bar must
remain visible — switching scenarios is the primary navigation action
on this tab and shouldn't require expanding Results first.
`tests/comparisonPanel.intersection.test.tsx` enforces the invariant:
clicks the "Results" header to collapse, then asserts the
`comparison-dsm-tab-bar` testid still renders while the chart subtitle
disappears.

**2I — Auto-pair-by-SSP button removed from `PairListEditor`.** The
button assumed an SSP-prefixed DSM scenario naming convention that
doesn't hold across user populations. It was removed because the
affordance was discoverable-but-useless for most users — manual + Add
pair is the universal pattern. If a future need for name-based pairing
emerges, it should be configurable per project (e.g. "pair by suffix
match", "pair by user-defined regex") rather than hardcoded to SSP
tokens.

#### What NOT to do

- **Don't add `compareResult: null` to selectors that aren't bridging
  to a side** (e.g. parameter-scenario selectors). Those selectors
  don't change `staticResult` / `projectedResult`, so clearing
  `compareResult` would force a useless recompute against the same
  inputs. The clear is load-bearing only on the three DSM-bridging
  selectors.
- **Don't move the DSM tab bar inside `<CollapsibleCard>`.** The tab
  bar is the navigation surface for switching the comparison's
  alignment dimension; hiding it behind a collapsed Results card would
  trap the user. The render test enforces this — moving it would fail
  the "tab bar still visible when collapsed" invariant.
- **Don't restore the Auto-pair-by-SSP button as "harmless because
  disabled when irrelevant".** The disabled-with-tooltip pattern was
  the original design and still left users hunting for an affordance
  that doesn't apply to them. The cleaner answer is removal.
- **Don't switch to `getByText`-style assertions over the formatted
  delta value in the tab-switch regression test.** Multiple ancestor
  elements share the same `textContent` (the containing div, the
  summary card, the results section), so `getByText(/+1.00e+1/)`
  matches several elements and throws. Read `compareResult.methods[0]
  .total_delta` from the store directly + assert
  `container.textContent.toContain(...)` for the rendered value.

### Material Flows multi-axis fan-out (Patch 4M)

Material Flows on the DSM Dashboard tab adopts the same two-axis
multi-select pattern as Impact Assessment's multi-DSM (Patch 2E.1) +
multi-parameter (Patch 2C). Sub-set of the Impact Assessment axes
because **LCI scenarios don't apply** to MFA: prospective LCI
databases change supply-chain emission factors, not the physical
material throughputs MFA tracks. Two axes only — DSM scenarios and
parameter scenarios — and the same one-axis-at-a-time axisConflict
rule.

**Backend** (`mapper/api/bom.py`):

- `MaterialFlowRequest` gained `dsm_scenario_id: str | None` and
  `parameter_scenario: str | None`. Both default to `None` (full
  backward compat — every existing single-result caller keeps
  working). When `dsm_scenario_id` is set the handler runs a fresh
  sim via `simulate_for_scenario` (the Patch 2E.1 helper) instead of
  reading the cached active-scenario sim. When `parameter_scenario`
  is set (and not `"Base"`), each archetype is cloned through
  `ParameterEngine` + `resolve_archetype_with_engine` before flowing
  into `compute_material_flows` — same pattern Patch 4D's
  single-product LCA uses.
- New sibling endpoint `POST .../material-flows-multi` takes
  `MaterialFlowMultiRequest` with `dsm_scenario_ids` / `parameter_scenarios`
  and fans out server-side (sync loop, no task registry — MFA
  compute is sub-second). Returns `MultiMaterialFlowResult`:
  `{axis: "dsm" | "parameter", runs: [...], elapsed_seconds}`.
  axisConflict (both axes non-empty) → 400.

**Frontend** (`stores/dsmStore.ts`, `components/flows/MaterialFlowPanel.tsx`):

- `dsmStore` gains three new slots — `materialFlowsRuns` (the runs
  array from the envelope), `materialFlowAxis` (`"dsm" | "parameter"
  | null`), `activeMaterialFlowScenario` (id of the scenario whose
  run is currently mirrored into the legacy `materialFlows` slot).
- `calcMaterialFlows(scope, ys, ye, groupBy, opts?)` routes to the
  legacy single endpoint when both axes are ≤1 selected, the multi
  endpoint when exactly one axis has N>1. Legacy endpoint still gets
  the in-task scenario field if exactly one is selected — the user's
  pick is honored even at N=1 (no scenario tab bar then, but the
  result reflects the chosen scenario).
- `selectMaterialFlowScenario(id)` mirrors the picked run's
  `MaterialFlowResult` into `materialFlows` so the existing chart /
  table / summary rendering reads it without per-component
  multi-scenario awareness — same shape pattern as Impact
  Assessment's selectStaticDsmScenario.
- The panel adds two chips below the existing Scope / Group By /
  Years controls — `<DSMScenariosChip>` (reused from Patch 2E.2) and
  a parameter sensitivity-cases checklist (mirrors `DSMImpactPanel`'s
  static-axis chip). `axisConflict` is computed from the selection
  counts and disables the Calculate button + renders an inline
  error banner.
- A scenario tab bar renders above the Results card when
  `materialFlowsRuns.length > 1`. Clicking a tab calls
  `selectMaterialFlowScenario` which swaps the active result; the
  rest of the rendering (table, chart, headline) is untouched.

#### What NOT to do

- **Don't add LCI scenarios as a third axis on Material Flows.**
  MFA tracks physical material throughputs (kg of steel, kWh of
  battery cells) which depend only on the BOM × stock, not on the
  background LCI database. Prospective LCI changes supply-chain
  emission factors — that's an Impact Assessment concern, not an
  MFA concern. Adding LCI to the MFA chips would either (a) be a
  no-op that confuses users, or (b) accidentally couple MFA to the
  pLCA database list and break the methodological boundary.
- **Don't fan out a Cartesian product (DSM × parameter) in one
  request.** axisConflict prevents this client-side and 400s
  server-side. A matrix UI for N×M results would need its own
  design — scenario tab bar can't represent a 2D grid cleanly.
- **Don't reach for a task registry / WebSocket for multi-MFA.**
  Each scenario's MFA compute is sub-second; the typical N is ≤5.
  A sync server-side loop returns the assembled envelope in well
  under a second wall-clock. Task plumbing would add complexity
  for no UX gain.
- **Don't move the per-archetype scenario state into `dsmStore`.**
  Scenario chip selection is panel-scoped — leaving the Material
  Flows tab and coming back shouldn't carry the previous selection.
  Store owns the *results* (cross-scenario, cross-tab); chips own
  the *picks* (per-tab, per-visit). Same convention as the
  multi-DSM Impact panel.
- **Don't change the legacy single endpoint's filename / response
  shape for backward compat callers.** The endpoint accepts the new
  scenario fields but the response is still `MaterialFlowResult`.
  Multi-shape is a separate envelope on a separate URL. Existing
  Excel export (`GET .../material-flows/export`) stays
  single-scenario; users export per-scenario by switching the
  active tab and re-exporting. Multi-scenario export is deferred —
  see "out of scope" in Patch 4M's brief.

### AESA bundled data provenance (Patch X1)

The AESA Carbon Budget Depletion view consumes two bundled JSON
data files that ship with the backend:

- `mapper-backend/mapper/data/aesa/ssp_trajectories.json` — global
  CO2 emissions trajectories, IIASA SSP marker scenarios
  (SSP1-2.6, SSP2-4.5, SSP3-7.0, SSP5-8.5), stored as 9 decadal
  anchor points per scenario and linearly interpolated to annual
  values at load time (`_expand_ssp_anchors`). Each entry carries
  an `iiasa_database` block (version, release year, URL, AR6
  marker convention) and a per-scenario `model` field naming the
  AR6 WG1 marker IAM (IMAGE 3.0.1 for SSP1-2.6, MESSAGE-GLOBIOM
  1.0 for SSP2-4.5, AIM/CGE 2.0 for SSP3-7.0, REMIND-MAgPIE 1.5
  for SSP5-8.5).
- `mapper-backend/mapper/data/aesa/carbon_budgets.json` — remaining
  global CO2 budgets from 2025 (1.5°C / 2°C × 50th / 67th
  percentile). Top-level `sources` array carries structured
  citations (IPCC AR6 WG1 SPM with DOI 10.17​​​/9781009157896,
  Global Carbon Budget 2024 with DOI 10.5194/essd-16-2625-2024).
  Each option references those sources by ID through
  `source_budget` + `source_deduction` and carries the explicit
  `original_gt_from_2020` so the deduction arithmetic is
  machine-traceable.

**Provisional flag is load-bearing.** Every scenario and every
budget option carries `provisional: true`. The IIASA attribution
is `best_estimate: true` because the source commit doesn't record
which IIASA SSP DB release the anchors were drawn from; the v2.0
2018 release + AR6 marker convention is the best estimate given
the values' shape and the file's contemporary `_notice`. The flag
must stay true until the bundled values are verified against
dense annual IIASA extracts.

**Carbon budget arithmetic — corrected in Patch X1+.** Patch X1's
audit surfaced an off-by-50 transcription gap in the 1.5°C / 50th
percentile option (stored 250 vs. derived 300). The X1+
re-derivation pass found the **same gap in 3 of 4 options** — all
in the same direction, a systematic transcription error (likely
subtracting 250 instead of 200, or applying an extra
unprescribed rounding step).

Corrected bundled values (AR6 50 GtCO2 rounding convention):

| Option | Pre-X1+ | Post-X1+ | Post-X1++ |
|---|---|---|---|
| 1.5°C / 50% | 250 | **300** | 300 |
| 1.5°C / 67% | 150 | **200** | 200 |
| 2.0°C / 50% | 900 | 950 | **1150** (orig 1350) |
| 2.0°C / 67% | 600 | 600 | **950** (orig 1150) |

The depletion year visible on the AESA Timeline shifts by ~1 year
for the 1.5°C / 50% × SSP2-4.5 pairing (was ~2031, then ~2032).
Patch X1++ shifts the 2°C depletion years substantially (2°C / 50%
×SSP2-4.5: ~2052 → ~2061; 2°C / 67% ×SSP2-4.5: ~2042 → ~2052).

**These depletion years were all read off the CHART before the
inclusive-accumulation fix, so each is ~1 year EARLY.** The chart was
drawing `remaining_budget(year + 1)` and annotating depletion one year
ahead of the engine on every depleting configuration (see the
"chart 2032, engine 2033" note further down). Post-fix the sparkline and
the Timeline read the engine's series, so **1.5°C / 50% × SSP2-4.5 is
~2033** — verified in the installed v0.1.6 build (2026-08-07), which
renders "Cumulative emissions vs 300 Gt budget · depleted ~2033". The
2°C figures above have NOT been re-measured; treat them as ~1 year early
until someone checks them the same way, and don't quote them as engine
values.

**Depletion year is budget × pathway — always state both.** The same
300 Gt budget reads ~2033 on SSP2-4.5 but **~2035 on SSP1-2.6**, which
is the fresh-config DEFAULT pathway. So "the 1.5°C/50 default depletes
~2033" is only true for the SSP2-4.5 (mitigation-gap) pairing, not for
what a new config actually opens on.

**Patch X1++ — 2°C re-sourcing.** Patch X1+ explicitly deferred
the 2°C `original_gt_from_2020` values pending methodological
sign-off; X1++ closes that flag.

- 2.0°C / 50% — stored 1150 was the **Forster et al. 2023**
  value with "from January 2023" reference date, silently
  substituted where the file's citation claimed "AR6 from
  2020" (which is 1350). Different reference date → different
  value → arithmetic that subtracts 200 Gt of 2020-2024 emissions
  no longer makes sense (Forster 2023 has already absorbed
  2020-2022). Corrected to AR6's **1350 Gt from 2020**.
- 2.0°C / 67% — stored 800 had no traceable git history (single
  bulk commit, no source attribution) and doesn't match AR6 OR
  Forster 2023 OR Indicators of Global Climate Change. Corrected
  to AR6's **1150 Gt from 2020**.

Cross-check references added to `sources[]`: Hausfather 2023
Climate Brink article (which explicitly compares AR6 1350 vs.
Forster 2023 1150, and AR6 1150 vs. Forster 950, for the two
2°C cases) — this is the link future maintainers should
consult when verifying values without re-reading the IPCC PDF.

**Fresh-config defaults (current).** A NEW AESA config defaults its carbon
budget to **IPCC AR6 2.0°C / 50th percentile (`IPCC_AR6_2C_50`, 1150 Gt from
2025) × `SSP1-2.6` (a temperature-CONSISTENT ~2°C depletion pathway), allocated
over 2025–2100, with `budget_basis = "CO2e_GHG"`** (the frontend toggle's
default; wired per-budget CO₂e factor 1.4846). History: 5AO/5AR set this to 2°C/50
× SSP2-4.5 (was 1.5°C/67th 200 Gt); the budget+pathway+basis triple is now
coherent. These are the default parameters of `build_carbon_budget()` in
`mapper/core/aesa_engine.py`, surfaced by `GET /aesa/defaults` (`get_defaults()`,
the sole no-arg caller) as `default_carbon_budget` and copied into a fresh draft
by `aesaStore.draftFromDefaults` (which flips the basis to `CO2e_GHG`). **Defaults
only** — they seed a fresh/reset config and never clobber a loaded/saved config
or user edits. Locked by `test_aesa_data_provenance.py::{test_fresh_config_carbon_budget_defaults,
test_get_defaults_surfaces_fresh_carbon_budget}`.

**Why this temperature/pathway default (UX, not methodology lock-in).** The
temperature default is a UX choice to preserve the **comparative SR gradient
across 2025–2050**: the 1.5°C budget (`IPCC_AR6_1p5C_50`, 300 Gt) is only ~6–7 yr
of current emissions, so it **saturates inherently by ~2033–2040 under ANY
pathway** (≈2040 even under the matched 1.5°C SSP1-1.9; the magnitude, not a
pathway mismatch, is the cause). A fresh config opening on a saturated climate
SR reads as broken; 2°C/50 × SSP1-2.6 stays non-depleting through 2100 and shows
a gradient. **Budget and pathway are independently selectable** — the strict
1.5°C view is one click away, and deliberate mismatching (e.g. a 1.5°C budget ×
SSP2-4.5) for **mitigation-gap analysis** stays available. The default pairs the
2°C budget with a **temperature-consistent** ~2°C pathway (SSP1-2.6, not the
~2.7°C SSP2-4.5) to avoid a mitigation-gap *default* — see Patch X2's warning
against pairing a budget with an off-temperature pathway in published claims.

**`end_year` is the budget ALLOCATION horizon, not the study/SR-timeline
window (Patch 5AR).** `annual_global_allocation(t) = remaining_budget(t) /
(end_year − t)`, so a smaller `end_year` divides the remaining budget across
fewer years → inflates the per-year safe allocation → collapses the
climate-change SR. The per-year SR results / timeline x-axis come from the
**DSM fleet trajectory's years** (`mres.years` in `AESAEngine.compute`), which
is entirely separate from `end_year`. 5AO mistakenly set `end_year` to the 2050
study window (taken from the config's "End" field), compressing a ~75-yr budget
into ~25 yrs; 5AR reverted it to **2100** (full-century remaining-budget
framing, consistent with GWP100). Do NOT set the budget `end_year` to the fleet
study window — they are decoupled by design (budget→2100, SR timeline→DSM).

Don't confuse the fresh-config
DEFAULT with the bundled data values above — this only changes which option/SSP/
window a new config starts on, not the budget data itself.

**Arithmetic invariant** locked in by
`tests/test_aesa_data_provenance.py::test_budget_arithmetic_is_internally_consistent`:
every option must satisfy
`original_gt_from_2020 - consumed_2020_2024_gt == remaining_gt_from_2025`.
A future data-entry mistake cannot ship without failing this test.

**AR6CarbonBudgetCalc citation added** to the sources registry
(Lamboll, R., DOI 10.5281/zenodo.8332951) — the reference
implementation for reproducing Table SPM.2 from raw AR6 inputs.
Future re-sourcing passes should diff against this calculator's
outputs.

**Patch X2 — SSP1-1.9 trajectory added.** Closes audit finding
A4. The SSP marker set is now complete per AR6 WG1 convention
(five scenarios: SSP1-1.9, SSP1-2.6, SSP2-4.5, SSP3-7.0, SSP5-8.5).
SSP1-1.9 attribution: IMAGE 3.0.1 (CD-LINKS marker, AR6 WG1).
Anchor values are provisional best estimates rounded to integer
Gt CO2/yr; refine against IIASA SSP DB v2.0 dense extract for
publication.

**Methodological significance**: SSP1-1.9 is the 1.5°C-aligned
trajectory. Before X2, users picking the 1.5°C carbon budgets
could only pair them with SSP2-4.5 (~2.7°C-aligned) or warmer —
the chart then read as **mitigation-gap framing** ("here's how
fast we deplete the 1.5°C budget if we follow current-policy
emissions"). With SSP1-1.9 available, users can now run
**matched 1.5°C-pathway analysis** ("here's what a 1.5°C-
compatible trajectory looks like against the 1.5°C budget").
Both framings are valid; the user must now actively choose.

**Net-negative emissions handling**: SSP1-1.9's late-century net
negatives (peak ~-8 Gt CO2/yr by 2090-2100, CDR + afforestation)
interact with the depletion arithmetic in a non-obvious way.
`remaining_budget(year) = max(0, initial - Σ_{y<year} E_y)`:

- When `Σ` is below the budget cap, remaining is positive and
  follows the formula directly. Late-century negatives subtract
  from `Σ`, so the displayed remaining GROWS over time. The
  "Not depleted within horizon" affirmation fires when `Σ`
  never crosses the cap (e.g. SSP1-1.9 × 2°C/50%: peak ~380 Gt
  cumulative against a 1150 Gt cap → never depleted).
- When `Σ` crosses the cap mid-century, the depletion event is
  pinned to that FIRST crossing year (e.g. SSP1-1.9 ×
  1.5°C/50%: peak ~380 Gt cumulative against a 300 Gt cap →
  depleted ~2040). Replenishment via late-century negatives
  brings `Σ` back below the cap, so the formula reports a
  positive remaining again by 2100. Methodologically: the
  overshoot has happened — replenishment doesn't erase
  temperature exceedance, but the math allows the budget to
  re-grow numerically. The chart's depletion annotation
  correctly pins on the first crossing (the methodologically
  important moment).

**UI affordance** (Patch X2): the AESA Timeline's Carbon Budget
Depletion inset shows EITHER "depleted ~YYYY" (red) OR "not
depleted within horizon" (green), affirmatively. The previous
implementation silently omitted the annotation when the budget
didn't deplete, which read as a render bug. Locked by
`tests/carbonBudgetNotDepleted.test.tsx` (3 cases: depletes,
never depletes, depletes-then-replenishes).

#### What NOT to do

- **Don't add a new SSP scenario or budget option without
  populating the provenance fields.** Scenarios need `model` +
  `source`; budget options need `source_budget` +
  `source_deduction` referencing entries in the top-level
  `sources` array (or a new entry added to it). The provenance
  regression test
  (`test_aesa_data_provenance.py::test_every_ssp_scenario_has_iam_model_attribution`,
  `..._every_budget_option_references_structured_sources`)
  enforces this — green tests are the gate to JOSS submission.
- **Don't remove the `provisional: true` flag until anchors are
  verified.** Verification means: dense annual extracts from a
  specific dated IIASA SSP DB release for SSP trajectories, AND
  spot-checking the budget arithmetic against the latest IPCC
  synthesis. The flag is also asserted by the regression test.
- **Don't cite IPCC AR6 inline in code comments without also
  updating `sources` array.** The structured array is the
  machine-readable registry — paper / IDA-deck / future
  contributor reads from one place. Inline-only citations drift
  out of sync with the registry.
- **Don't change the bundled numeric values to "fix" the
  arithmetic mismatch** as part of a documentation patch. That's
  a separate methodological decision (which AR6 table row to
  treat as canonical, whether to use the rounded or exact
  values) and should ship with explicit user sign-off and a
  paper-trail commit, not bundled with metadata cleanup.
  *(Patch X1+: the pure-arithmetic correction `remaining =
  original - consumed` shipped as a sibling patch with explicit
  sign-off; the `original_gt_from_2020` re-sourcing for 2.0°C
  options remains deferred.)*
- **Don't hand-type derived values when the derivation is
  published.** The 50 Gt off-by-rounding errors that Patch X1+
  corrected were the consequence of someone manually computing
  `remaining = original − consumed` and getting it wrong three
  times in a row. Two safer patterns: (a) compute at load time
  from `original_gt_from_2020 − consumed_2020_2024_gt`, eliminating
  the human transcription step; or (b) keep the materialised
  `remaining_gt_from_2025` field for export readability AND lock
  the equality with a test. Patch X1+ took (b) via
  `test_budget_arithmetic_is_internally_consistent`. Either way,
  the published source's rounding convention must be documented
  in the file's `_notice`.
- **Don't mix reference-date conventions across budget options.**
  AR6 SPM.2 values are "from January 2020". Forster et al. 2023
  values are "from January 2023" (they have already absorbed
  2020-2022 emissions). Indicators of Global Climate Change
  publishes annual updates with whichever reference date suits
  the publication year. The reference date is **part of the
  value's identity** — substituting a value from a different
  reference date silently breaks the deduction arithmetic and
  yields a displayed `remaining_gt_from_2025` that doesn't
  correspond to any published source. Patch X1++ corrected one
  case where 1150 (Forster 2023 from Jan 2023) had been
  silently used in place of 1350 (AR6 from 2020). If a future
  patch migrates the bundle from AR6 to Forster, the deduction
  semantics (`consumed_2020_2024_gt = 200`) must change in
  lockstep — Forster from-Jan-2023 needs a ~80 Gt 2023-2024
  deduction, not a 200 Gt 2020-2024 one.
- **When values trace to multiple potential sources, lock the
  canonical source with a published-source invariant test.** The
  arithmetic invariant (Patch X1+) catches internal
  inconsistencies (`original − consumed != remaining`); the
  published-source invariant (Patch X1++) catches transcription
  errors against the cited authority. Both layers are needed —
  the arithmetic invariant doesn't notice when both
  `original_gt_from_2020` AND `remaining_gt_from_2025` are
  drawn from a different reference date in lockstep. The
  published-source dict
  (`AR6_SPM_2_VALUES_FROM_2020` in
  `test_budget_originals_match_ar6_spm_table_2`) is the
  ground-truth registry; updating one of its entries must be
  paired with an explicit `_notice` change that documents the
  migration (and, if reference-date semantics change, a
  matching deduction adjustment).
- **Don't pair the 1.5°C budget with SSP2-4.5 in published
  claims without explicit framing as "mitigation gap analysis".**
  SSP2-4.5 is the AR6 middle-of-the-road / ~2.7°C-aligned
  trajectory; pairing it with the 1.5°C budget illustrates how
  far off-track current-policy emissions are, not what a
  1.5°C-compatible pathway looks like. For coherent matched
  analysis (Patch X2 makes this possible), use SSP1-1.9 × 1.5°C
  budget. The chart still renders both pairings — the methodology
  text accompanying any external claim must distinguish gap
  vs. matched framings.
- **Don't display "depleted ~YYYY" silently-omitted as the
  affirmation when a budget doesn't deplete.** Patch X2's
  Carbon Budget Depletion inset shows EITHER a red "depleted
  ~YYYY" or a green "not depleted within horizon" — the omitted-
  annotation case (pre-X2) read as a render bug. Any future
  patch that adds new annotation states (e.g. "depleted then
  replenished") MUST update both the depleted and not-depleted
  testids in the inset so the binary contract `exactly one of
  {depletion-year, not-depleted}` stays observably true.
- **Don't conflate "not depleted (cumulative never crossed
  cap)" with "replenished (cumulative crossed cap then receded
  below)".** The depletion event is the FIRST crossing — a
  methodologically committed temperature exceedance that the
  chart's annotation correctly pins on. Late-century net-negatives
  can bring the displayed remaining back above zero numerically,
  but the overshoot has already happened. The "not depleted
  within horizon" affirmation fires only when the trajectory's
  cumulative emissions never exceed the budget cap — the
  cumulative-stays-below-cap case, not the overshoot-then-
  receded case.
- **Net-negative emissions in late-century scenarios (SSP1-1.9,
  some SSP1-2.6 variants) replenish the budget in depletion
  math.** This is correct per the formula `remaining = max(0,
  B - Σ)` but counterintuitive on first read. The formula now
  lives in ONE place — `CarbonBudgetConfig.remaining_budget()` —
  so a change to it (e.g. sticky-depletion semantics, "stays at
  0 once depleted") propagates to the chart automatically.
- **The `CarbonBudgetInset` READS `remaining_budget_gt` off the SR
  rows; it does not compute a remaining-budget curve.** Earlier
  revisions of this file claimed the frontend and backend "share
  the same math". They did not, and saying so is what let the
  divergence persist: the inset accumulated INCLUSIVELY
  (`cum += E[y]; remaining = initial − cum`) while
  `remaining_budget(year)` sums `range(start_year, year)`,
  EXCLUDING the current year. The chart was drawing
  `remaining_budget(year + 1)` — 37 Gt low at 2025, 32 at 2030,
  22 at 2040 on the shipped 2°C/50 × SSP1-2.6 default — and
  annotated depletion ONE YEAR EARLY on every depleting
  configuration (1.5°C/50 × SSP2-4.5: chart 2032, engine 2033).
  `SustainabilityRatioResult.remaining_budget_gt` and
  `.global_allocation_gt` are on the very result the page
  renders; the helpers are `budgetSeriesFromResults` /
  `depletionYearFromSeries` in `TimelineView.tsx`. Locked by
  `tests/carbonBudgetReadsEngine.test.tsx` (frontend, against a
  backend-generated fixture) + `test_carbon_budget_series_fixture.py`
  (backend, keeps that fixture in sync with the engine and fails
  if the depleting case stops depleting, which would make the
  frontend gate vacuous).
- **When no SR row carries `remaining_budget_gt`, the inset draws
  NOTHING** (a note naming the cause: budget configured, no
  cumulative boundary mapped). It does not fall back to a
  frontend projection — a curve that agrees with Compute only by
  coincidence, with no way for a reader to tell which number is
  authoritative, is the thing that was removed.
- **The "System allocated share" line is NOT the SR denominator,
  though it shares the axes.** It samples ONE year's chain factor
  and holds it flat, and multiplies the REMAINING budget rather
  than the per-year allocation (`global_allocation_gt`). The SR
  divides by the year-by-year allocated SOS. Deliberate
  approximation kept for shape; don't read a value off it, and
  don't "reconcile" it by making the SR use it.

#### What NOT to do (any UI that shows a number the backend also computes)

- **If the backend already emits the number, READ it.** Don't
  re-derive it in the frontend "to avoid a round-trip" — the
  result is already in hand. A second implementation agrees only
  until one side changes, and the disagreement is silent because
  both look authoritative. This has now bitten three times: the
  chain editor's Total-factor preview (hand-rolled year resolver
  vs. the one Compute uses), `interpolateKeyframes` (mirrors
  `_interpolate_keyframes`, but returns 0 where the backend
  raises), and this inset.
- **If a preview genuinely must exist before Compute has run,
  label it as a projection or don't draw it** — and never let it
  occupy the same visual slot as the computed value with no
  distinction.
- **A frontend type missing a backend field is a cause, not a
  detail.** `remaining_budget_gt` had been on the API response
  since the carbon-budget path shipped; `SustainabilityRatioResult`
  in `client.ts` never declared it, so the only way to get the
  number appeared to be recomputation. When adding a computed
  field to a result model, add it to the TS interface in the same
  patch.

### SharingPreset is the Carrying-Capacity template (Patch 2a)

`SharingPreset` (backend `aesa_schemas.py`, global `sharing_preset_storage`) now
carries the **whole SR denominator**: in addition to principles + assignments +
chain, it has `boundary_set_id` (default `"Sala2020_EF"`) and `carbon_budget`
(`CarbonBudgetConfig | None`, default `None` = "inherit the
`build_carbon_budget()` default at apply time"). It IS the "Carrying Capacity
template" (the class name + storage keys are kept stable; the label is a
Phase-3 UI concern).

**Persistence-only — SR values are unchanged.** `POST /aesa/compute` reads
`config.boundary_set_id` (→ `load_boundary_sets()`), `config.carbon_budget`, and
`resolve_sharing(config)` (= `config.sharing` snapshot) — it **never reads the
template's `boundary_set_id`/`carbon_budget`**. The template's new fields are
**creation-time defaults** that seed an `AESAConfiguration`'s inline snapshot;
they never retroactively override a saved config (identical semantics to how
`sharing` already snapshots — `sharing_preset_id` is a bookmark). So a config
whose own boundary set / budget differ from its referenced template's is **not a
conflict**: the config snapshot is authoritative for compute, full stop.

**Back-compat**: presets/configs/sessions saved before 2a (no new fields) load
with the defaults (`Sala2020_EF`, `carbon_budget=None`). The built-in
`ferhati_2026_multi_d` template stays present + read-only. Locked by
`tests/test_aesa_carrying_capacity_template.py` (back-compat + round-trip +
no-drift: mutating the sharing snapshot's new fields to garbage leaves every
SR/SOS byte-identical). Do NOT make compute read these off the template — that
would reintroduce drift and break the snapshot-authoritative model.

### Per-principle downscaling in the σ sensitivity sweep (Patch 2b)

`AESAEngine.compute_with_sensitivity` (`mapper/core/aesa_engine.py`) runs one
variant per principle. It already flips every **category_specific** layer to the
tested principle P (via `category_assignments`). Patch 2b (Option 1) extends this
so a **fixed** layer ALSO resolves to P — but only when the layer carries data
for P (**"has data" = `P in layer.data` AND `layer.data[P]` truthy**); otherwise
it FALLS BACK to the layer's `fixed_principle`. A present-but-empty `data[P] ==
{}` is treated as ABSENT → fallback (never a zero factor).

**No SR drift on existing presets.** The built-in Multi-D shape has fixed layers
that carry only their `fixed_principle`'s data, so every variant falls back to
`fixed_principle` — byte-identical to the pre-patch sweep. The fix is confined to
the per-variant chain copy (`ly.model_copy(update={"fixed_principle": P})` +
`chain.model_copy(update={"layers": ...})`); it never mutates the stored preset,
and the **primary (non-sensitivity) `compute()` and the schema are unchanged**
(`DownscalingLayer.data` was already principle-keyed). Per-principle fixed-layer
data is reachable via import until the Phase-4 editor ships.

Locked by `tests/test_aesa_per_principle_sensitivity.py`: no-drift (patched built-in
sweep == reproduced category-only sweep, per-principle byte-identical), primary
unchanged, the new capability (a fixed layer with distinct EpC/AR data varies),
absent-principle fallback, present-but-empty→fallback-not-zero, and
no-mutation-of-original.

#### What NOT to do

- **Don't make fixed layers vary unconditionally in the sweep.** The fallback to
  `fixed_principle` when `data[P]` is absent/empty is what keeps single-principle
  fixed layers (the built-in) invariant → no drift. Removing it silently shifts
  every existing preset's sensitivity SRs.
- **Don't push the per-principle resolution into `compute()` /
  `DownscalingLayer.resolve_principle`.** Those drive the PRIMARY compute, which
  must stay byte-identical. The variation lives only in the per-variant chain
  copy built inside `compute_with_sensitivity`.
- **Don't mutate the stored chain/layers in place** when building a variant
  (`model_copy` per layer + per chain). In-place mutation corrupts the config's
  snapshot and the next variant.
- **Don't treat `data[P] == {}` as a zero factor.** Present-but-empty means "no
  per-principle override here" → fall back to `fixed_principle`.

### Ryberg2018_PBLCIA is a structure-only scaffold (Patch 2c)

A second boundary set — `Ryberg2018_PBLCIA` (Ryberg et al. 2018 PB-LCIA) — ships
in `mapper/data/aesa/boundary_sets.json` as **STRUCTURE ONLY, not computable**:
the 9 PB-framework boundaries (climate change, biosphere integrity, stratospheric
ozone depletion, ocean acidification, biogeochemical flows [N+P], land-system
change, freshwater use, atmospheric aerosol loading, novel entities) carry a
`control_variable` + `unit` (the standard Steffen et al. 2015 labels, marked
**provisional** for authoritative Ryberg fill), but `pb_value` (SOS) = null,
`ef_indicator` = null (no PB-LCIA characterisation method maps to it yet),
`zone_of_uncertainty` = null, `status_2023` = null. The set is marked
`computable: false`. **Nothing is fabricated** — SOS values and a PB-LCIA method
are the deferred dependency.

Schema (Patch 2c): `PlanetaryBoundary.{ef_indicator, pb_value,
zone_of_uncertainty, status_2023}` are now optional (`… | None = None`);
`BoundarySet.computable: bool = True`. `Sala2020_EF` supplies real values and is
unaffected (loads as computable, SR byte-identical).

**Compute guard** (`post_compute` in `mapper/api/aesa.py`, right after the
boundary-set-not-found check): if `not bset.computable` OR any boundary has
`pb_value is None`, it raises a **400 with a clear human message** ("… scaffolded
but not yet computable: it needs a PB-LCIA characterisation method and SOS
values …") — never a 500/crash on a null `pb_value × factor` or a null
`ef_indicator` in `suggest_method_mapping`. The generic PB picker surfaces Ryberg
immediately, so this guard is load-bearing even before the Phase-3 UI. Locked by
`tests/test_aesa_ryberg_scaffold.py` (loads-with-nulls, served in `get_defaults`,
compute rejected gracefully — assert 400+message not crash, Sala unregressed,
null-boundary round-trip).

Before Ryberg can compute, two things must land (out of scope for 2c): the
**SOS (`pb_value`) values** for each boundary, and a **PB-LCIA characterisation
method** that maps LCA results to these boundaries (the `ef_indicator` link).

#### What NOT to do

- **Don't fabricate SOS, control factors, zones, or assessment statuses for
  Ryberg.** Null is the honest scaffold state; fabricated numbers would ship as
  if authoritative. Fill from the Ryberg 2018 paper (and verify the control
  variables/units against it — the bundled labels are provisional PB-framework
  placeholders).
- **Don't remove the compute guard** or weaken it to a silent skip. Selecting a
  not-computable set must fail loudly with the clear message, not return empty
  results (which reads as "computed, nothing transgressed").
- **Don't make `Sala2020_EF` (or any real set) rely on the optional-field
  defaults.** Sala supplies real `pb_value`/`ef_indicator`; the optionality
  exists for scaffolds only. A real set with a null `pb_value` is the guard's
  trigger, not a valid state.
- **Don't characterise EF methods against Ryberg.** Its boundaries have no
  `ef_indicator` and represent the PB-LCIA framework's own control variables —
  they need a PB-LCIA method, not the EF v3.1 method set. Mapping EF methods to
  Ryberg PBs would be methodologically wrong (the Sala set is the EF-linked one).

### Carbon-budget CO2 vs CO2e/GHG basis (Patch 2d)

The climate-SR numerator is EF v3.1 GWP100 = **CO2e** (all GHGs); the carbon
budget (denominator) is IPCC **CO2-only** (~1150 Gt) on a **CO2-only** depletion
pathway (`ssp_trajectories.json` stores `anchors_gt_co2`). Comparing a CO2e
numerator to a CO2 denominator is a scope mismatch that **inflates** the climate
SR. Patch 2d adds a **denominator-only** fix: `CarbonBudgetConfig.budget_basis ∈
{"CO2","CO2e_GHG"}` (default **"CO2"** = today, byte-identical, **no drift**).

- **Numerator is unchanged** (EF GWP100 CO2e). Fix is denominator-only.
- **A CO2e basis is INERT without a usable `co2e_conversion`.** Compute
  (`post_compute` guard, beside the Ryberg 2c guard) **rejects** a CO2e basis
  with no usable conversion — *"Carbon budget set to CO2e/GHG basis but no
  sourced CO2→CO2e conversion supplied …"* — never computes on the CO2 budget
  (wrong scope) or a fabricated factor. Mirrors the Ryberg scaffold.
  **Since the CO2e wiring the factor IS populated for every budget** by
  `build_carbon_budget` → `co2e_conversion_for_budget`, so the guard now fires
  mainly on a **workbook import that left `co2e_factor` blank** (the import path
  reads the sheet value verbatim and never recomputes). Note the two defaults
  differ deliberately: the SCHEMA defaults `budget_basis="CO2"`, the UI seeds a
  fresh draft with `"CO2e_GHG"`.
- **Mechanism (b) "ratio" only** (`RatioCO2eConversion{kind:"ratio", factor,
  source}`): `with_basis_applied()` scales BOTH `initial_budget_gt` and
  `projected_emissions` by the per-scenario `factor` *before* the existing
  cumulative math, so `remaining_budget` / `annual_global_allocation` /
  `annual_system_allocation` run **unchanged** on the CO2e pair. Net effect: the
  whole climate SR timeline scales by **1/factor** (CO2e budget larger → SR
  lower). `(end_year − year)` is basis-independent; flow boundaries are
  unaffected.
- **Conversion is per-TEMPERATURE-TARGET and DERIVED** (not per-SSP, and not a
  hand-entered constant): `build_carbon_budget` populates every budget via
  `co2e_conversion_for_budget`, which recomputes `f` from the budget's own
  from-2020 / from-2025 numbers. `carbon_budgets.json` itself carries **no**
  `co2e_conversion` block — the factor is computed, not bundled. A workbook
  import instead uses the sheet's `co2e_factor` verbatim; a non-positive or
  absent factor is inert. The `CO2eConversion` union is designed so "linear" (mechanism a) and
  "pathway" (mechanism c) can be added later as `kind`s — **their compute is NOT
  implemented in 2d** (the inert guard rejects any non-ratio CO2e basis).
- **Where it lives**: `CarbonBudgetConfig` rides on the 2a Carrying-Capacity
  template + the `AESAConfiguration` snapshot; compute reads the config snapshot
  (snapshot-authoritative). Export (5AS chain columns) relabels Remaining Budget
  / Global Allocation as `Gt CO2e` when basis is CO2e (values are CO2e-scaled);
  the chain identity `global·1e12·share == allocated_sos` holds under uniform
  scaling. Locked by `tests/test_aesa_co2e_basis.py` (no-drift vs old-shape,
  ratio scales SR ÷factor + chain identity, inert→graceful 400, export relabel,
  round-trip).

#### What NOT to do

- **Don't invent a CO2→CO2e factor, and never mix ensembles.** It is DERIVED:
  `co2e_factor_for_budget` computes `f = ((m·x20 + b) − C) / x25` from the
  budget's own `original_gt_from_2020` / `remaining_gt_from_2025` plus a
  **`CO2eBudgetFit` selected by temperature target** — which carries the affine
  AND the offset AND the ensemble they were both fitted over:
  **1.5C → AR6 C1+C2** (m=1.3142, b=149.1242, C=250.665) and
  **2C → AR6 C3+C4** (m=1.2935, b=218.41, C=257.4). They travel together on one
  frozen dataclass precisely so a third target cannot inherit another
  ensemble's offset — which is exactly what happened before: two affines
  branched, one unconditional C=257.4 (a C3+C4 median) applied to both, so 1.5C
  budgets were re-baselined with 2C scenarios. `test_no_target_mixes_ensembles`
  checks each fit's declared categories against the rows of its own two files.
  The method is Meinshausen et al. (2018; 2019) as applied by Tilsted & Bjørn
  (2023), doi:10.1007/s10584-023-03583-4 — cited as the PRECEDENT; their
  published coefficients live in `TILSTED_BJORN_2023_PUBLISHED` and are never
  used to compute. MApper's default budget (2C/50) is unaffected by the 1.5C
  refit; every 2C `f` is byte-identical. Provenance and the
  two DIFFERENT scenario counts (343 regression / 427 offset — different
  filters, see below) live in `mapper/data/aesa/co2e_ratio/README.md`. The 2C
  affine is an **unpublished in-repo regression** — cite it as an original
  derivation, not as a sourced value. A missing/non-positive factor must stay
  inert (graceful reject), never silently compute.
- **Don't change the numerator.** This is denominator-only; the EF GWP100 CO2e
  impact is untouched.
- **Don't scale only the budget scalar without the pathway.** The "ratio"
  mechanism scales `initial_budget_gt` AND `projected_emissions` by the same
  factor so `remaining_budget(t)` stays internally consistent (SR ÷ factor
  uniformly). (Mechanism (a) "linear" has a pathway wrinkle — its intercept is a
  one-time cumulative offset, not per-year — which is why its compute is
  deferred, not approximated.)
- **Don't make CO2e the default basis.** CO2 stays default (no drift, opt-in
  shift). The downward SR shift fires only on an explicit CO2e_GHG + sourced
  ratio.

#### Phase B — what the conversion is, and what it is not

The full account is `mapper/data/aesa/co2e_ratio/README.md`. Four things that
have already been misread once and are worth carrying here:

- **`f` is per TEMPERATURE TARGET, not per SSP.** It converts a budget, not a
  pathway. The AR6 ensemble supplying `(m, b)` and `C` is chosen by the budget's
  temperature (C1+C2 for 1.5 °C, C3+C4 for 2 °C); the SSP the user picks does
  not enter `f` at all.
- **The mix-up guard is `test_no_target_mixes_ensembles`, NOT the sanity band.**
  The band (`[1.45, 2.20]` + the budget ordering) catches gross STRUCTURAL
  errors — a dropped or sign-flipped term, a unit error, conflated baselines.
  It does **not** catch an ensemble mix-up: swapping the two legs' offsets
  leaves every factor inside the band with the ordering intact, and so does the
  exact mismatch that shipped before the refit. Where it does catch a swap the
  margin is 0.001. Full injected-error table in the README. Don't treat a green
  band as evidence the ensembles are paired correctly.
- **A1 — `f` mixes observed and modelled provenance, deliberately.** `x₂₅`
  carries the OBSERVED −200 GtCO₂ (GCB 2024); `C` is a MODELLED ensemble median.
  No option is pure, because `x₂₀` is an AR6-ASSESSED budget rather than an
  ensemble statistic. Decision: keep the ensemble median, so `y₂₅` stays
  internally consistent with the `y₂₀` the affine produced. The alternative
  (rescaling `C` to the observed window) is quantified: it moves `f` by
  −0.53 % at 2 °C/50 and −4.18 % at 1.5 °C/67 — below the budget data's own
  50 GtCO₂ rounding on the default. Don't "fix" the mixture without reading A1.
- **A2 — the depletion year is INVARIANT under the basis.** One `f` scales the
  budget AND the pathway, so `SR_CO2e = SR_CO2 / f` exactly and `remaining`
  scales uniformly. That is what makes every basis-following label safe. The
  price is that a real pathway's CO₂e/CO₂ ratio drifts (≈1.37 instantaneous at
  2025 → 1.74–5.53 cumulative-to-2100 across the AR6 REMIND PkBudg scenarios)
  while `f` is constant. Mechanism (c), a true per-year CO₂e pathway, is
  DELIBERATELY unimplemented: `ssp_trajectories.json` stores `anchors_gt_co2`
  only, the AR6 CO₂e series are a different model/scenario set, and a
  year-varying ratio would move the depletion year — a methodological change,
  not a refinement.

Every quantity above is recomputed from the shipped CSVs and asserted against
the README by `tests/test_aesa_co2e_documented_claims.py`, so none of it can go
stale silently.

#### Budget labels follow the basis, in BOTH label and value (Phase B, B1/B2)

The stored `initial_budget_gt` is ALWAYS the pre-basis CO₂ figure. Any surface
that prints a budget magnitude must first put it in the basis compute will use —
`CarbonBudgetConfig.with_basis_applied()` on the backend,
`withBasisApplied()` in `src/utils/carbonBudget.ts` on the frontend — and label
it accordingly.

The defect this fixes: the exported workbook wrote "Initial budget (Gt CO2) =
1150.0" on its Carbon Budget sheet while the Impacts-vs-SOS chain columns, from
the same run, wrote "Remaining Budget (Gt CO2e) = 1707.2" — reading as a
remaining budget exceeding its own initial budget, in files that get attached to
papers. The sidebar sparkline had the same shape ("vs 1150 Gt" under a CO₂-eq
config), and the timeline inset had it PLUS an arithmetic error: `totalAllocated
= initial_budget_gt − last engine remaining` subtracted a CO₂-eq remaining from a
CO₂ initial.

The one thing that legitimately stays labelled CO₂ on a CO₂-eq run is the
conversion's INPUT: the published AR6 budgets in the option dropdown, the
`Source` citation prose, and the explicit "Initial budget before conversion
(Gt CO2)" row. Locked by `tests/test_aesa_budget_basis_labels.py`,
`tests/carbonBudgetBasisLabels.test.tsx` and the sidebar render tests in
`tests/aesaConfigBudgetBasis.test.tsx`.

#### One implementation, enforced on BOTH sides (Phase B, item 5)

The depletion arithmetic has had five copies (the engine, the timeline inset,
the sidebar sparkline, the shared helper, and one in a TEST that asserted the
engine against itself). `tests/carbonBudgetSingleImplementation.test.ts` and
`mapper-backend/tests/test_carbon_budget_single_implementation.py` now guard
both trees.

They forbid **element-wise access** to `projected_emissions` rather than
enumerating accumulation idioms — you cannot sum what you cannot reach, so
`+=`, `reduce`, a `for…of`, a comprehension and destructuring are all covered by
one rule. Where enumeration is legitimate (`api/aesa.py` writes a per-year
table; tests marshal fixtures) the narrower **accumulation** rule applies
instead. Also guarded: comparing a running total to `initial_budget_gt` (any
operator), re-deriving `remaining / (end_year − year)`, applying the CO₂e factor
by hand (including as a hard-coded literal), and reading the budget vintage
outside `carbon_budget_vintage()`. Both guards assert their own regexes against
a synthetic corpus, so the sweep cannot pass vacuously.

#### The budget vintage is written down ONCE (Phase B, B4/B7)

`carbon_budgets.json` carries `start_year_reference` (2020),
`deduction_end_year` (2024) and `consumed_2020_2024_gt` (200);
`carbon_budget_vintage()` in `aesa_engine.py` is the only reader. The
`build_carbon_budget` `start_year` default and the locked Reference sheet's
"N Gt from YYYY" detail both DERIVE from it — previously both said 2025 as a
literal, and the test asserted `cfg.start_year == 2025` against the same literal
it came from, verifying nothing. The −200 deduction's prose (the `_notice` and
all four per-option `source` strings) is now checked against the numeric field,
so a revised deduction cannot leave four stale sentences behind.

#### `provisional` fails CLOSED (Phase B, item 7)

`CarbonBudgetConfig.provisional` and `PlanetaryBoundary.provisional` default to
**True**. Every shipped budget option, SSP trajectory and boundary sets it
explicitly, so the default was never exercised — but it was `False`, meaning an
object built in code without the flag came out silently NON-provisional and
would render without the caveat. A safety flag must fail closed.

### A configuration follows the current defaults — it does not freeze them

`AESAConfiguration.sharing` and `.method_mapping` are **derived** unless the
user authored them, and a derived value is **not persisted**. Both already
resolve live when absent:

- `sharing` → `resolve_sharing()` falls through to
  `build_default_sharing_preset()`;
- `method_mapping` → `AESAEngine.compute` auto-suggests when it is empty, and
  the sidebar's auto-suggest effect fires on an empty mapping, so the table
  fills in with no Re-suggest click.

The bug was that the UI **eagerly** wrote a copy of both at creation time, so a
configuration carried whatever the defaults were on the day it was made,
forever. When `acidification` moved EpC → AGR and the Patch 4W exact-match
mapping took coverage 15 → 16, an existing configuration kept computing the old
way beside a fresh one computing the new way, with nothing on screen to explain
the disagreement.

**Reproducibility is satisfied one level up.** `AESASession.configuration_snapshot`
is the authoritative immutable record for compute — the schema docstring has
said so since sessions shipped — and it freezes at compute time. The
config-level copy was never what made a published result reproducible.

**Two halves:**

- **Frontend** — `AESAConfigDraft.sharingCustomized` / `.mappingCustomized`.
  `saveConfig` sends `sharing: null` / `method_mapping: []` unless one is set.
  They are set by the sidebar's sharing editors, by picking a preset, and by
  applying an AESACFG workbook (which comes through `updateDraft`). They are
  **not** set by `suggestMapping` — that is derivation, not authorship, which
  is why it writes the draft directly instead of going through `updateDraft`.
- **Backend** — `aesa_storage._migrate_derived_defaults`, a one-time pass at the
  read boundary that clears `sharing`, `multi_d` and `method_mapping` on any
  configuration written before the marker, then records
  `derived_defaults_migrated: true` and re-saves. `multi_d` is cleared TOO:
  `resolve_sharing` prefers migrating the legacy 2-layer shape over falling
  through to the defaults, so leaving it would resurrect the old chain.

**`carbon_budget` is NOT cleared.** A budget option is a methodological CHOICE
(which temperature target, which percentile); silently moving someone's 1.5 °C
budget would be a worse bug than the one being fixed. A configuration carrying
a superseded budget value keeps it, visibly. The line is derivation vs choice,
not staleness.

#### What NOT to do

- **Don't eagerly persist a default.** If a field has a live-resolution path
  when absent, absent is the correct stored state until the user diverges. The
  same shape is already used for `projectedCustomizedByArc` (Patch 4D/4F).
- **Don't remove the config-level `sharing` field** on the argument that the
  session snapshot makes it redundant. It is not only a frozen copy — it is the
  **editable working document** the sidebar's chain / principles / category
  editors write to (`asEditableSnapshot`). Removing it would delete the
  per-configuration sharing editor.
- **Don't drop the `derived_defaults_migrated` flag** or run the migration
  unconditionally. Without it, a genuine customisation saved after the
  migration is wiped on the very next load.
- **Don't extend the migration to `carbon_budget`, `boundary_set_id`,
  `impact_mode` or `dsm_scenario_id`.** Those are choices the user made, not
  defaults they never touched.

### AR is a single-year emissions share (RESOLVED)

`sharing_data.json`'s `layer1_defaults.AR` is **Denmark's total emissions across
all sectors over the world total, one data year, on a 100-year GWP CO2e basis**:
`59.3e6 / 60.57e9 t CO2e-100yr` (share 9.7903e-4), from the **Climate TRACE
Country Inventory, data year 2022**. Keyed at `year_base` 2025 like the other
four principles; the data year lives in the `source` string, not in the key.

**All five layer-1 principles are now single-year snapshots**: a value at a
point in time over the world's value at the same point. EpC (population), IN
(annual industrial GVA), AGR (annual agricultural GVA), LA (land area) and AR
(annual emissions). The `data[principle][year]` structure and its
step/interpolate resolution modes exist for exactly this shape.

**What was wrong.** AR held a **cumulative 1850-2020 CO2 total** (`3.5e9 /
2.4e12 t`, cited to *Global Carbon Budget 2023*). That is a different kind of
quantity from the other four, not a variant of one: on the same dataset a
cumulative share and a single-year share differ by roughly a factor of three
for an early-industrialised entity, and that factor divides straight into every
AR-allocated Sustainability Ratio. The pair was also internally mismatched (a
fossil-only numerator over an AR6 net-CO2 denominator) and rounded to two
significant figures, which is what kept both errors invisible.

**Layers 2 and 3 are unchanged at 0.25 and 0.60.** They were always
current-year shares (transport's share of the national total, passenger cars'
share of transport), and their `"Grandfathering"` descriptions were always
accurate. The inconsistency was layer 1 alone.

**Each grandfathering layer carries its OWN source, and neither is a citation.**
They used to share one string, taken from `layer2.source` in the data file:
*"Passenger cars ~60% of Danish transport GHG x transport ~25% of national
total = 0.15"*. That sentence describes the PRODUCT, so on the exported Sharing
Data sheet a reader saw it beside a factor of **0.25**, and again beside
**0.60** — describing neither. The strings now live in
`_DEFAULT_LAYER2_SOURCE` / `_DEFAULT_LAYER3_SOURCE`, immediately beside the
values they describe. The combined string stays on `layer2.source`, where it is
still correct: the legacy 2-layer `MultiDConfig` really does apply 0.15 as a
single factor.

**Neither value has a source to cite.** Both are round estimates, flagged
`provisional: true`, with no dataset and no data year recorded for either. The
strings say so, and name Danish EPA (Miljostyrelsen) as where to REFINE them —
never as where they came from. A string that merely named a body would read as
provenance for a number that has none. Do not add a citation without also
replacing the value it would be citing. The strings also carry no numerals: the
value is two lines away in `data=`, and a number repeated in prose goes stale
silently — which is the other half of what went wrong here.

**An earlier Climate TRACE cross-check implied transport is ~13.2% of Danish
emissions, not 25% — and this is NOT a reason to change 0.25.** The
cross-check chains through an unpinned ~73% passenger-car share, so it cannot
be reconciled against the 0.25 x 0.60 split from anything in this repo, and a
disagreement that only appears after passing through an unpinned factor is not
a contradiction. Both layers are treated as stated approximations in the paper's
methods. Note the pairing to be careful about: layer 1's AR principle DOES have
a pinned source (Climate TRACE Country Inventory, data year 2022, 59.3 Mt /
60.57 Gt), so it is tempting to reach for the same dataset to "fix" layers 2
and 3 into consistency with it. Resist that unless the sub-shares are pinned
too — a sourced layer 1 beside two re-derived-but-still-unpinned sub-shares
would look more rigorous while being no better founded.

#### What NOT to do

- **Don't re-merge the two grandfathering sources.** One string that describes
  a product describes neither factor. Locked by
  `test_the_grandfathering_layers_carry_THEIR_OWN_source`, which fails with
  "layers 2 and 3 are sharing one source string again".
- **Don't delete `layer2.source` from the data file** on the grounds that the
  chain no longer reads it. The legacy `MultiDConfig` path still does, and the
  product it describes is the factor that path applies. Locked by
  `test_the_combined_string_stays_where_it_is_still_correct`.
- **Don't change 0.25 or 0.60 to chase the Climate TRACE figure.** See above.
- **Don't put a number in a source string.** The value sits beside it in
  `data=`; a duplicated number is one that can drift out of agreement with the
  thing it annotates, unnoticed, which is exactly how the product-describing
  string survived.

AR allocates `ozone_depletion`, `particulate_matter` and
`photochemical_ozone_formation` in the default preset, and — via
`compute_with_sensitivity` — the AR whisker of the sharing-sensitivity box plot
for all 16 boundaries. Re-sourcing multiplied all three SRs by **1.4896**.

Locked by `tests/test_aesa_sharing_data_provenance.py`: structural checks (every
principle names a source, every share is a fraction, anything non-provisional
carries a vintage) plus a published-source invariant pinning both Climate TRACE
totals, the data year and the metric, and a check that **no** layer-1 principle
declares a cumulative basis.

#### What NOT to do

- **Don't reintroduce a cumulative basis on any layer-1 principle.** The five
  are comparable only because they sample the same instant. One principle
  integrating over 171 years while the others sample one year is a units error
  that happens to typecheck.
- **Don't key AR at its data year (2022).** Every principle is keyed at
  `year_base`; the data year belongs in `source`. Keying one principle
  differently would make the chain's year resolution silently
  principle-dependent.
- **Don't change AR without moving `unit` and `source` with it.** The guard
  pins the totals, the year and the metric together precisely so a re-sourcing
  cannot leave a stale citation behind.

### `DownscalingLayer.sources` is display-only

`sources: dict[principle_id, str]` carries provenance per (layer, principle),
keyed the same way as `data` because layer 1's AR series and its EpC series
come from different places. The exported AESACFG **Sharing Data** sheet has had
a `Source` column since the sheet existed and wrote `""` into it, so a reader of
an exported configuration could not tell where any number came from. It now
writes `layer.sources`, and the import reads the column back (optional — older
workbooks import unchanged, yielding empty provenance).

**Nothing in the engine reads it**, so a wrong or missing source can never
change an SR — locked by a test that mutates every source to garbage and
asserts every chain factor is unmoved. Unlike `Resolution`, a row that
disagrees with an earlier row for the same principle is **not** rejected: the
first non-blank wins, because provenance is a comment field and failing an
import over a typo in one would be worse than the disagreement.

### The Phase B golden covers the AR-allocated boundaries

`tests/fixtures/phase_b_no_drift.json` covered `climate_change` (EpC) and
`acidification` (AGR) only, so layer 1's AR pair was the one sharing value no
golden row depended on — it could be re-sourced (scope, vintage, window and
all) with the file still green. It now also covers `ozone_depletion`,
`particulate_matter` and `photochemical_ozone_formation`, and the vacuity test
asserts that coverage **by name**, not by row count, so the next boundary added
to the AR set cannot silently fall outside it.

**Regenerate it by running the probe, never by hand**:
`python -m tests.test_phase_b_no_drift '<why these numbers moved>'`. The
provenance argument is required and lands in `_generated_from` next to the
numbers it explains. The module docstring claimed a probe was "reproduced
below" for a whole patch cycle while there was only prose describing one.

### AESA compute source toggle — Fleet (DSM) vs Single-product (LCA) (Part C1)

The AESA compute path is **source-agnostic**. A toggle at the top of the
Compute Source area (`ComputeSourceCascade`, `aesa-source-toggle`,
default **Fleet (DSM)** so the fleet path is unchanged) switches between:

- **Fleet (DSM)** — the cascade below (DSM model → scenario → background); AESA
  consumes the upstream fleet `ImpactAssessmentResult` (the Patch 4O path).
- **Single product (LCA)** — AESA consumes
  `useSingleProductImpactStore.staticResult` (an `ArchetypeLCACalculateResult`)
  directly. The request carries `single_product_result` + `reference_year`
  (default **2025**); the backend (`single_product_to_impact_result`, done in
  3fb9355) adapts it to a single-reference-year impact and **skips the DSM
  system-match check** (`mfa_system_id` may be empty). No DSM system required.

**Mode state lives on `useAESAStore`** (`source`, `referenceYear` + setters,
reset to `'fleet'`/2025 on project reset) so both `ConfigSidebar` and
`AESADashboard` (its right-panel empty states) read it. **Mode-specific controls
are visibility-toggled (`display:none`, kept mounted)** — `aesa-source-fleet-controls`
/ `aesa-source-single-controls` — never conditional-unmount.

**Gate is relaxed per source via the pure `canComputeAESA(...)`**
(exported from `ConfigSidebar.tsx`): single-product enables Compute when a
`staticResult` is present (no `activeSystem`); **fleet gate is unchanged**
(needs active system + cached impact). The compute args are built by the pure
`buildAESAComputeArgs(...)` — single-product → `{mfaSystemId:'',
singleProductResult, referenceYear}`; fleet → the task-id / inline-mirror shape.
Both helpers are unit-tested (`tests/aesaSingleProductSource.test.tsx`).

**Everything downstream is reused unchanged** — boundary-set mapping (auto-suggest
reads the single-product result's `method` tuples when in single-product mode),
the sharing config (PresetSelector / DownscalingChainEditor / PrinciplesEditor /
CategoryAssignmentsTable), the carbon-budget config + basis toggle, and the SR
views. The SR views render a single-reference-year result acceptably; the
multi-year timeline degenerates to a single point (a single-year summary
fallback is a possible follow-up, not part of C1). Out of scope: the per-product
SOS-share form (C2) and the prospective single-product source (v2).

#### What NOT to do (Part C1)

- **Don't require a DSM `activeSystem` in single-product mode.** The relaxed
  gate (`canComputeAESA`) and the empty-`mfaSystemId` request are the whole
  point — the backend adapter has no DSM system. Keep the fleet gate as-is.
- **Don't conditional-unmount the mode-specific controls.** They visibility-
  toggle (`display:none`); unmounting loses the picker / reference-year state
  and is the disappearing-control failure class.
- **Don't fork the downstream sharing / boundary / carbon-budget / SR-view
  code for single-product.** It already operates on the adapted result; the
  source toggle only changes what feeds the compute.

### Single-product AESA: Static | Prospective basis + source relabel (Part C2)

**Source-toggle relabel + reorder (labels/order only — keys + default
unchanged).** The source toggle now reads `[ Single product (LCA) ]
[ System-level (DSM) ]` (single-product first/left); "Fleet (DSM)" → "System-level
(DSM)". The underlying enum is **still** `'fleet' | 'single_product'` and the
default-selected source is **still** `'fleet'` (store default) — the visual array
order is independent of which is selected. Testids unchanged
(`aesa-source-fleet` / `aesa-source-single`).

**Single-product gains a Static | Prospective sub-toggle** (`aesa-sp-basis-toggle`,
`aesa-sp-basis-{static,prospective}`), same visual style as the source toggle,
**default Static** (preserves Part C1 behaviour). Basis state lives on
`useAESAStore.singleProductBasis` (reset to `'static'`). The two basis bodies
(`aesa-sp-static-controls` / `aesa-sp-prospective-controls`) are
**visibility-toggled (kept mounted)**, never unmounted.

- **Static** (unchanged from C1) — reads `useSingleProductImpactStore.staticResult`,
  keeps the **Reference Year** input; backend flat-adapts at `reference_year`
  (`single_product_to_impact_result`), impact held FLAT across the SR horizon,
  SR moves only via SOS/budget depletion.
- **Prospective** — reads the year-resolved trajectory from
  `useSingleProductImpactStore.projectedRuns` (`ProjectedRun[]`, per-(db,year)).
  `selectProspectivePoints(runs)` (pure, exported) reduces them to ONE coherent
  series: the **first (iam,ssp) trajectory** by appearance order, year-points
  sorted, null-year (superstructure) runs dropped. Sent as
  `prospective_single_product: [{year, result}]`; **Reference Year is hidden**
  (the year axis comes from the trajectory). Backend
  `prospective_single_product_to_impact_result` builds one `DSMLCAResult.years`
  entry per year (NO flat adapter) → the engine emits one SR row per (boundary,
  trajectory year); years outside the budget horizon yield a non-positive
  allocation → SR None (existing engine behaviour = the "intersected with
  SOS/budget coverage" semantics).

**Explicit request discriminator (not field-overloading):**
`AESAComputeRequest.single_product_basis: Literal['static','prospective'] =
'static'`. Precedence in `post_compute`: `prospective_single_product` (non-empty)
→ `single_product_result` → task/inline. Fleet + static single-product paths are
**byte-for-byte unchanged**. The pure helpers fold the third basis in:
`canComputeAESA` gates prospective on `hasProspective`; `buildAESAComputeArgs`
emits `prospectiveSingleProduct` (empty `mfaSystemId`, no `referenceYear`).

**Sensitivity cases**: single-product Projected does not expose the parameter
(sensitivity) axis, so prospective runs are all "Base" — consume them as-is
(no multi-case overlay). If a future build adds per-case projected runs, pick the
Base case the same way the rest of the app does.

Locked by `tests/aesaSingleProductSource.test.tsx` (helpers across all three
bases + selectProspectivePoints + label/order + basis sub-toggle render) and
`tests/test_aesa_single_product.py` (prospective adapter multi-year series +
per-trajectory-year SRs + precedence + static-path-unchanged).

#### What NOT to do (Part C2)

- **Don't flip the default-selected source when reordering the toggle.** The
  array order is visual only; `source` defaults to `'fleet'`. Keep the enum
  keys/values and testids stable — only labels + order changed.
- **Don't flat-adapt the prospective basis.** Its impacts are already
  year-resolved (background evolved with the SSP); feed them straight to the
  engine via `prospective_single_product_to_impact_result`. No `reference_year`
  in the prospective branch.
- **Don't merge multiple (iam,ssp) trajectories into one SR series.**
  `selectProspectivePoints` takes the first trajectory; the backend also dedups
  by year (first wins) as a guard. A multi-trajectory overlay is a separate
  feature, not this build.
- **Don't conditional-unmount the basis bodies or hide Reference Year by
  unmounting.** Reference Year lives inside the `display:none` static body in
  prospective mode (kept mounted).

### Single-product AESA: what the impact is per (EVS40, items 1–4)

The SR divides an impact by an allocated SOS that is **per year**. The
single-product adapters document the functional unit as a single-year flow and
never divide, so the run must already be one year of the product. Nothing on
screen said so, and an EVS40 run compared a whole-life pLCA total (51,993.786
kg) with a per-year SOS (543.092 kg/yr): SR 95.7.

**`AESAConfiguration.impact_basis`** — `"as_computed"` (default, the previous
behaviour, numbers unchanged) or `"per_year"`, which divides every impact
magnitude by the lifetime the consumed run's stage amounts were scaled with
(`core/aesa_impact_basis.annualise`). `post_compute` → `_apply_impact_basis`
refuses `per_year`:
- for a fleet source (a fleet's yearly impact is already per year);
- unless the run used the **Lifetime** preset (`single_product_stage_meta`);
- for a BOM that **already divides by the lifetime** —
  `lifetime_division_rows` finds rows whose expression divides by the
  referenced lifetime parameter, or by any parameter equal to the lifetime.

**The third refusal is the reason the option exists in guarded form.** The
EVS40 EV9 archetype divides Manufacturing and End of Life by `lifetime_yr`
itself, so its 1-year run (3,249.61 kg in 2025) is already per year; dividing
by 16 again would report 203 kg and SR 0.37. Default stays `as_computed`
because that is the documented contract; the label makes it visible.

The basis is echoed on `AESAComputeResult` (`impact_basis`, `lifetime_years`)
and stated in ONE wording, `impact_basis_label()` (backend) ==
`impactBasisLabel()` (`utils/aesaImpactBasis.ts`), under the zone cards, in the
Detail table headers, in the Radar tooltip, and in the export (Summary rows +
two columns APPENDED to "Impacts vs SOS"; existing headers unchanged because
readers address them by name).

**Stage-amount provenance is frozen at compute time.**
`singleProductImpactStore.staticRunMeta` / `projectedRunMeta`
(`toStageAmountsMeta`) are set when a run starts and read by the three
single-product exports and by AESA. Reading the live editor entry instead is
what made an export print "Lifetime 15" beside "Use Phase 16". A lifetime taken
from a parameter (`lifetimeParam`) is re-derived when that parameter changes
(`SingleProductImpact`), and the export's Lifetime row says "not used" under
1-year or custom amounts.

**The prospective "Year range" is not a lifetime.** It is the span of
background databases, one functional unit per year. Nothing derives a lifetime
or stage amounts from it; the EVS40 "16" came from `lifetime_yr = 16`, not from
2025–2040. The workbook says so ("Year range means"), and the Prospective tab
warns when the two differ on the Lifetime preset.

**The AESA export saves server-side in the packaged app.** `POST
/aesa/export/save` writes the same workbook (same `excel_bytes` stamping) to
~/Downloads via `system.save_to_downloads`, shared with `/system/logs/save`.
`exportAESA` takes that route when `isPackagedDesktop()`. That is not because a
blob download cannot work there (most exports use one, successfully; see "The
packaged app is a REMOTE http origin"): the export's failures were the early
return and the 404, and the saved path is shown to the user. Both export routes
work without a DSM system (`source_name` names the file). Tested along the
real path: `test_aesa_export_real_path.py` starts uvicorn and POSTs real bytes
with the real header, then opens the file the server wrote.

**One budget-basis control.** The CO₂ / CO₂-eq toggle above the result views
was removed; the Configuration panel's is the only one. `setBudgetBasis` (store)
is now unused by the UI and kept only because its tests document the
re-compute contract.

#### What NOT to do

- **Don't default `impact_basis` to `per_year`**, and don't divide without the
  three refusals. A BOM that annualises itself is indistinguishable from a
  whole-life one by its numbers alone.
- **Don't read the live stage-amount editor in an export or in AESA.** Read the
  run's frozen meta.
- **Don't rename the "Impacts vs SOS" headers.** Append.
- **Don't add a third download mechanism.** Two exist: the blob download
  (everything, both environments) and the server-side save (Logs and AESA, in
  the packaged app only).

### AESA sensitivity cases: chosen, computed, shown, exported

Two kinds of case beside the base, both offered by the case window
(`CaseSelectionModal`, opened by Compute when `availableCases()` is non-empty):

- **sharing** — the existing per-principle sweep
  (`compute_with_sensitivity`, now narrowed by `principles=`). Testable
  principles follow ONE rule on both sides: every category-specific layer has
  data for it (`sharingCaseOptions` mirrors the engine).
- **parameter** — the project's parameter sensitivity cases. Before this they
  never reached AESA (it consumes one impact result; single-product Prospective
  never computed cases at all). `_parameter_cases` re-runs
  `calculate_archetype_lca` with `parameter_scenario=case` for the static result
  or every prospective year, applies the impact basis (and its refusals), and
  computes the SR. Single-product sources only: a fleet case is a full DSM × LCA
  run and is refused with a 400, not approximated.

Request: `sharing_cases` (None = old behaviour, every testable principle;
`[]` = none), `parameter_cases`. Response: `AESAComputeResult.cases`
(`AESACase`: id `sharing:EpC` / `parameter:v1g`, label, definition lines,
results). `sensitivity` stays for the box plot. The selection is remembered for
the session (`aesaStore.caseSelection`) and cleared on project change;
`activeCaseId` drives the switcher and resets on every new result or session.

Export: "Sensitivity" is now WIDE (Year, PB ID, Impact category, Abbreviation,
Base SR/zone, then SR / ΔSR / zone per case); the old long sheet is
"Sensitivity (long)"; case definitions are rows in Summary. A result saved
before `cases` existed is read from `sensitivity` as sharing cases.

The Cases view (`CaseComparisonView`) labels categories with the boundary's
`conventional_acronym` (GWP100, ETfw, ADPmm, LU …), an exception to the
"never an acronym on a label" rule in `aesaBoundaryLabels.ts`, made for this
figure on request; full names stay in tooltips.

#### What NOT to do

- **Don't compute parameter cases for a fleet source by reusing the base
  simulation.** A case can change the inventory AND (via scaling rules) the
  stock; refuse rather than half-apply it.
- **Don't let the window and the engine disagree on testable principles.**
- **Don't feed the switcher's case rows to the export.** The export always
  sends the full result with every computed case.

### AESA configuration save: one builder, single-product allowed

`post_configuration` / `put_configuration` build the model with
`_config_from_body` (the body's fields wholesale) and check the system with
`_check_system` (only when one is named). Listing fields by hand had dropped
`sharing`, `sharing_preset_id` and `dsm_scenario_id` on every save, and looking
up `None` made every single-product save a 404. The builder sets
`derived_defaults_migrated=True`: the storage layer's one-time migration clears
`sharing` on any configuration WITHOUT that flag, so without it a custom chain
saved here would be wiped on its first load. `test_aesa_config_save_single_product.py`
reads back through both load routes for that reason. The dashboard dropdown
lists configurations with no `mfa_system_id` when the source is single-product.

The "Impacts vs SOS" **Unit** column states the IMPACT's unit under its basis
(`impact_unit`: "… per functional unit" or "…/yr"); "SOS basis" carries the
SOS's per-year unit. Positions unchanged.

### Impact-category lists collapse through ONE component

`components/ui/CollapsibleBlock` wraps every picker and table that lists
impact categories: `IndicatorChecklist` (all pickers, `collapseKey` per page)
and the single-product Static / Projected / Comparison, Multi-item, LCA
Calculator (3), Monte Carlo distributions and AESA Detail tables. Body hidden
with `display: none` (never unmounted), summary always visible, state in
localStorage under `mapper.collapse.<key>` inside try/catch (renders expanded
without storage). Not wrapped, deliberately: the system-level DSM / Prospective
year-detail tables (rows are cohorts) and the Monte Carlo pairwise view (one
indicator at a time). `tests/collapsibleImpactCategories.test.tsx` lists the
surfaces; add a new category list there.

The picker's category headers are NOT sticky: a sticky header inside its own
section hid a one-row category's only row (EF v3.1 acidification). Chips use
`disambiguatedLabels`, because two EF v3.1 indicators are both "accumulated
exceedance (AE)".

### AESA Compute Source cascade (Patch 4O)

AESA is a **downstream consumer** — `POST /aesa/compute` takes an
`ImpactAssessmentResult` (inline or by `task_id`) and runs the
sharing/aggregation pipeline against its per-method per-cohort
impacts. AESA does **not** run LCA itself. The Compute Source
cascade therefore picks **which upstream Impact Assessment result
feeds AESA** (in Fleet mode), not parameters for an AESA-owned pipeline.

The cascade exposes the methodological hierarchy explicitly with
three levels in the Configuration sidebar:

1. **DSM model** — dropdown over `dsmStore.systems`. Picking a
   different model calls `dsmStore.selectSystem(id)` which swaps
   `activeSystem`. Because Impact Assessment results are tied to
   the active system at compute time, switching here typically
   requires re-running Impact Assessment for the new system before
   AESA has anything to read; the cascade surfaces this via the
   inline "no run cached" hint.
2. **Scenario** — dropdown over `systemState.scenarios`. Picking a
   scenario writes `draft.dsm_scenario_id` and calls
   `selectStaticDsmScenario(id)` / `selectProjectedDsmScenario(id)`
   to mirror the matching multi-DSM run into the per-tab
   `staticResult` / `projectedResult` slot. Single-scenario mode
   (no fan-out) leaves the runs map empty; the cascade then trusts
   the single available result and suppresses the "no run cached"
   hint to avoid false positives.
3. **Background** — Static / Prospective radio. Routes
   `draft.impact_mode` between `staticResult` and `projectedResult`
   in the existing pattern.

**Persistence**: `AESAConfiguration.dsm_scenario_id: str | None`
added to the schema. `None` is the backward-compat default for
pre-Patch-4O saved configs and freshly-defaulted drafts; the
sidebar resolves `None` to "use whatever's active" at render time
(active scenario id, falling back to base). Saving a config writes
the explicit cascade pick.

**Compute Source summary** (`data-testid="aesa-compute-source-summary"`)
on the AESA result header reads `{system} · {scenario} · {background}[ · IAM/SSP]`,
e.g. `MAp-DK Passenger Cars · SSP2 · Prospective Background · REMIND/SSP2-PkBudg1150`.
Users reading exported reports can immediately see what was
computed against without backtracking through the configuration
panel.

#### What NOT to do

- **Don't flatten the cascade back to a single radio "because it
  looks simpler".** The methodological hierarchy is meaningful for
  users assembling research outputs — the (system, scenario,
  background) trio is what defines the AESA computation, and
  hiding any of those choices behind implicit defaults invites
  reproducibility drift. The flat `<LciSourceRadio>` was the
  pre-Patch-4O state and was exactly the regression the cascade
  fixes.
- **Don't bundle multi-scenario AESA into the cascade.** The
  cascade is **single-select** — pick one (system, scenario,
  background) trio and run AESA against the matching upstream
  result. Multi-scenario AESA (running AESA against N DSM
  scenarios for comparison) is a separate methodological feature
  that should follow Impact Assessment's multi-DSM fan-out pattern
  when implemented (per-task envelope, server-side fan-out,
  scenario tab bar above results). Deferred — not a v1 cascade
  concern.
- **Don't add LCI scenario as a fourth cascade level.** LCI choice
  is the *Background* radio; further LCI scenarios (REMIND/SSP1
  vs. REMIND/SSP2 etc.) are picked when the user runs Impact
  Assessment in Prospective mode and propagate through the
  upstream `ImpactAssessmentResult`. The cascade reads which LCI
  scenario was used from `projectedResult.meta.scenario` and
  appends it to the Compute Source summary line.
  - **Patch 5AQ — multi-LCI scenario picker (NOT a cascade level).**
    When the Prospective Background run computed N>1 LCI scenarios,
    ConfigSidebar shows a small `<select>` (`data-testid=
    "aesa-lci-scenario-select"`) under the cascade letting the user
    pick WHICH already-computed scenario AESA assesses — no re-run.
    This is frontend-only: the run persists all N full
    `ImpactAssessmentResult`s in `useImpactStore.projectedMultiResult
    .scenarios[]`, and AESA consumes a single result inline
    (`computeAESA({impact_result})`, same path as the DSM mirror).
    The store hardcodes `projectedResult = scenarios[0].result`, so
    the picker overrides that pin: `activeImpact` and the compute's
    `impactInline` become `scenarios[idx].result`. Default idx 0
    (prior behavior); reset to 0 when a fresh multi run lands. The
    chosen scenario is passed **inline** (not via the single shared
    multi-LCI `task_id`, which only resolves scenario 1). Single-LCI
    / static modes are unchanged. Locked by
    `tests/aesaLciScenarioPicker.test.tsx`. This is still "AESA can
    only consume what Impact Assessment already produced" — it just
    lets the user choose among the produced scenarios rather than
    being pinned to the first.
- **Don't compute against a (system, scenario, background) trio
  whose Impact Assessment result isn't cached.** The cascade's
  inline "no run cached" hint blocks this with a clear pointer
  back to Impact Assessment. The Compute button is gated on
  `hasImpact` (the per-tab slot is non-null), so the failure mode
  is absent rather than misleading.
- **Don't write `dsm_scenario_id` on save unless the user made an
  explicit pick.** The factory default is `null` and the sidebar
  resolves it to "active scenario" at render. Eagerly writing the
  resolved id would lock saved configs to whatever scenario was
  active at save time — making them brittle to scenario rename /
  delete. The user has to actively pick a scenario from the
  cascade for the id to land in the saved config.

### AESA Configuration empty state (Patch 4Q)

When a project has no AESA configurations yet AND the user
hasn't started creating one, the Configuration sidebar renders an
empty-state block (`data-testid="aesa-config-empty-state"`) in
place of the cascade + downstream sections (planetary boundary
set, sharing preset, downscaling chain, principles, category
assignments, carbon budget, method-mapping). The footer Compute /
Save / Run-sensitivity controls hide too — there's nothing to
compute against, so showing them is misleading.

The empty state contains:
- A header line: **"No AESA configuration yet"**.
- A short explanation pointing at the cascade's purpose.
- A primary "**+ Create your first configuration**" button (testid
  `aesa-config-empty-state-create`) that fires `startNewConfig()`.
- A subtle reminder that the same action is also available via
  the page-header **+ New configuration** button.

**Coordination signal**: the sidebar gates on
`!creatingNewConfig && !activeConfigId && configurations.length === 0`.
The flag flips true via `startNewConfig()` (called by both the
page-header button and the inline empty-state button). It resets
on successful save (`saveConfig` writes `creatingNewConfig: false`
when it inserts the new config into `configurations[]`), on
selecting an existing saved config (`setActiveConfig(id !== null)`),
and on project reset.

**Why a flag rather than `draft != null`**: the draft is auto-
seeded from defaults the moment `loadDefaults` succeeds (see
`aesaStore.loadDefaults` line ~284 — `draft: get().draft ?? draftFromDefaults(defaults, presets)`).
That means `draft != null` is true on every fresh project visit
even before the user has expressed creation intent — using it as
the gate would never show the empty state. The explicit
`creatingNewConfig` flag separates "factory-seeded ephemeral
draft" from "user has decided to create a new config".

#### What NOT to do

- **Don't render the cascade with auto-seeded defaults when no
  config exists.** Pre-Patch-4Q the sidebar rendered the cascade
  + sections against the auto-seeded factory draft, with no
  signal to the user that their edits would be lost unless they
  saved. New users edited the cascade, navigated away, came back
  to find their work gone. The empty-state pattern forces an
  explicit creation step before edits become possible.
- **Don't auto-create a default configuration on first visit.**
  Configurations are explicit user intent — silently creating
  one (with a generic "New AESA configuration" name) clutters
  the saved-configs list with empty/abandoned entries every time
  a user opens the AESA tab. The "+ Create your first
  configuration" button is the explicit entry point.
- **Don't tie the empty state to `draft == null`.** That state
  is unreachable in practice once `loadDefaults` succeeds.
  Patch 4Q's `creatingNewConfig` flag is the right semantic
  signal: it captures "user has decided to create" without
  conflating with "draft has been auto-seeded".
- **Don't keep the footer Compute / Save / Run-sensitivity
  affordances visible in the empty state.** They invite the
  user to compute against an unsaved factory draft, which is
  the orphan-state path Patch 4Q removes. Hide them; the
  empty-state guidance + create button supplant them.
- **When testing the cascade, set `creatingNewConfig: true` in
  the test fixture.** Tests for the cascade that stub
  `configurations: []`, `activeConfigId: null`, and
  `creatingNewConfig: false` will hit the empty-state branch and
  the cascade won't render — the test then asserts on a hidden
  cascade and fails. Patch 4O cascade tests already needed this
  fix when Patch 4Q landed; future cascade-rendering tests
  should mirror the pattern.

### Long calculations: the full-screen `<ComputeOverlay>` (walkthrough 4)

Every calculation that can take more than ~10 s shows
`components/ui/ComputeOverlay.tsx`: a dimmed full screen with a centred card in
the desktop startup screen's style (the `LOADING_DATA_URL` page in
`mapper-tauri/src/main.rs`): spinner, what is running (title), what it is doing
(detail, e.g. "5 cases × 6 sharing · 4 LCA reruns"), elapsed M:SS, a % bar only
from a REAL pct, and Stop when the run can be stopped (the Stop button behind
the card is unreachable). Clicks are swallowed by the backdrop (and its
`stopPropagation` keeps portal events from reaching the owning panel's React
handlers); `inert` on `#root` blocks the keyboard. Portalled into
`document.body`. The card is revealed after `OVERLAY_REVEAL_MS` (250 ms) so a
sub-second run never flashes one; clicks are blocked from the first frame.

Entry points (measured on EVS40 / MAp-test, 2026-10-21): AESA compute with
cases (77 s; owned by `AESADashboard`, not the sidebar, whose collapsed variant
has no body), system-level Prospective (63 s) and Static (11 s with 25
indicators), single-product Prospective (19 s for 4 years) and Static (4 s),
Multi-item comparison, Monte Carlo single (69 s) and paired, DSM simulate, and
project export/import (`ProjectSwitcher`; a full export streams the whole
Brightway project). Locked by `tests/computeProgressCoverage.test.tsx` and
`tests/computeOverlay.test.tsx`.

**Why Prospective Calculate showed nothing (the first version).** Not the
request: `POST /impact/calculate` answers with a task id in ~0.01 s (measured,
MAp-test Car Fleet). `ProjectedImpactPanel`'s running flag was a ternary —
`scenarioProgress ? done < total : projectedJob running || …` — and a
single-scenario `run()` never clears `projectedScenarioOrder`. After one
Sensitivity-cases run on that tab, every later plain Calculate read "not
running", and `requestStop` only collected the finished fan-out tasks. Each
slot now counts on its own (`tests/projectedProgressAfterSensitivityRun.test.tsx`).
Both system-level panels also hold a `submitting` flag from the click until
the request returns, so the card never waits on the network.

`<ComputeProgress>` (below) remains for the inline cases not on this list:
pLCA generation, contribution analysis, and the LCA Calculator.

### Compute-progress unification — `<ComputeProgress>` (Patch 5AL)

All live compute-progress is the shared
`<ComputeProgress>` (`components/ui/ComputeProgress.tsx`) — the pLCA-Developer
separate-card treatment, app-wide. It's fed by `useElapsedSeconds` (the single
elapsed source) and renders **M:SS via `formatElapsed`**. Props: `{ label,
active, bar?: 'determinate'|'indeterminate'|'none', pct?, statusColor?, onCancel?,
cancelSlot? }`. The card renders only while `active`; the hook is called
unconditionally before the early return (Rules of Hooks).

**Bar rule — never fabricate progress.** `determinate` only where a REAL pct
exists: pLCA (`job.pct`), Prospective/Projected (WS `job.pct`), and the single-
product Static/Projected panels (their `done/total` fan-out count IS a real
fraction). `'none'` (spinner + elapsed) for instant/uncountable contexts:
Multi-item comparison (synchronous fan-out, boolean only — no bar) and LCA
Architect's contribution loading (phase label). `'indeterminate'` is reserved
for DSM Static, whose multi-slot fan-out exposes no single aggregable pct.

Migrated: pLCA `JobProgress` (running branch — its terminal "completed in X" +
Dismiss state stays, post-result metadata), `ContributionAnalysisPanel`,
`DSMImpactPanel`, `ProjectedImpactPanel`, `MultiProductLCA` (the teal "Computing…
Ns" pill is **deleted** — button morphs to spinner-only), `SingleProductStaticPanel`,
`SingleProductProjectedPanel`, and AESA `ConfigSidebar` (net-new). The bespoke
`useState`+`setInterval` timers in DSMImpactPanel/ProjectedImpactPanel are
retired (DSM keeps `completedElapsed` for the post-result line only). Locked by
`tests/computeProgress.test.tsx` + `tests/computeProgressMigration.test.tsx`.

> **All live compute-progress uses <ComputeOverlay> (long runs) or <ComputeProgress> (inline), both fed by useElapsedSeconds (M:SS via formatElapsed); never a bespoke setInterval timer, an in-button elapsed label, or a fabricated progress bar — the bar is determinate only from real pct, else 'none'.**

**Sole documented exception: `MethodLibrary`.** Its install rows interleave the
elapsed with a stateful `<StopButton>` and render a separate determinate bar —
hosting the card would relocate cancellation UI (out of scope) and restructure
the compact per-row list. It remains the **only** importer of the
`<ElapsedCounter>` COMPONENT (locked by
`tests/computeProgressMigration5AN.test.tsx`). `ComputeProgress` and
`PLCADeveloper` import only the pure `formatElapsed` helper from the same file —
not the component.

**Patch 5AN — the 6 remaining inline timers were migrated** (closing the 5AL
follow-up): `LCACalculator`'s five `startedAt` timers and `DSMDashboard`'s
simulation timer now use `<ComputeProgress>`. Bar modes by honest signal:
multi-year is **determinate** (real backend `myProgress.pct`, 0–100 → `/100`),
its `<StopButton>` left untouched in the control row (only the progress text +
elapsed consolidated into the card below); activity / archetype / both
contribution loaders and the DSM sim are **none** (single indivisible ops with
no pct). The dead per-timer `startedAt` states + their setters were removed
(`<ComputeProgress>` derives elapsed from `useElapsedSeconds(active)`); only
`caStartedAt` survives because it's still passed as
`ContributionAnalysisPanel.loadingStartedAt` (a now-ignored prop).

### Elapsed-timer wiring in multi-axis panels (Patch 4P)

Elapsed-time displays in multi-scenario panels need an `active`
flag that reflects **"any task in any active fan-out is still
running"** — not a single legacy slot.

The bug shape: `DSMImpactPanel`'s elapsed timer was wired to
`isCalculatingLCA` only — the legacy single-task boolean from
before Patches 2C / 2E.2 added multi-parameter and multi-DSM
fan-out. Both fan-outs spawn N parallel tasks under
`staticScenarioRuns` / `staticDsmScenarioRuns` (Static side) and
`projectedScenarioRuns` / `projectedDsmScenarioRuns` /
`pairedScenarioRuns` (Projected side). None of those flip
`isCalculatingLCA`, so the timer stayed at "0:00" throughout the
calculation. Stop button + progress bar still worked because they
already watched the right slots — the timer wiring was the gap.

**Fix shape**: compose a single `isAnyCalculating` boolean
covering every slot the panel can have a task in, then key the
timer effect on it. `DSMImpactPanel` already had this composed
for other uses (Stop button gating); the timer just needed to
read the same boolean. `ProjectedImpactPanel` had a partial
`isRunning` covering parameter-axis fan-out + the legacy single
task; Patch 4P extended it with `dsmCalcRunning` (multi-DSM fan-
out) and `pairedCalcRunning` (paired DSM × LCI).

**Test** (`tests/dsmImpactPanel.elapsedTimer.test.tsx`): stub
the impactStore with a multi-DSM run-in-flight shape (no
`isCalculatingLCA`, only `staticDsmScenarioRuns[id].job.done =
false`), advance fake timers, assert the elapsed display moves
off "0:00". Mirror test for multi-parameter axis. Idle-state
sanity test ensures the timer doesn't tick when no task is
running. Verified the test catches the bug by temporarily
re-wiring the effect to `isCalculatingLCA` only — the fan-out
cases failed, confirming the test is load-bearing.

#### What NOT to do

- **Don't add new fan-out slots without updating the
  `isAnyCalculating` / `isRunning` derivation.** Every panel
  that watches "is anything in flight?" needs to be in sync
  with the store's slots. The next time someone adds a new
  axis (e.g. cartesian fan-out, or a new mode beyond Static /
  Projected / paired), the elapsed timer + Stop button + progress
  bar all need to learn about it. Centralise in one boolean per
  panel; reference that boolean from every UI surface.
- **Don't write panel-local timer effects keyed on a single
  store slot.** Multi-axis panels must derive `isAnyCalculating`
  from the union of all task-bearing slots. The pre-Patch-4P
  shape — keying on the legacy `isCalculatingLCA` only — is
  exactly the bug class to avoid. If you find yourself writing
  `useEffect(..., [singleSlot])` for a timer in a multi-axis
  panel, you've reproduced this bug.
- **Don't reach for the shared `useElapsedSeconds` hook from
  single-product mode for the system-mode panels.** That hook
  takes a single `active: boolean` and ticks while it's true.
  System-mode's "active" is a derived boolean over multiple
  store slots, not a single state field — using the shared
  hook would require the same union logic anyway, and
  duplicating the timer logic across two patterns invites
  drift. The panel-local `useEffect + setInterval` pattern is
  fine; just feed it the right boolean.

### AESA export config may have `multi_d=None` (Patch 5AS/5AT)

The config posted to `/aesa/export` (and any `AESAConfiguration`) frequently has
**`multi_d=None`** — modern configs are sharing-preset based (the N-layer
refactor made `multi_d` the legacy optional shape; the frontend's synthesized
export config omits it entirely). `_build_aesa_workbook` had **unconditional
`config.multi_d.*` dereferences** (Summary "Layer 2" row, the whole "Multi-D
Configuration" sheet, Methodology rows) → `AttributeError` → 500 on every real
export. **Guard EVERY `config.multi_d` dereference** (`if config.multi_d is not
None:`); skip the legacy Multi-D rows/sheet cleanly when None. Everything else
(impact / allocated SOS / SR / the 5AS allocation-chain columns / zone table /
budget+SSP+horizon+sensitivity metadata) must emit for BOTH config shapes.

**Export tests must cover the `multi_d=None` path, not only non-None.** The 5AS
fixture set `multi_d` to a `MultiDConfig`, so it never hit the real export path
and a latent 4T crash shipped. `tests/test_aesa_sr_export.py` now tests both
shapes; the `multi_d=None` build-without-raising test is the load-bearing one
(it's the path every real export takes).

### AESA saved sessions (Patch 4R)

AESA carries two persistence surfaces with **different lifecycles**:

- **`AESAConfiguration`** (Patch 4O / 4Q) — *reusable input
  templates*. The user defines a cascade + sharing preset + method
  mapping once; it lives in the configurations list and is mutable
  through the editor. `aesa_storage.py` persists at
  `STORAGE_DIR/{project}/{config_id}.json`.
- **`AESASession`** (Patch 4R) — *immutable historical records of
  one compute event*. Configuration snapshot at compute time +
  result + traceability reference to the upstream Impact Assessment
  task. `aesa_session_storage.py` persists at
  `STORAGE_DIR/{project}/sessions/{session_id}.json`. Newest-first
  on `load_all` (ISO-8601 timestamps sort lexicographically).

**Backend routes** (`mapper/api/aesa.py`):
`GET /aesa/sessions` (list newest-first), `GET /aesa/sessions/{id}`,
`POST /aesa/sessions` (create with server-assigned uuid + timestamps),
`PATCH /aesa/sessions/{id}` (rename only — snapshot + result are
immutable), `DELETE /aesa/sessions/{id}` (hard delete).

**Frontend store**: `useAESAStore` gains `sessions[]`,
`activeSessionId: string | null`, plus actions
`loadSessions / saveCurrentSession / loadSession / renameSession /
deleteSession / clearActiveSession`. When `activeSessionId !== null`
the dashboard is in **session-loaded mode**: the cascade displays
the saved snapshot, the sharing preset / chain / mapping reflect
what was computed against, and the result body shows the saved
data.

**Frontend UI**:
- Page header: `Save session` button (`data-testid="aesa-save-session"`)
  appears when a result is on screen and not in session mode. Opens a
  modal pre-filled with `AESA · YYYY-MM-DD HH:mm · {system} · {scenario} · {Static|Prospective}`;
  user can override.
- In session-loaded mode the page-header `Save session` button is
  replaced by a `Return to live view` button
  (`aesa-return-to-live`); the sidebar footer's `Compute` / `Save` /
  `Run sensitivity` stack is replaced with a single full-width
  `Return to live view` button (`aesa-sidebar-return-to-live`).
- Configuration editing region wraps a `<fieldset disabled>` keyed
  on `inSessionMode` (`data-testid="aesa-config-fieldset"`). Native
  HTML disables every nested input/button/select in one go, no
  per-control wiring needed.
- Saved Sessions sidebar section (`<SavedSessionsList>`) renders
  newest-first; each row has rename (pencil) + delete (trash)
  buttons. Empty state (`aesa-sessions-empty`) shown when no
  sessions exist for the project. The list is rendered **outside**
  the disabled fieldset so users can switch / rename / delete
  sessions without first exiting session-loaded mode.
- Delete confirmation modal (`aesa-session-delete-modal`) — hard
  delete only, with the danger-styled confirm button labelled
  `Delete`.

#### What NOT to do

- **Don't reuse the configuration save flow for sessions.**
  Configurations are templates (reusable inputs); sessions are
  results (computed outputs with their input snapshot). Different
  lifecycle, different storage location, different UI affordances.
  Conflating the two creates ambiguous state where "load" might
  mean "load template" or "load saved result." Keep the two
  surfaces strictly separate — different store slots
  (`configurations` vs `sessions`), different file paths
  (`{config_id}.json` vs `sessions/{session_id}.json`), different
  pages of the sidebar.
- **Don't save sessions without snapshotting the configuration.**
  The live cascade is mutable; sessions are immutable historical
  records. A session must capture *exactly* what was computed
  against — if a user later edits the config, the saved session
  must continue to display the values that produced its result.
  Patch 4R's `saveCurrentSession` builds a fresh
  `AESAConfiguration` from the live draft and embeds it in the
  session payload. Future changes to the live cascade do not
  propagate.
- **Don't soft-delete sessions in v1.** Hard delete with
  confirmation modal is the simpler safety mechanism. Soft delete
  adds Trash UI complexity for marginal recovery benefit; revisit
  if users report accidental deletion as a real pattern.
- **Session-loaded mode must visually freeze the cascade AND
  replace Compute with Return-to-live in BOTH places** (page
  header + sidebar footer). Without both signals, users can edit
  cascade values thinking they're modifying the live state, only
  to be confused when their changes don't apply to the saved view.
  The `<fieldset disabled>` covers cascade edits; the page-header +
  footer button swaps cover the compute path.
- **Don't render the saved-sessions list inside the disabled
  fieldset.** Users navigating between saved sessions shouldn't
  have to exit the current saved view first — that's two clicks
  for what should be one. Keep the list outside the fieldset; the
  fieldset disables only the *configuration-editing* surface.
- **Don't snapshot the upstream Impact Assessment result inline.**
  The traceability `upstream_ia_task_id` field is the breadcrumb;
  the saved AESA result is self-contained for radar / timeline /
  box-plot / detail-table rendering (all read from
  `result.results` / `result.summary_by_year` / `result.sensitivity`
  directly). Inlining the full upstream IA result would double the
  per-session storage cost (~1–2 MB → ~3–4 MB) for marginal benefit
  given that the IA task may have aged out of the in-memory
  registry anyway by the time someone re-opens a months-old
  session.
- **Don't write `dsm_scenario_id`-style "use the active one when
  null" sentinels into a saved session's snapshot.** Sessions
  resolve to concrete values at save time; ambiguous sentinels make
  reload behaviour project-state-dependent (the active scenario at
  reload time isn't necessarily what was active at save time).
  Patch 4R explicitly snapshots the resolved cascade picks.
