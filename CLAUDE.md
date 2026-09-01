# MApper — AI Context Document

> This file helps AI assistants understand MApper's architecture for debugging and development support.

## What is MApper?

MApper (Multi-method Assessment of Products, Processes and Environmental Resources) is a desktop application for environmental sustainability assessment. It unifies four methods:
- **LCA** (Life Cycle Assessment) — environmental impacts per product lifecycle
- **DSM** (Dynamic Stock Modeling) — cohort-based fleet/stock dynamics with Weibull survival
- **pLCA** (Prospective LCA) — future technology scenarios via premise + IAM models
- **AESA** (Absolute Environmental Sustainability Assessment) — comparing impacts against planetary boundaries

> **Scope**: MApper is a general-purpose assessment tool. The Danish automotive fleet is **one example case study** — all features must work for arbitrary product systems (wind turbines, buildings, electronics, food systems, etc.). Avoid case-study-specific text, defaults, or hardcoded values in UI placeholders, templates, and onboarding.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand (state) + Recharts (charts)
- **Backend**: FastAPI (Python 3.11) + Brightway2 (LCA engine) + UMFPACK (sparse matrix solver)
- **Desktop shell**: Tauri v2 (planned)
- **LCA database**: ecoinvent 3.10 (user-provided, not bundled)
- **Prospective databases**: premise (generates future ecoinvent variants from IAM scenarios)

## Project Structure

```
mapper-frontend/
  src/
    api/client.ts          — all API calls to the backend
    stores/                — Zustand stores (bomStore, dsmStore, parameterStore, etc.)
    pages/                 — main page components (one per module)
    components/
      aesa/                — AESA tab components
      dsm/                 — DSM/Stock Modeller components
      flows/               — Material Flows components
      layout/              — sidebar, header
mapper-backend/
  mapper/
    api/                   — FastAPI routers (bom.py, dsm.py, impact.py, aesa.py, plca.py, parameters.py, subsystems.py, system.py)
    core/                  — computation engines (dsm_engine.py, aesa_engine.py, parameter_engine.py, premise_engine.py, bw2_wrapper.py, log_config.py)
    models/                — Pydantic schemas (dsm_schemas.py, aesa_schemas.py, parameter_schemas.py)
    data/aesa/             — built-in PB-EF boundary values, SSP trajectories, sharing data
  tests/                   — pytest tests
```

## Key Concepts

### Cohort Identity
A core design principle: every product (vehicle) carries its identity (fuel_type, size, birth_year) through the entire pipeline. A "BEV-LFP|Small born in 2028" is traceable from DSM → LCA → pLCA → AESA.

### Stage-Scope Mapping
BOM lifecycle stages map to DSM scopes:
- Manufacturing → inflows (counted at year of production)
- Use Phase + Maintenance → stock (counted annually for all alive)
- End of Life → outflows (counted at deregistration)

### Subsystems
Primary subsystems have their own inflows + Weibull survival. Dependent subsystems (e.g., charging infrastructure) derive stock from the primary via dependency rules. Both flow through Impact Assessment and AESA.

### Parameters
Named parameters (e.g., `battery_mass_lfp = 250`) can be referenced in BOM amount expressions. Multiple parameter sets enable scenario comparison.

### AESA Multi-D Sharing
16 EF v3.1 impact categories each get a category-specific sharing principle (EpC, IN, AGR, LA, AR) to downscale planetary boundaries. Dynamic carbon budget depletes based on SSP-projected global emissions.

## API Routes Overview

| Prefix | Module | Key endpoints |
|--------|--------|---------------|
| /api/bom | Archetypes & BOMs | import, export, template, link materials |
| /api/dsm | Stock Modeller | simulate, upload stock/inflows, state |
| /api/dsm/systems/{id}/subsystems | Subsystems | CRUD, dependency rules, compute |
| /api/impact | Impact Assessment | calculate (static + projected), export |
| /api/impact/methods | LCIA Method Library | list library, install, install-custom, uninstall, WS progress |
| /api/aesa | AESA | configure, compute, boundary-sets, export |
| /api/plca | Prospective LCA | generate premise databases |
| /api/parameters | Parameters | CRUD sets, resolve expressions, template |
| /api/db | Database Explorer | list databases, search activities |
| /api/system | System | logs viewer, log export |

## LCIA Method Library

Users can extend the built-in LCIA methods (EF, ReCiPe, CML, TRACI, IPCC, …) with additional characterisation factor sets via **Impact Assessment → Method Library**:

- **Registry**: `mapper/data/lcia_methods.json` lists downloadable methods with download URLs, per-ecoinvent-version variants, installer type (`bw2package` or `pip`), and size.
- **Installers** (`mapper/core/lcia_method_engine.py`):
  - `bw2package` — downloads a `.bw2package` file from Zenodo and imports via `bw2io.BW2Package.import_file()`. Used by **IMPACT World+ 2.2.1** (variants for ei 3.10 / 3.11 / 3.12).
  - `pip` — runs `pip install <spec>` at install time, then calls a configured entry function. Used by **LC-IMPACT** (via `bw2_lcimpact==0.4.2`).
  - `excel` — accepts a user-supplied `.xlsx` via `bw2io.ExcelLCIAImporter`. UI prompts for name tuple + description + unit (these are not read from the file).
- **Ecoinvent detection**: `detect_ecoinvent_version()` parses installed databases and returns "3.10"/"3.11"/"3.12", or None if ambiguous (UI then shows a version picker).
- **Biosphere matching policy** (Excel path): `<5%` unmatched flows → warn and continue; `≥5%` → fail with a detailed error. This is especially important for stale methods (e.g. LC-IMPACT is ~4 years old; biosphere3 drift may surface here).
- **Manifest**: per-method install manifests live at `{platform user-data dir}/mapper/lcia_methods/<method_id>/manifest.json` and record the registered method tuples so uninstall can remove exactly what was installed.
- **Background tasks**: `POST /impact/methods/install` returns a `task_id`; progress (`{stage, pct}`) streams over `WebSocket /api/impact/methods/ws/{task_id}` until a `done` or `error` frame. Same pattern as `plca`.
- **Dropdown refresh**: on successful install/uninstall the frontend dispatches a `lcia-library-changed` `CustomEvent` on `window`. `useMethodSelection()` in `MethodPicker.tsx` listens and re-fetches `getMethods()`.
- **Install files cached at** `{user-data dir}/mapper/lcia_methods/<method_id>/<filename>` so repeat installs don't re-download.

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

> **All live compute-progress uses <ComputeProgress> fed by useElapsedSeconds (M:SS via formatElapsed); never a bespoke setInterval timer, an in-button elapsed label, or a fabricated progress bar — the bar is determinate only from real pct, else 'none'.**

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

## Logging

- Backend writes a rotating log file at `{platform user-log dir}/mapper/mapper.log` (1 MB × 3 rotations).
- Format: `[YYYY-MM-DD HH:MM:SS] [LEVEL] [module] message`
- Unhandled exceptions are routed through `logging` (both `sys.excepthook` and a FastAPI `@app.exception_handler(Exception)`).
- Frontend captures uncaught errors (`window.onerror`, `onunhandledrejection`, React `ErrorBoundary`) and non-2xx `fetch()` responses into a Zustand `logStore` (last 50 entries).
- Users view combined frontend + backend logs under Settings → Logs (filter, copy, export to `.txt`).

## Common Error Patterns

| Error | Likely cause | Fix |
|-------|-------------|-----|
| "Unlinked materials" in Impact Assessment | BOM materials not linked to ecoinvent activities | Open archetype in LCA Architect, link materials via Database Explorer |
| "No impact assessment results" in AESA | Haven't run Impact Assessment yet | Go to Impact Assessment tab, select indicators, click Calculate |
| UMFPACK singular matrix | Circular reference in ecoinvent or zero-demand product | Check the archetype's ecoinvent links — one may point to a dummy activity |
| "Parameter set not found" | Stale localStorage reference | Clear browser storage or select a different parameter set |
| premise generation fails | Missing encryption key or network issue | Verify premise key is set, check internet connection |
| premise superstructure write fails (e.g. biosphere flow lookup) | Known premise edge case on ecoinvent 3.10 | Engine falls back to separate per-year databases with a `fallback_warning` |
| "X methods unmapped" in AESA | LCA indicators don't match PB-EF boundary names | Click "Re-suggest from impact methods" in AESA config sidebar |
| LCIA method install: "no new LCIA methods were registered" | The `.bw2package` content is already in the project under a different claim prefix | Check `bw2data.methods` for existing tuples; remove them before reinstalling |
| LCIA method install: "X% of biosphere flows unmatched" | Custom .xlsx references flows that don't exist in `biosphere3` (or use a different naming convention) | Check the file's flow names; adjust to match biosphere3 categories/subcategories |
| LCIA method install: pip fails (offline / permissions) | LC-IMPACT needs network + pip write access | Install in an environment where `pip install bw2_lcimpact` can run |
| DSM upload rejected: "Initial stock must contain only ages 1 and above" | Uploaded initial stock CSV/XLSX contains an age=0 row | Initial stock contains pre-existing products only (age ≥ 1). Move new arrivals at t₀ into the inflows CSV with year=t₀. The aggregate-format Weibull decomposition also produces ages 1..max_age only. |

## Favicon (Patch 5AH)

The browser/tab favicon is the purple MApper bolt set in a solid **brand-teal
circle** (`#14b8a6`, `--accent`/`--mod-lca`) with a soft **light-green aura**
(`#34D399`, `--success`); bolt purple is `#863bff` (the existing logo path,
preserved at `mapper-frontend/public/bolt-logo.svg`). Master is
`public/favicon.svg` (64×64). The aura is **concentric semi-transparent green
circles, not a radial-gradient/filter** — ImageMagick's SVG rasterizer drops
gradients/filters (renders them transparent), so the gradient version produced
auraless PNGs; plain circles render in every engine.

Generated set (via `magick`, in `public/`): `favicon.ico` (multi-res 16/32/48),
`favicon-16/32/48.png`, `apple-touch-icon.png` (180), `icon-192.png`,
`icon-512.png` (PWA), `site.webmanifest` (192/512 + `theme_color #14b8a6`).
**Small-size aura simplification:** the 16/32 PNGs are rasterized from a
no-aura mini (bolt + solid circle only) for crispness; 48/180/192/512 carry the
full aura. Wired in `index.html` head (svg + ico + png + apple-touch + manifest
links). Vite app only — there's no Next.js marketing site in this workspace; if
the `mapper.leonardoferhati.com` site exists as a separate repo, repeat the
asset there. Locked by `tests/faviconAssets.test.ts` (head/manifest references
+ files exist + brand colors).

**Desktop app icon (Patch 5AH, same design).** The Tauri dock/taskbar/window
icon is a SEPARATE set from the web favicon — generated from the same
`favicon.svg` master into `mapper-tauri/icons/`: `icon.png` (1024² master),
`32x32.png` / `128x128.png` / `128x128@2x.png` (Linux), `icon.ico` (Windows,
multi-res 16/32/48/64/256), `icon.icns` (macOS, via `iconutil`). Wired via
`bundle.icon` in `mapper-tauri/tauri.conf.json` (Tauri v2 config skeleton —
`frontendDist` → `../mapper-frontend/dist`, `devUrl` → Vite). The Rust crate is
NOT yet scaffolded (see `mapper-tauri/README.md`); regenerate the icons with
`tauri icon icons/icon.png`. (No tauri CLI in this env — the set was built with
`magick` + `iconutil`.)

## Development

```bash
# Backend
cd mapper-backend
conda activate map
uvicorn mapper.main:app --reload --port 8000

# Frontend
cd mapper-frontend
npm run dev

# Tests
cd mapper-backend
pytest tests/ -q
```

## Key Files for Debugging

- `mapper/core/bw2_wrapper.py` — all Brightway2 interactions (LCA computation, database queries)
- `mapper/core/dsm_engine.py` — stock dynamics computation
- `mapper/core/aesa_engine.py` — sustainability ratio computation
- `mapper/core/parameter_engine.py` — safe expression evaluation
- `mapper/core/premise_engine.py` — prospective-DB generation (separate + superstructure modes, fallback on write error)
- `mapper/core/log_config.py` — rotating file logger + log-tail reader used by Settings → Logs
- `mapper/api/impact.py` — Impact Assessment orchestration (Static + Projected + subsystem aggregation)
- `mapper/api/lcia_methods.py` + `mapper/core/lcia_method_engine.py` — LCIA Method Library (install/uninstall, WS progress, manifests)
- `mapper/data/lcia_methods.json` — LCIA registry (downloadable methods: URLs, pip specs, per-ei variants)
- `mapper/api/system.py` — `/api/system/logs` endpoints
- `src/api/client.ts` — all frontend API calls (check here for endpoint URLs)
- `src/stores/` — application state (check here for state shape and actions)
- `src/stores/logStore.ts` — frontend error capture (global fetch wrapper + error handlers)
- `src/components/ErrorBoundary.tsx` — top-level React error boundary

## Cancellable operations (Patch 1)

Long-running tasks expose a universal stop control. Five backend endpoints are
wired through a single in-process cancellation registry at `mapper.api.tasks`:

| Endpoint | Worker | Cancellation checkpoint |
|----------|--------|-------------------------|
| `POST /api/lca/contribution/multi-year` (multi-year LCA contribution) | `mapper/api/lca.py` | per-year boundary in the year loop |
| `POST /api/plca/generate` (pLCA premise generate) | `mapper/api/plca.py` | stage-callback via `_emit` in `core/premise_engine.py` |
| `POST /api/impact/calculate` + `POST /api/impact/calculate-scenarios` | `mapper/api/impact.py` | `_progress_runner` closure (per archetype × method × year) |
| `POST /api/impact/methods/install` (bw2package + pip + xlsx variants) | `mapper/api/lcia_methods.py` | stage-callback via `_emit` in `core/lcia_method_engine.py` |
| Legacy single-year LCA (`calculate_lca` worker) | `mapper/api/lca.py` | three manual checkpoints between major stages (UI exposure deferred — sync POST) |

DSM/MFA/AESA simulate / compute paths are intentionally NOT wired in Patch 1 —
they're sub-3s in-process compute, not background-thread workers, and adding
checkpoints would be churn without user value.

### Registry primitives — `mapper/api/tasks.py`

- `register(task_id) → Event` immediately before launching the worker.
- `is_cancelled(task_id) → bool` polled at worker checkpoints (O(1)).
- `cancel(task_id) → bool` flips the flag (returns False for unknown ids).
- `unregister(task_id)` always called in the worker's `finally` block.
- `in_grace_period(task_id) → bool` — 1.0s window after `register()` during
  which a zero-subscriber WS state is **not** treated as a disconnect cancel.
  This covers the `POST returns → client opens WS` race.
- `maybe_cancel_on_last_subscriber_leave(task_id, *, remaining_subscribers,
  task_done) → bool` — the disconnect-cancel rule:
  `cancel iff (remaining_subscribers == 0 AND not task_done AND past grace)`.

### Cross-module exception convention

Workers raise `mapper.api.tasks.CancelledOperation` at checkpoints. Engines
that live in `mapper.core` (premise_engine, lcia_method_engine, core/tasks)
must NOT import from `mapper.api` (one-way dependency). The dispatch in
`core/tasks.py:run_in_thread` and the `_emit` helpers therefore matches by
class name (`type(exc).__name__ == "CancelledOperation"`). This contract is
asserted in `tests/test_cancellation.py::
test_cancelled_operation_class_name_match_is_module_independent`.

### Wire protocol

- Cancel POST: `POST /api/tasks/{task_id}/cancel` → 200
  `{"cancelled": true, "task_id": ...}` on success, 404 if the registry has
  no entry for `task_id` (already finished or never started).
- WS terminal frame: `{"type": "cancelled", "task_id": ...}`. The frame set
  is `{progress, done, error, cancelled}` — `cancelled` is the discriminator
  for "stopped cleanly", distinct from `error`.
- Result-fetch GET: returns `Union[<ResultModel>, CancelledTaskResponse]`
  where `CancelledTaskResponse = {"cancelled": True, "task_id": ...}` (HTTP
  200, NOT 499). The `cancelled: True` discriminator + `Literal[True]`
  pydantic field lets clients narrow without type-introspection. We chose
  200+discriminator (not 499) because cancellation is a documented expected
  outcome, not a server error; 499 is non-standard (nginx-only) and
  complicates frontend error handling.

### Frontend pieces

- `src/components/ui/StopButton.tsx` — shared component, idle/running/stopping
  visual states.
- `src/hooks/useCancellableTask.ts` — state machine; `useRef<string>` guards
  against stale closures and late WS frames from superseded tasks.
- `src/api/client.ts:cancelTask(taskId)` — POST wrapper, returns null on
  404 (treated as "the worker beat the cancel").

### What NOT to do

- Don't add cancellation to in-process compute that runs in the request
  thread (DSM simulate, AESA compute, parameter resolve). Those are <3s and
  return synchronously; a Stop button would just confuse the UI.
- Don't emit a `cancelled` frame from a WS handler that doesn't own a
  registered task (e.g. ecoinvent imports). The shared `progress.py` calls
  `maybe_cancel_on_last_subscriber_leave` which is a no-op for unregistered
  ids — relying on that is fine.
- Don't `--amend` the cancel-frame pattern back to "no body, just close the
  socket". The explicit terminal frame is what lets the frontend
  distinguish Stopped from Errored without inferring from socket state.
- Don't write the result cache before checking `is_cancelled` one last time
  at the end of the worker. A late cancel that arrives after the final
  computation but before the cache write should still be honoured (skip the
  write, emit the cancelled frame). Most workers achieve this by raising at
  the next iteration boundary; the legacy LCA worker does it via the third
  manual checkpoint.

### Known follow-ups

- Multi-scenario Impact Assessment fan-out: the current StopButton fires
  cancel POSTs in parallel for every in-flight scenario task. This works
  but isn't atomic — if the server is mid-fan-out you can race a cancel
  ahead of registration. In practice the `runProjectedScenarios` POST
  returns all task ids before the workers spin up, so this hasn't bitten;
  flag if it ever does.

## Archetype validation lifecycle (Patch 2)

BOM rows are validated against `bw2data` at **upload time**, not at compute
time. Compute reads a persisted per-row status flag and refuses with a
structured 422 if any error rows exist. This decouples authoring (where the
user fixes a broken file) from computation (which must be predictable and
fast).

### Where the validator runs

- **Upload** (`POST /api/bom/import`): `mapper/api/bom.py:_parse_bom_workbook`
  yields a parallel `list[BOMValidationRow]` alongside the parsed BOM tree.
  After upsert, `validate_bom()` (`mapper/core/bom_validator.py`) runs once
  per archetype; `_apply_validation_to_archetype()` stamps each
  `BOMNode.validation_status` to `"ok" | "warning" | "error"` and stores
  the full `ValidationReport` on `Archetype.validation_report`.
- **Compute** (`POST /api/lca/standalone`, `POST /api/impact/calculate`):
  `validation_error_count(arc.bom)` walks the persisted node tree
  (no bw2 calls) and raises `HTTPException(422, detail=...)` if any node
  has `validation_status == "error"`. The detail dict contains
  `{error: "validation_failed", message, archetype_id, archetype_name,
  error_rows, report_url}` — the frontend uses `report_url` to fetch the
  persisted report via `GET /api/bom/archetypes/{arc_id}/validation-report`.

### Severity contract

- **Error** (blocks compute): `code_truncated`, `code_not_found`,
  `database_missing`, `code_no_database`, `database_no_code`. Compute is
  refused because we cannot resolve the row to an ecoinvent activity.
- **Warning** (allowed, surfaced): `name_mismatch`, `location_mismatch`,
  `unit_mismatch`. The `(db, code)` tuple still resolves to a real activity —
  the user-supplied annotation simply doesn't match. We trust the code.

### `BOMNode.description` — provenance that survives a re-import

Free-text on a row, for the assumption behind its quantity or its link.
**Nothing computes from it** (asserted by a test that mutates every
description and requires every quantity unmoved). It exists because a
modelling choice that lives only in someone's memory is not a modelling
choice a reviewer can check.

It **round-trips through the workbook's `Description` column**, and that is the
load-bearing half: re-import is the routine path for these projects, and a note
that dies there is worse than no note because it reads as documented when it is
not. A blank cell — or an older workbook with no such column — imports as
`None`, so nothing legacy changes. `BOMNodeUpdate.description` takes `"unset"`
to clear and `None` to leave alone, the same PATCH convention as `basis` and
`uncertainty`.

Two live examples, both in MAp-test's Hydrogen Station: the 8 kg of R134a
records that end of life is assumed **zero on full recovery** per EU
Regulation (EU) 2024/573, with real-world recovery at 50–90 % named as the
gap; the 400 kg carbon fibre wrap records that inert waste is a **proxy**
because ecoinvent 3.10 has exactly one CFRP activity, the production market,
and no waste route at all. Neither assumption is visible in a number and both
change one materially.

#### What NOT to do

- **Don't add a field carrying provenance without a workbook column.** The
  field alone survives until the next export/re-import, which is precisely
  when someone is most likely to believe it is still there.
- **Don't let anything read it at compute time.** It is a comment. If it ever
  gains meaning, the test that mutates every description to garbage and
  asserts byte-identical quantities will fail, and that is the intended alarm.
- **Don't export `None` into the cell.** It imports back as the literal string
  `"None"`. Write `""`.

### Silent paths fail closed — four answers, not one

Four lookups used to step over a missing input and carry on, and all four
produced a **smaller, entirely plausible** number with nothing said. That is
worse than a crash: a fleet total 8 % low still looks like a fleet total. They
do NOT get the same treatment, because the right behaviour differs per path.

| Path | Behaviour | Why |
|---|---|---|
| unlinked BOM row (`api/lca.py`, BOTH builders) | **refuse, 422** | the row is in the BOM because the user wants it counted |
| cohort carrying stock, no mapping (`dsm_lca_engine`, `material_flow_engine`) | **refuse**, `UnmappedCohortError` | same defect as a dangling mapping, one step earlier in the same lookup |
| stage name matching no keyword (`stage_to_scope`) | **warn + default** | the keyword table is an automotive vocabulary; MApper is general-purpose |
| node naming an undefined lever (`_apply_global_levers`) | **refuse**, `UndefinedLeverError`, ONLY when levers are in play | the 1.0 identity when they are not is a designed guarantee |

**Both single-product builders refuse, not just one.** `_build_archetype_source_demand`
(single-product LCA, trajectory, all three Monte Carlo entry points) and
`_build_archetype_demand` (contribution analysis) are separate demand builders.
Guarding one leaves a silent-drop path open behind a guard that looks shut.
This also ends an inconsistency: the fleet path has always refused, so the same
archetype used to compute fine single-product and 400 fleet-wide.

**Messages name the offending thing, never a count.** `"has 3 unlinked
material(s)"` is precisely the guard that costs a debugging session, so
`_refuse_on_unlinked` reports stage › row for each (capped at 10 + "and N
more"), the node_ids, and the fix. `UnmappedCohortError` names the cohort, its
count and year, and says explicitly what it is NOT — a dangling mapping — since
the fixes differ: add a mapping vs re-link an existing one. They are separate
exception types for the same reason.

**`count > 0` is checked BEFORE the mapping lookup.** A declared-but-empty
cartesian cohort contributes nothing and must never raise, or a sparse fleet
becomes unrunnable.

#### The stage fall-through warns because refusing would be wrong

`Decommissioning`, `Installation`, `Construction`, `Retirement`, `Replacement`,
`Commissioning`, `Transport`, `Distribution`, `Logistics` and `Raw materials`
all match no keyword and default to `inflows`. `Decommissioning` is the sharp
one: an obvious end-of-life stage counted at production. But refusing would
block a legitimate wind-farm or building project over a naming convention, so
`validate_bom` emits a `stage_scope_defaulted` **warning** beside
`unit_mismatch`, **once per stage** (a 250-row stage would otherwise raise 250
identical warnings), and an explicit `scope` on the stage root always wins,
which makes the fix one click. `stage_name_matches_a_keyword` exists so callers
can detect the fall-through without a second copy of the matching rule.

#### The lever flag is stated, never inferred

`_apply_global_levers` takes an explicit `levers_in_play: bool`, threaded
through `resolve_quantity` → `flatten_bom_for_year` →
`flatten_roots_for_year_and_scope`, and set by the engine from
`self._param_table is not None`. **Do not infer it from `lever_values` being
non-empty.** An empty dict cannot distinguish "no table threaded through" from
"a table with no entries", and inferring a semantic distinction from an empty
container is how a false positive arrives later — it would work on today's data
and break on the first project with an empty parameter table. The distinction
is a property of the CALL, so the caller states it.

The three-way identity — `p_bp=1.0` == absent == untagged == the pre-lever
engine — survives untouched, because it runs with levers not in play.

#### What NOT to do

- **Don't reintroduce a bare `continue` past a missing link, mapping, stage
  match or lever.** `tests/test_silent_paths_fail_closed.py` sweeps
  `api/lca.py`, `core/dsm_lca_engine.py`, `core/bom_engine.py` and
  `core/material_flow_engine.py` for `if <falsy check>: continue` on those
  lookups. It matches the CHECK rather than any one variable name, so it
  catches the next instance in a new file. Verified load-bearing: putting one
  `continue` back fails two of its cases. `_ALLOWED` carries the two
  legitimate skips WITH reasons, and a separate test fails if a declared
  exemption no longer exists.
- **Don't guard only the path named in the brief.** The sweep found a fifth
  and sixth: `material_flow_engine` carried both the unmapped-cohort skip AND
  the dangling-archetype skip — the latter being the original WP5 shape, still
  open there after `dsm_lca_engine` closed it. One engine raised while its
  sibling stepped over the same condition on the same data.
- **Don't build a test archetype whose ROOT is a material.** Three fixture
  helpers did (`bom=[node]` with a material named `cells` / `pack` / `steel`),
  leaning on the stage fall-through to be classified as inflows — a shape
  production never produces. They now wrap the material in a `Manufacturing`
  stage root. Under warn-only they would not have failed, which is exactly why
  leaving them would have meant the next person read them as canonical.

### The sweep walks the package. There is no watchlist.

Both shapes ran against a named list of six modules. The base rate stayed
non-zero across two widenings — the second found `material_flow_engine`'s two,
the third found the scaling-rules migration — so scope stopped being a
judgement call. `_package_modules()` is `BACKEND.rglob("*.py")`, and a new
module is swept the day it lands.

**The first package-wide run was 26 hits, 11 of them `@router.get(...)`** —
route decorators matched because their PATH STRINGS mention the words the sweep
watches for. That is a detector bug, not an exemption backlog; exempting them
would have buried the real finding under boilerplate. Excluded by DECORATOR
POSITION rather than receiver name, so it does not depend on the router
variable being called `router`. 26 → 14.

Final: **16 hits, 15 exempted, 1 real** — `scaling_rules` were not migrated.

#### Exemptions carry a CATEGORY, and one of them is checked

`guarded` (a raise or warn covers it), `validated` (checked at the write
boundary), `filter` (a miss is the intended semantics), `display_only`
(export/label resolution, derives no number).

`display_only` was the weak one: "it doesn't compute" was a stated assumption
that nothing verified, and an export that started deriving numbers would have
silently invalidated it. It is now checked —
`test_a_display_only_exemption_really_does_not_compute` asserts the enclosing
FUNCTION calls nothing in `_COMPUTE_CALLS`.

**Function granularity, not module.** Module was tried first and is useless
here: `api/bom.py` imports the compute layer six times AND hosts four of the
five display-only sites, because it is a 3000-line module holding both the
dsm-lca endpoint and the export builders. A companion test pins that the check
does fire on `run_dsm_lca`, so it cannot go vacuous.

It is a heuristic, not a proof — a function could derive a number without
calling a named entry point. It turns an assumption into something that breaks
loudly in the common case, which is the honest claim for it.

### Scaling rules were the one thing UI-hidden code cost us

`DSMScalingRule.dimension_filters` sits in the same `_INHERITABLE_SLOTS` tuple
as `mode_configs`, is filtered the same way (`cohort_dict.get(k) == v`), and
was the only one of the seven that `_migrate_state` did not reconcile. A
dimension rename left every rule matching nothing, and the call site is

```python
out[year][ck] = count if rule is None else self._resolve_rule(rule, count, year)
```

so a 1.4× growth rule quietly became 1.0×. **No user data was affected** — 593
JSON files scanned, zero with non-empty `scaling_rules`.

**It survived because no clicking reaches it.** The scaling-rules UI was
removed on 2026-05-01 while the backend stayed live, so every hand-driven check
missed it and only a package walk found it.

#### The other UI-unreachable surfaces, audited

Of 220 backend routes, **12 have no frontend caller**: five AESA reference-data
GETs (`/boundary-sets/{id}`, `/multi-d-defaults`, `/sharing-data`,
`/ssp-trajectories`, `/carbon-budget-options`), six subsystem manual-flow
routes (upload/template/clear × inflows/outflows), and
`POST /lca/calculate-archetype-trajectory`. **None carries either shape** —
checked function by function, including `compute_manual_subsystem` behind the
manual-flow routes. So scaling rules were the only one, and the rest are
unreachable-but-clean rather than unswept.

**A PARAMETER with no UI control is the same shape as a route with no UI
caller.** `POST /dsm/systems/{id}/simulate` takes an optional `case` (parameter
sensitivity case) that the frontend never sends — `simulateMFA` in `client.ts`
puts only `scenario_id` on the query string, and the DSM Dashboard has no
sensitivity-case selector. So the boundary is complete and correct, and
**unreachable by clicking**. Added deliberately in the Patch B path-1 binding
so the API is expressible and the other two call paths (`/impact/calculate`,
`.../material-flows`, which DO forward their case) go through one function —
but recorded here because this is exactly how the `scaling_rules` migration gap
survived: backend live, UI removed, every hand-driven check missing it.

Also on this list for the same reason: **scaling rules themselves**. The editor
was removed from the DSM config bar on 2026-05-01 while the backend stayed
live, so `DSMScalingRule` — the only channel from parameters into DSM output —
cannot be authored in-app at all. Both live projects have zero rules, which is
why every parameter-binding defect in that path has been latent rather than
live. Reinstating the editor makes them live; re-read the scaling-rule sections
before doing it.

That list is worth keeping current: an endpoint with no UI caller gets no
hand-testing, so the automated sweep is the only thing that reaches it. The
same applies to a REQUEST FIELD no UI populates — the sweeps walk routes, not
query parameters, so a field like `case` is only covered by the tests written
for it.

#### What NOT to do

- **Don't reintroduce a watchlist.** Both sweeps walk the package. Adding a
  name list back — even a longer one — restores the failure mode where scope is
  something a person has to remember.
- **Don't exempt a detector bug.** Route decorators were 11 of 26 hits; the fix
  was excluding them structurally, not declaring them.
- **Don't mark an exemption `display_only` without checking the function.** The
  category is verified, so a wrong one fails rather than sitting there.
- **Don't add a scenario slot without adding it to `_migrate_state`.**
  `scaling_rules` was in `_INHERITABLE_SLOTS` and not in the migration for
  months, which is exactly how a slot goes stale in silence.

### A stale reference and an empty match are not the same thing

`filter_primary_stock` summed to 0.0 for both, and only one of them is
ordinary. The distinction is the design:

- **legitimate empty match** — every key and label resolves, no cohort carries
  that combination this year (a fuel type with no vehicles yet). **Returns 0.0
  in silence.** Raising would make a sparse fleet unrunnable.
- **stale reference** — the filter names a dimension or label the primary
  system does not have. It cannot match in ANY year, so 0.0 reads as "this
  subsystem has no stock" when the reference is simply broken. **Raises
  `StaleDriverFilterError`.**

Pinned from both sides: a declared-but-unstocked label must NOT raise, an
undeclared one must. The `test_subsystem_engine` fixture used to express
"matches nothing" with an undeclared label — the exact conflation — and now
declares a third label carrying no stock instead.

**An empty value list is refused at the WRITE boundary.** `{"Fuel": []}` was
dropped by the normaliser, so the filter meant "no filter" and the rule got the
WHOLE primary stock: measured **350.0 against an intended 150.0**. It
**over-counts**, the opposite direction from every other defect in this family
and correspondingly harder to notice as "suspiciously small". Refused in
`validate_dependency_rule` so nothing already stored breaks; the branch stays
defined for rules saved before the check existed.

**The migration is the fix; the other two detect the symptom.**
`update_system` reconciles stock rows, inflows, stock targets, manual outflows,
mode configs and survival configs through its label-translation maps — and used
to say nothing about subsystem dependency rules, which live in a separate store
its migration never reached. So renaming a dimension silently orphaned every
rule that filtered on it. `_migrate_subsystem_filters` now carries them through
the SAME maps: renamed labels translated, removed labels and dimensions dropped
and counted, warned like the other six.

#### The class guard needed a SECOND shape

The `continue` sweep reported **zero** for `subsystem_engine`, which had two
real defects — because neither was a skipped iteration. Both were a silent
VALUE, and so was path 1's original:

```
allowed = {dim: set(vals) for dim, vals in driver_filter.items() if vals}
if all(cohort_dict.get(dim) in vals for dim, vals in allowed.items()):
linked = [m for m in all_materials if m.ecoinvent_activity is not None]
```

`_default_sites` is AST, not regex, because both distinctions are structural:

- **`.get()` with no default, consumed inline** (in a comparison, a boolean,
  another call) so a miss becomes `None` and flows on. `x = d.get(k)` alone is
  NOT flagged — the caller still holds the miss, and whether they check it is
  the `continue` sweep's job. `d.get(k, 0.0)` is not flagged either: an
  explicit numeric default in a running total means "nothing yet".
- **a comprehension whose `if` KEEPS the resolved rows**, thereby dropping the
  unresolved ones. The SIGN is the whole test: `is not None` / bare truthy
  keeps the valid and drops the invalid; `is None` / `not in` **collects** the
  offenders, which is what a guard does before raising on them. Flagging the
  second would make the sweep fire on its own fixes.

The first attempt was a regex over `[...]` and missed
`allowed = {dim: ... if vals}` entirely — a dict comprehension. That is why it
is AST.

**Verified against all three historical defects**, on the exact lines that
shipped rather than paraphrases, plus the corrected forms as negatives. It
reports four live sites, all four declared in `_ALLOWED_DEFAULTS` with reasons,
and a separate test fails if a declared exemption no longer exists.

#### What NOT to do

- **Don't raise on an empty match.** A filter that resolves and matches nothing
  is ordinary. Only a reference to something absent is an error.
- **Don't answer a failed lookup with a plausible default in a calculation
  path.** Both sweeps in `tests/test_silent_paths_fail_closed.py` cover the two
  shapes; an exemption needs a reason, not just an entry.
- **Don't flag a comprehension that collects offenders.** `[m for m in mats if
  m.ecoinvent_activity is None]` is a guard building its own error message.
- **Don't extend `update_system`'s migration without the subsystems.** They are
  the one slot that lives outside the system's state, which is exactly why they
  were missed for as long as they were.

### The compute path refuses on a unit mismatch. Upload warns. Both are right.

`unit_mismatch` at upload is where a NEW project gets caught. What the audit
actually named is that quantities enter demand vectors with **no dimensional
check at all**, so a project already carrying a mismatch computes in silence —
MAp-test's three charger rows asked for 7, 18.5 and 180 whole-vehicle
dismantlings, and were found by hand rather than by the code.

**The apparent contradiction dissolves once you separate *when* from *what*.**
Upload warns because the rows have not had a chance to be fixed and refusing an
import would strand a project at the door with nothing computable; its job is
to say the file has a problem. Compute refuses because the row is about to
become a number. That is exactly the shape `_refuse_on_unlinked` already
ships **in the same function** — unlinked rows warn at upload and 422 at
compute — and nobody found that contradictory, because it is one rule applied
at two moments.

**Three sites, one definition.** `_canonical_unit` is shared with the upload
check, so a row cannot warn at import and compute anyway:

| Site | Covers |
|---|---|
| `_build_archetype_source_demand` | single-product LCA, trajectory, **all three Monte Carlo entry points** |
| `_build_archetype_demand` | contribution analysis |
| **`compute_demand_vector`'s caller in `DSMLCAPipeline`** | **the fleet** |

**The fleet site is the one the other two miss**, and it is the path with the
most at stake: a fleet run reaches the demand vector through neither builder.
`monte_carlo.py` is covered transitively — it calls the first builder before
its loop, so its per-iteration `_aggregate` sees rows already checked.
`standalone_lca` is covered differently, refusing via `validate_roots` before
it builds. `calculate_activity_lca` is N/A: no BOM row, so no second unit.

**The fleet cache is per-run and never module-level.** `DSMLCAPipeline
._unit_cache` maps `(db, code) → (unit, name)`; the check runs per cohort per
year, far too hot for a bw2 lookup per row. It cannot be module-level because
bw2's project state is mutable — a database import or a premise generation
changes what a key resolves to — the same rule the row validator's `code_cache`
follows. Pinned: same refusal with and without the cache, on the same data.

#### NO CONVERSION, EVER

Nothing needs converting. Every unit pair in either live project folds to
identity — `kg`/`kilogram`, `kWh`/`kilowatt hour`, `tkm`/`ton kilometer`,
`m3`/`cubic meter` — which is spelling, not dimension.

And a genuine mismatch must **never** be converted. A silent kg→tonne would be
the same class of defect this refusal closes: a plausible number resting on an
assumption nobody stated. Worse here than elsewhere, because the two readings
are indistinguishable from inside the code — `kg` against a `unit` activity
might mean "convert by mass per unit" (a mass we do not have) or "this link is
wrong" (all three real cases were the second). Converting would have to guess.
`test_nothing_anywhere_converts_a_unit` checks no site does.

#### What NOT to do

- **Don't add a demand builder without the check.** Three sites today; the
  fleet one was missing from the first two and is the one that computes WP5.
- **Don't soften compute to a warning for consistency with upload.** They
  answer different questions at different moments, and `_refuse_on_unlinked`
  already sets the precedent in the same function.
- **Don't lift `_unit_cache` to module scope.** bw2 project state is mutable;
  a cache that outlives the run answers from a different project.
- **Don't convert.** Re-link the row or fix its unit. The alternative is a
  number nobody can audit.

### `unit_mismatch` — the BOM unit is a different QUANTITY

Quantities reach the demand vector with **no dimensional check**:
`_build_archetype_source_demand` does `total_demand[key] += m.quantity *
stage_amt` and nothing compares the BOM's unit to the activity's reference
unit. So a kg amount against a per-unit activity is charged as that many
units, silently. MAp-test's three charger `Electronic waste treatment` rows
carried 7, 18.5 and 180 **kg** against `market for manual dismantling of used
electric passenger car`, whose reference unit is **one vehicle** — 180 whole-EV
dismantlings for one DC charger's end of life. Nothing raised, warned or
logged, and a full audit of *stored* `validation_status` showed the project
100 % clean.

**The check must be quiet about SPELLING.** A BOM writes `kg` where ecoinvent
writes `kilogram`. MAp-test has 870 such pairs against 3 genuine errors, so a
verbatim string compare would bury the signal it exists to raise.
`_canonical_unit` folds a unit onto its quantity kind through `_UNIT_ALIASES`;
an unlisted unit folds to **itself**, so an unrecognised pair is reported
rather than waved through.

**A warning, not an error.** The `(db, code)` pair still resolves, so the row
is computable — and making it an error would refuse to compute for every
project already carrying one, including the project the check was written for.
Same reasoning that keeps `name_mismatch` a warning.

**It is upload-time, like the rest of the validator**, so it does not catch a
row relinked in-app afterwards. That is the existing design (see *Don't re-run
validation on every compute*), not a gap this check introduces.

Validation order is structural → database existence → code resolution →
name/location consistency. Cheapest checks first; later checks short-circuit
when an earlier one already errored on the same row.

### Caching

Within a single `validate_bom()` call, `(db, code)` lookups against bw2 are
cached. A typical archetype with ~250 rows referencing ~80 unique activities
makes ~80 bw2 calls instead of 250. **Never cache across calls** — bw2's
project state is mutable (database imports, premise generation), and a
stale cache would silently serve wrong answers.

### Frontend surface

- After upload, `LCAManager.tsx` renders one `ValidationReportPanel` per
  archetype with errors/warnings. Issues are grouped by
  `(severity, error_type, bad_value)` so "6 unique truncated codes
  affecting 41 rows" appears as 6 collapsible rows, not 41.
- `Archetypes.tsx` shows a persistent banner on the detail view of any
  archetype with errors, plus a red dot on its tree row.
- `LCACalculator.tsx` disables the **Calculate** button when any selected
  archetype has `validation_error_rows > 0`, with a tooltip listing the
  blocking archetype names.

### Anti-patterns — DO NOT

- **Don't re-run validation on every compute.** `validate_bom()` does
  ~80 bw2 lookups per archetype; doing this inside `/api/impact/calculate`
  would add hundreds of ms to every multi-archetype request and make
  cancellation semantics murkier. The whole point of persisting
  `validation_status` is that compute is O(n) walk, no I/O.
- **Don't reject uploads on validation errors.** The user needs to see
  the report to know what to fix. Persist the archetype with
  `validation_status` flags, surface the report, let them decide whether
  to re-upload a corrected file or open the archetype in the BOM editor
  to relink rows by hand.
- **Don't lift the per-call `(db, code)` cache to module scope.** It would
  serve stale data across project switches, premise database installs,
  and ecoinvent re-imports.
- **Don't add `name_mismatch`/`location_mismatch`/`unit_mismatch` to the error
  set.** A resolved code is the source of truth; a mismatched display name is a
  data-quality signal, not a blocker. `unit_mismatch` in particular would
  refuse to compute for any project already carrying one — which is every
  project this check was written to help.
- **Don't compare units verbatim.** Fold through `_canonical_unit` first, or
  the 870 legitimate `kg`/`kilogram` pairs in MAp-test drown the 3 real
  findings. And don't make an unknown unit fold to a wildcard — unlisted folds
  to itself so a genuinely different pair still reports.
- **Don't reach for a unit CONVERSION.** The check reports; it never rescales a
  quantity. A silent conversion would be a second invisible transformation on
  top of the one being surfaced, and the right amount for a relinked row is a
  modelling decision, not an arithmetic one.
- **Don't validate against prospective databases at upload time.** The
  validator runs against the active bw2 project's installed databases.
  pLCA-generated databases are produced post-upload, on demand. Cross-DB
  validation belongs (if at all) in the Impact Assessment configure step,
  not the BOM upload step. Out of scope for Patch 2.

### Acceptance shape

`tests/test_bom_validator.py` includes a synthesised reproduction of the
WP5 v1 failure mode: 943 valid rows + 41 broken rows distributed across
6 unique truncated codes. The expected report shape is `error_rows=41`,
`valid_rows=943`, exactly 6 error groups summing to 41 affected rows.
A corrected-file fixture round-trips to `error_rows=0`. The 422 contract
is asserted by registering an Archetype with a node bearing
`validation_status="error"` and invoking the route handler directly.

## Multi-year LCA performance: known bottleneck and Stage 3 plan

### Current state (post Stage 2, depth=5/cutoff=0.01 multi-year default)

A 6-year ICEV-Petrol × REMIND SSP2-PkBudg1150 contribution-analysis run currently
takes **~311 s** (≈52 s/year). At the original deeper config (depth=6/cutoff=0.005)
the same run takes **~338 s**, down from a pre-Stage-2 baseline of 542 s. Per-year
scores are byte-identical to the pre-cache implementation — Stage 2 was a pure
performance fix, no methodology change.

The wall-clock breakdown per year at the new defaults is roughly:
- `solve` ~3.8 s (UMFPACK factorization on a fresh per-year prospective DB; one
  refactorization per year, unavoidable until preloading is on the table)
- `sankey` ~40 s (BFS at depth=4 — capped via `min(max_depth, 4)` in `lca.py`)
- `tree` ~7-8 s (after Stage 2's unit-score memoization)
- everything else <0.2 s combined

### Stage 2: what it did

`get_recursive_contribution_tree` and `get_supply_chain` now share a single
`unit_score_cache: dict[(db, code), float]` per call. The cache exploits LCA
linearity (`score(act, x) = x × unit_score(act)`) so each unique upstream
activity is characterised once via `runner({act_key: 1.0}, [m_t])` instead of
once per (activity × propagated amount) tuple. The cache is created in
`_compute_contribution_analysis` and passed to both functions. Cache size is
logged in the `[CA-phases]` line for verification (typical: 2 500-2 700 unique
activities per year on ecoinvent 3.10). Tree time dropped 4-6× at all depths;
total redo_calls fell ~40% on the depth=6 baseline.

### Bottleneck: sankey BFS at depth-4 frontier

After Stage 2, sankey is the dominant phase at any `max_depth ≥ 4`. The cost is
**not** characterisation work — sankey's per-call cache (which Stage 2 promoted
to be the shared one) already eliminates redundant unit-score calls. The cost
is `act.technosphere()`, which is a peewee/SQLite query against the
`ActivityDataset` table for every node visited. At the depth-4 BFS frontier the
fan-out widens substantially and the query count dominates wall-clock.

Going from sankey-depth 3 → 4 alone produces an ~8× cost increase
(~5-6 s/year → ~40 s/year on ecoinvent 3.10). Sankey at depth 5 is not currently
exposed (capped at 4 server-side because Sankey rendering becomes unintelligible
past 4 layers).

### Stage 3 lever (deferred — do NOT implement until triggered)

**Plan**: batch-load technosphere exchanges via `Database.load()` once per year,
hold in memory keyed by activity, replace per-call `act.technosphere()` with
dict lookups. `Database.load()` returns the full activity list with all
exchanges resolved in one shot, avoiding the per-activity peewee round-trip.

**Expected gain**: ~311 s → 80-120 s for the same depth=5/cutoff=0.01 6-year
config. Sankey would drop from ~40 s/year to ~5-10 s/year (matching the
characterisation-only cost).

**Open question to validate before implementation**: memory footprint of the
full exchange graph for a premise database. ecoinvent 3.10 has ~22k activities
and `Database.load()` materialises every exchange of every activity — this could
be substantial (tens to hundreds of MB per database). Multi-year holds 6+
prospective DBs; if memory pressure is real we'd need either an LRU on loaded
DBs or a partial load (only activities reachable from the BFS root). Measure
peak RSS for `Database.load()` on one premise DB before committing to the path.

**Trigger to revisit**: external user feedback that multi-year compute is too
slow, OR a workflow that involves rapid multi-year iteration (e.g. parameter
sweeps, sensitivity analysis over many archetype variants). Do not start Stage 3
speculatively.

### What NOT to do

- Don't drop the `[CA-phases]` or `[multi-year]` log instrumentation — it's
  INFO-level (rotates with `mapper.log`, no console spam) and is the only
  vehicle for verifying performance claims when this becomes a problem again.
- Don't lower the multi-year `max_depth` default below 5 to "fix" speed —
  ecotoxicity-class methods have hot paths beyond depth 5 (largest hidden
  depth-5/6 node = 25.5% of root impact for freshwater ecotox on ICEV-Petrol).
  Depth=5 is the methodologically-defensible minimum.
- Don't add a unit-score cache to a different scope (cross-call, cross-method,
  cross-database) — Stage 2's cache is correct because it's per-call. Sharing
  across calls would silently serve stale values when the database changes.

## Chart axis-title room (rotated y-axis labels)

A rotated (`angle: -90`) y-axis title placed in the left MARGIN
(`position: 'left'`) clips at the SVG's left edge: its x depends on Recharts'
left-margin math (`margin.left`, `<YAxis width>`, `offset`) and readily goes
negative, cropped on-screen AND in the export (the export serializes the same
SVG). **Don't reason about / tune those margins** — and **you can't measure the
title coordinate in a test either: Recharts 3.x renders NOTHING in jsdom** (0
`<svg>`/`<text>`/`.recharts-*` nodes even with `ResponsiveContainer` mocked), so
there's no serialized SVG to read x/transform from. For a left clip the fix is
an inside position (`position: 'insideLeft'`, structurally `x > 0`); for a wide,
short inset a rotated title may not *fit vertically* at all (see below).

**Durable export lesson — chart labels that must appear in exports have to be
IN the `<svg>`.** `exportChart` serializes ONLY the chart `<svg>`
(`findChartSvg` → `serializeSvgForExport`); HTML siblings of the chart (an HTML
caption above/around it, a `<div>` title) are NOT captured. So a title rendered
as an HTML caption looks fine on-screen but is **absent from the PNG/SVG/PDF
export**. If a label must show in exports, render it inside the chart svg (a
Recharts axis `<Label>`, or a `<Customized>` `<text>`), not as surrounding HTML.

**AESA carbon-budget inset — intentionally UNTITLED (labelled externally).**
That inset is short (120px, ~86px plot). A rotated full-text y-title (~144px)
can't fit its plot height → top-clips on-screen AND export regardless of
position/offset (a FIT problem, not export-bounds). Iterations: rotated
`insideLeft` (5AV, still top-clipped) → HTML caption (on-screen only, dropped
from export per the lesson above) → in-svg `<Customized>` horizontal `<text>` →
**final: no chart title at all** (per Leo — the chart shows axes + data only;
it's titled in the surrounding figure/report). The methodological note ("Based
on projected global emissions…") stays as an HTML caption — it's a caveat, not a
title. `margin.top: 12` keeps the top tick ("1,200.0") off the SVG top edge (it
clipped at the original `2`). `tests/aesaCarbonBudgetTitleRoom.test.ts` now
GUARDS the no-title state (no svg `<text>`/`<Customized>`/`angle:-90` title, no
HTML caption title, note retained, `margin.top:12`) — source-level, since
Recharts isn't observable in jsdom; the real check is **eyeballing a fresh
export**.

(5AU's "`margin.left − YAxis width ≥ offset + ~10px`" rule checked a proxy, not
the outcome, and still clipped — superseded above.)

## Chart export discipline

Every chart in the frontend must use `<ChartExportButton>` from
`components/charts/ChartExportButton.tsx` (paired with `<ChartExportContainer>`
as the capture target). When adding a new visualization panel, audit chart
coverage as part of the patch — don't ship a new chart without export.

Conventions: button placed top-right of the chart container; the `filename`
PROP is lowercase `<topic>_<context>` snake_case and carries no prefix of its
own (e.g. `multiyear_evolution_<target>_<method>_<years>`,
`dsm_survival_default_k<k>_lambda<λ>`,
`timeline_<archetype>_<yearStart>-<yearEnd>`). Match existing siblings in the
same panel before inventing a new naming scheme.

`buildFilename` then adds the `mapper_` prefix, a mode suffix and, for raster
formats, the scale — so the file on disk is
`mapper_<prop>[_chart|_legend][@Nx].<ext>` (and `jpeg` writes `.jpg`). Don't
put `mapper_` in the prop; it would double.

Every chart with numeric axes uses `<NumberFormatControl>` for live display
formatting, placed in the same flex row as `<ChartExportButton>` (button row,
top-right of the chart container). Format settings are display-only — they do
not affect data exports or stored values. State is scoped per chart (or per
panel-pair when summary + detail share a unit) via `useNumberFormatter()`;
formatters are not synced across panels and not persisted to localStorage.
The default `{ notation: 'scientific', sigFigs: 3 }` preserves pre-existing
rendering. Wire the formatter into Y-axis tick labels, Tooltip values,
headline displays, and table cells that sit with the chart.

**Exception — AESA**: `RadarView`, `TimelineView`, and the `CarbonBudgetInset`
restrict the picker to Fixed via `notations={['fixed']}`. SR values cluster
near 1.0 and Gt CO₂ remaining-budget values stay in tens-to-hundreds — neither
benefits from scientific or SI notation, and offering them invites confusion.
Default Fixed decimals: 3 (RadarView), 2 (TimelineView SR), 1 (carbon budget Gt).

**AESA Timeline SR reference-line labels live in the LEGEND, not the
chart plot area** (Patch 4AF, supersedes Patch 4AD). The dashed
boundary lines (`<ReferenceLine y={1.0} strokeDasharray="4 4">` and
`y={2.0}`) still render inside the chart, but their TEXT LABELS are
attached to the Recharts `<Legend>` as additional entries alongside
the indicator data series. Pre-Patch-4AF iterations tried
`insideTopRight` (collapsed at the right edge) and
`insideTopLeft` (collapsed at the bottom-left when Y-range expanded
to ~60 SR for filtered views) — both placements failed because the
two boundary lines fall near identical pixel rows whenever the
visible Y-range is large.

The methodologically-correct framing: SR=1.0 (Safe boundary) and
SR=2.0 (Uncertainty boundary) are **interpretation aids, not data**.
Data lives in the plot area; interpretation aids belong in the
legend (where the chart's meanings are documented). This decouples
label readability from Y-axis range — labels stay legible regardless
of how compressed or expanded the data is.

Implementation note: Recharts 3.x' default `<Legend>` filters
explicit-`payload` entries that don't correspond to a chart series
(only `<Line dataKey>` entries survive), so reference-line entries
added via the `payload` prop get silently dropped. Patch 4AF uses
the `content={(...) => <ul>...</ul>}` API for full custom render
control: the `<ul>` contains indicator entries (`<rect fill>`
swatches) AND the two reference-line entries (`<line stroke
strokeDasharray="4 4">` swatches matching the actual chart lines'
dash pattern). The export pipeline's Patch 4AE color-extraction
priorities pick up both shapes correctly (priority 1 reads `<rect>`
fill for indicators, priority 3 reads `<line>` stroke for reference
lines).

#### What NOT to do (reference-line labels in the chart plot area)

- **Don't place reference-line labels inside the chart plot area
  when the chart's Y-range can vary widely.** Compressed Y-ranges
  collapse multiple reference lines to nearly the same pixel,
  causing label overlap regardless of left/right/top/bottom
  positioning. Move reference markers to the legend, where
  horizontal space and the surrounding context make them
  unambiguous.
- **Don't try to fix label overlap by repositioning within the
  chart.** Patch 4AD tried `insideTopRight → insideTopLeft`;
  Patch 4AF retired the in-chart placement entirely. Any future
  "reference markers overlap" symptom on a Cartesian chart with
  multiple reference lines should reach for the legend, not
  another position keyword.
- **Don't pass reference-line entries via Recharts 3.x's
  `<Legend payload={[...]}>` prop and expect them to render
  alongside indicator entries.** Recharts 3.x filters payload
  entries that lack matching chart series. Use the
  `content={(...) => ...}` render API for full control when
  mixing series and reference markers.
- **Don't change the boundary thresholds** (1.0 / 2.0) — they're
  methodologically defined by the Sala 2020 framework (zone
  transitions Safe → Uncertainty → High-Risk). Only label
  position is a UI concern; values are not.

**SR-timeline reference lines + their legend swatches read from ONE shared
zone-colour source.** The SR=1.0 (safe) and SR=2.0 (uncertainty) `<ReferenceLine>`
strokes AND the legend swatch `<line>` strokes in `TimelineView.tsx` both read
`ZONE_COLOR.safe` (`#1D9E75`) / `ZONE_COLOR.zone_of_uncertainty` (`#EF9F27`) from
`components/aesa/zones.ts` — so they can't desync (lines must match their
swatches). Locked by `tests/aesaTimelineReferenceLineColor.test.ts` (source-level:
Recharts renders nothing in jsdom, so it pins the shared constant + both call
sites deriving from it, not a rendered pixel). **Give the reference lines an
explicit `strokeWidth`** (matching the swatch's `={2}`): Recharts 3.8's default
ReferenceLine `strokeWidth` is `1`, which rendered the (correctly-coloured) zone
line as a faint, near-invisible 1px dash on the dark theme while the 2px swatch
read clearly — the "swatch coloured, line invisible" mismatch was render *weight*,
not a colour-source desync or a black token. Don't hard-code a hex/black on these
lines (use `ZONE_COLOR`), and don't drop the explicit `strokeWidth`.

> **Export colour-retention (resolved).** The SR=1.0/2.0 lines are tagged
> `className="mapper-semantic-ref"`, and `darkenReferenceLines` (`chartExport.ts`)
> SKIPS any line whose `closest('.recharts-reference-line')` carries that class —
> so their `ZONE_COLOR` green/orange survives export (the 5AJ print re-theme would
> otherwise remap every reference line to `PRINT_REF` ink, which on a TRANSPARENT
> export read as muted grey-on-dark). All other reference lines (the year-detail
> cursor, etc.) still darken to ink exactly as before; `adaptInkForPrint` already
> ignores `ZONE_COLOR`, and the background-fill logic is unchanged. The carbon-budget
> `y=0` red floor is deliberately NOT tagged (it darkens as before — a separate
> call). Locked by `tests/aesaTimelineReferenceLineColor.test.ts` (pure-DOM:
> marked line retains `ZONE_COLOR`, plain line → `PRINT_REF`).

**Exception — DSM stock counts**: `DependentStockCharts` defaults to Fixed
because stocks are integer/near-integer (vehicles, units). Picker stays
unrestricted so users can switch to scientific for very large fleets.

**Integer unit-counts** (vehicle counts, system units) on labels adjacent to
formatted quantities should keep their existing `fmtInt`-style helper — those
aren't user-controlled values, just integer counts paired with the formatted
quantity (e.g. MaterialFlowPanel's `... + fmtInt(units) ${unitLabel}`).

**Raster resolution**: PNG and JPEG exports support 1× / 2× / 3× / 4× resolution
multipliers (≈96 / 192 / 288 / 384 DPI). 2× is the default for retina screen
viewing; 3× is recommended for academic publication (~300 DPI standard).
Filenames include an `@<scale>x` suffix for raster formats only (e.g.
`mapper_<chart>_<context>@3x.png`). SVG and PDF exports are
resolution-independent and don't expose this option. Selection persists for
the session via a module-level `sessionScale` in `ChartExportButton.tsx` —
not localStorage — so tweaks propagate across charts within a session but
reset to 2× on reload.

**Print palette (Patch 5AJ)**: chart EXPORTS render print-style — black ink
(text, axis lines, tick marks, tick labels, titles, legend text) on a **white**
background (`light`, the default), with gridlines/borders in light grey and
Recharts `<ReferenceLine>` annotations darkened to a print-readable stroke. Data
series colours (cohort / scenario fills) are **retained**; the **on-screen dark
theme is untouched** (the re-theme runs on the export *clone* only). The
re-theme also applies to `transparent` exports (black ink, page/slide colour
shows through) — only `dark` exports keep the dark ink. Implemented in
`chartExport.ts`: `adaptInkForPrint` (a pure string remap of the dark INK source
colours — `--text-*` / `--border-*` in their hex / `rgb(...)` / `var()` forms —
to black / grey; data palette hexes are absent from the source lists, so they
pass through) plus `darkenReferenceLines` (a DOM pass keyed on
`.recharts-reference-line-line`, because the module accent colours those lines
use — e.g. `--mod-plca` `#f59e0b` — collide with `CHART_PALETTE` and so can't be
remapped by colour). Default export bg is `light`; `BG_STORAGE_KEY` was bumped
to `.v2` so any stale persisted `dark` resets once. Locked by
`tests/chartExportPrintPalette.test.ts`.

> **Chart exports re-theme INK only (text/axes/grid/background → black-on-white); data series colours are never recoloured, and the on-screen dark theme is untouched.**

Known limitation (flagged, not fixed): the hand-drawn faceted by-cohort
view's year-detail *cursor* dashed line uses the module accent directly (no
Recharts class), so it stays accent-coloured rather than darkened in that one
export. It's readable on white; revisit only if it reads poorly.

**Menu structure (Patch 4L)**: two-tier visibility. Primary
affordances — Mode picker (when a legend is wired) and Format picker
— are always visible at the top of the popup. Secondary refinements —
Resolution and Background — are collapsed under a single **Advanced**
toggle that defaults to closed. The collapsed toggle shows a compact
summary (`2× · Light`) so users can confirm active settings without
expanding. Resets to collapsed on every menu open: per-action
behavior, no session persistence. The active values themselves still
persist (Resolution via `sessionScale`, Background via the
`mapper.chartExport.bg` localStorage key) — only the expansion state
resets.

#### What NOT to do

- **Don't expand Advanced by default "for discoverability."** The
  collapsed summary already shows the active values. Defaults
  (2× retina, Light) are reasonable for the overwhelming majority of
  exports; visual quietness on every menu open is more valuable than
  surfacing controls users rarely touch.
- **Don't persist Advanced expansion across menu opens** (e.g. via
  localStorage). The user opening the menu for a quick PNG shouldn't
  see a sprawling form because they expanded Advanced once an hour
  ago. Per-action collapsed-by-default is the contract.
- **Don't hide the format picker behind Advanced.** Format choice is
  the primary export decision — every export touches it. Hiding it
  would invert the affordance hierarchy.
- **Don't reach for `<CollapsibleCard>` for popup-menu collapses.**
  That component is for big content blocks (Configuration, Results,
  Stage Amounts) and brings border / shadow / h3-level title weight.
  In a popup the collapsible should be lighter — small chevron +
  uppercase label, no border. Different visual weight for different
  scale of UI element.

### Legend export (Patch 4I)

Charts that ship a separate legend block can pass either `legendRef`
(direct `RefObject<HTMLElement | null>` to a sibling node) or
`legendSelector` (CSS selector queried inside the chart container —
covers Recharts-internal legends like `.recharts-legend-wrapper` in
AESA TimelineView). When either is provided, the export menu adds a
**Mode** picker with three options:

- **Chart + Legend** — default. Stacks the chart SVG and the
  natively-rendered legend SVG vertically into one combined SVG,
  then runs through the same SVG-to-canvas/PDF/SVG pipeline.
  Filename has no suffix (matches the historical "no-suffix
  combined" convention so paper-figure references stay stable).
  **The legend is centered horizontally (Patch 5AF)**: in
  `buildCombinedSvg`, the legend's nested `<svg>` is placed at
  `centeredLegendX(totalWidth, legendWidth) = max(0, round((totalWidth −
  legendWidth)/2))` within the export's full width (= `max(chartWidth,
  legendWidth)`), instead of `x="0"` (left-aligned, the pre-5AF look).
  Clamped to ≥0 so it never pushes off the left margin. Layout only — the
  legend's items + the 5O visible-only set are unchanged.
- **Chart only** — runs `exportChart` with `mode='chart'`. Filename
  gets `_chart` suffix.
- **Legend only** — extracts `(color, label)` pairs from the live
  legend's DOM, then renders a fresh SVG document with `<rect>`
  swatches and `<text>` labels using a system-font stack. Filename
  gets `_legend` suffix.

Charts without a legend (or whose legend is part of the chart visual
itself, like `<StageBreakdownChart>`) MUST omit both props. The menu
then keeps its single-mode shape — no Mode picker rendered, no
filename suffix, no behavior change. Same module-level `sessionScale`
and `BG_STORAGE_KEY` apply across all three modes.

Currently in scope (have a separately-exportable legend):
`<ProjectedTimeSeriesChart>`, `<ComparisonReferenceLineChart>`,
`<MultiScenarioImpactChart>` (Total view only — faceted view's facets
self-label and the prop is conditionally omitted), `<TimelineView>`
(via `legendSelector`).

Out of scope: `<ComparisonDeltaChart>` (no legend block — its
trajectories share colors with the sibling refline chart's legend
above it), `<StageBreakdownChart>` (legend is a stage swatch row
inside the chart's own export container, captured by the chart
export already), `<RadarView>` (zone colors are self-labelled by
ring text, no category-by-color encoding to legend).

**Patch 4J extended the in-scope set** after a deeper audit of the
DSM Dashboard and the Patch-4I exclusions. Charts added:
`<BoxPlotView>` (custom HTML legend; Patch 4I missed this because it
grepped for Recharts `<Legend>` rather than custom HTML legend
blocks), `<MultiYearTrajectoryPanel>` evolution view (Recharts
`<Legend>`, `legendSelector`), `<TimelinePreviewModal>` (Recharts
`<Legend>`, `legendSelector`). Also: DSM Dashboard's three stacked
charts (Stock composition / Age distribution / Outflow split) had
**no legend rendered at all** — Patch 4J added the legend HTML blocks
+ wired the export affordance.

**Rendering strategy** (Patch 4K — replaces Patch 4I's
`<foreignObject>` approach): native SVG `<rect>` + `<text>` with a
system-font stack (`Helvetica, Arial, sans-serif`).

Patch 4I shipped a `<foreignObject>` wrapper around the cloned
legend HTML, with computed styles inlined. That tainted the canvas
in production: MApper loads Geist + Geist Mono from
`fonts.gstatic.com`, the inlined `font-family: Geist, ...` triggered
a cross-origin font fetch when the browser rasterised the SVG, and
`toBlob` then refused with **"Tainted canvases may not be exported."**
The DSM Dashboard's Stock Composition chart was the most visible
trigger but every legend export was affected.

The native-SVG path avoids the issue entirely:

- `extractLegendItems(legend)` walks the live legend's DOM. One
  row per top-level child (or per `<li>` inside Recharts'
  `ul.recharts-default-legend`). Swatch color = first descendant
  with non-transparent `backgroundColor` (falls back to `stroke` /
  `border-top-color` for SVG-line / dashed-line legend items).
  Label = `textContent`.
- `renderLegendSvg(items, maxWidth, bg)` lays out items into rows,
  wrapping at `maxWidth` (the live legend's bounding-box width so
  the export mirrors what the user sees). Text width measured via a
  2D-canvas `measureText` (no painting → no taint); falls back to
  ~6 px per char when canvas isn't available (jsdom). Outputs one
  `<rect>` + one `<text>` per item, system-font, foreground color
  matched to the chosen background mode.

Live legends in the codebase render with the page's CSS variables
(Geist font, theme-aware colors). The exported legend deliberately
diverges — the export uses generic system fonts so the rendered
image looks reasonable in any consuming surface (paper figure,
slide deck) without depending on Geist being available wherever the
file is pasted.

#### What NOT to do

- **The exported chart legend is centered horizontally within the export
  width (clamped to margins) and stays visible-only (5O) — centering is
  layout only; it must never change which series are exported.** The center
  offset is `centeredLegendX` in `buildCombinedSvg`; the exported series come
  from `extractLegendItems(legendRef)` upstream (visible entries only, hidden
  in a sibling). Don't fold visibility logic into the centering, and don't
  center by trimming/reordering items.
- **Don't reinvent legend extraction per chart.** Use the shared
  `legendRef` / `legendSelector` API on `<ChartExportButton>`. Per-
  chart extraction would diverge over time (style inlining, computed-
  size rounding, light-bg color swaps) and the next person to add a
  chart would inherit three different patterns to choose from.
- **Charts with multi-category visual encoding (stacked, colored,
  faceted) MUST render a legend AND must use shared color mappings
  when their categories overlap with other charts in the codebase.**
  Two related rules from the same observation: legends must exist,
  and colors must align across related charts.
  - The legend half (Patch 4I→4J): without a legend, colors map to
    nothing the user can see. Patch 4J uncovered three DSM Dashboard
    charts where the rule had been silently inverted ("no legend
    element → no Mode picker → ship as-is") — the stacked area /
    stacked bar / multi-source bar were uninterpretable before the
    legend was added. When the audit asks "does this chart visually
    render a separable legend block?", the answer should be driven
    by "does the chart have multi-category color encoding?", not by
    "does the file currently contain a `<Legend>` element?".
  - The colors half (Patch 4N): if two charts visualize overlapping
    dimensions, the same value MUST get the same color. DSM Stock
    Composition and Impact Assessment's "Impact over time, by
    cohort" both encode DSM cohorts; pre-Patch-4N they each built
    their own label set and ended up with different colors per
    cohort. Centralised via `useDSMSystemColors` in
    `src/utils/dsmCohortColors.ts` — the by-cohort chart now colors
    each cohort by its currently-selected DSM Stack-by dim value
    (e.g. `BEV-LFP|Small|2028` → fuel_type → `BEV-LFP` color),
    matching what the user sees in the DSM dashboard.
  - **Patch 5AG — the MULTI-scenario "By cohort" facets must also
    use the shared resolver.** The single-scenario cohort-stacked
    chart used `dsmColors.colorForCohort` (4N), but
    `MultiScenarioImpactChart`'s `cohortColorMap` prop was still being
    fed from generic `useChartColors(cohortStackKeys)` — so the
    per-scenario By-cohort facets fell back to a default palette and
    disagreed with the DSM charts + cohort mapping. Fixed by building
    `cohortColorMap` in `ProjectedImpactPanel` as
    `{ ck: dsmColors.colorForCohort(ck, i) }` (identity-keyed,
    two-layer base + override flows through). The facets read
    `cohortColorMap[ck]` and now match the DSM charts.
  - **By-cohort impact charts inherit colors from the shared cohort
    resolver (`useDSMSystemColors`), keyed by cohort identity — never
    a default/index palette; the same cohort must be the same color
    across DSM and impact charts, and overrides must flow through.**
    (The Total view's per-scenario LINE colors are a different axis —
    `SCENARIO_PALETTE` — and stay as-is.) Locked by
    `tests/byCohortImpactColors.test.tsx`.
  - **BOTH System-level "Impact over time, by cohort" charts — Static
    Background (`DSMImpactPanel`) and Prospective Background
    (`ProjectedImpactPanel`) — build `cohortColorMap` the SAME way:
    `{ ck: dsmColors.colorForCohort(ck, i) }` via `useDSMSystemColors`.
    They stack at the same level (cohort keys) and MUST share this one
    source so the same cohort/fuel keeps its color when the user
    switches tabs. `DSMImpactPanel` previously used an independent
    `useChartColors(cohortStackKeys)` path (algorithmic per-cohort),
    which flipped colors vs. Prospective's fuel colors — do not
    reintroduce a second color-assignment path. Locked by
    `tests/impactByCohortColorParity.test.tsx` (source-invariant +
    behavioral parity).
- **Don't define a local color palette for charts that share
  dimensions with other charts.** Cohort and archetype color mapping
  is centralised in `src/utils/dsmCohortColors.ts` (Patch 4N).
  Indicator color mapping for AESA Timeline lives in
  `src/utils/aesaIndicatorColors.ts` (Patch 4S). Every chart that
  visualises DSM cohorts or AESA indicators must import the shared
  helper — never re-implement per chart. Same principle generalises
  beyond DSM: when adding a chart whose categories overlap with an
  existing chart's, lift the mapping into a shared utility before
  shipping; re-implementing per chart guarantees future drift the
  next time someone adds a hue to one but forgets the other. The
  shared utilities are the single source of truth for their
  respective dimensions.
- **Don't use CSS variables (`var(--mod-aesa)` etc.) for chart
  series colors that flow through Recharts.** CSS-variable
  resolution on SVG presentation attributes inside Recharts'
  detached legend wrapper is browser-flaky — chart lines may
  render fine while legend swatches resolve as transparent or
  stroke-default. Patch 4S hit this on AESA Timeline: the local
  palette had `var(--mod-aesa)` as slot 0; lines rendered teal but
  the legend swatch at that slot was an invisible faint outline.
  Fix: use literal hex (`#34D399`) in palettes that feed Recharts.
  Reserve CSS variables for HTML element styling (page chrome,
  custom legend `<span>` swatches) where the cascade is reliable.
- **Don't trust Recharts' auto-derived legend payload.** Pass
  explicit `payload={[{value, type, color}, ...]}` to `<Legend>`
  with concrete colors per item. Auto-derivation depends on
  `<Line>` / `<Area>` / `<Bar>` sibling rendering order and `stroke`
  attribute resolution — easy to silently break. Explicit payload
  is the safe pattern. Pair with `iconType="square"` for filled
  swatches; the default `iconType="line"` renders a 1-2px stroke
  that's barely visible at legend size.
- **Don't ship Export Legend on charts without a legend ELEMENT.**
  After confirming the chart genuinely doesn't need one (single-line
  charts, single-color charts, zone-coloured charts where labels are
  on the axes / rings), omit `legendRef` / `legendSelector` so the
  Mode picker doesn't render. This still applies — the prior rule's
  intent stands, but the audit must distinguish "doesn't need a
  legend" from "needs one but doesn't have one."
- **Don't change the existing chart-only export's filename to add
  `_chart`.** That's reserved for explicit user picks of "Chart only"
  on charts that have a legend affordance. Backward compat: charts
  without a legend keep their unsuffixed filenames forever.
- **Don't use `<foreignObject>` for chart export.** Patch 4I tried
  this; Patch 4K reverted it. Browser canvas tainting is real and
  triggered by **any** cross-origin reference inside the foreignObject
  — most commonly external fonts (Geist via `fonts.gstatic.com` in
  this app), but also images, SVG icons, and CSS-variable URLs.
  Once the canvas is tainted, `toBlob` throws and PNG/JPEG/PDF all
  fail. SVG export sometimes survives because no rasterisation
  happens, but the failure mode is non-obvious and format-dependent.
  Render legends as native SVG (`<rect>` + `<text>`) with a
  system-font stack and the whole class of bugs disappears.
- **Don't reference external fonts in exported SVGs even if you
  think they're safe.** Today's same-origin `@font-face` is
  tomorrow's CDN-hosted variant; today's non-tainting font load is
  tomorrow's CORS-restricted one. The system-font stack
  (`Helvetica, Arial, sans-serif`) is the universal safe choice for
  exports — the rendered text might not look identical to the live
  app's Geist, but the file always opens cleanly and the reader can
  always read it. Live UI font and export font are deliberately
  decoupled.
- **Don't pull in `html-to-image` for the legend export.** The
  native-SVG renderer reuses the same SVG-to-canvas pipeline the
  chart export already uses. A new dep would re-introduce the same
  taint-vector class of bugs (it ultimately uses canvas
  rasterisation under the hood) plus add bundle weight for a
  rendering surface (flat legend rows) that's a poor fit for the
  library's general-purpose HTML-to-image goals.

**Legend swatch color extraction priority** (Patch 4AE):
`extractLegendItems` walks each row's descendants once and applies
four colour-source rules in order:

1. **SVG `fill` attribute** (`<path>`, `<rect>`, `<circle>`, etc.).
   Highest priority. Recharts `<Legend iconType="square">` emits the
   swatch icon as `<path stroke="none" fill={color}>` — fill is
   where the actual color lives.
2. **CSS `backgroundColor`**. Covers custom HTML legends (BoxPlot,
   RadarView zone swatches, ConfigSidebar pills) where the swatch
   is a styled `<span style="background: ...">`.
3. **SVG `stroke` attribute**. Covers Recharts `iconType="line"`
   swatches (a horizontal stroke with `fill="none"`) and the
   dashed-line "Static" entry in `<ComparisonReferenceLineChart>`.
4. **CSS `border-top-color`** (when style ≠ `none`). Covers custom
   dashed-line legend entries that use `border-top: ... dashed`.

After all four pass empty: last-resort sentinel `#888`.

**`isTransparentColor`** rejects `transparent`, `rgba(0,0,0,0)`,
empty string, **and the SVG paint keywords `none` and
`currentcolor`**. Pre-Patch-4AE the `stroke` walk matched
`stroke="none"` on Recharts square icons and the extractor
returned `color: "none"`; the renderer then emitted
`<rect fill="none">` which is **invisible** in transparent-
background PNG exports (the user-reported bug).

**`renderLegendSvg` defensive guard**: every `<rect>` emitted by
the renderer goes through `isTransparentColor(item.color) ? '#888'
: item.color`. The extractor should never produce a transparent-
paint value (the four priorities plus the `#888` sentinel cover
all cases), but transparent-background exports turn any unpainted
rect into pure invisibility with no visual hint — belt-and-
suspenders the rule at the render boundary too.

#### What NOT to do (legend swatch colours)

- **Don't add a new colour-source check without putting it in the
  priority order.** The order matters: a Recharts square icon has
  BOTH `stroke="none"` and `fill={color}`. The fill must win;
  putting the stroke walk first or accepting "none" as a colour
  produces the invisible-swatch regression.
- **Don't return colour strings unvalidated from the extractor**
  ("just trust Recharts"). External libraries' DOM shapes drift
  with versions; the `isTransparentColor` rejection list is the
  single contract that catches all "would render unpainted"
  values regardless of which extractor branch produced them.
- **Don't drop the `renderLegendSvg` defensive `#888` coercion**
  even though the extractor "should never" leak a transparent
  value. Transparent-background PNG export is a no-margin-for-
  error rendering surface — invisible swatches look like a bug
  in the underlying data rather than an export glitch and erode
  user trust in the export pipeline.
- **Don't test legend extraction with custom-HTML fixtures only.**
  The existing test set (BoxPlot-style `<span style="background:
  ...">`) covers the backgroundColor branch but missed Recharts'
  SVG-path-fill branch for years — the Patch 4AE bug shipped
  with green tests. Always include Recharts-DOM-shape fixtures
  (`<svg><path stroke="none" fill={color}>`) when changing
  extraction logic.

## UI conventions

### Multi-select chips/selectors anchor Pick/Add on the LEFT

Multi-select chip components (selected items rendered as removable
chips next to a Pick/Add affordance) anchor the Pick button on the
LEFT of the row. Selected chips flow rightward in selection order —
newest additions land at the rightmost position. The Pick button
stays in the same DOM/visual position regardless of selection state.

Why: the alternative — Pick on the right — produces layout drift.
As selections grow, Pick shifts right; when selections shrink, Pick
doesn't always shift back the same distance (because of wrap
behaviour); add/remove cycles produce awkward gaps. Left-anchored
Pick is stable: users always reach for the same place to add a
selection, and the rightward flow gives a clear "newest at the
right" reading order.

**Components in scope** (audit complete as of this patch):

- `<DSMScenariosChip>` (`components/dsm/DSMScenariosChip.tsx`) — used
  in `DSMImpactPanel`, `ProjectedImpactPanel`, `MaterialFlowPanel`.
- LCI Scenarios chip group (inline in
  `components/impact/ProjectedImpactPanel.tsx`).

**Components correctly excluded from the rule**:

- **Single-select dropdowns** (Archetype picker, Method family
  `<select>`, AESA cascade DSM-model / scenario / background). No
  "selections accumulating" — only one value, no shifting layout.
  Don't apply the rule here; reordering would break expected
  dropdown semantics.
- **Vertical checkbox lists** (Sensitivity cases checklist in
  `DSMImpactPanel` + `MaterialFlowPanel`, AESA principle assignments,
  ArchetypeCheckboxTree). Every option is permanently rendered —
  there's no popover affordance to anchor.
- **Vertical row editors** (`PairListEditor` in
  `ProjectedImpactPanel`, `DimensionsEditor`, `DependencyRulesEditor`,
  `DownscalingChainEditor`, `PrinciplesEditor`,
  `ScalingRulesEditor`, parameter table rows). Add buttons live at
  the bottom of vertical lists where new rows naturally appear —
  there is no horizontal drift problem.
- **Single-button-with-popover pattern** (Patch 4T's
  `<IndicatorDisplayFilter>`). The chip IS the trigger; selections
  live inside the popover, not as adjacent chips. No layout drift
  to fix.

**Visual convention**: Pick/Add button uses a **dashed border**
(`1px dashed var(--border-default)`) to distinguish it from
solid-bordered selected chips. The dashed border is the "this is an
action button, not a static value" affordance. Match across all
multi-select chip implementations.

#### What NOT to do

- **Don't render Pick/Add after selected items in multi-select
  chips.** The button shifts right as selections grow, doesn't
  always shift back when selections shrink (wrap behaviour, gap
  collapse), creating awkward layout drift. Anchor Pick on the left.
- **Don't apply the left-anchor rule to single-select dropdowns**
  (impact method family picker, archetype picker, AESA cascade
  selectors). Single-select has no "accumulation" concern — there's
  only ever one value, no shifting layout. The rule is multi-select
  only.
- **Don't apply the rule to vertical row editors** (`PairListEditor`,
  list editors). Vertical lists have no horizontal drift; "Add row"
  belongs at the bottom where new rows naturally appear.
- **Audit-and-fix-all is the right discipline for layout consistency
  rules.** Fixing one chip while leaving siblings inconsistent
  produces a worse UX than the original — users notice the
  inconsistency and start hunting for which-chip-uses-which-pattern.
  When establishing a layout convention, apply it universally in
  one patch; don't accumulate technical debt by deferring siblings.
- **Don't drop the `data-testid="*-pick"` selector** when refactoring
  a chip. The convention test
  (`tests/multiSelectChipLeftAnchor.test.tsx`) keys off it to assert
  DOM order. Without the testid the regression is invisible.

Year-detail UI uses the shared `<YearSlider>` component
(`components/ui/YearSlider.tsx`), not a `<select>` dropdown or bare
`<input type="range">`. The slider syncs with chart cursors live (every drag
step, not just on release) — the chart's `<ReferenceLine>` and any per-year
tables/sub-charts read the same `detailYear` state, so binding it to the
slider's `onChange` propagates on every input event.

**When it applies — single-year-focus pattern**: the user inspects details
for one year out of N (cohort table for {year}, age distribution at {year},
SR radar at {year}, top-N materials in {year}, AESA box plot at {year}).
The chart/table re-renders to show that year's slice.

**When it doesn't — all-years-at-once pattern**: the visualization shows
all years simultaneously without a focal year (multi-year trajectory line
charts, time-series stacked areas, AESA Timeline). No slider — the chart
*is* the year navigator.

**Currently used by**: DSM Dashboard (system dynamics + age distribution),
DSM Material Flows (top-N detail year), Impact Assessment (Static +
Prospective Background cohort year), AESA Dashboard (top-level year), AESA RadarView,
AESA BoxPlotView. Pass `accentColor` matching the module (`--mod-dsm`,
`--mod-lca`, `--mod-plca`, `--mod-aesa`); use `variant="inline"` when the
slider sits inside a chart card, `variant="card"` for a standalone year
picker; `showDots={years.length <= 30}` keeps dots from cluttering long
horizons. Range pickers (start-year + end-year) and parameter sliders
(Weibull k/λ, mode parameters) keep their bespoke `<input type="range">` —
this convention is for single-year inspection only.

Long-form panels (configuration + results pairs) use `<CollapsibleCard>` for
the configuration and results sections so users can focus on either input or
output. Default both expanded; user controls collapse. Collapsed-state
summary line includes key headline metrics so the card is informative
without expansion (e.g. `{N} indicators · {scope} · {years range} ·
Sensitivity: {name}` for config; `Calculated in {time} · {N} indicators ·
Peak: {value} {unit} ({year})` for results). Hide the Results card entirely
until a calculation has produced data — don't render an empty stub. Used in
Impact Assessment (Static + Prospective Background tabs).

**Where the pattern applies**: `<CollapsibleCard>` applies where a config
block stacks vertically above a results block. Where config and results are
arranged side-by-side (sidebar + main), the layout itself provides the
separability and `<CollapsibleCard>` isn't needed.

**LCA Architect Manager tab** uses `<CollapsibleCard>` for Import, Export,
and Archetype Summary — same pattern as Configuration cards in Impact
Assessment. Import + Export sit side-by-side at the top (responsive grid)
and Archetype Summary stacks below. Each card collapses independently.
Import and Export default expanded (primary affordances on first visit);
Archetype Summary defaults collapsed (informational, surfaces totals via
the summary line).

**AESA exception**: AESA Dashboard does not use the `<CollapsibleCard>`
pattern. AESA uses a sidebar+main layout where configuration is already
separable via the existing `sidebarCollapsed` toggle, and the main content
(zone headline cards + active view) is primary content that should remain
visible. `<CollapsibleCard>` is for vertical config/results stacks like
Impact Assessment, not for horizontal sidebar+main layouts.

### Page-level scroll for chart-rendering pages

Page-level scroll is MApper's default for any page rendering charts
at natural height. Don't constrain page or result-body containers
to viewport height — sequential reading (scroll the page) is
preferred over panel-internal scrolling. Charts have natural sizes
determined by content (radar axis count, time-series year range,
stack of indicators with axis labels). Forcing them into bounded
containers either clips them (Patch 4V's regression) or shrinks
them illegibly.

**Currently applied to**:

- **Single-product Impact Assessment** (Patch 4D era — see the
  detail below this section).
- **AESA result body** (Patch 4V). Drops `height: 100%` from the
  AESA root, `overflow: hidden` from inner `<main>`, and
  `flex: 1, minHeight: 0, overflow: auto` from the active-view
  section. Configuration sidebar becomes `position: sticky, top: 0,
  maxHeight: calc(100vh - 96px)` so it stays visible while main
  scrolls; the body wrapper uses `alignItems: flex-start` so the
  sidebar's height is content-driven (precondition for sticky).

**Future pages** with chart-rendering result bodies should follow
the same pattern: drop viewport-fit constraints, let Shell's outer
`<main overflow: auto>` handle the scroll, sticky-position any
sidebar that should stay visible during scroll. Always-mount tab
panels via the visibility-toggle convention (the existing rule)
applies here too — don't conditional-mount panels to "save scroll
height," just let `display: none` do the work.

#### What NOT to do

- **Don't constrain chart-rendering pages to viewport height.** A
  fixed-height ancestor with `overflow: hidden` (or `auto`) creates
  an internal scroll container that fragments the reading
  experience and clips chart content positioned outside the SVG
  bounding box (radar axis labels, legend overflows). The single-
  scroll-container rule keeps the page coherent.
- **Don't add `flex: 1, minHeight: 0, overflow: auto` to chart
  containers** thinking it "constrains" the chart. It clips. SVG
  charts often render content (axis labels, tooltips) outside
  their reported bounding box; `overflow: auto` on the container
  hides those instead of letting the page scroll to reveal them.
- **Don't reach for sticky sidebars without `alignItems:
  flex-start` on the flex container.** Without it, flexbox stretches
  the sidebar to the container's content height; there's then no
  room for the sidebar to "stick" within its own container, and
  `position: sticky` becomes a no-op. The combination of `align-
  items: flex-start` (sidebar = content height) + `position:
  sticky` (anchored to scrollable ancestor = Shell `<main>`) is
  load-bearing.

### Single-product mode uses page-level scroll

Single-product Impact Assessment sections take their content's natural
height; the page itself scrolls. Configuration and Results stack
vertically and grow to whatever vertical space their content needs.

**Why**: LCA results are long-form analysis output — many indicators,
stage breakdowns, scenario tabs, and tables meant to be reviewed
sequentially. A bounded-height-with-internal-scrolling layout was
attempted (Patch 4 — `fill` prop on `<CollapsibleCard>`, `flex: 1` +
`minHeight: 0` on panel sections, internal scrolling within
Configuration and Results) and reverted after dogfooding: section-level
scrolling fragments the reading experience because LCA review is
inherently sequential reading rather than dashboard-style at-a-glance
comparison. Two scroll containers (page + section) compete and force
the user to track which one their cursor controls.

**Stage Amounts collapsibility (kept)**: the wrapper-level Stage Amounts
editor sits inside its own `<CollapsibleCard>`, default collapsed — most
users keep Lifetime defaults; the editor is an advanced tweak.
Collapsed-state summary shows preset + abbreviated per-stage amounts
(`Lifetime · 15 yr · Mfg 1 · Use 15 · Maint 15 · EoL 1`) so users see
the active configuration without expanding. Locked in by
`tests/singleProductLayout.test.tsx`.

**Sub-tab nav → content separation (Patch 5K)**: the Single-item content
block (`single-product-tab-content`) carries a `marginTop: var(--space-4)`
so the Static/Prospective/Comparison tab row reads as distinct from the
CONFIGURATION card below it (matches the System-level layout's tab→content
gap). Spacing comes from the scale token, never hardcoded px.

**Single-pane card spacing (Patch 5U)**: the single-pane is a plain block
container (no flex `gap`), so stacked cards space via a scale-token `marginTop`
on the lower element. The Archetype → Stage amounts gap (`single-product-stage-amounts`)
uses `marginTop: var(--space-4)` — the same token + mechanism as the
tab-nav → content gap above. Any future card added to this pane follows the
same rhythm (scale token, never hardcoded px).

#### What NOT to do

- **Don't constrain Single-product mode section heights with flex
  layouts.** Page-level scroll is the established pattern. The
  bounded-height-with-internal-scrolling layout was attempted and
  reverted because it fragments long-form LCA result review. Don't
  reintroduce `height: 100%` / `minHeight: 0` / `flex: 1` on panel
  roots, tab panes, or `<CollapsibleCard>` instances within the
  single-product subtree.
- **Don't add a `fill` prop (or equivalent) back to
  `<CollapsibleCard>`.** It was removed cleanly when the bounded-height
  pattern was reverted because no consumer outside single-product used
  it. If a future panel genuinely needs viewport-bounded scroll, build
  it as a one-off rather than re-introducing a generic prop that
  invites the failed pattern.
- **Don't conditionally mount the inactive tab panes** in the single-
  product wrapper. Same visibility-toggle rule as everywhere else —
  panel-local state (Configuration expanded/collapsed, scenario tab
  idx) must survive a tab switch. The wrapper uses `display:
  block|none` per pane, not conditional render.

### Visibility-toggle vs. conditional mount (general UI rule)

**General rule.** Any UI element that hides and reappears — tab panel,
collapsible card, modal, accordion, mode wrapper, sub-tab — defaults to
**visibility-toggle** (`display: none`), not conditional mount/unmount.
Conditional mount kills component-local React state silently and forces
store-lifting that wouldn't otherwise be necessary. Reach for conditional
mount only when there's a specific reason to free memory (e.g. heavy
lazy-loaded components that aren't worth keeping in memory across the
entire session, or panels with side-effecting mount logic that should
re-run when the user returns). Default to visibility-toggle.

The "conditional-mount eats useState" failure mode has been root-caused
multiple times in this codebase: tab panels (Patch 3), mode toggle
wrappers (Patch 3), sub-tab panels (Patch 3), and `CollapsibleCard`
(Patch 4A). The pattern is established enough to be the default rule for
all hide/reappear UI.

**Concrete instances in this codebase.**

- **Impact Assessment tab panels** (`ImpactAssessment.tsx`): renders all
  three panes (`static`, `projected`, `compare`) simultaneously and flips
  the `display` style on the inactive ones. Each pane carries a
  `data-testid="impact-tab-pane-<key>"`. Locked in by
  `tests/impactAssessment.tabPersistence.test.tsx`.
- **Impact Assessment mode toggle** (Patch 3): single-product and
  system-mode subtrees both stay mounted; `display: none` on the
  inactive pane. Locked in by `tests/impactAssessment.modeToggle.test.tsx`.
- **`CollapsibleCard`** (Patch 4A): body wrapped in `<div style={{display:
  expanded ? 'block' : 'none'}}>` so MethodPicker selections, scope picks,
  and other indicator-row state survive collapse/expand round-trips.
  Locked in by `tests/collapsibleCard.visibilityToggle.test.tsx`.

Each long-lived panel (`DSMImpactPanel`, `ProjectedImpactPanel`,
`ComparisonPanel`) is wrapped in `React.memo` so unrelated parent
re-renders (e.g. opening the Method Library modal, toggling tabs) don't
cascade. memo doesn't help with the panels' own store-subscription
re-renders, but those only fire while a calculation is active and the
hidden subtree skips layout/paint via `display: none`.

#### What NOT to do

- **Don't switch back to `{condition && <Panel />}`.** That kills every
  panel-local `useState` on hide/reappear — the bug this pattern fixes.
  Render tests will catch the regression, but only if a future dev runs
  the suite. The pattern itself (visibility-toggle) is the primary
  defense.
- **When fixing a "state disappears on switching" bug, do NOT lift the
  affected state into a store as a first instinct.** Investigate whether
  the parent wrapper conditionally mounts/unmounts. The wrapper-level
  fix (visibility-toggle) is principled and benefits all consumers;
  state-lifting is symptomatic, adds store complexity for one specific
  case, and creates two sources of truth (store slot + any mirrored
  local state) that are easy to desync. Lift state only when you have a
  separate reason to share it across components — never as a workaround
  for unmount-on-hide.
- **Don't leave `data-testid` selectors in place but make them
  conditional** (e.g. on activeTab or expanded). Render tests assert
  panes/wrappers are always present; conditional `data-testid` would
  break the always-present invariant silently.
- **Don't move CollapsibleCard's children outside the toggle wrapper to
  "save renders".** The wrapper exists precisely to scope `display: none`
  to the body while leaving header (chevron, title, summary, actions)
  visible. Splitting the children across the wrapper would either
  require duplicating the toggle logic per child or break the
  always-mounted contract for some children.

### Effects in visibility-toggle-mounted panels (Patch 4E)

When two panels are mounted simultaneously via the visibility-toggle
pattern, `useEffect` dependencies on the wrapping panel's "primary"
identity (e.g. `[archetypeId]`, `[systemId]`) are NOT enough to drive
cross-panel synchronization. Both panels are alive at the same time;
the user can edit data in one and expect it to flow to the other
without an archetype/system change. Subscribe to the **actual data
being synchronized** — the source-of-truth slice — so the effect fires
whenever that slice changes, not just on identity switch.

**Concrete instance — Static→Projected inheritance.** The Projected
panel's first-visit-inheritance effect (Patch 4D) was originally keyed
on `[archetypeId]` only. Bug: user picks an archetype before
configuring Static; the inherit effect fires once with `staticCfg ===
undefined` (path 3 → defaults), then never re-fires. User then
configures Static and switches tabs — Projected silently stays on
defaults because `archetypeId` didn't change.

**Patch 4E fix** in `SingleProductProjectedPanel.tsx`:

- Add a sliced selector
  `useSingleProductImpactStore((s) => s.staticConfigByArc[archetypeId])`
  so the effect re-fires when *just this archetype's* static config
  changes (not on every store write).
- Add the sliced value to deps. Read `projectedConfigByArc` and
  `projectedCustomizedByArc` fresh via `getState()` rather than
  subscribing — they're written by the effect itself, and subscribing
  would re-fire from the effect's own write.

**Patch 4F amendment — live mirror, not one-shot.** Patch 4E shipped a
guard ref that fired Path 2 inheritance only the first time the
staticCfg slice changed for an archetype, with subsequent changes
falling through Path 1 (early-return on non-archetype-change). The
unit tests passed because they wrote one staticCfg payload then
asserted; the real workflow — user adds 4 indicators sequentially on
Static — only inherited the first. Patch 4F flipped the semantic:
**live mirror Static→Projected until `projectedCustomizedByArc[arc]`
flips true.** Each Static slice change re-bumps the picker; the
banner shows only once per arc per session
(`bannerShownForArcRef`). Once the user clicks anything on Projected
that calls `setProjectedCustomized(arc, true)`, the mirror stops and
Path 1 takes over (restore-only-on-archetype-change).

**Patch 5AY — cold-load default seed (closes the parked single-item Prospective
watch-item / image-1's 0/N).** The mirror has no SOURCE until Static publishes
to `staticConfigByArc[arc]`; opening Prospective FIRST (Static not effectively
published yet) left it at 0/N. Fix: `SingleProductProjectedPanel` fetches the
full indicator set (all-N, EF v3.1 else first family — matching MethodPicker's
cold default) and a dedicated **cold-seed effect** seeds it via `initialSelected`
(+ picker remount) ONLY when truly cold: no `staticCfgForArc` methods, no
`projectedConfigByArc[arc]`, not customized, and `selectedMethods` empty. The
seed flows through the SAME single-echo + `skipNextMethodsChangeRef` path the
mirror uses → `projectedCustomized` stays **false**, so a later Static publish
still mirrors over the default (the cold-seed's `staticCfgForArc` guard yields),
and a genuine user edit still flips customized true and freezes the mirror.

**Why NOT `defaultAllSelected` on the Projected MethodPicker (the rejected
naive fix).** `defaultAllSelected` fires its all-N onChange ASYNCHRONOUSLY
(after `getMethods` resolves), so it arrives as a SECOND onChange the single-use
skip ref can't cover — `handleMethodsChange` reads it as a user edit →
`setProjectedCustomized(true)` → freezes the mirror, regressing
`singleProductStaticDefaultPublish (b)` + `singleProductInheritanceUserFlow`.
Seeding all-N via `initialSelected` instead fires exactly ONE mount echo, which
the skip absorbs — no async double-onChange, no false customization. The
mirror source being seeded to the full default regardless of visit order is the
convention; `projectedCustomized` is set only by genuine user changes, never by
the default seed. Locked by `tests/singleProductProjectedColdLoad.test.tsx`
(cold → all-N + not customized; later Static change still mirrors; real user
edit customizes + freezes).

**Lock in by user-click test, not store-mutation test.** The 4E test
suite stubbed `setStaticConfigForArc` directly via the store, which
bypasses the actual `MethodPicker.onChange → handleMethodsChange →
store-write → slice-selector → Projected-effect` chain. The user-flow
test (`tests/singleProductInheritanceUserFlow.test.tsx`) renders both
panels and clicks rendered MethodPicker checkboxes. That's the
pattern for any cross-panel sync regression — store mutation alone
doesn't catch the lifecycle/effect-ordering shape that broke 4E.

#### What NOT to do

- **Don't add `staticConfigByArc` (the whole map) to the deps**, only
  the per-archetype slice. Subscribing to the whole map fires on
  every other arc's edits too, which is needless churn (and would
  bypass zustand's reference-equality optimization).
- **Don't subscribe to `projectedConfigByArc` in the deps to "keep
  things consistent".** The effect writes to that slot on every
  mirror, so subscribing creates a self-trigger loop. Read fresh via
  `getState()` for slots the effect itself writes.
- **Don't reintroduce the "one-shot inheritance" semantic.** It looks
  defensible on paper ("only inherit once, then user owns Projected")
  but doesn't match the user's mental model when configuring
  indicators piece-by-piece. Live mirror is the contract; the
  customized flag is the off-switch.
- **Don't move the banner-suppression off
  `bannerShownForArcRef`.** The mirror fires N times per arc as the
  user adds indicators on Static; only the first fire should pop the
  banner. A flag tied to projCfg presence (4E's
  `inheritedForArcRef`) was wrong because projCfg gets rewritten on
  every mirror — using it as the "first inheritance" signal also
  broke the live-mirror semantic.
- **When debugging "data X doesn't update in panel Y after I edit
  panel Z", first check: are X and Y both mounted simultaneously,
  and is Y's effect keyed on something other than X?** That's the
  failure mode. The fix is almost always "add the slice of X to Y's
  deps." Then ask "what's the off-switch?" — explicit user
  customization is usually the right answer; first-fire heuristics
  fail in incremental-edit workflows.
- **Don't set `defaultAllSelected` (or any auto-default) on a panel whose
  selection FEEDS a live-mirror — let it inherit.** Self-defaulting fires the
  panel's `onChange` → trips its customize handler (`setProjectedCustomized(true)`)
  on mount → freezes the mirror, so upstream (Static) edits stop propagating.
  `SingleProductProjected` deliberately omits `defaultAllSelected`; it gets "all"
  via the 4F mirror from Static. Default-all belongs on the SOURCE panel only.

### Hooks must be called unconditionally (Patch 4H)

React's Rules of Hooks require every functional component to call the
same hooks in the same order on every render. Violating this throws
**"Rendered more hooks than during the previous render"** at runtime
the moment a re-render takes a different code path through the
component body. Patch 4G shipped a regression in
`SingleProductComparisonPanel.tsx` that exemplifies the failure mode
— `const [isExporting, setIsExporting] = useState(false)` and the
matching `useCallback` were placed AFTER the early-return guards on
`archetypeId`/`staticResult`/`projectedRuns`. Single-state tests
passed because each test exercised only one path per component
instance. The bug surfaced in the field when the user transitioned
from "no results" to "both results computed" within the SAME instance
— render N: 7 hooks, render N+1: 9 hooks → React throws.

**The rule:** every hook (`useState`, `useEffect`, `useMemo`,
`useCallback`, `useRef`, custom hooks, store hooks like
`useSomeStore(...)`) must run before ANY conditional `return`.

```tsx
function Panel({ id }) {
  // ALL hooks first, unconditional.
  const [a, setA] = useState(...)
  const value = useStore((s) => s.value)
  const memo = useMemo(...)
  const handler = useCallback(...)
  useEffect(...)

  // THEN conditional returns.
  if (id == null) return <Empty />
  if (!value) return <Loading />
  return <Full ... />
}
```

The hook body itself can branch on conditions (e.g. `useEffect(() =>
{ if (!result) return; ... })`). What can't branch is whether the
hook is *called* — that's a positional contract React enforces by
hook count.

#### Render-test discipline for result-presence states

Components with multiple result-presence states (no result, partial
result, full result) need render tests for **each** state — and at
least one test that **transitions between states within a single
component instance.** Single-state tests pass against hook-ordering
bugs because each test renders only one path. The transitioning
test is the one that catches the regression.

`tests/singleProductComparisonHookOrder.test.tsx` is the template:
five cases covering all three single-state renders plus an explicit
empty → full transition via store mutation + `rerender`. The
transition assertion (`expect(...).not.toThrow()` around the
`rerender` call) was the only one that failed against the buggy
implementation; the four single-state cases passed even before the
fix. When you add a new conditional branch to a panel, add the
transitioning render test before shipping.

#### What NOT to do

- **Don't place hooks after early returns to "scope them" to the
  full-render path.** A hook that's only "needed" in one branch
  must still be called unconditionally — its return value can be
  ignored when the branch isn't taken.
- **Don't write a single-state render test and assume it catches
  hook-ordering bugs.** Single-state tests took 4G to production
  green. The transition test is the load-bearing one.
- **Don't lift the affected state into a store as a workaround.**
  The fix is structural (move the hook above the early return), not
  state-architectural. State-lifting addresses a different failure
  mode (visibility-toggle conditional-mount eating useState — see
  the existing rule above) and adds store complexity for no benefit
  here.
- **Don't disable the React error boundary that catches the throw
  in dev.** The "Rendered more hooks" error is loud on purpose; if
  you're tempted to swallow it, that's the bug telling you a
  re-render path is structurally broken.

### Δ chart framing in Single-product Comparison

`<ComparisonDeltaChart>` (in
`components/charts/ComparisonReferenceLineChart.tsx`) ships with the
title **"Impact assessment change compared to Static Background
(Δ > 0 → worsening, Δ < 0 → improvement)"**. Explicit Δ math wins
over visual-direction framing — both are methodologically valid
(`Δ = P − S` in both single-product and system Comparison code), but
user preference is the explicit math. The earlier "downward =
improvement" framing was tried in Patch 4E and replaced in 4F. Do
not relitigate without a user-driven reason; document the next pivot
here so the back-and-forth is visible.

The chart is a `<LineChart>` (no area fill). Patch 4F also dropped
the original vertical-gradient `<Area>` fill — it conveyed
direction (red top = bad, green bottom = good) but read as a
shadow/halo against the page background. Sign legibility is preserved
by the curve crossing the y=0 reference line and the tooltip's
green/red value tone. Match the sibling `<ComparisonReferenceLineChart>`
styling — both are now Line-only with no fill.

### Single-product Impact Assessment Excel exports (Patch 4G)

Three sibling builders in `mapper/api/impact.py`, paralleling the
per-axis system-mode builders (`_build_multi_param_workbook`,
`_build_multi_dsm_workbook`, `_build_multi_paired_workbook`,
`_build_multi_scenario_workbook`):

- `_build_single_product_static_workbook(archetype_name, scope,
  scenarios)` — Configuration / Total impacts / Stage breakdown.
  Multi-parameter sensitivity adds one column per case to the totals
  sheet. Stage breakdown sheet appears only when `scope == "all"` AND
  at least one scenario carries a non-empty `stage_breakdown`.
- `_build_single_product_prospective_workbook(archetype_name, scope,
  runs)` — Configuration / Time series (wide) / Time series (long) /
  Stage breakdown by year (only when `scope == "all"`). Wide layout is
  for skim-the-trajectory reading; long layout is for downstream
  pandas/R consumption.
- `_build_single_product_comparison_workbook(archetype_name, scope,
  static_result, projected_runs)` — Configuration / Comparison data /
  Cumulative summary per traj. Sign convention `Δ = P − S` (matches
  the in-app Δ chart from Patches 4E/4F). Δ% normalisation handles
  `S == 0` by writing an empty cell rather than `inf`/`NaN`.

Routes: `POST /impact/export-single-product-{static,prospective,comparison}`.
Each takes a typed envelope (`SingleProduct{Static,Prospective,
Comparison}ExportRequest` in `mapper/models/schemas.py`) carrying the
archetype name, scope, and the data — no task_id lookup needed
because the frontend already has the result objects in
`useSingleProductImpactStore`. Filenames follow
`MApper_Impact_SingleProduct_<Static|Prospective|Comparison>_<archetype>_<date>.xlsx`,
sanitised via `_sanitize_filename`.

**Frontend wiring**: each Single-product Results card has a
`<button data-testid="single-product-{static,projected,compare}-export">`
in the CollapsibleCard `actions` slot. The button is absent (not
disabled) before a result exists — the Results card itself is gated
on `hasResults`, so a no-data state shows the empty state, not a
greyed-out button. Loading state during export shows a spinner.

#### What NOT to do

- **Don't bundle Static + Prospective + Comparison into one
  mega-workbook.** Each sub-tab gets its own export — matches the
  per-axis convention from system-mode (multi-LCI, multi-DSM,
  multi-param, multi-paired all ship as separate files), keeps each
  file shareable in isolation, and avoids a workbook that's
  load-bearing on three different result shapes at once. If a user
  wants both Static and Prospective, they download two files.
- **Don't move the builders into `mapper/api/lca.py`.** That module
  owns LCA Architect's Calculator export
  (`_build_lca_export_workbook` + `/lca/export-archetype`), which is
  a workshop tool tied to BOM authoring. Single-product Impact
  Assessment is a sibling to system-mode Impact Assessment, both
  computing through `/lca/calculate-archetype` but with different
  framing (sensitivity / prospective / comparison). Keeping the
  Patch-4G builders next to the multi-axis system-mode builders in
  `impact.py` makes the per-axis pattern easier to extend.
- **Don't include the Stage breakdown sheet for specific-stage
  scopes.** When `scope ∈ {"inflows", "stock", "outflows"}`, the
  result is already that one stage — a "breakdown" would just have
  one column, which is redundant with the Total impacts sheet. The
  test `test_stage_breakdown_omitted_for_specific_scope` enforces
  this.
- **Don't write `Δ% = inf` or `NaN` when Static is zero.** Empty
  cell is the right surface — analysts opening the workbook in
  Excel won't get NaN-cascading-into-formulas surprises.
- **Don't reach for the per-scenario detail in the Comparison
  workbook for "rich" exports.** Multi-axis exports across modes
  deliberately ship narrower — re-run a single scenario's Static or
  Prospective for cohort-level / contribution-level depth. This
  mirrors the multi-LCI / multi-DSM convention.

### Onboarding tour

`OnboardingTour.tsx` (react-joyride) walks first-time users through one
representative research workflow end-to-end — computing a product's climate
impact against an ecoinvent base, with each step pinned to the next sidebar
tab in research order: Database Explorer → Archetypes (LCA) → Stock
Modeller (DSM) → Impact Assessment → AESA. Tour design is **goal-driven**
(one canonical research question executed end-to-end), not feature-driven
(per-button tooltips). pLCA and other branching paths get one-line mentions
in the welcome and closing steps, not dedicated stops.

Anchored via `data-tour="nav-<id>"` attributes on the Sidebar tab buttons
(`Sidebar.tsx`). Auto-start gated by the `mapper-onboarding-complete`
localStorage flag; manual restart via the `window.__mapperStartTour` global
exposed for the Settings → "Restart tour" button.

**When adding new tabs or major features, the tour does NOT automatically
need updating** — only update if the new feature changes the canonical
research workflow itself. New features get documented in CLAUDE.md and/or
in-app tooltips, not the tour.

#### What NOT to do

- **Don't blindly add a tour step for every new tab or feature.** The tour
  stays focused on one workflow; turning it into a feature catalog
  defeats its purpose and pads the run-time past the "2-minute" promise
  in the welcome copy. If a new feature is genuinely load-bearing for the
  canonical research path, replace or modify an existing step — don't
  append.
- **Don't add per-feature deep-dive steps** ("here's the multi-LCI chip,
  here's the format control, here's how to export charts"). Those belong
  in tooltips, the Help/Settings panels, or CLAUDE.md — not the tour.
- **Don't remove the `data-tour` attributes** on sidebar tabs without
  updating the corresponding step's `target` selector. Joyride silently
  drops steps with missing targets, which leaves users mid-tour at a
  blank screen.

### DSM combined "Inflows & Outflows" flows chart (Patch 5AD)

The DSM Dashboard's former single-series "Outflows" chart is now **"Inflows &
Outflows"** — two flows in one chart. **Inflows** render as a GROUPED bar (its
own Recharts `stackId="i"`) beside the **outflow** column (the existing
natural/forced/uploaded breakdown stays stacked under `stackId="o"`), with a
legend. Inflow data is the per-year total from the SAME DSM result
(`Σ simulationResult.years[].inflow`) — added to the `outflowBreakdown` memo; no
DSM compute/simulation change. There was no separate Inflows chart to remove
(inflows only had an upload card + a summary card). The chart shows whenever
there are inflows OR outflows.

**Colors match the table coding and are fixed per series** (not index-based):
inflow = `var(--success)` (the table/summary green), outflow sources keep
`--chart-3` / `--danger` / `--mod-dsm`. The legend/series model is the pure
`buildFlowLegend(breakdown)` (`utils/dsmFlowLegend.ts`) — Inflows lead, then a
single "Outflows" entry (single source) or the natural/forced/uploaded split —
keeping bars and legend swatches in lockstep. The legend always renders now (≥2
series) and legend export is always enabled; the chart-image + legend export
cover both flows. Filename `flows_<start>-<end>`. Locked by
`tests/dsmFlowLegend.test.ts`.

#### What NOT to do

- **The flows chart displays inflows and outflows together from the existing DSM
  result series — it is a visualization, not a compute change; series colors
  match the table's inflow/outflow coding and stay stable per series.** Don't
  fetch/recompute inflows (sum `simulationResult.years[].inflow`); don't
  index-color the series (fixed per-key via `FLOW_COLORS`); don't stack inflow
  into the outflow column (separate `stackId` → grouped, side-by-side).

### DSM Dashboard parallel-input upload boxes (Patch 5A)

Annual inflows and Annual outflows on the DSM Dashboard System dynamics
tab are methodologically parallel — both are time-series CSV inputs that
feed stock dynamics from the same kind of data stream. They share one
layout, rendered through the shared `<DSMUploadSlot>` component
(`components/dsm/DSMUploadSlot.tsx`): header → status line → action
prompt → schema subtitle → Download template link (top-right of the
uploader header, owned by `<CSVUploader>`) → drop-zone. The shared
component enforces the symmetry by construction — the two boxes cannot
drift apart as their copy evolves. `<CSVUploader>`'s drop-zone carries a
fixed `minHeight` so it renders at the same size across boxes and upload
states regardless of header content above it. Symmetry is locked by
`tests/dsmUploadSlotSymmetry.test.tsx`.

The two status lines differ in wording because the methodological
conditions differ (inflows: "Required to run simulation"; outflows:
"Required for manual cohorts"), but both follow the same "Required …"
framing and the same structural slot. The schema subtitles differ in
content (inflows describes new units entering; outflows notes the
optional age/birth_year cohort-targeting column) but both occupy the
same one-line subtitle slot.

The Stock and Stock-targets boxes deliberately stay on `<SetupCard>`,
not `<DSMUploadSlot>` — Stock has a different purpose (single upload +
aggregate toggle in its header `right` slot), and the parallel-input
symmetry rule is specific to the inflows/outflows pair.

#### What NOT to do

- **Don't ship visually asymmetric layouts for methodologically
  parallel inputs.** Side-by-side boxes serving the same structural
  purpose (upload a time-series CSV) should follow identical layout
  patterns even when their content differs. Asymmetry signals
  "different thing" to users when these are actually the same thing
  applied to different data streams. The pre-Patch-5A inflows box
  shipped without a schema subtitle and with a non-parallel status
  ("Not yet uploaded"), making it read as a different kind of control
  than outflows.
- **Don't patch one box's props inline** to fix the symmetry. The
  shared `<DSMUploadSlot>` is the enforcement mechanism; editing one
  box's `<SetupCard>`/`<CSVUploader>` directly re-opens the drift the
  component closes.
- **Don't fold Stock into `<DSMUploadSlot>`.** Stock isn't part of the
  parallel pair — it carries an aggregate toggle and single-upload
  semantics. Forcing it into the shared component would require
  bending the component with optional slots.
- **Don't drop the drop-zone `minHeight`** when refactoring
  `<CSVUploader>`. Without it, a box with more header content pushes
  its drop-zone to a different size/offset than its sibling.

#### Patch 5A+ — layout structure (Stock banner + parallel pair)

Patch 5A unified the *component*; the boxes still rendered at different
sizes because (a) the schema subtitles wrap to different line counts at
narrow column widths, shifting the drop-zone start, and (b) Stock took a
full equal-width grid column, compressing the inflows/outflows pair. The
DSM Data-setup grid (`DSMDashboard.tsx`) is now two stacked rows:

- **Stock = system identity → full-width row.** Renders as a horizontal
  banner (`<CompactCard>`) when uploaded, a full-width `<SetupCard>` (with
  the by-age / Aggregate toggle) when empty. It is NOT a column in the
  temporal grid.
- **Temporal inputs → equal-width parallel row below.** A nested grid
  (`data-testid="dsm-temporal-grid"`) with `gridTemplateColumns:
  repeat(N, 1fr)` and `alignItems: 'stretch'`, where N = inflows +
  conditionally outflows (manual mode) + stock-targets (stock-driven
  mode). The inflows/outflows pair always splits its row 50/50 regardless
  of stock upload state.

This layout is **methodologically meaningful**: Stock defines the system;
inflows + outflows describe its temporal evolution. The visual hierarchy
(identity banner above, temporal pair below) reflects that.

Two complementary mechanisms guarantee identical box dimensions in the
parallel pair:

1. **Subtitle-area reservation** (primary). `<CSVUploader>` accepts
   `descriptionMinHeight`; `<DSMUploadSlot>` passes a 2-line reservation
   (`SUBTITLE_MIN_HEIGHT = '2.8em'`). The drop-zone starts at the same
   vertical offset in both boxes no matter how the subtitle wraps.
2. **Stretch backstop** (secondary). The temporal grid's
   `align-items: stretch` + `<SlotFrame>` `height: 100%` + `<DSMUploadSlot>`
   `flexGrow: 1` make boxes equalize to the tallest sibling if a subtitle
   ever exceeds the reservation.

#### What NOT to do (layout)

- **Don't shoehorn Stock into a 3-/4-column grid with the temporal
  inputs.** Stock has different semantics (system identity) and different
  upload UI (aggregate toggle, larger empty state). An equal-width grid
  produces asymmetry when stock is uploaded (compact chip beside full
  boxes) and compresses the parallel pair below visual minimums. Stock is
  its own full-width row.
- **Don't rely on `align-items: stretch` alone for parallel-input
  symmetry.** Variable-length subtitles cause inconsistent drop-zone
  offsets even when total box heights are equalized (extra height pools at
  the box bottom, not above the drop-zone). Reserve the subtitle-area
  min-height (`descriptionMinHeight`) so the drop-zone starts at the same
  offset; stretch is only the height backstop.
- **Don't drop `flexGrow`/`height: 100%`** from `<DSMUploadSlot>` /
  `<SlotFrame>` when refactoring — without them the stretch backstop is a
  no-op (the bordered card won't fill the stretched grid cell).
- **Don't shorten or rewrite the subtitle / drop-zone text to "fix"
  wrapping.** The subtitles are methodological documentation; the fix is
  the reservation + wider 50/50 columns, not truncation.

### DSM Simulation warnings panel collapse (Patch 5B)

`<SimulationWarningsPanel>` (`components/dsm/SimulationWarningsPanel.tsx`)
renders the DSM simulation warnings. The per-cohort-per-year "manual
outflow exceeds available stock" lines are repetitive and can run long
(37+ rows), pushing the results/charts far down the page. The header
carries a collapse toggle (Chevron, mirrors `<CollapsibleCard>`'s icons)
and a **persistent count** — `Simulation warnings (N)` — so collapsing
hides the body without erasing the signal that warnings exist.

- **Default expanded.** Warnings flag real data issues the user
  shouldn't miss; collapse is a manual action once they've read them.
- **Visibility-toggle, not unmount.** The body is `display: none` when
  collapsed (per the codebase-wide convention) so re-expanding is
  instant and scroll/row state is preserved. Locked by
  `tests/simulationWarningsPanel.test.tsx`.
- **Not `<CollapsibleCard>`.** That primitive hardcodes neutral
  `--bg-surface` / `--border-subtle` styling; the warnings panel needs
  its `--warning`-tinted background + border as a semantic signal. The
  inline panel keeps the warning styling and adds the same
  visibility-toggle behaviour rather than losing the colour by reusing
  the neutral card.

Warning data is a **flat `string[]`** (`simulationResult.summary.warnings`)
with no severity/type field, so summary-vs-per-cohort lines are only
distinguishable positionally — the panel collapses the whole body
uniformly rather than pinning the first "fleet stock drifted" summary
line. If a future patch adds a structured warning shape (type/severity),
keeping the summary line visible while collapsing the repetitive
per-cohort lines becomes worthwhile.

**Patch 5B+ — advisory vs per-cohort font color.** Within the body,
advisory/summary warnings render in the warning accent
(`var(--warning)`) and the repetitive per-cohort lines recede to a muted
`var(--text-secondary)`, so the advisory stands out from the high-volume
noise. Classification is by `isPerCohortWarning(msg)` — a regex on the
regular high-volume prefix `^Year \d{4}: (manual outflow|requested )`,
which matches BOTH per-cohort formats `dsm_engine.py` emits (the
`exceeds available stock` line at 1458 AND the `requested … outflows at
age` line at 1433). Everything that doesn't match is treated as advisory
(today only the aggregate `Total fleet stock drifted … baseline … Verify
…` line at 1104). Colors come from theme tokens (theme-aware), not
hardcoded hex. This is purely a per-row text-color change; collapse,
count, visibility-toggle, and empty-state are untouched. The durable fix
remains a structured `{severity, message}` shape from the backend, at
which point the UI should read the field instead of pattern-matching.

#### What NOT to do

- **Don't drop the count from the header when collapsed.** The count is
  the whole reason collapse is safe — without it a user can forget there
  were warnings. Hide the body, never the `(N)`.
- **Don't conditional-unmount the warning body on collapse.** Use
  `display: none`; the rows stay mounted so re-expand is instant. The
  test asserts the body node persists across a collapse/expand round-trip.
- **Don't default the panel to collapsed.** Warnings signal data
  problems; hiding them by default risks users shipping analyses with
  unaddressed issues.
- **Don't classify the advisory warning by position (`warnings[0]`) or by
  matching its specific wording.** Both break under backend changes —
  reordering shifts the position; rephrasing the "drifted/baseline/Verify"
  copy breaks a wording match. Match the regular high-volume per-cohort
  prefix (`^Year \d{4}: (manual outflow|requested )`) and treat the
  remainder as advisory. And match BOTH per-cohort formats — keying only
  on `manual outflow` mis-styles the `requested … outflows at age` line
  as advisory.

### DSM start/end stock figures — top-left KPI card (Patch 5C → 5D → 5E)

The selected year's **start** and **end** total-stock figures live in the
top-left KPI card of the DSM results 2×2 grid (`<StartEndStockCard>` in
`components/dsm/StartEndStockCard.tsx`, helper `yearStockStartEnd`). The
card label is "Total stock"; "Start of {year}" and "End of {year}" render
at **identical typographic scale/weight/mono** (5E — neither dominant).
Both track the year slider.

**Correct semantics (Patch 5E — fixes the 5C/5D mislabeling).** The engine
snapshots `YearResult.stock` AFTER the year's inflows/outflows
(`dsm_engine.py` ~1464), so it is the END-of-year figure. Therefore:

- `end(Y) = Σ YearResult[Y].stock` (the post-flows snapshot — this is the
  number 5C/5D wrongly labelled "start").
- `start(Y) = Σ YearResult[Y−1].stock` (end of the prior year). For the
  FIRST horizon year there is no prior `YearResult`, so `start` is the
  **uploaded initial-stock total** — `Σ` of the resolved `initial_stock`
  slot (`resolveSlot(systemState, 'initial_stock')`, the `"{cohort}|{age}"
  → count` dict), summed before any simulation flows. `null` → em-dash.

Invariant `start + net == end` (`net = Σ inflow − Σ outflow`) holds by
engine construction: at idx 0, `stock[0] = initial − Σoutflow + Σinflow`,
so `initialStockTotal + net[firstYear] == YearResult[firstYear].stock`
exactly. Reads as `start + Net change = end` next to the flow cards.

`yearStockStartEnd(years, selectedYear, initialStockTotal)` takes the whole
`years` array (needs the prior year), not a single `YearResult`. Do NOT
revert to `start = Σ stock` of the selected year — that's the END figure
(the 5C/5D bug).

**Patch 5D — relocation history.** 5C placed these in the Age-distribution
box header (`AgeDistributionStockFigures`); 5D moved them into the KPI card,
removed the redundant single "Total stock {year}" `SummaryCard`, renamed the
component → `StartEndStockCard` (SummaryCard chrome, 2×2 grid). 5E corrected
the data source + equalized the two figures' styling.

#### What NOT to do

- **Don't source `start` from `Σ YearResult.stock` / `summary.totalStock`.**
  That is the END-of-year snapshot (the 5C/5D bug). `start` is the prior
  year's snapshot, or the uploaded initial-stock total for the first year.
- **Don't compute `end` by reading the next year's record** (`stock[year+1]`).
  `end(Y) = Σ YearResult[Y].stock` directly — the final horizon year works
  with no "next year".
- **Don't crash (or show 0) when the first-year initial stock is absent.**
  Pass `null` and render an em-dash. Only the first year depends on the
  initial-stock slot; later years read the prior `YearResult`.
- **Don't make one figure visually dominant.** 5E equalizes them — same
  `valueStyle` object on both value nodes. The locked test asserts equal
  `fontSize`/`fontFamily`/`fontWeight`/`color`.
- **Don't re-add a standalone "Total stock {year}" card.** Its single
  number is now the End figure — showing both duplicates it.

### Cohort → Archetype mapping is one source of truth (Patch 5F)

The cohort → archetype mapping (DSM cohort+size → BOM archetype + scale)
is a **single source of truth owned by the DSM store** —
`dsmStore.cohortMappings: Record<cohortKey, {archetype_id, scaling_factor}>`,
fetched/saved via `fetchCohortMappings`/`saveCohortMappings` against
`/dsm/systems/{id}/cohort-mappings`. Every surface reads (and the one editor
writes) that slice:

- **DSM tab (canonical editor)** — `CohortMappingEditor` inside
  `CohortMappingDialog`. The ONLY editing surface. Reads the store live,
  debounced auto-save to the backend.
- **IA Static Background** (`DSMImpactPanel`) — **read-only** summary row
  ("Cohort → Archetype · N of M mapped" + "Edit in DSM →"). The count
  derives DIRECTLY from `cohortMappings` (no local snapshot).
- **IA Prospective Background** (`ProjectedImpactPanel`) — read-only,
  already store-direct.
- **Material Flows** and **IA compute** consume the same slice; the
  backend reads its persisted copy keyed by `mfa_system_id` (the
  `ImpactAssessmentRequest` / `dsm-lca` body carries **no** mapping
  payload), so compute can't run against a client-side stale copy.

The "N of M mapped" count derives from this slice **everywhere it appears**,
so the numbers are always identical. Locked by
`tests/cohortMappingSync.test.tsx` (propagation without remount, post-mount
subscription, no duplicate slice, compute keyed by system id).

**Patch 5F history.** Before 5F, `DSMImpactPanel` carried its own full
inline editor + a `draftMappings` local snapshot and derived the count from
the draft — so the IA count could disagree with the DSM editor (unsaved
draft, or divergence) and Static/Prospective could disagree with each other.
5F (per product decision: DSM-canonical, read-only IA) removed the inline
editor + draft buffer; IA now reads the store directly.

#### What NOT to do

- **Don't snapshot store-derived data (cohort mapping, system definition,
  etc.) into component-local `useState`/`useRef` at mount.** With the
  visibility-toggle mounting convention the component never remounts, so the
  snapshot goes stale when the source is edited from another surface.
  Subscribe to the store directly (the same root-cause family as Patch 4E).
- **Don't keep a second copy of the cohort mapping in the Impact Assessment
  tab** (or any consumer). One mapping in `dsmStore`, consumed downstream by
  Material Flows and Impact Assessment — never duplicated per consumer. The
  test asserts `impactStore` has no `cohortMappings` slice.
- **Don't re-add an editing surface to IA without a product decision.** IA
  is read-only by the 5F decision; editing is DSM-only via "Edit in DSM →".
  A second editor reintroduces the draft-vs-store divergence 5F removed.
- **Don't put the cohort mapping into the IA compute request body.** The
  backend resolves it from its persisted copy via `mfa_system_id`; sending a
  client snapshot would risk computing against stale data and is a backend
  data-shape change (out of scope).

### Header affordances must look actionable (Patch 5G)

Actionable header affordances must render with the shared `<Button>`
primitive (`components/ui/Button.tsx`), never plain text with a click
handler. The Impact Assessment header's **Method Library** action uses
`<Button variant="secondary">` (bordered, elevated bg, pointer cursor) —
evidently clickable yet visually subordinate to the filled
`variant="primary"` "Calculate" CTA. It's a single shared header serving
both Single-product and System-level views. Locked by
`tests/methodLibraryButton.test.tsx`.

Variant guide: `primary` = the one filled CTA per surface; `secondary` =
evident-but-subordinate supporting actions; `ghost` = transparent, for
in-context/low-emphasis controls where a border would be visual noise — NOT
for a top-level header action that should read as a button.

#### What NOT to do

- **Don't style a supporting header action as `ghost` (or bare text + click
  handler).** `ghost` has a transparent border, so it reads as plain text
  and users don't recognize it as clickable — the exact bug 5G fixed
  (Method Library was `variant="ghost"`).
- **Don't give a supporting action a filled/primary style on a page that
  already has a primary CTA.** Two filled buttons compete. Calculate is the
  filled CTA; Method Library (and peers) use `secondary` — evidently
  clickable, visually subordinate.
- **Don't hand-roll a bespoke button style.** Reuse the `<Button>` primitive
  so border/hover/focus/cursor and icon+label `gap` stay consistent app-wide;
  let the primitive's `gap` space the icon (don't re-add manual icon margins).

### Multi-item comparison page sections are collapsible (Patch 5H)

The three top-level sections of Single-product → **Multi-item comparison**
(`components/impact/MultiProductLCA.tsx`) — **Scope**, **Items to compare**,
**Results** — are each wrapped in the shared `<CollapsibleCard>` primitive
(the same one behind Configuration / Results / Stage Amounts). Wrapping, not
building: the card supplies the chrome + title + collapse, so each section's
own outer chrome/title was removed to avoid double-nesting.

- **Collapsed headers carry a live summary** read at render (never snapshotted
  at collapse time): Scope → `scope · method · N indicators` (selected
  family + selected count; the bare `<MethodPicker>` owns its selection
  internally, so the family's *total* "of M" isn't available to the parent
  without swapping the picker — out of scope, so we show the selected count);
  Items → `N selected`; Results → `N successful, M failed`.
- **Defaults**: Scope and Items expanded; Results expanded and **only
  rendered post-compute** (when `multiResult` exists) — the card appears with
  the results.
- **Collapse is `useState`, session-local, no persistence.** It survives the
  Single item / Multi-item sub-tab switch because that sub-tab is
  visibility-toggled (the pane never unmounts).
- **No auto-collapse-on-compute** — collapsing is user-only (predictable over
  clever).
- The Items DB picker sits in the card's `actions` slot (the slot
  stop-propagates clicks so it doesn't toggle the card).
- Locked by `tests/multiProductCollapsibleSections.test.tsx`.

**Structural alignment to the Single item tab (Patch 5Q).** Multi-item now
mirrors Single item's **selection-first** flow. Section order:
**Items to compare → Stage amounts → Configuration → Compute → Results**
(was Scope/config-first). The config card is titled **"Configuration"** (was
"Scope"), and the scope-stage buttons + the collapsed-summary use the Single
item tab's wording/casing — **Full Lifecycle / Manufacturing / Operation /
End of Life** (same underlying `all/inflows/stock/outflows` map; cosmetic
only, also the app-wide convention incl. System-level). This is alignment **by
analogy** (the N-item nature is preserved): the `<MultiItemSelector>`
(multi-select) sits at the top mirroring single-item's Archetype picker — NOT
replaced by a single dropdown; the per-item stage editors (5I) mirror
single-item's single STAGE AMOUNTS section. All existing multi-item
functionality is preserved (per-item stage amounts 5I, look-alike
discriminating rows 5M, scenario-visibility 5O, exports). Locked by
`tests/multiProductStructureAlignment.test.tsx`.

**Known functional differences (flagged, deliberately NOT built in 5Q — would
be new compute features, not layout):**
- **No background-tab layer — but prospective IS reachable via per-item
  vintages (Patch 5R, below).** Multi-item has no Static/Prospective/Comparison
  tab triplet; instead, *activity* mode lets each item carry its own database
  vintage (ecoinvent + premise SSP×year). That fills the prospective gap in a
  per-item-vintage flavor — see "Within-type multi-item comparison + per-item
  vintages". A year-matched Δ-comparison tab layer remains unbuilt (separate
  decision).
- **No sensitivity-cases control.** Single item's config exposes multi-parameter
  sensitivity cases; multi-item has none in the UI (the per-item
  `parameter_scenario` field exists in the wire schema but is unexposed). Adding
  it is functional.

#### What NOT to do (alignment)

- **Multi-item is N-item — align it to single-item's structure by analogy,
  never by forcing single-select shapes onto it.** The `<MultiItemSelector>` at
  the top mirrors the single Archetype picker; the per-item stage editors mirror
  the single STAGE AMOUNTS section. Don't replace the multi-select selector with
  a single-archetype dropdown, and don't collapse the per-item editors into one.
- **Don't build multi-item prospective/comparison compute or sensitivity cases
  under the banner of "structural alignment."** Those are flagged functional
  gaps requiring an explicit decision — layout reshuffles must not silently grow
  new compute.

### Within-type multi-item comparison + per-item vintages (Patch 5R)

Multi-item comparison is **within-type**: a comparison is of ONE type —
archetypes OR activities, never mixed. A **mode toggle** (Archetypes |
Activities) in `MultiProductLCA.tsx` drives the shared `<MultiItemSelector>`'s
`mode` prop (`'archetype'` / `'activity'`, both pre-existing); switching mode
clears `selectedItems` so cross-type items can't linger. (The old `mode="mixed"`
is retired here — `<MultiItemSelector>` still supports `'mixed'` for other
contexts, but multi-item comparison never uses it.)

**Activity mode = per-item-vintage model.** An activity can be added at several
**vintages** — base ecoinvent (static) and/or premise SSP×year databases —
**each a distinct comparison item computed against its own database**. Picking
an activity opens `<ActivityVintagePicker>` (ecoinvent + the installed premise
vintages for that base_db); each checked vintage appends one
`ActivityProductItem` whose `database` IS the vintage's DB name, labeled
`<reference product> [<vintage>]` (e.g. `electricity, low voltage [SSP1 2040]`).
`productItemKey` is `act:{database}|{code}` → unique per vintage → distinct
item, distinct stable color.

**This fills the previously-flagged Gap A (prospective compute) in a
per-item-vintage flavor — NOT a background-tab layer.** There is no
Static/Prospective/Comparison tab triplet; prospective enters as per-item
database selection.

**Database selector is Activities-mode-only (Patch 5V).** The "Items to compare"
header database dropdown (`multi-product-database-select`) renders only when
`compareMode === 'activity'`. It scopes the activity search (`useActivityStore`)
and is the base_db for the vintage picker — neither applies to archetypes.
Archetype compute does NOT read `selectedDatabase`: `handleCompute` sends only
`{scope, methods}`, so `compute_database` is null and each archetype resolves
against its BOM's base ecoinvent links. `selectedDatabase` is store-backed
(`useActivityStore`), so the Activities selection survives Archetypes↔Activities
switches. Locked by `tests/multiProductDatabaseSelector.test.tsx`.

**Lifecycle SCOPE is Archetypes-only (Patch 5X).** The CONFIGURATION SCOPE
selector (Full Lifecycle / Manufacturing / Operation / End of Life) renders only
when `compareMode === 'archetype'`. Activities are single ecoinvent processes
with no lifecycle stages — the backend ignores scope for them
(`ActivityLCARequest = {activities, methods}` has no scope field;
`calculate_activity_lca` never reads it; the activity branch of
`calculate_multi_product_lca` builds the request WITHOUT `body.scope`). So
activities lock to **Full Lifecycle** via `scopeForMode(mode, scope)` (returns
`'all'` for activities) — the payload rule that keeps a leftover non-`'all'`
archetype scope from leaking into an activity run, leaving the payload/result
identical to today's default. The CONFIGURATION collapsed summary omits the
scope token in Activities (methods only). Extends the 5V/5W mode-scoping family.
Locked by `tests/multiProductActivityScope.test.tsx`.

**Backend per-item DB is the EXISTING contract — not new compute.** The
activity branch of `calculate_multi_product_lca` (lca.py) already builds an
`ActivityLCARequest` keyed by `item.database` and calls `calculate_activity_lca`,
which resolves the activity in that DB via `bw2data.get_activity((database,
code))` and runs the LCA against THAT vintage's technosphere. Premise preserves
codes (the same invariant `_translate_demand_to_database` relies on), so one
picked activity resolves in every vintage by code. The only backend lift in 5R
was a vintage-aware result `label` (composed from `ActivityProductItem.vintage_label`)
so two vintages of one activity don't collide on a chart axis. Per-vintage
results reflect each DB's intrinsic intensity — e.g. SSP1 > SSP5 for the DK grid
(the audited premise/REMIND ordering from the Patch 5P diagnostic), locked by
`tests/test_multi_product_activity_vintage.py`.

**Vintage resolution is Design A (frontend-resolves).** The concrete premise DB
name comes from `usePLCAStore.databases` (`ProspectiveDB[]` — the same registry
`_resolve_prospective_dbs` reads). The frontend picks the DB name and sets it as
the item's `database`; the backend's existing per-item-DB passthrough computes
against it. We do NOT reimplement prospective resolution and do NOT call
`_resolve_prospective_dbs` per item — the registry is the single source of truth
on both sides.

**Separate-mode vintages only (v1).** Only per-year **separate**-mode premise
DBs (concrete `year`, own `name`) are offerable — the entire prospective compute
pipeline targets only these (`_resolve_prospective_dbs` rejects superstructure's
`year: null`, and no SDF/presamples year-slice activation engine exists).
Superstructure DBs are listed **disabled** in the picker with a tooltip
("generate separate-mode for per-year comparison"). Computing a year-slice from
a superstructure DB would silently use one ambiguous stored scenario — deferred
until a year-slice activation engine is built (a separate, methodology-adjacent
effort).

**Grouped scenario template + shared `<ScenarioYearPicker>` (Patch 5Z).** The
picker mirrors the single-item Prospective Background "LCI scenarios" picker:
premise vintages are **grouped by the FULL scenario (model · ssp-budget)**
(label `${iam} · ${ssp}`, e.g. "remind · SSP1-PkBudg1150"; `ssp` carries the
budget so this is model · ssp-budget, never SSP alone), each group with per-group
**ALL YEARS / CLEAR** controls and year checkboxes. The **"ecoinvent (static)"**
option stays **ungrouped above** the groups and toggles independently; the
Cancel / "Add N to comparison" footer is unchanged. The grouping + controls are
**display-only** — they drive the same `checked` set and `buildItems()` mapping
as the old flat list (the per-item DB / coords are untouched). Superstructure DBs
join their scenario group as **disabled** year-entries. The grouped UI is the
shared presentational `<ScenarioYearPicker>` (`components/impact/ScenarioYearPicker.tsx`),
extracted from the single-item picker and reused by BOTH (single-item →
prospective DBs via `selectedDbs`/`toggleDb`/`setTrajectoryDbs`; multi-item →
the `checked` vintage set). The component is selection-AGNOSTIC (no state); each
parent owns its selection + handlers + testids — the two parents stay separate,
sharing only the picker. The single-item refactor is behavior-preserving (its
testids + Prospective flow unchanged). Locked by `tests/scenarioYearPicker.test.tsx`
(component) + `tests/activityVintagePickerGrouped.test.tsx` (multi-item grouped).

**Per-item color stability.** The comparison chart's solid mode (activity
vintages / stage-less archetypes) colors each bar by a STABLE per-item color via
`useChartColors(itemLabels, 'multi-product')` + `colorFor`, keyed by item label
— removing/reordering an item never recolors the survivors. (Stacked/archetype
mode keeps the per-STAGE positional palette — that's a different axis.) Locked by
`tests/multiProductActivityVintage.test.tsx` + `tests/multiProductComparisonChart.test.tsx`.

**Export-vintage provenance (mirrors stage-amounts 5J/5K+).** The export records
each activity item's vintage on a **"Vintages" sheet** (`# · Item · Vintage ·
Database · Base database · IAM · SSP · Year`), threaded via
`MultiProductExportRequest.activity_vintage_meta` (keyed by item_id
`{database}|{code}`, the `ActivityVintageMeta` shape). Emitted only when ≥1
activity item; falls back to deriving the DB from item_id when no meta is
supplied (older clients). Built by `_build_multi_product_workbook` in `impact.py`
(a sheet, not a conditional on existing sheets). Locked by
`tests/test_multi_product_vintage_export.py`.

#### What NOT to do

- **Activity vintages are per-item database selection, not a global background
  mode.** Each activity × vintage is an independent comparison item with its own
  DB; reuse `_resolve_prospective_dbs` (via the registry the frontend reads),
  don't reimplement prospective resolution. There is no "set the prospective
  background for the whole comparison" toggle — the vintage is per item.
- **The vintage picker groups by the full scenario (model · ssp-budget),
  matching single-item — never group by SSP alone (it collapses pkbudg1150 vs
  base); the grouping and ALL YEARS/CLEAR controls are display-only and must not
  change the checked-vintage → comparison-item mapping.** (Patch 5Z: grouping
  uses the structured `(base_db, iam, ssp)` coords, not string-parsing; the
  shared `<ScenarioYearPicker>` is selection-agnostic — changing it must keep
  both single-item and multi-item behavior-preserving.)
- **The multi-item database selector belongs to Activities mode only and must
  not render in Archetypes mode — but never remove it without first confirming
  the archetype compute path does not read selectedDatabase as its background.**
  (Patch 5V confirmed: `handleCompute` sends only `{scope, methods}` →
  `compute_database` null → archetypes resolve against their BOM's base
  ecoinvent links. The dropdown is vestigial search-scope in Archetypes mode.)
- **Lifecycle scope (and stages) apply to archetypes only — the SCOPE selector
  must not render in Activities mode, and activities compute against Full
  Lifecycle; never remove the selector without confirming activity compute
  doesn't depend on a non-Full scope.** (Patch 5X confirmed:
  `ActivityLCARequest` has no scope field and `calculate_activity_lca` never
  reads scope, so it's a no-op for activities; `scopeForMode` locks them to
  `'all'`.)
- **Don't offer superstructure vintages for compute.** `_resolve_prospective_dbs`
  rejects `year: null`; there's no year-slice activation. Naming a superstructure
  DB directly computes one ambiguous stored scenario, not the requested year.
  List them disabled; defer until an activation engine exists.
- **Don't mix archetypes and activities in one comparison.** Within-type is the
  contract; the mode toggle enforces it (switching clears the selection). Mixed
  comparison was the pre-5R `mode="mixed"` and is retired here.
- **Don't reintroduce positional `CHART_PALETTE[idx]` coloring for solid-mode
  items.** Per-item color must be stable (keyed by `item_id` via the shared
  resolution — Patch 5S moved the key off the label so display-shortening can't
  recolor) so a removed/reordered item doesn't recolor its neighbours — the
  whole point for comparing N vintages over time.
- **Don't make the backend echo a bare reference-product label for activity
  items when a vintage is set.** Two vintages of one activity would collide on
  the chart axis. The label is composed `<reference product> [<vintage_label>]`;
  the `vintage_label` is frontend-owned (the DB IS the per-item selection).

### Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer (Patch 5S)

Frontend-only polish on the Patch 5R multi-item comparison. No backend/schema
change; the compute payload + export provenance are untouched.

**Bar | Line chart-type toggle (Chart view only).** A segmented control in the
results toolbar (next to the method dropdown + view toggle) switches the chart
between Bar (`MultiProductComparisonChart`) and Line (`MultiProductLineChart`).
Table view is unaffected. State is `ResultsSection`-local.

**Line view = per-scenario over years (NOT per-item).** `MultiProductLineChart`
is a thin sibling — it does NOT reuse `MultiScenarioImpactChart` (consumes
cohort-aware `ImpactAssessmentResult`) or `ProjectedTimeSeriesChart` (its runs
carry `ArchetypeLCAResult` + it lives in the single-item tab). It reuses the
shared primitives (`SCENARIO_PALETTE`, `ChartExportButton`/`Container`,
native-SVG legend, `NumberFormatControl`, 5O-style clickable per-series
visibility) — not a duplicated charting stack. The pure `buildVintageLineModel`
groups items into one series per **(base_database + iam + ssp)** scenario and
plots the selected method's score by **year**, reading the **structured vintage
coords** (Patch 5R `ActivityVintageMeta`, joined to result items by `item_id`)
— never by string-parsing the label. So 18 vintage items → 3 SSP series. Series
colored by ORIGINAL sorted index (stable under hide/show). Sparse years →
`connectNulls={false}` (gaps, no interpolation). The **static (ecoinvent)
vintage** (no ssp/year) renders as a labeled horizontal `<ReferenceLine>`, not a
series.

**Line gating (DATA-driven from the DISPLAYED results — 5S follow-up fix).**
The Line toggle is enabled only when the **charted results** yield a usable year
axis — ≥2 distinct years across premise vintages (`ssp` + `year` present).
Derived from the results being charted, **never from the live selection or
compareMode**: results can outlive a mode switch (the selection clears per 5R)
and not every Activities-mode result is line-able (multi-distinct-activity has
no year axis). The year-axis coords come from `multiVintageCoords` — a
**compute-time snapshot** in `useMultiProductLCAStore`, keyed by item_id and
results-aligned (NOT the live `selectedItems`-derived map, whose original
coupling disabled Line on valid line-able results once the selection changed).
The same snapshot feeds the Line chart's `vintageCoords` and the export
provenance. Otherwise disabled with tooltip *"Line view needs vintages across
multiple years"*; Bar always available. `effectiveChartType` never renders Line
when disabled. **State hygiene**: `switchMode` clears the results
(`clearResults()` → `multiResult` + `multiVintageCoords` null) alongside the
selection, so a stale cross-mode chart can't linger after a mode switch.

**Common-prefix label cleanup (display-only).** `shortenByCommonPrefix`
(`utils/labelPrefix.ts`) strips the shared activity prefix so bars/legend show
only the differing vintage (e.g. "SSP1-PkBudg1150 2025"), with the shared
activity ("electricity, low voltage") shown once as a chart subtitle. Trims the
LCP to a clean token boundary (last space / `[`) and degrades to full labels
when there's no usable common prefix (multi-distinct-activity, archetype names).
**Provenance is never shortened** — the export's Vintages sheet (5R) reads
structured `activity_vintage_meta`, not display strings.

**Selected-panel grouping (Part B).** `MultiItemSelector` gained an OPTIONAL
`renderSelectedItems?: ReactNode` display override (absent → unchanged default
`<SelectedChip>` list, so archetype mode + LCA Calculator are untouched).
Activities mode passes `<GroupedVintagePanel>`: vintages of one activity (same
`code`) render under ONE header (ref product · location · unit · code shown
once) with compact removable vintage chips beneath. **Display-only** — selection
state, item identity, per-item removal (still `onRemoveItem`), and the compute
payload are all unchanged.

**Live compute timer (Part C).** The post-run time is backend-returned
(`result.elapsed_seconds`); there's no client start timestamp. The live timer
reuses the existing `useElapsedSeconds(active)` hook (1s cadence, same as the
single-product panels) keyed on `multiLoading` — the button shows
"Computing… {n}s", and the precise final value still comes from the backend on
the Results card. The hook clears its interval on completion (active→false) AND
on unmount (effect cleanup).

#### What NOT to do

- **Line availability is derived from the displayed results' year axis (≥2
  distinct years across scenarios) — never from the live selection or
  compareMode; keying it to the selection disables Line on valid line-able
  results once the selection changes, and keying it to the mode disables it on
  stale-but-line-able results and wrongly enables it for multi-distinct-activity
  comparisons.** The gate reads the compute-time `multiVintageCoords` snapshot
  (results-aligned), not the live `selectedItems`. Results also clear on a mode
  switch so a stale cross-mode chart can't linger.
- **Line view is per-scenario over years, not per-item — group by
  (base+IAM+SSP+budget) and plot by year; don't string-parse the label if
  structured coordinates exist.** The coords are snapshotted into
  `multiVintageCoords` at compute time (from the run's `ActivityProductItem`s,
  Patch 5R), joined to result items by `item_id` (`{database}|{code}`).
  String-parsing the composed label is brittle and unnecessary.
- **Display-shorten labels via common-prefix stripping; never drop provenance
  from the export.** Shortening is display-only; the Vintages sheet always
  records the full structured database/SSP/year.
- **Clear the compute-timer interval on completion AND unmount.** Reuse
  `useElapsedSeconds` (it does both via effect cleanup); don't hand-roll a
  `setInterval` without a cleanup path.
- **Don't reuse `MultiScenarioImpactChart` or generalize
  `ProjectedTimeSeriesChart` for the Line view.** The former consumes
  cohort-aware `ImpactAssessmentResult`; the latter carries `ArchetypeLCAResult`
  and lives in the single-item tab (out of scope). The thin sibling reuses
  shared primitives without a duplicated stack.
- **Don't make the grouped panel anything but display-only.** It's rendered via
  the selector's `renderSelectedItems` seam; it must not own selection/removal
  logic beyond calling the parent's `onRemove`, and must never alter the compute
  payload. Archetype mode must keep the default chip list (don't pass the
  override there).
- **Don't key Line series color or Bar item color by the (shortenable) display
  label.** Bar keys by `item_id`; Line keys by original scenario index. Keying
  by a label that common-prefix-stripping can change would recolor series when
  the selection changes.

**LCA Architect → Single-product LCA gets the same treatment (Patch 5N).**
`pages/LCACalculator.tsx` wraps its **Configuration** (the setup form: FU
archetype/activity selection + scope + method + indicators + database/year +
Calculate buttons) and its **Results** sections in the shared
`<CollapsibleCard>`. Configuration's collapsed summary is
`database · method · N indicators` (live: `computeDatabase` || "base
ecoinvent", `selectedMethods[0]?.[0]`, `selectedMethods.length`); Results'
is `item · N indicators · elapsed` (per mode — activity: `actDemand[0]`
name / `actResult`; archetype: `arcResult.archetype_name` or `N archetypes`
when multi). Configuration expanded by default; Results only renders
**post-compute** (gated on `actResult`/`arcResult`), expanded. There are two
Results branches (`fuMode === 'activity'` and `'archetype'`) — each wraps its
own results-present block; loading/error states stay outside the card.
`configOpen`/`resultsOpen` are session-local `useState`. Existing testids
preserved; `data-testid="lca-config-body"` added. Locked by
`tests/lcaCalculatorSections.test.tsx`.

**"New Calculation" is a secondary button (Patch 5G/5N).** In
`LCACalculator`, the header "New Calculation" affordance is a start-over/reset
(`handleReset` clears all results), so it uses `<Button variant="secondary">`
— evidently clickable but subordinate to the filled primary "Calculate" CTA
(per the 5G convention). Not `primary` (it's not the compute trigger), not
`ghost`/bare text. `data-testid="lca-new-calculation"`.

#### What NOT to do

- **Don't conditionally unmount a section body on collapse.** Use the
  collapsible's visibility-toggle (`display: none`, body stays mounted) so
  item selection, search text, scroll, and chart/table state survive
  collapse/expand — same reason tabs don't unmount.
- **Collapsed-header summaries must read from the live source at render**,
  never a value captured when the section collapsed — or the summary goes
  stale (cf. the cohort-mapping single-source fix, Patch 5F). The regression
  test mutates the store *while collapsed* and asserts the header updates.
- **Don't reach for the lighter popup-menu collapse** (Advanced, Patch 4L)
  for page sections — that's for menus. `<CollapsibleCard>` is the right
  primitive for big content blocks; don't swap them.
- **Don't over-nest** — three top-level collapsibles only. Don't make
  Indicator Selection independently collapsible *inside* the now-collapsible
  Scope card.
- **Don't auto-collapse Scope/Items when compute finishes.** Deliberate
  non-feature.

### Stage amounts are a shared capability — Single item + Multi-item (Patch 5I)

Stage amounts (preset 1 year / Lifetime (Nyr) / Custom; ANNUAL stages scale
by the year count, one-time stages stay at 1) are a **shared capability**
across Single item and Multi-item comparison:

- **Frontend component**: one `<StageAmountsEditor>`
  (`components/impact/StageAmountsEditor.tsx`) serves both. The preset→amounts
  math (`stageAmountsForPreset`), the collapsed summary
  (`stageAmountsSummary` / `abbreviateStage` / `formatStageAmount`), and
  `defaultStageAmounts` are all exported from that file. Single item and
  Multi-item import them — there is no second copy (these were extracted from
  `SingleProductImpact.tsx` in 5I; the Single-item behavior is unchanged).
- **Backend application**: one function — `calculate_archetype_lca`
  (`mapper/api/lca.py`) applies `stage_amounts` inline (each stage's material
  quantities × that stage's amount). The multi-product handler
  (`calculate_multi_product_lca`) dispatches each `ArchetypeProductItem` to
  `calculate_archetype_lca` with that item's `stage_amounts` — the SAME
  function. The ANNUAL-vs-one-time distinction lives in the `stage_amounts`
  dict the frontend computes; the backend multiplies uniformly. **No backend
  change was needed in 5I** — the field + passthrough already existed
  (`ArchetypeProductItem.stage_amounts`, `MultiProductRequestItem`).

**Multi-item model**: per-item amounts keyed by `productItemKey` in
`useMultiProductLCAStore.stageAmountsByItem` (reusing `ArchetypeStageAmounts`
per entry). A **global preset** (in `MultiProductLCA`) sets the default for
all items (apply-to-all overwrites every entry); new items **seed** from the
current global preset, removed items are **pruned** — reconciled against the
live selection by a `useEffect`, never a parallel copy of `selectedItems`.
At compute, each entry's `amounts` is injected into the wire item's
`stage_amounts` (in `toWireItem`). Per-item editors render as collapsible
cards (default collapsed; summary line carries the values), one per archetype
item, after selection. Activities have no stages → no editor. Default global
preset is `1year` (all stages = 1 ≡ no per-item amounts), so existing
default multi-item results don't shift. Locked by
`tests/multiProductStageAmounts.test.tsx` (frontend) +
`tests/test_multi_product_stage_amounts.py` (backend scaling + single-vs-
one-item-multi parity + default backward-compat).

**Per-item card treatment — elevated + numbered (Patch 5W)**: the per-item
STAGE AMOUNTS cards use an OPT-IN `<CollapsibleCard variant="item">` that sits
on the **elevated** surface (`var(--bg-elevated)`, one step up the surface
scale) so selected items stand out from the structural cards (ITEMS TO COMPARE
/ CONFIGURATION / Results), which stay on the base `var(--bg-surface)`. Each
per-item card carries a leading **1-based number badge** (`<ItemNumberBadge>`,
muted `--mod-lca` accent) via CollapsibleCard's new optional `leading` slot —
indexed by display order over the renderable items, so it re-sequences on
add/remove (remove the first of two → the remaining card shows "1"). Both new
CollapsibleCard props (`variant`, `leading`) default to the current look, so
every other consumer (structural cards, single-item view) is unchanged.
Display-only — no change to selection, stage-amounts values, collapse, or the
compute payload. Locked by `tests/collapsibleCardVariant.test.tsx` (component
contract) + `tests/multiProductItemCards.test.tsx` (variant token + badge text
+ re-sequence + structural-stays-base).

#### What NOT to do

- **The elevated + numbered treatment is an opt-in CollapsibleCard variant for
  per-item cards only — never lighten the shared card globally, or the
  hierarchy with ITEMS TO COMPARE / CONFIGURATION is lost.** `variant` defaults
  to `'default'` (base surface); only the per-item loop passes `variant="item"`.
- **Don't hardcode the lighter surface** — it's the `var(--bg-elevated)` token
  (one step up the surface scale), not a hex.
- **The number badge is display order, 1-based, re-sequenced on add/remove** —
  derive it from the rendered/filtered item list's index, not a stored field;
  it must track selection order/count (reinforcing "N selected" / "Compute (N
  items)").

**Export note**: multi-item Excel export does not yet record the per-item
stage amounts used. Deferred follow-up (the export builder would add an
amounts column/sheet); flagged, not done in 5I.

#### What NOT to do

- **Don't fork the stage-amount calculation for multi-item.** Both Single
  item and Multi-item compute MUST call the same server-side
  `calculate_archetype_lca`, so an equivalent configuration produces identical
  results. The parity test asserts single vs one-item-multi are byte-equal.
- **Don't reimplement the preset math or summary line in the multi-item
  component.** Import `stageAmountsForPreset` / `stageAmountsSummary` from
  `StageAmountsEditor`. Two copies drift.
- **Key per-item state by item id and reconcile against the live
  selection** — seed on add, prune on remove. Don't maintain a parallel copy
  of the selected-items list (it drifts); the `stageAmountsByItem` map is
  reconciled by an effect with an only-set-if-changed guard.
- **Don't change the default global preset away from `1year`** without
  re-checking the backward-compat test — a different default would shift
  existing default multi-item results.

### Multi-item export records per-item stage amounts (Patch 5J)

The Multi-item comparison export (`_build_multi_product_workbook` in
`mapper/api/impact.py`) records per-item stage amounts in a dedicated
**"Stage amounts" sheet** (columns `#·Item·Preset·Lifetime (yr)·<per-stage
columns>`) so a run is reproducible from the export alone. Emitted whenever
≥1 archetype item is present (activities have no stages → skipped); placed
after Configuration (sheets are accessed by name, so order is non-load-
bearing — additive, existing sheets unchanged).

**Why frontend + backend**: the compute result echoes only the resolved
per-stage `amounts` map (`ArchetypeLCACalculateResult.stage_amounts`).
`preset` ('1year'/'lifetime'/'custom') and `lifetime` are frontend-only
concepts, so they're threaded through the export request as
`MultiProductExportRequest.stage_amounts_meta: dict[item_id,
StageAmountsMeta{preset, lifetime, amounts}]` (the frontend builds it from
`useMultiProductLCAStore.stageAmountsByItem`, keyed by `archetype_id` =
`item_id`). The builder reads preset/lifetime from the meta and the per-stage
amounts from the meta — **falling back** to the result-echoed
`stage_amounts` (preset/lifetime → "—") when no meta is supplied (older
clients), so it degrades gracefully. Locked by
`tests/test_multi_product_stage_amounts_export.py` (backend) +
`tests/multiProductStageAmounts.test.tsx` (frontend: request carries the meta).

**Single-item parity (Patch 5K+, closes the 5J divergence)**: the single-item
export builders (`_build_single_product_{static,prospective,comparison}_workbook`)
now ALSO record preset + lifetime, alongside the existing per-stage amounts
one-liner, in the **Configuration block** (single archetype → fields, not a
separate sheet). Both export paths reuse the shared `StageAmountsMeta{preset,
lifetime, amounts}` and use the same labels (`Preset`, `Lifetime (yr)`):
multi-item in the "Stage amounts" sheet, single-item in the Configuration
block. Single-item threads a **single** `StageAmountsMeta` (not a dict) on
each `SingleProduct*ExportRequest`, sourced from
`useSingleProductImpactStore.stageAmountsByArc[archetypeId]`; per-stage
amounts still come from the result echo. Same backward-compat fallback as
5J (no meta → preset/lifetime "—", amounts still shown). Locked by
`tests/test_impact_single_product_export_stage_meta.py` (backend) +
`tests/singleProductExportButtons.test.tsx` (frontend threads the store meta).

#### What NOT to do

- **Don't export computed impact figures without the parameters that
  produced them** (stage amounts, and more broadly scenario / method /
  scope). Exported research outputs must be reconstructable from the export
  itself — the numbers PLUS the assumptions, not the numbers alone.
- **Don't let single-item and multi-item exports diverge in what
  provenance they record.** Both capture preset + lifetime + per-stage
  amounts via the shared `StageAmountsMeta`; a new field added to one path's
  provenance must be added to the other (and to the type). 5K+ closed the
  5J gap — don't reopen it.
- **Don't derive preset/lifetime from the resolved amounts.** They're
  ambiguous (all-ones could be '1year' or 'custom'; annual=15 could be
  lifetime-15 or custom). Thread them from the frontend store via
  `stage_amounts_meta`; fall back to "—" when absent, never guess.
- **Don't key `stage_amounts_meta` by `productItemKey`** (`arc:{id}`) — the
  workbook identifies archetype items by `item_id` (= `archetype_id`). The
  frontend converts the store's productItemKey-keyed map to archetype_id
  keys when building the export request.
- **Don't make the "Stage amounts" sheet replace or reorder existing
  sheets.** It's additive; existing tests assert sheets by name. Keep
  Configuration / Comparison (wide|long) / SB_* / Errors exactly as they are.

## Two independent dimensions need a test on the CROSS, not only the margins

**Where a feature has two independent dimensions, at least one test must
exercise the CROSS, not only each margin.**

The paired Monte Carlo `_cf` cache bug needed **2 items AND 2 methods** to
fire. The suite covered both margins — multi-item runs with one method, and
multi-method runs with one item — and every one of them passed while the
feature crashed on the first real 2x2 a user tried. Margin coverage reads as
thorough and is blind to exactly the interaction the second dimension exists
to create.

The cache was reset inside the per-method loop, so after item 0 it retained
only the LAST method's draw and item 2 raised `KeyError(<first method
tuple>)`. One test at 2 items x 2 methods would have caught it on the day it
shipped.

Dimensions already in this codebase that pair this way: (items x methods),
(scenarios x indicators), (years x scopes), (axis fan-out x parameter cases).

### What NOT to do

- **Don't count two margin tests as covering their cross.** N=1 on either axis
  collapses the interaction. If a loop is nested, a test must enter it at
  depth >= 2 on both levels.
- **Don't reach for the cross only after a bug.** When adding a second
  dimension to an existing feature, the 2x2 is part of shipping it — the
  paired work shipped margins only, and the cross came from a user's crash.

## A route taking externally-keyed identifiers needs one test per identifier-space

**A route accepting a list of externally-keyed identifiers needs one test per
identifier-space, not one repeated across the happy path — concretely, at least
two distinct method families on any method-taking route.**

Every Monte Carlo test used `EF v3.1` and only `EF v3.1`. A family-dependent
assumption was therefore structurally invisible: the suite was green while the
feature crashed on the second family a user tried. Repeating the same
identifier across twenty assertions adds confidence in the *route* and none in
the *identifier space*.

`methods: list[list[str]]` is externally keyed — the tuples are `bw2data`
registry keys, project-scoped, and installable/uninstallable at runtime. The
same shape applies to activity `(database, code)` pairs, premise database
names, and LCIA method tuples generally.

**Up-front validation is the guard.** `mapper/api/method_validation.py`
`validate_methods_registered()` is the single implementation; every route
taking `methods` calls it before launching any work:
`/lca/monte-carlo`, `/lca/monte-carlo/multi`, `/lca/calculate-archetype`,
`/lca/calculate-multi-product`, `/impact/calculate`.

Without it the failure is a bare `KeyError((...))` raised from inside
`PersistentLCARunner` → `lca.switch_method(mt)` (bw2calc's `load_lcia_data`
does `methods[self.method]`) — deep in a worker, often minutes into a run,
naming nothing.

### What NOT to do

- **Don't validate by skipping with a warning.** Silently dropping an
  indicator returns a result the user believes covers N indicators when it
  covers fewer. Fail loudly and name the tuple.
- **Don't write a route test that uses one identifier N times and call the
  space covered.** Two distinct families, minimum. `test_worker_launch_coverage`
  measures *that* a worker launches, not *what* it launches with — it cannot
  close this gap, and a payload-shape guard could not either, because validity
  is environment-dependent (CI has no registered methods at all). This stays
  per-route test discipline.
- **Don't let a test fixture POST an unregistered tuple.** After validation
  landed, two worker-launch fixtures 400'd before their launch and silently
  stopped measuring what they existed to measure. A fixture must declare the
  registry it POSTs against (`monkeypatch.setattr(bw2data, "methods", {...})`),
  not rely on the route accepting unvalidated input.
- **Don't assume a KeyError naming a method tuple means the method is
  missing.** It can equally be an internal cache keyed by method tuple. The
  reported `KeyError(('EF v3.1', 'acidification', 'accumulated exceedance
  (AE)'))` was NOT a registry miss — that tuple is installed in every project —
  it was the paired multi-item CF cache being reset *inside* the per-method
  loop, so only the last method survived and item 2 raised on the first.
  Check the registry before theorising: a tuple that is installed everywhere
  cannot be a project-scoping problem.

## Variation in MApper

DSM Scaling Rules are temporarily hidden from the UI as of 2026-05-01. Backend
remains functional: the `DSMScalingRule` model, CRUD endpoints
(`/api/dsm/systems/{id}/scaling-rules`), the `dsm_engine.py` simulation-time
scaling logic, and the cross-product simulate endpoint's case handling all stay
intact. Existing scenarios with persisted rules continue to compute correctly.
Reinstate by re-adding the button to the DSM config bar in `DSMDashboard.tsx`
(import `ScalingRulesEditor` + `SlidersHorizontal`, restore the
`showScalingRules` state and modal trigger), restoring the `scaling_rules`
entry to `SLOT_DEFS` in `ScenarioManagerModal.tsx`, and adding it back to the
`SlotKey` union + `flattenSlot()` branch in `SlotDataViewer.tsx`.

## Frontend type-check (canonical gate)

The canonical per-patch type-check is **`npm run type-check`** (= `tsc -b`),
which is the SAME tsc invocation `npm run build` (`tsc -b && vite build`)
enforces. Run it after any frontend change and treat a non-zero exit as a
blocking failure — a patch is not "tsc clean" until this passes.

**The gap that let errors accumulate (Patch 5AI):** earlier patches verified
with a bare `tsc --noEmit`, which checks the ROOT `tsconfig.json` — but the
root config is `{ "files": [], "references": [...] }`, so `tsc --noEmit`
type-checks **nothing** and exits 0 even with real errors. The strict rules
(`strict`, `noUnusedLocals`, `noUnusedParameters`) live in `tsconfig.app.json`,
which only the project-reference build (`tsc -b`) walks. Always use `tsc -b`
(via `npm run type-check` or `npm run build`); never `tsc --noEmit` against the
root config as a gate.

Patch 5AI cleared the 60→0 accumulated backlog with no suppression: the
dominant bucket was the Recharts 2→3 type migration — custom tooltips switch
from `TooltipProps<V,N>` to `Partial<TooltipContentProps<V,N>>` (active /
payload / label live on `TooltipContentProps`, not `TooltipProps`), and
`<Tooltip formatter>` callbacks must type their value param as Recharts'
`ValueType` (drop the `(v: number)` annotation, coerce with `Number(v)` in the
body) because `Formatter`'s value param is contravariant.

## Frontend testing

Vitest + @testing-library/react + @testing-library/jest-dom + jsdom configured
end-to-end (shipped alongside Patch 2E.2). `vitest.config.ts` loads
`tests/setup.ts` (jest-dom matchers imported); test files live under
`mapper-frontend/tests/` matching `**/*.test.{ts,tsx}`.

Scripts (in `mapper-frontend/package.json`):
- `npm test` — watch mode for active development
- `npm run test:run` — one-shot run for CI / verification

Convention: frontend state-machine tests should be added in the same patch
that ships the state-machine logic. The "skip frontend tests, no runner"
exception is retired.

First landing: `tests/axisConflict.test.ts` (9 cases on the 3-way
axisConflict rule, covering all single-axis allowances, the three pairwise
conflicts, the three-way conflict, and the N=0 boundary).

### Test determinism — mock the function the component actually calls (Patch 5L)

`tests/logEntryCopy.test.tsx` was intermittently failing on full-suite runs
(~25–30%), clean on re-run. **Root cause: the test mocked the wrong function
name.** `LogsPanel`'s mount effect calls `getSystemLogs(500)`, but the test
mocked `fetchSystemLogs` — a name the panel never calls. So the *real*
`getSystemLogs` ran on mount, making a real network `fetch` whose
resolve/reject timing varies with machine load; its `setLoading` /
`setLoadError` / `setBackendLines` updates fired at unpredictable moments
*during* the test, re-rendering the row mid-interaction. That produced the
load-dependent, order-independent flake — surfacing variously as "writeText
called 0 times", "Copied ✓ not found", or the row's button not appearing.
It was NOT a clipboard mock bleed (instrumentation confirmed the stub stayed
intact every run) and NOT a real bug in the copy feature. Fix: mock
`getSystemLogs` (correct name + `log_path` return shape) so the mount resolves
immediately and deterministically — no stray network call, no mid-test
re-render. Verified green 12/12 isolated and 10/10 full-suite consecutive.

#### What NOT to do

- **Tests must be order-independent and not depend on real I/O.** Mock the
  function the component *actually calls* — verify the import name against the
  component, don't assume. A mock under the wrong name silently no-ops: the
  real network/clipboard/timer call runs, and its variable async timing
  becomes a load-dependent flake. (Here: mocked `fetchSystemLogs`, component
  called `getSystemLogs`.) When a test is "flaky on first full-suite run,
  clean on re-run", suspect a real async call (wrong/absent mock) before
  blaming the assertion.
- **Async clipboard + `setTimeout` label flips need deterministic flushing,
  not bare/`waitFor` assertions racing real time.** Click inside
  `await act(async () => { fireEvent.click(...) })` (flushes the awaited write
  AND the resulting re-render), then assert synchronously — so the "Copied ✓"
  check can't lose to the component's 1500ms revert-to-"Copy" timer.
- **Don't reach for `vi.useFakeTimers()` to fix a `findBy`/mount-driven
  test.** Freezing timers reorders a component's mount-fetch resolution and
  can detach the very nodes the test queries. Fix the mock + flush with `act`
  instead.

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
  (Patch 4Q). The dropdown hides entirely when zero configurations
  exist; "+ Create your first configuration" remains the
  affordance.
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
- **Don't make the dropdown render when zero configurations
  exist.** Patch 4Q's empty-state ("+ Create your first
  configuration") handles the first-config path; rendering the
  dropdown trigger with N=0 would duplicate the affordance.

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

## Cohort mapping section + per-dim-value color overrides (Patch 4AJ)

Patch 4AJ does two small but coupled things on the Impact Assessment
Cohort mapping section:

**Section rename.** The collapsible header in `CohortMappingEditor.tsx`
reads `Cohort mapping` (previously `Cohort → Archetype`). The arrow
glyph is an unforced naming wart — the section maps cohorts, that's
the noun.

**Per-dimension-value color overrides.** Each Fuel / Size / etc.
dim-value pill in the cohort mapping table is now a clickable button
that opens `<DimensionColorPicker>` anchored to the pill. The picker
offers a 20-swatch preset grid (CHART_PALETTE), a hex input, and a
Reset-to-auto button. Selecting a color via any path overrides that
dim value's color **everywhere it appears** — DSM Stock Composition,
Impact Assessment by-cohort, Material Flows, any future chart that
visualizes the same dim. Per-project persistence (writes to the same
`useChartColors` localStorage map already keyed by current project).

**Three architectural decisions locked in**:

1. **Per-dim-value, not per-row.** Setting BEV-LFP → teal changes
   BEV-LFP's color in every cohort it appears in, not just the
   clicked row's cohort. The user's mental model is "BEV-LFP is
   teal everywhere"; per-row overrides would fragment that.

2. **Per-project, single map.** Overrides write through to the
   existing `mapper-color-assignments-<project>` localStorage map
   that `useChartColors` already reads. No new persistence layer.
   A parallel `mapper-color-overrides-<project>` JSON array tracks
   which entries in the color map were set explicitly by the user
   vs. assigned by the deterministic algorithm — `getOverriddenLabels(scope)`
   reads it. The split lets `Reset to auto` distinguish "no
   override → button disabled" from "override exists → click to
   revert."

3. **Click-pill popover, not a column.** The pill IS the affordance.
   Adding a separate "Color" column would clutter the table and
   spatially separate the action from the thing it changes. Click,
   pick, close. No commit button — every interaction in the picker
   is immediate.

**Reactivity contract.** `useChartColors` listens for a
`mapper-color-changed` `CustomEvent` on `window`; `setLabelColor` /
`clearLabelColor` dispatch it with `detail.scope`. Consumers in the
matching scope re-render via an internal `tick` state. Without this
event, localStorage writes are invisible to React.

**Determinism preserved.** `assignColors` continues to assign new
labels deterministically (alphabetical + skip-used-palette-slot).
Reset clears the user override; the next `assignColors` call
reassigns the same auto color it would have picked originally,
because the algorithm walks `CHART_PALETTE` in order skipping
already-used colors. The "Reset to auto" guarantee is that the
revert is to the SAME color the user would see on a fresh project
with no overrides — not a random shuffle.

### What NOT to do

- **Don't add a separate `mapper-color-overrides-*` map of `{label →
  color}` and read color from it.** That would mean two sources of
  truth (overrides map + assignments map) and a precedence rule the
  rest of the codebase doesn't know about. The override IS just a
  user-set entry in the assignments map; the parallel set tracks
  only "is this entry a user choice" — never the color itself. One
  source of truth for color resolution.
- **Don't fan out the picker to other panels (DSM Dashboard, Impact
  Assessment by-cohort chart, etc.) as additional click affordances**
  for the same dim values. The Cohort mapping table is the single
  entry point — adding more click sites would invite confusion when
  two pills look slightly different in different panels (which they
  shouldn't, but discoverability vs. consistency is a UI tradeoff
  that breaks). If a future patch wants to make legends clickable to
  pick colors, that's a separate design decision.
- **Don't bypass `setLabelColor` and write to localStorage
  directly.** The function maintains the parallel overrides set, the
  event pubsub, and the no-op short-circuits in one place.
  Bypassing it means the Reset button can't tell if a label is a
  user override, AND consumers won't re-render.
- **Don't trigger `setLabelColor` from any code path the user didn't
  intend as an override.** Algorithm-derived assignments must go
  through `assignColors` (which writes to `mapper-color-assignments-*`
  WITHOUT touching the overrides set). The promotion-to-override
  semantics is the contract: only the picker writes to the overrides
  set, only the picker calls `setLabelColor` / `clearLabelColor`.
- **Don't make the picker show all rendered colors as preset
  options.** The preset grid is `CHART_PALETTE` exactly — 20 fixed
  colors. Pulling in scenario palettes, AESA indicator palettes, or
  other palette sources would invite cross-palette mixing (e.g.
  picking a SCENARIO_PALETTE blue for a cohort, then the same blue
  appearing on an unrelated scenario line). One palette for one
  picker; the hex input is the escape hatch.
- **Don't persist the picker's open state.** It's a per-click
  popover — closing on outside-click / Escape / color-applied is
  the only valid lifecycle. State persistence (e.g. "reopen the last
  pill the user touched") would be a fix to a problem nobody has.
- **When testing the picker, set `useProjectStore.currentProject`
  in the test fixture.** The picker writes to
  `mapper-color-assignments-<currentProject>` — tests that omit the
  project setter will write to `_global` and assertions against the
  project-scoped key will silently miss. The fixture in
  `tests/cohortMappingColorOverride.test.tsx` is the template.

## Two-layer color overrides — per-dim + per-row (Patch 4AK)

Patch 4AK adds a **per-row coloring layer that COEXISTS with** Patch 4AJ's
per-dimension layer. Two color systems with different scopes and
different resolution rules, side by side:

- **Per-dimension (Patch 4AJ)** — a single dim value (e.g.
  `BEV-LFP`) gets a color applied to single-dim stacked charts
  (DSM Stock Composition stacked by Fuel, Impact-by-cohort grouped
  by Fuel). Persisted in localStorage via `setLabelColor` /
  `clearLabelColor`. PRESERVED unchanged.
- **Per-row (Patch 4AK)** — one cohort row (e.g. `BEV-LFP|Small`)
  gets a color applied to both pills in the Cohort Mapping table
  AND to that cohort key in **cohort-key stacked charts** (DSM
  Stock Composition with stackByDimension=null, Impact-by-cohort
  without grouping). Persisted server-side on
  `CohortMapping.row_colors: dict[cohort_key, hex]` so Excel
  round-trip carries them.

### Resolution priority

Two distinct chart contexts, two distinct rules:

| Chart context             | Resolution priority                                              |
|---------------------------|-----------------------------------------------------------------|
| Cohort-key stacking       | Row override → algorithm modulo fallback                        |
| Single-dim stacking       | Row override → per-dim override (Patch 4AJ) → algorithm fallback |

`useDSMSystemColors(activeSystem, stackByDimension, { rowColorOverrides })`
is the single source of truth.

**An EXPLICIT per-cohort override always wins — in BOTH cohort-key and
single-dim stacking (colour-fix, supersedes the original Patch 4AK
"single-dim ignores row overrides" rule).** `colorForCohort` is only
ever called with full cohort KEYS by "by-cohort" charts (Impact-over-time
by cohort, `ExpandedCohortChart`, multi-scenario facets), where each
series is exactly ONE cohort — so a per-cohort colour is well-defined
regardless of the Stack-by grouping. Because `stackByDimension` defaults
to the first non-age dimension on every system load (`dsmStore`), the
old "single-dim ignores row overrides" rule silently dropped every
user-assigned primary `CohortMapping.row_colors` AND subsystem
`SubsystemCohortMapping.color` to the algorithmic palette on the
"Impact over time, by cohort" chart — the reported "chart ignores my
assigned colours" bug. The refined rule: **row override first (both
modes); a cohort WITHOUT an override still groups under its dim value in
single-dim mode** (per-dim colour → Patch 4N/5AG cross-chart fuel-colour
consistency preserved), or gets the deterministic palette in cohort-key
mode.

This does **NOT** affect DSM Stock Composition: that chart reads
`colorMap` directly (one colour per merged dim band) and never calls
`colorForCohort`. Locked by `tests/byCohortAssignedColors.test.tsx`
(assigned primary + subsystem colours resolve under the DEFAULT non-null
`stackByDimension`; both bare and `<system_id>::`-prefixed key formats
resolve; unassigned cohorts unaffected by the override map) and the
updated `tests/patch4ak.test.tsx`.

### Storage models, deliberately different

Per-dim is a chart-display preference that spans dimensions outside
the cohort mapping, so it lives in **localStorage** (Patch 4AJ
contract preserved). Per-row IS a property of the cohort mapping
entry, so it lives **server-side** on `CohortMapping.row_colors`.
This split:

- Avoids dual sources of truth (localStorage + backend) that Excel
  round-trip would force on a unified model.
- Lets the per-row state flow through `saveCohortMappings`
  end-to-end without a parallel sync layer.
- Keeps Patch 4AJ's reactivity contract (the
  `mapper-color-changed` custom event) targeted to per-dim only —
  per-row reactivity flows through zustand state updates on
  `dsmStore.cohortRowColors`.

### Picker mode toggle

`<DimensionColorPicker>` now has a **mode toggle** at the top of the
popover: "This row" / "All {label}". Defaults to "This row" — the
more granular and (per the user spec) more common workflow. Both
modes share the same 40-color palette, hex input, and Reset-to-auto
button. Each mode's Reset clears ONLY that layer's override; the
other layer is unaffected.

`onSetRowColor` / `onClearRowColor` callbacks wire the row mode to
the `dsmStore` actions; the dim mode continues to call
`setLabelColor` / `clearLabelColor` directly (Patch 4AJ path
unchanged).

### Excel upload derivation — row → dim at the import boundary (Patch 4AK²)

When the Excel cohort-mapping file is uploaded, the per-row colors
in the Color column are **also derived into per-dim overrides at
the import boundary**, but ONLY when unambiguous.

**Derivation rule** (`deriveDimColorsFromRowColors` in
`utils/dsmCohortColors.ts`):

For each dimension value V, collect the colors of every row whose
cohort key contains V:
- 1 unique color across all V-containing rows → that color is the
  derived per-dim override for V.
- 0 colors (no rows have a color set for V) → no derivation.
- ≥2 colors → ambiguous → no derivation; per-row overrides still
  apply in cohort-key stacked charts.

**Example (the WP5 bug-fix scenario)** — Excel with 51 rows, where
each Fuel family (BEV-LFP, HEV-LFP, …) has 3 rows (Small, Sedan,
SUV) all sharing one hex:
- BEV-LFP rows all carry `#60a5fa` → derived: `BEV-LFP → #60a5fa`
- HEV-LFP rows all carry `#22c55e` → derived: `HEV-LFP → #22c55e`
- Size values (Small, Sedan, SUV) each appear across 15 fuel
  families with 15 different colors → ambiguous → NOT derived

Result: DSM Stock Composition stacked by Fuel reflects the
uploaded palette immediately (via per-dim Patch 4AJ resolution).
Cohort-key stacked charts also reflect it (via per-row Patch 4AK
resolution). The user's intent "BEV-LFP is blue everywhere" is
served by both layers without aggregating row colors at chart
resolution time.

**Why at upload only, not in-app**:
- Upload is a one-shot bulk expression of user intent. The "if
  unambiguous, derive" rule translates the Excel data shape (one
  Color column per row) into the two-layer resolution model
  without UI complexity.
- The in-app per-row picker stays one-way (row only) — propagating
  to per-dim on every picker click would silently overwrite
  intentional per-dim variations the user set via the
  picker's dim mode.

**The runtime architectural separation is preserved**: chart
resolution still reads per-dim for single-dim stacking, per-row
for cohort-key stacking. The derivation only happens at the
import boundary, populating both layers from one source.

### Excel round-trip scope

Excel template export/import handles **per-row only**:

- Template export (`GET .../cohort-mappings/template`): emits a
  `color` column at the end. Populated with `#RRGGBB` hex when the
  row has an override, blank otherwise.
- Template upload (`POST .../cohort-mappings/upload`): parses the
  `color` column. Empty / `auto` → no override. Valid 6-digit hex
  → stored in `CohortMapping.row_colors`. Invalid → surfaced in
  `CohortMappingResult.invalid_row_colors` as `<cohort_key>: <bad
  value>` without dropping the row's archetype + scaling_factor.

**Per-dim overrides DO NOT round-trip through Excel.** They're
UI-driven via the per-dim picker mode. Documented limitation
because per-dim isn't a property of the cohort mapping data — it's
a chart preference that spans dimensions.

### Picker palette: 40 colors

`CHART_PALETTE` expanded from 20 → 40 (Patch 4AK). Organized as 20
base hues + 20 darker shades, laid out in 4 rows × 10 columns in the
picker preset grid. The wider palette supports light/dark curation
(e.g. picking a darker shade for the "older" cohort vs. a lighter
shade for the "newer" cohort in a fleet over time).

The expanded palette is shared by both picker modes AND by the
existing algorithm fallback in `assignColors`. Algorithm
deterministic-assignment behaviour is byte-stable: it just has more
distinct slots before wrap.

### What NOT to do

- **Don't aggregate row colors when stacking by single dimension.**
  Single-dim stacked charts MUST use per-dim Patch 4AJ overrides;
  row colors apply only when stacking by cohort key. Mixing systems
  creates visual inconsistency — a user-set BEV-LFP|Small row color
  silently bleeding into the BEV-LFP fuel-stack slot would conflict
  with other (BEV-LFP, *) cohorts that don't carry the same row
  color.
- **Don't make the per-row override apply to one pill only.**
  Per-row colors both pills in the row. The user's intent in
  setting a row color is visual unity within that cohort —
  individual-pill coloring within a row would be the per-dim
  affordance, which already exists as the "All {label}" mode in
  the picker.
- **Don't remove the Patch 4AJ per-dim picker mode.** Both layers
  coexist for different chart workflows; removing per-dim would
  break single-dim chart customization (e.g. "BEV-LFP is always
  teal everywhere" across DSM Dashboard's various stack-by views).
- **Don't propagate per-dim colors to cohort-key chart stacking.**
  When a row has a row override, cohort-key chart uses it. When a
  row doesn't, cohort-key chart falls back to algorithm modulo —
  NOT to per-dim. Per-dim and per-row are parallel systems, not
  nested. A user who wants "all BEV-LFP rows to share the BEV-LFP
  per-dim color in cohort-key stacking" should set the per-dim
  override AND switch the chart to single-dim stacking — the
  cohort-key view is for distinguishing individual cohorts.
- **Don't unify the storage models.** localStorage for per-dim,
  backend for per-row is intentional. localStorage-only per-row
  would force frontend post-processing of Excel exports (no
  client-side xlsx library) or a separate sync layer with the
  backend; backend-only per-dim would couple chart preferences to
  cohort mapping data semantically. Different scopes → different
  storage models.
- **Don't move the per-row state out of `cohortRowColors` into a
  separate localStorage layer for "consistency with Patch 4AJ".**
  See above. The reactivity flow (zustand `cohortRowColors` state →
  chart re-render) is enough; adding a parallel localStorage layer
  creates dual-source-of-truth bugs the first time the server-side
  storage is updated (e.g. via Excel upload from another browser
  tab).
- **Don't pass `rowColorOverrides` to `useDSMSystemColors` in
  charts that visualize per-dim slices.** Single-dim charts must
  pass through to the per-dim resolution — passing row overrides
  in is a no-op today (the hook ignores them in single-dim mode)
  but invites future misuse. Charts that visualize cohort-key
  stacking MUST pass them in.
- **Don't auto-derive per-row color from per-dim colors** (e.g.
  "BEV-LFP|Small = avg(BEV-LFP per-dim, Small per-dim)"). The two
  layers are independent expressions of user intent; cross-layer
  derivation would silently invalidate either pick when the other
  changes.
- **Don't drop the picker's mode toggle for "discoverability".**
  Per the user spec (option c), the mode toggle is the load-bearing
  affordance that exposes both layers in one picker UI. Defaulting
  to "This row" makes the common case one-click; switching to
  "All {label}" is one extra click for the per-dim case.
- **Don't round-trip per-dim overrides through Excel.** Out of
  scope. Per-dim is a chart preference, not part of the cohort
  mapping data structure. If a future workflow needs per-dim
  round-trip, ship a separate export/import action for it (e.g. a
  JSON-based "Chart preferences" import) rather than bolting it
  onto the cohort mapping Excel template.
- **Don't strict-match 3-digit hex (`#abc`)** in the Color column
  parser. Excel doesn't auto-expand 3-digit hex on save; users who
  type `#abc` likely meant `#aabbcc` but the parser can't know.
  Strict 6-digit-only matching with row-level error surfacing is
  the safest contract.
- **Don't make the dim derivation bidirectional.** Excel upload
  propagates row → dim when unambiguous; the in-app per-row picker
  does NOT auto-update dim overrides. Each layer stays addressable
  independently after the initial upload. Bidirectional propagation
  would silently overwrite intentional per-dim picks every time the
  user adjusts a row.
- **Don't propagate dim overrides to row overrides on upload (or
  ever).** Asymmetric: row → dim (when consistent), dim → row
  (never). Reason: dim is the broader scope; deriving rows from dim
  would overwrite intentional per-row variations. A user who sets a
  per-dim color via the picker's "All {label}" mode is expressing
  a chart-level preference, not a cohort-mapping data property.
- **Don't run the derivation on every `fetchCohortMappings` call.**
  Derivation runs at the **upload boundary** (`handleFile` in
  `CohortMappingEditor`), not on every fetch. Running on fetch
  would re-derive on page reload, potentially overwriting per-dim
  picks the user made between uploads. The fetch path is read-only
  for the per-dim layer.
- **Don't move the derivation to the backend** as "the parser
  should produce the per-dim map too." Per-dim is a frontend-only
  state (localStorage chart preference, Patch 4AJ contract). Moving
  derivation server-side would force the backend to know about a
  storage layer it has no reason to know about and would couple
  the import handler to chart-rendering concerns.
- **Hex case must be normalized to a single canonical form
  (lowercase `#rrggbb`) before storage AND comparison.** User
  input from Excel comes uppercase; UI picker may emit lowercase;
  hex-input field accepts either. Without normalization, equality
  checks fail across sources: a row written `#FF00FF` and another
  written `#ff00ff` for the same Fuel would be classified as
  "different colors" by a Set-based comparison, breaking the
  derivation's "all rows share one color" check. The
  `normalizeHex()` utility in `utils/chartColors.ts` is the
  canonical normaliser; apply at every write boundary
  (`setLabelColor`, `setRowColor`, future stores) and at the
  derivation's comparison set.
- **Treat 'auto' / empty Color cells as 'no opinion' in
  derivation, not as conflict.** A Fuel value with 2 colored rows
  + 1 auto/empty row should still derive when the 2 agree. The
  backend already strips auto/empty before persisting to
  `row_colors`, but the derivation function ALSO filters them out
  defensively so any future caller (manual JSON edit, test
  fixture, a different upload path) can't trip the function into
  a false-conflict state. Real conflicts are 2+ DIFFERENT hex
  values for the same dim value — those still correctly suppress
  derivation.
- **Don't introduce a separate write path that bypasses
  `normalizeHex`.** Every persisted color must flow through the
  utility. Most callers won't bother thinking about case; the
  invariant should be enforced at the boundary, not relied on at
  every call site. If a future store action persists colors, it
  MUST call `normalizeHex` first.

## Project-scoped stores must reset on project change (Database Explorer staleness)

Found 2026-08-07 verifying the Windows v0.1.6 installer; **fixed before
v0.1.6 shipped** (Cause B sat on the licence-free demo path a JOSS reviewer
follows). Kept here because it is a two-part failure that a green test suite
actively concealed.

**Symptom.** Switching projects leaves the Database Explorer rendering the
PREVIOUS project's database list and activity table. Switch to a project the
backend reports as having 0 databases and the page still shows the old
project's activity count (e.g. "4,362 activities") with the database
`<select>` gone; the `hasDatabases === false` empty state — and with it the
**"Load demo project" button, which only renders inside that empty state** —
never appears. Symmetric in the other direction: right after the demo button
switches projects, the explorer says "No databases in this project yet" while
`GET /api/databases` returns two.

**Not a backend bug.** `GET /api/databases` is correct throughout; only the
frontend view is stale. A webview reload (Ctrl+R) fixes it every time, which
is the tell: the data is refetched on mount but not on project change.

**Reproduced** from both Settings and the Database Explorer itself, before
and after an app restart. A **cold boot into a database-less project renders
correctly**, so a genuinely new user (fresh install, empty project) is NOT
affected — this bites mid-session project switching, which includes anyone
demoing MApper by hopping between projects.

**Root cause — TWO independent bugs that produce the same symptom.** Diagnosed
2026-08-07; both are small fixes, but fixing only one leaves half the symptom.

*Cause A — switching TO a project (stale activity table).*
`projectStore.switchProject` is fine: it calls `refreshProjectsAndDatabases`,
so `projectStore.databases` DOES update. The stale data lives in the OTHER
store — **`useActivityStore` is never reset on project change**.
`selectedDatabase` keeps pointing at the previous project's db (e.g.
`biosphere3`) and `activities` keeps the previous page. The initialise effect
(`DatabaseExplorer.tsx` ~line 687) is guarded by `!selectedDatabase`:

```ts
useEffect(() => {
  if (databases.length > 0 && !selectedDatabase) setDatabase(databases[0].name)
}, [databases, selectedDatabase, setDatabase])
```

With a stale-but-truthy `selectedDatabase` it does nothing — no re-select, no
refetch, no clear. Two knock-on effects: the db `<select>`'s value is no longer
in `databases`, so the picker renders no matching option (looks like it
"disappeared"); and `<EmptyState>` is gated on `activities.length === 0`
(`DatabaseExplorer.tsx` ~line 937), so a stale NON-empty `activities` means the
empty state — **and the "Load demo project" button inside it** — can never
render even though `databases.length === 0` is correct.

*Cause B — the demo button (says "No databases" when there are two).*
`DemoLoadButton` calls `useProjectStore.fetchProjects`, and **`fetchProjects`
sets only `{projects, currentProject}` — it never calls `getDatabases()`.**
Only `refreshProjectsAndDatabases` (used by `switchProject` / `createProject`)
refreshes both. So after the demo builds and switches, `databases` is still the
previous project's `[]` → `hasDatabases === false` → "No databases in this
project yet", while the backend already has `biosphere3` +
`demo-synthetic-technosphere`.

**The fix.**

*A* — `useActivityStore` gained the standard project-change reset. **Every
project-scoped store ends with the same block** (`bomStore`, `dsmStore`,
`aesaStore`, `impactStore`, `plcaStore`, `parameterStore`, `subsystemStore`
already had it; `activityStore` was the ONLY one missing it):

```ts
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useXStore.getState().reset()
})
```

It resets ONLY — the explorer's own effect re-selects `databases[0]` once
`selectedDatabase` is null, so selection logic stays in one place. **When you
add a new project-scoped store, add this block.**

*B* — new `projectStore.resyncAfterProjectChange()` (project list + databases,
refreshed atomically). `DemoLoadButton` and App's project-guard 409 handler now
call it instead of `fetchProjects`.

**Do NOT make `fetchProjects` fetch databases.** It is the cold-boot mount
fetch with a deliberately tuned ~22.5 s retry budget; awaiting a second request
inside it changes its timing contract and took down all 4 `projectColdBoot`
tests (which drive it under fake timers). That was tried and reverted — use
`resyncAfterProjectChange` from callers that know the project changed.
`tests/databaseExplorerProjectSwitch.test.tsx` B3 guards this.

**Publish the project and its databases in ONE `set()`.** The first attempt set
`currentProject` then `databases` separately; the intermediate render held the
NEW project with the OLD database list, and the explorer's initialise effect
ran in that window and re-selected a database from the old project — undoing
the reset. `refreshProjectsAndDatabases` is now atomic.

**Why the existing tests didn't catch it:** `projectSwitcherRefetch.test.tsx`
and `projectColdBoot.test.ts` are both green and both are about **`fetchProjects`
resilience only** — cold-boot retry, not clobbering on persistent failure, and
re-fetching the PROJECT LIST when the dropdown opens. Neither asserts anything
downstream of a project *change*, and neither renders `DatabaseExplorer`. The
area looks covered and isn't.

**The regression test must switch project on an ALREADY-MOUNTED explorer** — a
mount-time-only test passes against the bug. `tests/databaseExplorerProjectSwitch.test.tsx`
renders `<DatabaseExplorer>`, then switches in BOTH directions (has-dbs →
no-dbs, and no-dbs → has-dbs via the demo path) without unmounting, asserting
the picker AND the activity table follow. Both halves were verified
load-bearing by disabling each fix in turn and watching the suite go red.

**Seeding order gotcha for other tests:** set `useProjectStore.currentProject`
BEFORE seeding `useActivityStore`, or the reset subscription wipes the seeded
activities (this is why `multiProductActivityVintage.test.tsx` reorders its
`beforeEach`). Same hazard already applied to `bomStore`.

### The class, and the guard that closes it

The same false premise shipped **four** times:

| # | site | gate | live? |
|---|---|---|---|
| 1 | `api/lca.py` single-product | `parameter_scenario is not None or table.has_time_varying()` | yes — 727× on WP5 use phase, ~1600× on Battery Circularity totals |
| 2 | `api/bom.py` `material_flows` | `is not None and != "Base"` | yes — reported the **vehicle count as kilograms** |
| 3 | `api/bom.py` dsm-lca | `param_table` assigned only inside `if body.parameter_set_id:` | latent |
| 4 | `api/impact.py` | same | latent |

3 and 4 are a **data-flow** gate, not a syntactic one: `DSMLCAPipeline`
resolves iff it is handed a table, so a falsy `parameter_set_id` left
`parameter_table=None` and silently disabled resolution for a whole
system-level run. They were latent only because every UI path sends `"Base"`
(truthy) and `/impact/calculate-scenarios` defaults to `"Base"`.

`tests/test_parameter_resolution_never_gated.py` closes the class. It is
AST-based, not textual — it finds every call to `resolve_archetype_with_engine`
and walks the enclosing `if` statements, because all four gates lived in
*enclosing scope* where a line-oriented grep cannot see them. A separate rule
covers the data-flow shape (3 and 4) by asserting `param_table` is never
assigned inside a `parameter_set_id` branch. `ALLOWED` is empty on purpose;
an entry must say why a gate is correct, not merely that it exists.

Anti-vacuity: `test_the_guard_catches_each_historical_gate` replays all four
shapes through the same analyser and requires each to be flagged, and
`test_the_guard_accepts_the_corrected_shape` pins that *validating* a scenario
name is not the same as *gating* on it. The one conditional that legitimately
wraps a resolve call — `DSMLCAPipeline`'s year-varying branch, which chooses
resolve-once vs resolve-per-year — is pinned unflagged by its own test.

## The DSM sim binds the sensitivity case; the LCA half always did

`scenario_id` (a DSM scenario) and `case` (a parameter sensitivity case) are
**different axes**. `simulate_for_scenario` hard-coded
`_engine_for_scenario(None)`, so the DSM sim always ran under Base — while
BOTH of its callers had the user's selection in hand and dropped it:

| caller | knew | forwarded |
|---|---|---|
| `impact.post_calculate` | `body.parameter_set_id` | nothing |
| `bom.material_flows` | `body.parameter_scenario` | nothing |

Each applies the case to the archetypes and then simulated the fleet under
Base, so one run mixed two cases. `case` is now threaded through
`simulate_for_scenario(system_id, scenario_id, case=None)`, both callers
forward it, and `/simulate` takes an optional `case` query param (validated by
the shared helper). `None` means Base — every pre-existing caller is
byte-identical.

**Scaling rules are the only channel from parameters into DSM output**
(`_resolve_rule`, reached only from `_scale_year_cohort` / `_scale_outflows`,
both short-circuiting when there are none). Neither live project has a single
scaling rule — 0 across both — which is why this was latent. The binding is
wrong regardless of whether today's data exercises it.

**The frontend does not send `case` on `/simulate` yet** — `simulateMFA` sends
only `scenario_id`, and the DSM Dashboard has no sensitivity-case selector.
The query param exists so the boundary is complete and a direct API caller can
express it; wiring the UI is a separate decision.

### Keyframed parameters resolve PER SIMULATION YEAR inside a scaling rule

`ParameterEngine.__init__` resolves the whole table **eagerly** into
`self.params` for ONE year, and `resolve()` then evaluates against that frozen
map. Every DSM caller built it with `year=None`, under which keyframes are
ignored and a time-varying parameter silently collapses to its `base_value` —
so `base * adoption` applied the SAME adoption to 2026 and 2050.

**The year was never missing.** `_resolve_rule` already receives it — it
injects it as an expression variable — and both callers
(`_scale_year_cohort`, `_scale_outflows`) are per-year loops. It was available
and unused for parameter RESOLUTION. Those are two different things and only
the second was broken: injecting `year` into the *expression* always worked,
which is part of why the path looked covered.

`DynamicStockModel` now takes keyword-only `parameter_table` +
`parameter_scenario` alongside the legacy `parameter_engine`, and
`_engine_for_year(year)` returns a per-year engine cached in `_year_engines`.
This is the shape `DSMLCAPipeline` has always used — passing the raw table so
keyframes resolve per year — applied to the half that never got it.

**Byte-identical everywhere except keyframes × scaling rules**:
`_engine_for_year` falls back to the single pre-built engine when no table was
handed in (every legacy caller) AND when the table carries no keyframes (both
live projects). One `resolve_all` per year per simulate, not per cohort.

**`subsystem_engine` is deliberately not threaded.** Its
`compute_subsystem_result` builds a synthetic `MaterializedDSMState` with **no
`scaling_rules` field set at all**, so per-year resolution is unreachable there
by construction, and its engine comes from a pre-resolved `ParameterSet` rather
than a table. Threading it would mean changing `_build_engine`'s return shape
for a path that cannot use it.

#### The fixture asserts ABSOLUTE values, not difference

`tests/test_dsm_scaling_year_varying.py` computes each expected count in the
test file from the keyframe anchors — a **second implementation** of the
clamp-and-interpolate rule, deliberately not a call to
`_interpolate_keyframes`, because asserting the engine against the very
function the engine uses verifies nothing.

A test that only checked "the years differ" would pass on any
wrong-but-varying resolution — an off-by-one year, anchors read in reverse.
The anchors are chosen so one run covers a clamp before the first anchor, the
anchors exactly, an interior interpolated year, and a clamp after the last:
`[100, 100, 150, 200, 250, 250]`.

`base_value` is set to an absurd `99.0` so that ignoring keyframes produces
`9900.0` — unmissable rather than plausible. Verified load-bearing: reverting
`_engine_for_year` to the single engine fails 9 of 12 with exactly that
uniform 9900.0, and leaves the three no-drift cases passing.

#### What NOT to do

- **Don't build one `ParameterEngine` per simulate and expect keyframes to
  work.** It resolves eagerly at construction and is pinned to whatever `year`
  it was given. Pass the table.
- **Don't confuse the injected `year` variable with year-resolved parameter
  VALUES.** `extra_vars={"year": ...}` always worked and is not the fix.
- **Don't assert a resolver against the function it uses.** Recompute the
  expected value independently in the test, or the assertion is circular.
- **Don't test year-varying behaviour by asserting only that years differ.**
  Absolute expected values per year, or a wrong-but-varying resolution passes.

### Why this survived: the engine was tested, the invocation was not

`test_dsm_scaling.py::test_multi_scenario_produces_distinct_results` constructs
`ParameterEngine(table, scenario=...)` **directly** and asserts the three
trajectories differ. It never goes through a route. So it proved the mechanism
honours a case while the wiring one level up passed `None` — the same shape as
the worker-launch coverage gap, where a test measures *that* something runs and
never *what it is invoked with*.

`tests/test_dsm_simulate_case_binding.py` goes through the routes, and carries
a test asserting `test_dsm_scaling.py` still does NOT, so the note cannot go
stale silently.

#### What NOT to do

- **Don't conflate `scenario_id` with `case`.** DSM scenario and parameter
  sensitivity case are separate axes that both reach `simulate`. The names are
  close and the bug was exactly this conflation being invisible.
- **Don't test a parameter binding by constructing the engine yourself.** That
  is what left this open. Drive the route.
- **Don't read "no live data exercises it" as "not a bug".** Zero scaling rules
  today is a property of today's projects, not a guarantee.

## A sensitivity case name is CHECKED, once, at every boundary

`ParameterTable.resolve` falls through to `base_value` when the requested
scenario carries no override. That is correct for a parameter the case does not
touch, and silent for a case that does not exist at all:

    scenario='Optimistic'    -> 150.0
    scenario='Optimsitic'    -> 100.0   <- Base, no warning
    scenario='does-not-exist' -> 100.0

So a sensitivity run against a typo reported "no sensitivity" and read as a
finding. Battery Circularity's cases are `sa_early_repurpose_120kkm`,
`sa_high_soc_100`, `sa_dc50_25c` — a typo in one of those is not hypothetical.

`dsm.py`'s `simulate_scenarios` had this check for ONE route. Every other
boundary taking a case name accepted anything. `validate_parameter_scenarios`
(`mapper/api/parameters.py`) is now the one implementation, called at nine
sites across six modules: `/lca/calculate-archetype`,
`/lca/calculate-archetype-trajectory`, `/impact/calculate`,
`/impact/calculate-scenarios`, `/lca/monte-carlo`, `/lca/monte-carlo/multi`,
`/dsm/.../simulate-scenarios`, `.../material-flows`, `.../material-flows-multi`,
plus the two parameter-editor preview routes (`/parameters/resolve`,
`/parameters/validate`) — a typo there previewed Base values, which reads as
confirmation that the name is fine.

**`None` and `"Base"` are always valid.** Absence of a selection means Base,
which is the documented default; only a NAMED case absent from a PRESENT table
raises. Same rule the global-lever guard settled on.

**Validity is membership, never whether the case moves a number.** MAp-test's
two cases carry ZERO overrides across 43 parameters — they resolve identically
to Base. They exist, so naming one is not an error.

**Fan-out validates the WHOLE list before spawning anything.** A bad name in
position 3 must not leave two fleet runs already in flight, or two material-flow
runs already assembled under wrong labels.

**The engine's fallthrough is deliberately unchanged.** The check is at the
boundary, so `resolve` keeps its simple rule and the name is validated once.

### `lci_scenarios` is an axis and counts toward axisConflict

`post_calculate_scenarios` computed `multi_axes` over three axes and omitted
multi-LCI, under a comment (and a docstring) saying `post_calculate` rejected it
alongside a fan-out parent. **It does not, and never did** — the only
`lci_scenarios` reference in `post_calculate` is
`multi_lci_mode = mode == "projected" and len(lci_scenarios_list) > 1`. So 3
sensitivity cases × 3 LCI scenarios launched **nine** fleet runs while the
validator counted one axis, and there is no numeric cap anywhere downstream to
catch it. Multi-LCI runs sequentially inside a single task, which is why it read
as "in-task" rather than "fan-out" — but sequential is not free, and the rule
exists to stop the multiplication, not the parallelism.

The count fires on `len(...) > 1`, never on presence: one LCI scenario is a
coordinate, not a fan-out, and must not conflict with a parameter sweep.

#### What NOT to do

- **Don't add a boundary taking a case name without calling the helper.**
  `test_every_route_taking_a_case_name_checks_it` sweeps every route whose
  request schema carries `parameter_scenario` / `parameter_scenarios` /
  `parameter_set_id` / `cases` and fails naming it. `_ALLOWED` is empty on
  purpose; an entry must say why not checking is correct.
- **`get_parameter_set` counts as a check, and is not a near-miss.** It returns
  `None` for any name outside `table.list_scenarios()` — the SAME namespace and
  rule — and its callers raise on `None`. `run_dsm_lca` and both
  `compute_subsystem` routes are guarded that way and were false positives of a
  name-based sweep.
- **Match ACCEPTED as CALLS, not substrings.** The first version of the guard
  matched bare names, so a `from ... import validate_parameter_scenarios` line
  inside a route body satisfied it on its own — deleting the actual call left
  the guard green. Caught by re-running the revert.
- **Don't move the check into `resolve` / `resolve_all`.** The fallthrough there
  is correct per parameter; raising inside it would refuse every parameter the
  case legitimately does not override.
- **A full-suite green does not prove a fixture registers what it names.** The
  parameter table lives in a module-level registry that no test clears, so one
  test's table satisfies the next test's case name. Three fixtures named cases
  they never registered; the full suite passed on all three locally and CI —
  a clean environment, different skips, different ordering — failed on one.
  **Verify a boundary guard by running each candidate test FILE in isolation**
  (`for f in ...; do pytest $f; done`), which removes the leakage. That sweep
  found the third; the full suite never would have.
- **A fixture naming a case no table carries is a fixture to correct.** Three did
  (`test_calculate_scenarios_static_mode_preserves_mode_per_task`,
  `test_parameter_axis_fans_out_one_call_per_scenario_name`,
  `test_calculate_scenarios_param_axis_unchanged_when_no_dsm_ids`); all three
  now register the cases they name.
- **Don't restore the claim that `post_calculate` rejects multi-LCI beside a
  fan-out parent.** A comment describing a protection nobody implemented is
  worse than no comment — it is why the omission survived review. Pinned by
  `test_the_false_claim_is_gone_from_the_source`.

## A negative quantity is a credit, not a reason to drop the row

`calculate_archetype_lca` shares an activity's score among the materials using
it. The guard was `if same_act_qty > 0`, so an activity group whose NET
quantity was negative — a credit or avoided-burden row, ordinary in a
circular-economy model — had its share sent to 0 and vanished from **both** the
stage breakdown and the contributions list, while its real impact stayed in
`total_score` from the bulk solve.

Measured: Battery Circularity's `A - Circular EV` has
`Battery-excluded glider shredding` summing to −0.0092125, and **6.5 %** of its
total went unattributed (`sum(stages)` 0.07873 vs `total` 0.08420).

The guard is now `!= 0`. Only an exactly-zero group is skipped, where the share
is genuinely undefined.

**Blast radius, measured across both real projects:** 33 of 36 archetypes are
byte-identical. All 28 WP5 archetypes are unchanged, including `Fuel Station`,
whose negative End of Life stage predates this — negative *contributions* were
never dropped, only groups whose *net* was ≤ 0. Three Battery Circularity
archetypes gain previously-unattributed impact in End of Life
(`A - Circular EV`, `A0 - Reference EV`, `EV-I life`); every **total** is
unchanged, because the bulk solve never had the bug.

### Credits in the stage bar

`StageBreakdownChart` is a proportional div stack, **not Recharts**, so a
negative stage does not render below an axis — it renders at `|v|` and, left
alone, is indistinguishable from a burden of the same size. It would read as
*adding* impact when it subtracts. Two changes:

- Credit segments are **hatched** (a repeating-linear-gradient), not merely
  recoloured, so the distinction survives the print/greyscale export re-theme.
  The tooltip says "credit, subtracted from the total", and a one-line note
  appears below the bar only when a credit is present.
- The denominator is the **gross** sum of `|v|`, not `|net|`. With `|net|` a
  mixed-sign bar's segments sum to more than 100 % and the excess is clipped by
  the container's `overflow: hidden` — segments silently disappear off the end.
  WP5's Fuel Station is a live example (−92.78 against ~6.9 × 10³ positive).

#### What NOT to do

- **Don't guard a proportional share on `> 0`.** The undefined case is `== 0`,
  not `< 0`. A negative share is meaningful and signed.
- **Don't size a mixed-sign proportional bar by `|net|`.** Use gross, or
  segments overflow and are clipped.
- **Don't distinguish credits by colour alone.** Chart exports re-theme ink and
  may be read in greyscale; the hatch is what survives.
## Archetype composition — an archetype as another's BOM input

`Archetype.includes: list[ArchetypeInclude]`. The reference is by **archetype
id, never a node id**: node ids are re-minted on every import
(`assign_node_ids` only fills missing ones, and the workbook parser builds
nodes without them), while a merge-mode import matches archetypes by name and
preserves their id.

### Spliced stage-by-stage, MATCHED ON SCOPE

A child's Manufacturing lands in the parent's Manufacturing, its End of Life in
the parent's End of Life. This is the whole design constraint: `Battery Pack`
carries both stages, and collapsing it into whichever stage the reference sat
in would put end-of-life transport into manufacturing — wrong scope, wrong
basis, wrong point in the DSM. A scope the parent lacks gets a new stage rather
than being dropped into an unrelated one.

### Parameters resolve in the CALLER's context

There is one parameter table per project and one namespace, so the caller's
context is the only context. **Compute the parent under `Optimistic` and the
child's expressions take Optimistic values too.** A nested archetype is NOT a
frozen sub-assembly, and someone will expect it to be. Cross-project references
are forbidden in v1 precisely because two projects genuinely have two tables.

### Eager splice, so no cache changes

Splicing runs in `DSMLCAPipeline.__init__` before `self.archetypes` is set, and
in `_build_archetype_source_demand` before parameter resolution — upstream of
`_flat_cache` `(archetype_id, scope, year)`, `_flat_cache_year`
`(archetype_id, year, scope, db)` and `_resolved_arc_cache`
`(archetype_id, year)`. Every key therefore refers to an archetype whose
children are already baked in, and no cache learns about references.
`test_splicing_happens_upstream_of_every_flatten_cache` is the alarm if that
ever moves.

Quantity scaling is free: `flatten_bom` already cascades
`effective = parent_quantity × node.quantity`, so a ref at 2 doubles the
child's whole subtree. `ArchetypeInclude.quantity_expression` resolves like any
other quantity — which is what lets a reference carry a functional-unit
normaliser (see the acceptance case below).

### Cycles and depth

Detected at **save time and flatten time**, and the second is not redundant:
archetype JSON is edited on disk, arrives by project import, and round-trips
through Excel, none of which passes a save route. `MAX_INCLUDE_DEPTH = 4`,
surfaced verbatim in the error. A cycle error names the chain.

### Basis below the root

A spliced child stage becomes a NON-root node while keeping its own `basis`,
so basis had to become readable below the root. `flatten_root_with_amounts`
inherits the multiplier down the tree and lets the nearest basis-declaring
ancestor override it, so a per-year child under a per-unit parent stage still
scales with the lifetime. Driven by `basis_amounts`
(`{"per_unit": 1.0, "per_year": <lifetime>}`); absent, every material takes its
stage root's amount, byte-identical to pre-composition behaviour.

### Source-qualified material keys

DSM aggregation keys by material NAME (`mat_qty[...]`, `material_totals[...]`),
so a "Steel frame" in the parent and one in a child would merge into a single
contribution line. `material_key()` qualifies the leaf with the **nearest**
enclosing include using `INCLUDE_KEY_SEP = "::"` — the same string the
subsystem aggregation already uses, not a second scheme — so a grandchild
reports the grandchild and a reader recovers the source with
`key.split(INCLUDE_KEY_SEP)`. Rows outside any include are unchanged.

`lca.py` still reads only `path[0]` / `path[1]` for `stage` / `component`, so
for a chain deeper than one level the intermediate names do not fit there. The
**name** carries the nearest include instead; widening the contribution shape
to a full path is a separate UI decision.

### Dangling references are LOUD

`dsm_lca_engine` used to `continue` past a cohort mapping pointing at a missing
archetype while the API raised 404 for the same condition. That silent skip is
the WP5 failure verbatim, and composition adds a second class of dangling id,
so the engine now raises `DanglingArchetypeError`. A dangling include raises
`ArchetypeCompositionError`.

### Import modes

**Merge is safe for a project using composition** — it matches by name and
preserves the archetype id. **Replace orphans every reference**: it mints a
fresh `uuid4()`. Both re-mint node ids.

**The BOM workbook cannot express a reference**, so exporting a composed
archetype is **refused** with a 400 rather than silently writing the child's
spliced rows and re-importing a flattened copy that no longer tracks the child.
Use project export/import, which carries `includes` intact.

### Acceptance

`B0 - Reference BESS` hand-duplicates `Battery Pack` inline. Rebuilt as a
reference carrying `1 / b0_cumulative_ac_energy_delivered_kwh` as its include
quantity, the composed twin reproduces the original at **rel-diff 0.000e+00**
on GWP100 and acidification against the live project.

**Why the divisor is needed, and the design limit it reveals:** the standalone
`Battery Pack` is expressed per pack, while B0's inline copies are the same
expressions divided by the FU normaliser. One include quantity reproduces both
of its stages because both carry the same divisor. `BESS-Inverter` cannot be
referenced the same way: its Manufacturing is divided by the normaliser and its
Use Phase is not, and a single include quantity scales the whole child
uniformly. **A child whose stages carry different normalisations cannot be a
single reference** — split it, or leave it inline.

#### What NOT to do

- **Don't flatten a child into one of the parent's stages.** Match on scope.
- **Don't splice lazily inside `_flatten`.** The cache keys would go stale.
- **Don't reference a node id.** They are re-minted on every import.
- **Don't let a dangling reference `continue`.** Silent shrinkage is
  indistinguishable from a genuinely smaller result.
- **Don't invent a second key separator.** `INCLUDE_KEY_SEP` is the subsystem
  string on purpose.
- **Don't export a composed archetype to the BOM workbook.** The format has no
  reference row; the refusal is the feature.
## Use-phase basis is a PROJECT convention, with a per-stage override

Battery Circularity's archetypes are uniformly whole-lifecycle, so declaring a
basis per stage per archetype was repetitive for something that is really a
project fact. And the only stages that differ between the two real projects are
**Use Phase and Maintenance** — Manufacturing and End of Life are per-unit in
both.

`ProjectSettings.use_phase_basis ∈ {life_cycle, one_year}`, set in
LCA Architect → Manager between the Import/Export cards and Archetype Summary.

- **Life cycle** → the BOM already holds whole-life quantities, so **Stage
  amounts is hidden entirely** on Single-product (and on Multi-item, same page).
- **One year** → the control appears as before, Lifetime available.

### Where it lives, and why no copy-helper change was needed

`dsm/{project}/project_settings.json` — a FILE inside the **existing** dsm root,
not a sixth root. All three carry paths are whole-tree operations on
`root/{safe_project}` (`copy_project_storage` → `shutil.copytree`,
`write_archive_storage` → recursive `tf.add`, `install_archive_storage` →
`_copy_tree`), so duplicate, rename, export, import and delete carry it with
**zero changes to `project_storage.py`**. A new root would have needed a
`storage_roots()` entry and an archive label, and — the real hazard — an archive
from this build would be **silently dropped by an older one**, since
`install_archive_storage` does `root = roots.get(label); if root is None:
continue`. `dsm_storage._load_project` skips non-directories, so the file is
invisible to the existing loader.

The in-memory registry follows `parameters._tables` **including its lesson**:
reloaded by `_rehydrate_after_storage_write` and pruned by `_prune_registries`,
because `hydrate_from_disk` merges and never prunes. Sixth appearance of that
class.

### Defaults

- **Existing project → `one_year`.** No file means it predates the feature and
  must compute exactly as it did: the control renders, the preset defaults to
  1 year, every multiplier is 1.
- **New project → `life_cycle`, written explicitly at creation.** The
  difference between a new and a legacy project is a stored fact, not a guess
  at read time. Whole-lifecycle is the more common convention outside fleet
  modelling, and it is the more conservative failure — getting it wrong shows
  an implausibly small use phase, where the other direction silently multiplies
  a whole-life BOM by the lifetime.

### How it composes with the per-stage declaration

**Per-stage declaration › project setting › nothing.** The setting supplies a
default for **Use Phase and Maintenance only**; PR #41's declaration still
overrides it, which is what an archetype mixing bases against its project's
convention needs (WP5's station archetypes, whose Use Phase rows are
evaporative losses rather than annual driving).

This **revises what `basis = None` means** — PR #41 shipped "undeclared →
forced ×1", this is "undeclared → inherit the project setting". Gated: MAp-test
at the default preset is byte-identical, because existing projects resolve to
`one_year` and the 1-year preset is ×1 either way.

### Single-product only — never the fleet

The fleet gets annual semantics **structurally from `scope`**: `scope="stock"`
applies the Use Phase BOM once per simulation year for every unit alive. A
basis multiplier there would **double-count**. Guarded by a name sweep over
`dsm_lca_engine.py` in the same family as the resolution guard.

### The hidden control explains itself where it is missing

When Life cycle hides Stage amounts, Single-product renders a note saying so,
naming the setting and linking to Manager. A user with an annual BOM notices
the missing control **there**, not in Manager; a note only in Manager leaves a
hidden affordance with no explanation on the page it is missing from.

#### What NOT to do

- **Don't add a sixth storage root for project-level data.** A file inside an
  existing root is carried for free and cannot be dropped by an older build.
- **Don't let the setting reach `dsm_lca_engine`.** Double-counting against
  per-year cohort counting.
- **Don't extend the setting to Manufacturing or End of Life.** They are
  per-unit in every project examined; the setting says nothing about them.
- **Don't hide a control without explaining it on the page it vanished from.**

## Scope is WHEN the fleet counts it; basis is WHAT one row means

Two independent properties of a BOM stage. They were conflated, and the
conflation was expensive.

- **`scope`** — `inflows` / `stock` / `outflows`. Tells the DSM *when to count
  the stage*: manufacturing at the year of production, stock every year the
  unit is alive, end-of-life at deregistration. Correct for every project and
  unchanged.
- **`basis`** — `per_unit` / `per_year` / **undeclared**. Tells the app *what a
  single row's quantity means*: the whole-life amount for one functional unit,
  or one year's worth. It decides the stage-amounts multiplier.

**A stock-scoped stage is not necessarily per-year.** Every Battery Circularity
Use Phase carries `scope="stock"` while its quantities are already per kWh of
AC service. The Use Phase reaches that basis *by construction, not by
division*: its rows carry a literal `1.0` (plus the round-trip-loss term
`1 / bess_round_trip_efficiency - 1`), because one kWh of service is one kWh of
service. **Only Manufacturing and End of Life carry a divisor** — they hold
whole-life amounts and are divided by the archetype's own AC-energy normaliser
(§ *Two AC-energy normalisers* below; B0 divides by
`b0_cumulative_ac_energy_delivered_kwh`, B by `bess_ac_energy_delivered_kwh`).
The old `is_annual = (scope == "stock")` derivation therefore multiplied its use
phase by the lifetime and left manufacturing at 1 — the functional unit becomes
15 kWh for one stage and 1 kWh for another. Incoherent, not a rescale: ×8.76 on
B0's total.

Meanwhile WP5 genuinely *is* per-year (`d_annual * w_car * p_icev_petrol`), and
mixes bases inside one archetype — Manufacturing and End of Life one-time, Use
Phase and Maintenance annual. So basis is **per stage**, never per archetype: a
per-archetype declaration cannot express WP5 at all.

### Undeclared means undeclared

Every existing stage migrated to `basis = None`, which forces a multiplier of
**1** and disables the Lifetime preset with the reason stated in the panel.
That default is safe for *both* conventions precisely because it is not a
guess: ×1 is the one multiplier WP5 and Battery Circularity already agree on
(WP5 ×1 is exactly the previous `1year` default; BC ×1 is its intended FU).
Any basis guess is right for one project and wrong for the other — which is why
there is a declaration at all.

`basis` is three-state for the same reason. A boolean's absence is
indistinguishable from `False`, and that is exactly how the silent
scope-derived guess took hold.

### `is_annual` is demoted, not deleted

It is still computed and still published as `ArchetypeSummary.stage_annual`,
but **only as a UI suggestion** ("this stage is counted per simulation year —
probably per_year"). It must never determine a multiplier again;
`stage_basis` does that. It is kept because it is present in every persisted
archetype and drives the hint.

### Declaring it

In-app, per stage, via `BOMNodeUpdate.basis` → `bomStore.setStageBasis` →
the select in `<StageAmountsEditor>`. **Re-import is deliberately not the
migration path**: re-importing is what orphaned the WP5 cohort mapping on
2026-08-04, so the route for the project that most needs a basis must not be
the one that breaks it. `ArchetypeSummary.stage_ids` exists to make the
in-app route possible. The `Basis` workbook column is an additional route for
people who work in Excel, and round-trips on the stage-root row like `Scope`.

The Lifetime horizon may reference a parameter (`ArchetypeStageAmounts
.lifetimeParam`) so a project that already models it — Battery Circularity's
`bess_lifetime_years = 15` — drives it rather than carrying a hand-typed
duplicate that can drift from the BOM's own expressions.

#### What NOT to do

- **Never derive `basis` from `scope`.** They answer different questions. The
  `stock → per_year` rule is a *suggestion* surfaced in the UI and nothing
  more. `tests/test_stage_basis.py` and `tests/stageBasis.test.tsx` both pin
  this; restoring the fallback fails 5 frontend tests.
- **Don't reach for `stage_annual` when you need a multiplier.** It is the
  scope-derived hint. `stageBasis()` is the accessor that decides.
- **Don't make undeclared fall back to anything.** Undeclared computes at ×1
  and says so. A fallback is precisely the silent guess being removed.
- **Don't make basis per-archetype.** WP5 mixes bases within one archetype;
  a per-archetype flag would force all-per-year (Manufacturing ×15 — fifteen
  vehicles built, 141 732 kg CO₂e) or all-per-unit (no lifetime scaling at
  all).
- **Don't collapse `basis` to a boolean.** The third state is load-bearing.

### Two AC-energy normalisers — B0 and B are DIFFERENT, on purpose

Battery Circularity holds **two** cumulative-AC-energy parameters. They look
like a duplicate and are not; an external audit read them as "a confirmed
discrepancy" and it was a false positive.

| Parameter | Base value | Used by | Occurrences |
|---|---|---|---|
| `b0_cumulative_ac_energy_delivered_kwh` | **89 514.008 08** | `B0 - Reference BESS` | 3 quantity expressions |
| `bess_ac_energy_delivered_kwh` | **88 358.095 88** | `B - Circular BESS`, `BESS-II life`, `BESS-Inverter` | 4 + 1 + 1 |

**B0 is the NEW-battery reference BESS (100 % initial SoH); B is the
second-life one** (arrives at ~84 % SoH, ends at 75.2 %). A healthier battery
delivers more energy over the same 15 years, so B0 **must** exceed B — it does,
by **1.3082 %**. Two values, two archetypes, no overlap: verified by walking
every `quantity_expression` in all eight archetype JSONs. **Do not "harmonise"
them.**

Corroborating checks that pass: `bess_annual_ac_energy_delivered_kwh × 15`
reproduces B exactly (rel diff 0.000e+00); the round-trip closure against
`bess_cumulative_ac_charge_kwh` implies an effective RTE of 0.900 237 vs a
nominal 0.9 (+0.026 %); both parameters rise per-year under
`sa_bess_lifetime_10y` (+0.341 % B0, +0.279 % B), the correct sign for
degradation; and both sit near 38 % of community demand, so the system is
demand/PV-limited rather than capacity-limited — which is why a much healthier
battery buys only 1.3 %.

**The scenario-override asymmetry is correct, not a gap.** B0 carries an
override only in `sa_bess_lifetime_10y`; B carries all six. The other five
cases perturb **EV-side** parameters only (charging power/mode, target SoC, EV
cell temperature, service distance), which change how degraded the battery is
*when it arrives at second life*. That moves B and cannot touch a new reference
battery. Only the lifetime case changes B0's own operation.

**Changing the divisor is NOT a clean multiplier on the total**, because the
Use Phase carries no divisor. Forcing B0 onto B's value scales Manufacturing
and End of Life by exactly 1.013 082 13 and leaves the Use Phase at 1.000 000,
so the total moves **+0.585 % on GWP100 but +0.875 % on acidification** — the
multiplier is indicator-dependent, tracking each indicator's
Manufacturing : Use split (44.6/55.3 for GWP100, 66.8/33.1 for acidification).
`A`/`A0` are untouched by either value: the EVs normalise on
`ev_service_distance_km` (160 000 km), and their scores are bit-identical
across both.

#### Two open caveats for the paper — NOT defects, and NOT fixable here

Both need the source dispatch/degradation model, which does not live in this
repo. Record them; do not attempt to close them from the parameter table.

- **B0's normaliser has no corroborating sibling.** B can be cross-checked
  three ways (`bess_annual_…`, `bess_cumulative_ac_charge_kwh`,
  `bess_cumulative_fec`). B0 has none of these — no `b0_annual_…`, no
  `b0_cumulative_ac_charge_kwh`, no `b0_cumulative_fec`, no `b0_end_soh_pct`.
  Its 89 514.008 can only be checked by ratio against B and by physical
  plausibility. If the reference dispatch is re-run, **have it emit the
  siblings too.**
- **B's FEC closure is 0.68 % off and does not resolve.**
  `bess_cumulative_fec × 60 kWh × discharge_eff` = 87 756.729 kWh against a
  stored 88 358.096 (implied FEC 1552.294 vs stored 1541.729). Every
  redefinition constructible from the table — charge-side, discharge-side,
  their mean — lands at ~1552, never 1541.73. It is small and it is not the
  normaliser, but it is unexplained.

## A parameter scenario says WHICH values, never WHETHER to resolve

A BOM row whose Quantity cell is a parameter expression is imported with
`quantity = 1.0` as a **pre-resolution placeholder** and the formula in
`quantity_expression`. So skipping resolution does not fall back to the base
values — it computes against 1.0.

`_build_archetype_source_demand` (`mapper/api/lca.py`) used to gate resolution
on `parameter_scenario is not None or table.has_time_varying()`, on the stated
grounds that a scalar-only table "resolves identically anyway". That premise is
false for any BOM holding expressions. Both single-product panels send `None`
for Base — `SingleProductStaticPanel.tsx` (`sc === BASE_SCENARIO ? null : sc`)
and `multiProductLCAStore.ts` (a field the UI never sets) — so on a scalar-only
table the gate never opened and every expression row computed as its
placeholder.

**The system-level path never had this bug.** `DSMLCAPipeline` gates on
`parameter_table is not None`, and `parameters._table_for` always returns a
table (`setdefault`), so it always resolved. That asymmetry is what made the
defect invisible: WP5's fleet numbers were right the whole time and only the
single-product panels were wrong.

Measured on the real projects before the fix, **on 2026-08-28 at 06:46**:

| | before | after | |
|---|---|---|---|
| WP5 ICEV-Petrol, Use Phase (1 yr) | 0.78 | 567.7 kg CO₂e | 727× |
| Battery Circularity B0, total | 239.2 | 0.1499 kg CO₂e † | ÷1596 |
| B0 Manufacturing / Use split | 99.86 / 0.06 | 44.4 / 55.4 † | |

† **These two B0 rows no longer reproduce — they are a dated measurement, not a
current expectation.** B0's live GWP100 is **0.16292 kg CO₂e** (EF v3.1,
ecoinvent-3.10-cutoff, `scope="all"`, default preset), split
44.6 % Manufacturing / 55.3 % Use Phase. The figures moved for reasons outside
this patch and after it: `stage_basis` landed the same day at 08:27, and the
project's parameter table was last written at 22:18. The ratio the row exists
to demonstrate (÷1596, i.e. the divisor going from never-applied to applied) is
unaffected — **keep the dated numbers and this note rather than silently
restating them**, because a re-measured figure would no longer be evidence of
what this patch fixed.

The Battery Circularity case is the clearer failure: its functional unit is
1 kWh of AC service, produced by dividing Manufacturing and End of Life by the
archetype's AC-energy normaliser — for B0 that is
**`b0_cumulative_ac_energy_delivered_kwh` (89 514.008)**, not
`bess_ac_energy_delivered_kwh` (88 358.096), which is B's (see *Two AC-energy
normalisers* under the stage-basis section). The Use Phase is divided by
nothing: it carries a literal `1.0`, being per-kWh by construction. Unresolved,
the divisor never applies, so a whole battery pack is charged against 1 kWh.

**Resolution now always runs.** For an expression-free BOM,
`resolve_archetype_with_engine` is a deep copy with no substitutions, so
nothing moves — verified across every archetype in the demo, Wind Farm and
`default` projects, none of which carries an expression.

`tests/test_single_product_expression_resolution.py` is the guard, and
`test_matches_the_system_level_path` is the load-bearing one: it flattens the
same archetype through `DSMLCAPipeline` and through the single-product handler
and requires the same quantity, so the two paths' agreement is a checked
property rather than a coincidence.

### What NOT to do

- **Don't gate resolution on the scenario being non-None.** `None` and
  `"Base"` are the same scenario; if they compute different numbers, that is
  the bug. The scenario selects which values to substitute, never whether to
  substitute.
- **Don't treat `quantity` as meaningful when `quantity_expression` is set.**
  It is a placeholder the importer writes so the node validates; only the
  resolved value is real. Any code path that reads `quantity` without having
  run the engine is computing on 1.0.
- **Don't let the single-product and system-level paths diverge on parameter
  handling.** They compute the same archetype and must agree. The alignment
  test exists because a comment asserting equivalence is not a check.
- **A visual "the chart looks broken" report can be a compute bug.** The
  stacked bar rendering was correct throughout; it faithfully drew a use phase
  that really was 0.002 % of the total, because the quantity behind it was a
  placeholder. Read the values before touching the rendering.

## Project export is modelling-only by DEFAULT, and streamed

`export_project` buffered the whole tarball through `io.BytesIO`. Fine for an
archive of kilobytes; fatal for one of 38 GB — exporting MAp-test wedged the
backend. It now **streams to a temp file and returns a `Path`**; the route
serves it with `FileResponse` and deletes it in a `BackgroundTask` after the
response is sent.

One endpoint, `mode ∈ {"modelling", "full"}`:

- **`modelling` (default)** — MApper's own storage only: DSM systems,
  archetypes and BOMs, cohort mappings, AESA configuration, parameter table,
  pLCA registry. The archive still carries the project *folder* (with only
  `__mapper__` inside) so the importer's `roots[0]` finds it — same layout as a
  full archive, minus the bw2 payload.
- **`full`** — everything. Marked as carrying licensed content in the manifest
  **and in the filename** (`.full-LICENSED.mapperproj.tar.gz`), because a
  recipient reads the filename first and this archive is not redistributable.

Modelling-only is the default for two independent reasons: a full archive
bundles licensed ecoinvent content the recipient is not entitled to, and it is
the one that OOMs.

### The manifest records database NAMES, not a version string

`database_inventory()` writes per-database **link counts** taken from the
archetypes' `ecoinvent_activity.database`, plus the installed database list
split into base and premise.

A version string is not actionable, because resolution is by
`(database, code)`: **"ecoinvent 3.10 cutoff" will not match a link stored
against `ecoinvent-3.10-cutoff`.** Counting links per name also shows which
databases the project actually depends on rather than which happen to be
installed.

**Premise databases are listed separately** (`installed_premise`,
`premise_count`) because a recipient cannot obtain them by licensing
ecoinvent — they are derived by running premise against an IAM scenario, and
must be regenerated rather than acquired.

### Acceptance

The round trip that caught the id-reminting problem in #37: export
modelling-only, install under a NEW name, and require that the archetypes and
their BOM trees are present **and a cohort mapping still RESOLVES** against
them. Id equality alone passes while every pointer dangles, which is exactly
how the WP5 mapping broke.

**Composed archetypes are checked the same way.** Composition landed after this
export was designed, and an `ArchetypeInclude` is an ARCHETYPE ID — the same
class of pointer. So the round trip also requires that `includes` survive with
ids verbatim, that the referenced id lands on a real archetype in the imported
project, that the include quantity is intact (losing it silently rescales the
child's whole subtree), and — the strongest form — that the imported tree still
**splices**: resolving the reference must reproduce the child's rows at the
include's scaling.

#### What NOT to do

- **Don't buffer an export in memory.** Stream to a temp file and let the route
  clean up. `test_export_returns_a_path_not_bytes` asserts on the function
  BODY, not its docstring — the docstring explains the fix and mentions
  `BytesIO`.
- **Don't make `full` the default.** Unshareable and it OOMs.
- **Don't record only an ecoinvent version.** Resolution is by
  `(database, code)`; names with counts are what a recipient can act on.
- **Don't fold premise databases into the ecoinvent list.** Licensing ecoinvent
  does not obtain them.
- **Don't treat a modelling-only archive as truncated on import.** It carries
  no bw2 payload by design; the recipient supplies their own licensed
  databases.

## Renaming a project, and the registries that never prune

Brightway has no rename. `bw2data.projects` exposes `copy_project` /
`delete_project` / `set_current` and nothing else, and its project directory is
named after a hash of the project name, so there is no directory to move either.
`rename_project` (`mapper/core/bw2_wrapper.py`) is therefore copy-then-delete,
reusing the machinery the duplicate and delete paths already have:
`duplicate_project` (bw2 copy + `copy_project_storage`, ids verbatim), then
`delete_project` + `delete_project_storage`.

**Copy first, delete second.** The copy is the step that can fail — disk space,
or two names that sanitise to one storage directory — and doing it before the
delete means a failure leaves the original completely intact. The window in
between is a project that exists under both names; a crash there loses nothing.
Reversing the order turns a failed rename into data loss.

### The registries never prune — this is the fifth appearance

`hydrate_from_disk()` merges with `.update()`. Every earlier appearance of that
was benign because nothing had been removed: demo/load, duplicate and import all
ADD a project. **Rename is the first operation that MOVES storage**, so the old
name keeps answering out of the nine project-keyed in-memory registries until
the app restarts — and a rename that silently leaves the old project working is
worse than one that fails outright.

`_prune_registries(project)` in `mapper/api/databases.py` drops the key from all
nine: `bom._archetypes`, `bom._cohort_mappings`, `bom._dsm_lca_results`,
`dsm._systems`, `dsm._states`, `dsm._results`, `dsm._multi_results`,
`subsystems._subsystems`, `subsystems._subsystem_results`. It lives in the API
layer, not in `mapper/core/project_storage.py`, because core must not import
from `mapper.api` (the same one-way rule the cancellation convention follows).
Order at the route is **prune, then rehydrate** — the other way round, the
rehydrate's merge just sits alongside the stale entries.

Delete does the same, for the same reason: the storage is gone but the key
survives, and it becomes live data the moment a project is created under that
name again.

### `_rehydrate_after_storage_write` also has to reload parameter tables

`hydrate_from_disk()` does NOT cover `parameters._tables` — `main.py` hydrates
that separately at startup via `install_parameters`. This was a latent data-loss
path on the duplicate and import routes, not just rename: `_table_for` does
`_tables.setdefault(project, ParameterTable())`, so an unloaded project does not
read its file, it gets an **empty table**, and the next parameter write persists
that empty table over the real one. `install_parameters` clears before it
updates, so calling it is a full reload that both adds the new key and drops the
stale one.

### UI

Rename is a `'rename'` mode on `ProjectSwitcher`'s existing `InlineForm` — the
same inline pattern already behind "New project" and "Duplicate current",
prefilled with the current name. **Not `window.prompt`**: it is a no-op in
WKWebView, so the packaged desktop app would silently do nothing.

#### What NOT to do

- **Don't implement rename as anything other than copy-then-delete, and don't
  reverse the order.** There is no `projects.rename` to find; check
  `bw2data.projects`' surface before assuming otherwise. Copy-first is what
  makes a failure non-destructive.
- **Don't add a route that moves or removes a project's storage without
  pruning the registries.** Adding storage only needs the rehydrate; moving or
  removing it needs the prune as well. `test_project_rename.py` pins this from
  both directions, including the negative
  (`test_hydrate_alone_does_not_retire_the_old_name`) so the prune cannot be
  deleted as redundant while `hydrate_from_disk` still merges.
- **Don't re-mint ids on a rename.** Every registry is `dict[project][id]` and
  every path is `{project}/…`, so ids are already namespaced; cohort mappings
  reference archetype ids and AESA configs reference DSM system ids, and
  re-keying orphans them exactly the way a re-import once orphaned the WP5
  mapping.
- **Don't drop the `install_parameters` call from the rehydrate** on the
  grounds that `hydrate_from_disk` "already reloads everything". It does not
  touch parameter tables, and the failure is silent and destructive.
- **Don't reach for `window.prompt` for any rename in this app.** WKWebView
  ignores it. Standard input events only.

## Truncated lists must be reachable

A list that shows the first N and closes with a plain `…and M more` caption
strands M items with no way to see them. The import panel
(`pages/LCAManager.tsx`) did this twice — warnings at 10, archetypes at 8 — and
`ValidationReportPanel` carried a third copy that was unreachable **code**: its
`…and N more` sat inside a `{open && …}` branch and was itself guarded by
`{!open && …}`, so it could never render.

**Expand in place on click** is the convention, matching the two in-app
precedents: `ValidationReportPanel`'s `GroupRow` (chevron header, expands to the
full affected-row list) and `SimulationWarningsPanel` (collapse with a persistent
count). Not "scroll the panel with everything present" — that keeps 14
repetitive lines pushing the actual content off screen.

**The truncation was frontend-only.** Nothing in `bom.py` caps the warnings
list, so the displayed count was accurate and expanding the UI genuinely reaches
more data. Check which side truncates before designing the fix: if the backend
capped it, an expand control would be a lie.

### Splitting informational warnings from real ones

Import warnings are a flat `string[]` with no severity field — the same shape
problem as the DSM simulation warnings. A parameterised BOM emits one
`Quantity '…' stored as expression; resolved at pipeline time.` per row, so a
dozen benign lines bury `parent '…' not found; attached to stage root instead`.

`isInformationalImportWarning` (exported from `LCAManager.tsx`) matches on the
**emitted suffix** of that one format string, not the whole sentence: the row
number varies and the expression is user data. Real warnings render always;
informational ones collapse behind a count that expands. That keeps the
`SimulationWarningsPanel` rule ("don't default a warnings panel to collapsed —
warnings signal data problems") intact, because nothing that signals a problem
is hidden.

The durable fix remains a structured `{severity, message}` shape from the
backend; when that lands, read the field instead of pattern-matching.

#### What NOT to do

- **Don't ship a `…and N more` caption that is not a control.** Either make it
  clickable or don't truncate.
- **Don't classify by position (`warnings[0]`) or by matching a whole
  sentence.** Reordering breaks the first; rephrasing breaks the second. Match
  the stable part of the format string.
- **Don't treat an unrecognised warning as informational.** Anything that does
  not match is surfaced by default — a warning type added later must not be
  silently collapsed out of sight.
- **Don't collapse the real warnings too** to make the panel shorter. The
  reason the informational class can be collapsed is precisely that the real
  ones stay visible.

## Client-server project state desync — `X-Mapper-Project` guard (Patch X1+++)

The user's "lost WP5" bug was a **project-state desync**: the
backend's `bw2data.projects.current` was `default` while the
frontend UI was labelled `MAp-test`. `POST /api/dsm/systems` read
`_current_project()` → `default` → persisted the new "Wind farm"
system into `default/` instead of `MAp-test/`. The user thought
they were creating Wind farm in MAp-test; from their view, it
looked like MAp-test had **lost** WP5 (the dropdown was filtered
to `default`'s systems).

**Root cause class**: any write endpoint that reads
`_current_project()` / `get_current_project()` for storage scope
is vulnerable. Backend restarts reset bw2's active project to
its default; frontend's `currentProject` (no persist middleware)
re-syncs separately via `fetchProjects()` on App-mount. There's
a window — and a category of UI flows after restart — where the
two diverge silently.

**Fix shape**: the frontend sends an `X-Mapper-Project` header on
every request, indicating which project it thinks it's on. The
backend's `verify_project_state` dependency (in
`mapper/api/project_guard.py`) compares against
`get_current_project()` and **409s** with a structured
`project_state_mismatch` detail on disagreement. The frontend
catches 409 via `configureProjectGuard()` (wired in `App.tsx`)
and triggers a `fetchProjects()` re-sync.

**Header semantics**:
- Absent / empty → **no validation**. Backward compat for curl,
  tests, and non-browser clients.
- Present + matches `get_current_project()` → handler proceeds.
- Present + mismatched → 409 with:
  ```json
  {
    "detail": {
      "error": "project_state_mismatch",
      "message": "Project state mismatch: client expects 'MAp-test' but backend is on 'default'. Refresh the page or switch projects.",
      "expected_project": "MAp-test",
      "current_project": "default"
    }
  }
  ```

**Endpoints guarded** (Patch X1+++): all **create** endpoints —
the highest-risk class because their outputs have no preexisting
linkage to a project:

- `POST /api/dsm/systems`
- `POST /api/aesa/configurations`
- `POST /api/aesa/sessions`
- `POST /api/parameters/table/scenarios`
- `POST /api/parameters/import`
- `POST /api/bom/archetypes`
- `POST /api/bom/archetypes/import`

**Endpoints intentionally NOT guarded**: per-system writes that
take a `{system_id}` path parameter. These self-protect because
`_get_system()` raises 404 if the id isn't in the bw2-current
project's `_systems` dict — the mismatch surfaces as a 404
rather than misrouting. Adding the guard would just convert one
404 path into a 409, with no extra correctness benefit.

### What NOT to do

- **Don't trust client-displayed project state to match backend
  bw2 state silently.** Backend restarts reset
  `bw2data.projects.current` to bw2's default; frontend state
  may re-sync at a different time. Any write endpoint that reads
  `_current_project()` for scope MUST be guarded by
  `Depends(verify_project_state)` (when present, validates the
  `X-Mapper-Project` header) — silent misrouting causes
  invisible data loss.
- **Don't rely on `fetchProjects()` running only on App-mount
  to keep state synced.** A backend restart mid-session doesn't
  trigger a frontend reload, so the frontend's `currentProject`
  can be stale for an arbitrary duration. The 409 guard is the
  load-bearing reconciliation point — it fires on the first
  mismatched write and triggers `fetchProjects()` then. If a
  future patch adds long-poll / SSE / WebSocket backend
  notifications, the project-state channel should also push
  re-sync events on restart, but the 409 path is the
  always-safe fallback.
- **Don't skip the header on file-upload endpoints.** FormData
  bodies bypass `request()`; `uploadFile()` in `api/client.ts`
  has its own `_withProjectHeader()` call. Any new direct
  `fetch()` against the API must also include the header (or
  route through `request()` / `uploadFile()`). Otherwise the
  guard is silently bypassed for those paths.
- **Don't add the guard to GET endpoints.** GETs from the
  stale frontend should still load the wrong-project data
  (otherwise the page can't render and the user can't see WHY
  they're mismatched). The guard is for **writes** only —
  silent reads of wrong-project data are recoverable just by
  switching projects; silent writes are not.
- **Don't return the 409 with a plain string detail.** The
  structured `project_state_mismatch` shape is the contract
  the frontend's `client.ts` keys off (`body.includes(...)`).
  Future patches that need to add more diagnostic context can
  extend the dict; the `error` field must remain
  `project_state_mismatch`.
- **Don't drop the header-absent free pass.** Tests, curl
  debugging, and any third-party scripts hitting the API
  shouldn't be forced to plumb the header through. The guard
  is opt-in from the client side (browser apps opt in by
  setting up `configureProjectGuard`); backend default is
  permissive.
- **When the user reports "data disappeared", check
  `bw2data.projects.current` BEFORE assuming data loss.** This
  bug looked like a critical data loss event in the bug report
  but turned out to be 100% recoverable just by switching the
  backend's bw2 project. The disk had everything; the in-memory
  view was just scoped to the wrong project. The diagnostic
  sequence in this patch's bug report (inspect disk → list
  endpoint → live `/api/projects` → compare) is the template
  for any future "lost system / lost archetype / lost config"
  report.

## Chart expand pattern — `<ChartExpandModal>` (Patch 4AL)

Grid-of-charts views (Impact Assessment by-cohort, future AESA
Radar / Material Flows / etc. adopters) render small chart facets
at overview size. Patch 4AL adds an **expand-to-detail-view**
affordance: each facet renders a small `Maximize2` icon in its
top-right corner; clicking it opens a portaled modal with the
chart at full size for detailed inspection.

**Component**: `<ChartExpandModal>` in
`src/components/ui/ChartExpandModal.tsx`. Pure composition —
takes `isOpen`, `onClose`, `title`, optional `actions` slot
(for export / format / auto-fit toggles), and `children` (the
chart itself). Portals to `document.body` per the Patch 4X
stacking-context discipline. Backdrop click + Escape + close
button all dismiss.

**First consumer**: `<MultiScenarioImpactChart>`'s
`<FacetedView>` for Impact Assessment "Impact over time, by
cohort (per scenario)". The SVG-based facet grid is wrapped in
an absolutely-positioned HTML overlay layer that renders one
expand button per facet, positioned via the same grid math
(col/row → percent of container) so the buttons follow the SVG's
responsive scaling.

**Y-axis behavior**:
- **Default**: same Y-axis range as the grid (`yMax` from the
  shared scenarios max). Preserves cross-scenario visual
  comparison — a user mentally calibrated to the grid carries
  that calibration into the expanded view.
- **Auto-fit toggle** (modal header `actions` slot): when on,
  recomputes `yMax` from JUST that scenario's data, revealing
  more detail within that scenario but breaking
  cross-scenario comparability. Default off.

**Pattern reuse**: future grid views (AESA Radar, Material
Flows, single-product LCA stage breakdown, etc.) should adopt
`<ChartExpandModal>` rather than re-implementing the chrome.
The modal owns no chart logic — only the chrome, portaling,
dismissal handlers, and slot for actions. The parent grid owns:
(a) which facet is expanded, (b) how to re-render the chart at
full size, (c) what auto-fit / format / export options to
expose in the actions slot.

**Patch 4AL+ — full single-scenario affordances inside the
modal.** Patch 4AL shipped the modal with auto-fit-Y-axis
toggle only; the expanded chart was the same hand-drawn
`<Facet>` SVG rendered at larger size, which deliberately
omitted tooltip / legend / export. Patch 4AL+ replaced the
modal body with `<ExpandedCohortChart>` —  a Recharts-based
component that mirrors the canonical single-scenario by-cohort
view (`ProjectedImpactPanel.tsx`) exactly:

- **Export button** via the existing `<ChartExportButton>` (Patch
  4K legend extraction pipeline). Mounts inside the chart's own
  header alongside the format control + auto-fit toggle, NOT in
  the modal's actions slot. Filename pattern
  `{filenameBase}_facet_{scenario_label}` keeps the scenario
  identifiable in the user's downloads folder.
- **Legend** below the chart, one entry per cohort key, swatch
  colors resolved via the SAME color path the chart fills use
  (the `colorForCohort` callback passed in). Patch 4AJ per-dim
  overrides → propagate to legend swatches because both read
  from `cohortColorMap` (which `useChartColors` populates with
  user overrides). Full cohort list — no top-N truncation; if
  the modal grows tall, the modal body scrolls.
- **Tooltip** via the shared `<StackedTotalTooltip>` (same
  component the single-scenario view uses) — hover shows per-
  cohort contributor values + Total row at the hovered year.

The auto-fit-Y-axis toggle moved from the modal's actions slot
into the chart's `extraHeader` slot, grouped with format +
export for coherent "chart-display controls" placement.

**Color resolution invariant**: chart fills, legend swatches,
and tooltip swatches MUST all read from the same source. In
`<ExpandedCohortChart>`, the parent passes a single
`colorForCohort(cohortKey, fallbackIdx) => string` callback;
the component uses it for Area `stroke`/`fill` AND legend
swatch `backgroundColor`. The Recharts Tooltip inherits Area
colors via dataKey, so swatch consistency follows. Any future
patch that adds a fourth color-rendering surface (legend
export pipeline, screenshot watermark, etc.) MUST route
through the same callback.

### What NOT to do

- **Don't make the entire chart area clickable to trigger
  expand.** Conflicts with hover tooltips, legend interactions,
  data-point hover, and any other chart-native gestures
  (selection brushes, zoom controls). Use an explicit expand
  icon affordance in the header / corner.
- **Don't change the Y-axis range in the expanded view by
  default.** Users carry their visual calibration from the
  grid; auto-fitting breaks cross-scenario comparability and
  invites misreading ("scenario A is twice scenario B" when
  they're not — the auto-fit just rescaled). If detail-view
  auto-fit is needed, expose it as an explicit user toggle in
  the modal's actions slot.
- **Don't duplicate `<ChartExpandModal>` logic per grid
  context.** The chrome (portal, backdrop, Esc handler, close
  button, title bar, actions slot) is identical across grids.
  Extract once, reuse. Future grid-of-charts views should
  consume the shared component; copying it creates drift the
  first time someone updates one copy but not the other.
- **Don't skip portaling for expand modals.** Per the Patch 4X
  precedent: stacking contexts from `position: sticky`
  (AESA sidebar), `transform`, etc., trap z-index. Even
  `z-index: 9999` can't escape its parent stacking context.
  Always portal to `document.body`.
- **Don't co-locate the expand button with the SVG's title
  text.** The button needs to be HTML (for icon rendering,
  accessibility tooltip, click handler ergonomics). Wrap the
  SVG-based grid in a relatively-positioned container and
  render an absolutely-positioned HTML overlay with the
  buttons, positioned via percent-of-container so the overlay
  follows the SVG's responsive scaling. Putting the button as
  an SVG `<g>` element with a click handler works but requires
  reimplementing icon rendering, accessible labels, and
  hover-state styling that lucide-react + CSS give you for free.
- **Don't conditionally mount the modal's children when isOpen
  toggles.** Render the chart fresh each time the modal opens —
  the modal subtree is short-lived and chart-local state
  (hover, format setting in the actions slot) is expected to
  reset on each open. This is opposite to the visibility-toggle
  pattern for long-lived tab panels (where conditional mount
  kills `useState` you want preserved); short-lived modals are
  the right place for conditional mount.
- **Don't add expand to charts that aren't part of a grid.** A
  single-chart view at full panel width already IS the
  detailed view — there's nothing to expand to. The pattern
  exists to scale from grid-overview to single-chart-detail;
  applying it to charts that are already detail-sized adds a
  redundant control that does nothing useful.
- **Don't invent new chart affordance patterns inside the expand
  modal.** When the same chart type already exists as a
  single-scenario view elsewhere in the app (Impact Assessment's
  by-cohort single-scenario chart is the canonical source), the
  expanded modal MUST mirror it: same export button via
  `<ChartExportButton>`, same tooltip component
  (`<StackedTotalTooltip>` for stacked-area), same legend layout,
  same color resolution path. Don't reach for a new tooltip
  shape, a custom legend layout, or a parallel export
  implementation — users carry their mental model from the
  single-scenario view into the modal and any divergence reads
  as inconsistency.
- **Don't reach for a parallel color resolution path inside the
  expand modal.** All chart-rendering surfaces (Area fills,
  legend swatches, tooltip swatches) must read from the SAME
  `colorForCohort` callback that the grid uses, so per-dim
  (Patch 4AJ) and per-row (Patch 4AK) overrides propagate
  uniformly. The 4AL+ invariant test
  (`chartExpandModalAffordances.test.tsx::legend swatches use
  the same colors as the chart cohortColorMap`) locks this in —
  if a future patch routes legend colors through a different
  lookup, the test breaks.
- **Don't bolt the expanded chart's affordances into the
  existing `<Facet>` SVG via conditional props.** Patch 4AL+
  considered adding `expanded?: boolean` to toggle legend +
  tooltip + export rendering inside `<Facet>`, but `<Facet>`
  is hand-drawn SVG (paths + ticks) while the affordances need
  Recharts (Tooltip hit-detection, ResponsiveContainer). Two
  rendering models in one component splits maintenance
  attention. Use a separate component
  (`<ExpandedCohortChart>`) for the expanded path; the grid's
  `<Facet>` stays minimal for overview density.

## Monte Carlo uncertainty propagation (single-product)

`POST /lca/monte-carlo`, task-registry + WebSocket + per-iteration cancellation.
Sidebar position 7 ("Uncertainty"). The methodology lives in
`mapper/core/monte_carlo_engine.py`; read its module docstring before changing
`mapper/api/monte_carlo.py`.

**Entry point is a handoff, not a form.** "Run uncertainty" on the
Single-product Static results card writes a `MonteCarloHandoff`
(archetype, methods, scope, stage amounts, sensitivity case, database) into
`useMonteCarloStore` and navigates. Arriving from a result must never require
re-specifying anything. Opening the tab directly with no handoff shows guidance
pointing back at Impact Assessment, not an empty form. The handoff does NOT
auto-run — a minute of compute is the user's call.

**What samples what.** `bw2calc.MonteCarloLCA` resamples the technosphere,
biosphere AND characterisation factors, so the background is free. It does NOT
touch the foreground, structurally: MApper writes no foreground database, so an
archetype is a demand VECTOR over ecoinvent activities, not entries in A. The
foreground enters by resampling the demand per iteration
(`mc.demand = …; mc.build_demand_array(); next(mc)`), measured at ~1%.

**ORDER OF OPERATIONS PER ITERATION — the part that must not be got wrong:**

1. draw each PARAMETER once
2. re-resolve every expression against those draws
3. apply per-row uncertainty to LITERAL rows only

Step 1 before 2 keeps a shared driver correlated. `d_annual` appears in many WP5
expressions; drawing those rows independently averages the driver away and
NARROWS the reported spread. Measured on real data with the same sigma:
**GSD² 1.2219 with uncertainty on the parameters vs 1.0189 with it on the
expression rows** — the spread nearly vanishes. (Originally measured as
1.2170 vs 1.0185 under the pre-2026-08-31 `exp(1.96σ)`; see *One GSD²* below.) Under-reporting uncertainty is
the one direction that cannot be defended in a paper.

Step 3's "literal rows only" is the same rule from the other side, and it is
ENFORCED (`UncertaintyConfigError`, a 400), not documented. Row factors are keyed
by `node_id` and applied DURING demand construction, before aggregation —
several rows can link one ecoinvent code, and scaling the aggregated entry would
leak one row's draw onto its neighbours.

**Pedigree constants (`mapper/core/pedigree.py`).** Brightway ships no pedigree
table — "pedigree" appears in exactly two files in the whole installed stack,
both ecospold2 readers, and neither computes anything: ecoinvent applied the
matrix upstream and `bw2io` just reads `varianceWithPedigreeUncertainty`. So
MApper must ship its own, and they must be the ones ecoinvent used. Recovered by
least squares over 35,844 exchanges carrying both `scale` and `scale without
pedigree` (R² = 0.987, max deviation 0.02) → the **classic
Weidema/Frischknecht** table, NOT the Ciroth et al. 2016 revision. Convention:

    sigma_i^2 = [ln(f_i) / 2]^2      # the factor is a 95% RANGE, hence the /2
    sigma_total^2 = sigma_basic^2 + SUM_i sigma_i^2

Dropping the `/2` inflates every factor by ~30% and the output stays plausible.
The recovery pass was run once without it and reported the entire table as a
mismatch before the convention was spotted. Pinned by
`test_pedigree.py::test_the_half_is_load_bearing`.

**A median ABOVE the deterministic score is EXPECTED — do not "fix" it.**
Measured 1.10x–1.55x across 16 indicators on PHEV-NMC811. It is not a sampling
defect: `loc == ln(|amount|)` exactly for every ecoinvent exchange checked (so
each exchange's median IS the deterministic amount), and a bare ecoinvent
activity with no MApper involvement shows the same offset — 1.001x for a short
supply chain, 1.142x for a long one. Aggregating lognormals up a supply chain
pulls the total above the sum of medians, and the offset grows with depth. The
UI therefore flags only ratios **< 0.9 or > 2.0**; flagging the ordinary offset
would cry wolf on every run. A median BELOW the deterministic score is the shape
that actually indicates a problem.

**Performance.** `MonteCarloLCA` solves with CGS warm-started from the previous
iteration, so it does NOT refactorise: **75.3 s for 1000 iterations x 16
indicators** on PHEV-NMC811 (0.075 s/iter). `DirectSolvingMonteCarloLCA`
refactorises every time — 1.76 s/iter, ~30 min for the same run — for
numerically identical answers (same seed, 60 iterations, max relative difference
9.4e-8). Extra indicators are ~0.2 ms each: one solved inventory, one CF dot
product per method. Foreground parameter uncertainty adds ~8% (re-resolve +
re-flatten per iteration). 1000 iterations sits at 0.18% drift on the
percentiles vs a 1200-iteration reference.

**Per-method CF sampling, two traps.** `load_lcia_data()` reads
`self.method_filepath`, NOT `self.method` — assigning `mc.method = m` and
reloading silently returns the ORIGINAL method's factors, which produced sixteen
identical distributions on the first end-to-end run. `switch_method` is the call
that recomputes the filepath. And `switch_method` replaces `cf_params` while the
chain's `cf_rng` still holds the previous method's array, so the chain must be
switched back and its `cf_rng` rebuilt before any iteration. Characterisation is
diagonal, so a score is a dot product of sampled factors with per-flow inventory
totals — every method gets its own sampled CFs, rather than one being sampled
and the rest held fixed.

**The lower bound is stated in the UI, not only here.** ~12% of ecoinvent's
non-production exchanges carry undefined uncertainty and are sampled as fixed
(88% lognormal with pedigree retained, 0.2% normal), so any reported spread is a
LOWER BOUND. `mc-lower-bound-note` says so on every result, and also says when
no foreground input is scored at all.

### One GSD², and a second number that is not one

**GSD² means `exp(2σ)` everywhere.** Input and output, backend and frontend,
UI and workbook. It is not a preference and not a rounding of 1.96:

- it is what makes `gsd2_from_sigma(ln(f)/2) == f` exact for a published
  pedigree factor `f`, which is the whole reason `pedigree.py` carries the `/2`;
- it is **ecoinvent's own convention**, recoverable from the shipped data. On an
  exchange with one non-default pedigree score,
  `scale² − scale_without_pedigree²` implies a σ for which `exp(2σ)` reproduces
  the published factor and `exp(1.96σ)` does not (completeness=2: variance
  0.000100 → σ 0.01000 → `exp(2σ)` **1.0202** vs published **1.02**;
  `exp(1.96σ)` gives 1.0198). ecoinvent stores no GSD² field at all — only
  `loc` and `scale` — so the convention has to be matched, not read.

A MApper GSD² that meant something else from ecoinvent's would be the trap,
whichever constant is mathematically defensible.

**`dispersion_95 = p97.5 / median` is the separate, exact figure.** Read
straight off the percentiles, assuming nothing about the shape. GSD² is the
lognormal approximation to it, and they genuinely differ: on a true lognormal
`dispersion_95` lands on `exp(1.96σ̂)` (−0.4 %), but on a **sum** of lognormals —
which every real run is — it departs by +2.9 % at three terms and +8.5 % at six,
and by **+6.6 %** on the real B0 run.

**What was wrong, and it was wrong twice over.** `summarize` reported
`exp(1.96σ̂)` under the name `gsd2` while seven other sites used `exp(2σ)`. That
number was **neither statistic**: not GSD² (its label), and not the dispersion
either, because the samples are not lognormal — and the figure it approximated
was already two fields away in the same dict. The two agree to ~1 % at ordinary
spreads, which is why nothing surfaced it.

#### MIGRATION — exports made before 2026-08-31

Any workbook or screenshot produced before this change reports `exp(1.96σ̂)` in a
column headed `GSD2`. **Convert rather than re-run:**

> **GSD² = reported ^ (2 / 1.96) = reported ^ 1.020408**

Always upward: +0.20 % at 1.10, +0.37 % at 1.20, +0.64 % at 1.37, +0.83 % at
1.50, +1.43 % at 2.00, +2.27 % at 3.00. At MApper's usual range (GSD² ≈ 1.2–1.5)
the correction is **0.4–0.8 %**, inside Monte Carlo noise at 1000 iterations — so
no conclusion drawn from a pre-change export changes, and the workbook itself now
carries this formula on its Distributions sheet.

The six figures quoted in this file and the three in schema docstrings are
restated at `exp(2σ)` **with the originals kept visible**, for the same reason
the `0.1499` B0 note keeps its original: a re-measured figure stops being
evidence of what the patch that produced it fixed.

#### What NOT to do

- **Don't introduce a second constant.** `tests/test_gsd2_one_definition.py`
  sweeps both source trees — AST for Python (so a docstring may NAME `exp(1.96σ)`
  while arithmetic may not), a string-stripped regex for TS — and asserts
  `summarize` on exactly-lognormal draws returns `exp(2σ)`. Reverting the
  constant fails four of its cases. It also asserts it would have caught the
  line that shipped, so it cannot go vacuous.
- **Don't rename `exp(1.96σ̂)` instead of replacing it.** "95 % dispersion
  factor" is the right name for `p97.5 / median` and the wrong name for a
  lognormal-fit estimate that misses it by 6.6 %. Renaming would have preserved
  a number that is neither thing.
- **Don't print a bare `GSD2` header again.** Every surface states the formula:
  `GSD2 = exp(2*sigma)` and `95% dispersion factor = p97.5 / median` in the
  workbook headers, `title` tooltips on the UI table, and the definition beside
  the number in `PedigreeEditor`. The bare label is what let the two travel
  under one name.
- **Don't restate the approximation as the definition.** `exp(2σ)` IS the GSD²;
  "the 95 % range is roughly ÷/× this" is a consequence with 2 standing in for
  1.96. `pedigree.gsd2_from_sigma`'s docstring said both as one sentence, and
  that sentence is the shape of the original mistake.

**Both new fields are additive optionals** — `BOMNode.uncertainty` and
`Parameter.uncertainty`, `None` by default, legacy data deserialising as `None`,
untagged rows provably unaffected (`sigma_of(None) == 0.0`). Same precedent as
`MaterialEvolution` and `global_levers`. `FlattenedMaterial` carries
`quantity_expression` and `uncertainty` too, because the expression-row rule is
enforced on the FLATTENED list — see below.

**Stats are shared with AESA.** `boxStats` moved from `BoxPlotView` into
`src/utils/boxStats.ts`; both tabs import it. Two quantile functions that
disagree at the interpolation boundary would put identical data in visibly
different boxes on two tabs.

### What NOT to do

- **Never `DirectSolvingMonteCarloLCA`.** It looks like the more rigorous
  choice to anyone who does not know the iterative solver is warm-started here.
  27x slower, identical numbers. `test_uses_the_warm_started_iterative_solver`
  is AST-based, not a grep, because the docstring names the class in order to
  explain why it is not used.
- **Never let an expression row carry its own `uncertainty`.** It inherits from
  its parameters; carrying its own too means either double-drawing the shared
  driver or replacing it with independent draws, and BOTH mis-state the spread.
  Rejected with a 400, not resolved by precedence — either precedence rule
  produces a plausible-looking wrong number.
- **Don't add a field to `BOMNode` for Monte Carlo without carrying it through
  BOTH flatten paths.** `flatten_bom` and `flatten_root_with_amounts` are
  separate implementations. `quantity_expression` was added to the first only,
  and the expression-row guard then read `None` on every real row and never
  fired — while a BOMNode-based unit test stayed green. The test now builds
  `FlattenedMaterial`, which is what the call site actually passes.
- **Don't scale an aggregated demand entry by a row factor.** Key by `node_id`
  and apply before aggregation; several rows can share one ecoinvent code.
- **Don't flag the ordinary median-above-deterministic offset as an error.** It
  is a property of ecoinvent + lognormal aggregation, reproducible on a bare
  activity. Flag `< 0.9` or `> 2.0`.
- **Fleet-level Monte Carlo is out of scope.** 78x the cost (26 years x 3
  scopes) and the DSM contributes its own uncertainty axis — a modelling
  question, not a sampling one. `test_dsm_path_never_reaches_monte_carlo` sweeps
  both directions, in the same family as the parameter-resolution and
  stage-basis guards.
- **Don't clear the result when the Monte Carlo tab mounts.** The tab is
  navigated away from and back to; clearing on mount discards a finished
  75-second run every time the user returns. Reset only when the handoff KEY
  actually changes.


### Pedigree scoring — two surfaces, one table

The scoring half of the Monte Carlo feature. Two routes, because the two things
being scored have very different cardinality: **44 parameters** (in-app) and
**914 literal BOM rows across 28 archetypes** (Excel).

**Parameters — in-app, and this is where the variance lives.** Expanding a row
in the parameter table editor shows the keyframe editor AND a pedigree editor.
A scored parameter carries a `σ` badge on the collapsed row, next to the
time-varying clock, so it is visible without expanding. This is the
high-value surface: measured, uncertainty on the parameters gives GSD² 1.2219
where the same sigma on the expression rows gives 1.0189 (originally 1.2170 /
1.0185 under `exp(1.96σ)`).

**BOM rows — six Excel columns, read at import.** `Pedigree Reliability`,
`… Completeness`, `… Temporal`, `… Geographical`, `… Technological`, plus
`Basic Variance`. Six columns rather than one packed string so a spreadsheet
can sort, filter and fill-down them individually — which is the entire reason
the bulk route is Excel and not the UI. They round-trip on export, following
the `Basis` precedent, so an in-app edit is not wiped by a re-import.

There is also a per-row in-app override (`BOMNodeUpdate.uncertainty`, with
`"unset"` to clear, exactly like `basis`), for the one-off correction that
should not require a re-import.

**ONE table, served — the UI holds no copy.** `GET /lca/pedigree` serves
`mapper.core.pedigree`'s indicators, factors and default basic variance, and
the editor computes its live GSD² preview from that payload and nothing else. A
hard-coded copy in the frontend would drift the moment either side was edited,
and the drift would be invisible because both copies would keep producing
plausible GSD² values. `pedigreeEditor.test.tsx` serves a deliberately WRONG
table and asserts the editor follows it, which is what proves there is no local
constant.

The composition rule (`σ² = σ_basic² + Σ [ln(fᵢ)/2]²`) IS duplicated in
`utils/pedigree.ts` — three lines, pinned on both sides, and a round-trip per
keystroke to preview a number is not worth it. Both sides assert the same four
reference values so they cannot drift apart silently.

**A single score round-trips to its own published factor**: with one indicator
scored and zero basic variance, `GSD² == f` exactly, because `exp(2·ln(f)/2) =
f`. A clean check that the `/2` in the variance and the `exp(2σ)` in the GSD²
are exact inverses — drop either and it stops holding.

**Adding the surfaces changed no number.** Verified on real data across the two
commits: deterministic scores for 6 WP5 archetypes × 3 indicators, plus a
seeded 120-iteration Monte Carlo, dumped and diffed — **byte-identical, same
sha256**. An unscored row and an unscored parameter contribute no foreground
variance, exactly as before.

#### What NOT to do

- **Don't hard-code the pedigree factors in the frontend.** Fetch them from
  `GET /lca/pedigree`. Two tables drift silently because both keep producing
  plausible numbers; there is no symptom until someone compares a foreground
  score against a background exchange.
- **Don't record a score of 1.** It adds no uncertainty, so storing it only
  makes an unscored row LOOK scored in the UI and in the export. Both the
  import and the editor drop it.
- **Don't export a 0 for an unscored row.** It would import back as an
  out-of-range score and warn on every row. Blank round-trips to unscored.
- **Don't use `col(row, name) or ""` for a NUMERIC workbook column.** A literal
  `0` is falsy, so that idiom reads an out-of-range zero as a blank cell and
  drops it silently instead of warning. The text columns can use the short form
  because there `""` and `None` mean the same thing; the pedigree columns use
  `col(row, name, "")`.
- **The expression rule is enforced at THREE boundaries, and all three are
  needed.** Compute (400, from the engine), import (a warning, and the scores
  are dropped), and the per-row PATCH route (400). Import-time matters because
  silently accepting the scores would leave the user with a workbook whose
  whole point fails only when they press Run. The UI must not OFFER the field
  on an expression row either — `PedigreeEditor` renders a `disabledReason`
  instead of the picker, and a test asserts the score buttons are absent.
- **Don't let a bad score drop the row.** An invalid pedigree cell warns and
  leaves the row unscored; the quantity, link and everything else survive.


#### Score by material NAME — the primary surface

WP5 has 914 literal BOM rows but only **148 distinct names** (a name recurs
across ~6 archetypes), so the scoring job is 148 entries, not 914. The Material
scoring table on the Uncertainty tab is that list; scoring "Steel frame" once
covers the 21 rows that use it.

Resolution order per row: the row's **own** `uncertainty` (Excel column or
in-app override) → the **material-name library** → **unscored**, contributing
no foreground variance exactly as before.

**AN AUTHORING CONVENIENCE, NOT A SAMPLING CHANGE — and say so, because after
the expression-row finding the opposite assumption is reasonable.** Inheriting
a score is exactly equivalent to typing the same scores onto the row.
`collect_row_draws` keys every draw by `node_id`, never by name, so two rows
sharing a name get two INDEPENDENT draws. A shared PARAMETER genuinely is a
shared driver (drawing per-row instead collapsed GSD² 1.2219 → 1.0189,
originally 1.2170 → 1.0185); a
shared NAME is two separate quantities that happen to be equally well known.
In practice the distinction barely arises inside one archetype — measured
**1.007 rows per name** across WP5, with only `Fuel Station` repeating a name
at all — but the guarantee comes from the `node_id` keying, not from that
statistic. Locked by `test_inheritance_shares_the_SCORE_not_the_DRAW` and
`test_a_shared_name_does_NOT_behave_like_a_shared_parameter`, both verified
load-bearing by re-keying draws to the name.

If a fleet-level Monte Carlo ever needs a shared name to imply a shared draw —
across archetypes it plausibly should, since it IS the same material dataset —
that is a deliberate methodological change with its own measurement, not
something to slip in by keying draws differently.

**Coverage is impact-weighted, and that is the point.**
`GET /lca/material-pedigree/coverage` returns both figures; the banner leads
with the weighted one:

    47 of 148 materials scored — covering 82% of this archetype's GWP100

A row count reports how much clicking has been done. The impact-weighted share
reports how much of the ANSWER rests on assessed data — which is where the next
hour of scoring is worth spending, and what makes a reported GSD² legible
rather than implied. Measured on BEV-LFP: scoring the top **5** names of 148
covers **55%** of its GWP100. The banner also names the biggest unscored
contributors, and the table sorts by that share so the costly ones are first.
Expression rows are excluded from the denominator — they cannot be scored, so
counting them would understate coverage and point the user at a row they cannot
fix.

**Storage** is `dsm/{project}/material_pedigree.json` — a FILE inside an
existing root, for the reasons in `project_settings_storage`: carried by
duplicate / rename / export / import with zero changes to
`project_storage.py`, whereas a new root could be silently DROPPED from an
archive by an older build. A missing or corrupt file reads as an EMPTY
library: unscored is the safe reading because it changes no number.

**Still byte-identical with nothing scored** — the same sha256 as the
pre-Monte-Carlo baseline, re-verified after the library landed.

##### What NOT to do

- **Don't key a Monte Carlo draw by material name.** Score-sharing and
  draw-sharing are different things, and conflating them silently widens every
  reported spread. Draws are keyed by `node_id`.
- **Don't give an expression row a library score.** It inherits from the
  parameters in its expression; a name-based score would reintroduce exactly
  the double-draw the expression rule bans. `collect_row_draws` skips
  expression rows before consulting the library.
- **Don't report coverage as a row count alone.** "47 of 148 scored" says
  nothing about whether those 47 matter. The weighted share is the headline;
  the count is context.
- **Don't ship a blanket project-level default pedigree.** It was measured and
  rejected: applying one to every row moved BEV-LFP's total GSD² by only
  0.4–8.3% (1.2230 → 1.2274–1.3267, originally 1.2181 → 1.2224–1.3192 under
  `exp(1.96σ)`; the percentage is unchanged), because independent per-row draws average
  away. It manufactures a number without adding information, and a reader
  cannot tell an assessed 1.24 from a ticked-checkbox 1.24. Scoring 148 names
  is the real answer.


### Reading a single sensitivity case (Single-product Static)

**The case tab bar already switches the stage breakdown.** `activeScenario`
drives `activeResult`, and `activeResult` drives BOTH the stacked
`<StageBreakdownChart>` and the indicators table, so clicking a case in
`single-product-static-scenario-tabs` re-renders both with that case's numbers.
This was believed unreachable and is not; verified by render probe (Base
5.00e+2, sa_early 9.00e+2 on the same chart) and pinned by
`tests/singleProductCaseReadout.test.tsx`. Do NOT add a second case selector.

The three views read the same computed results differently and none replaces
another: the stacked chart is one case in stage detail, the sensitivity
range/tornado is all cases as totals, the table is one case per indicator.

**What was missing was provenance, not the switch.** The chart and table showed
a case's numbers without saying WHICH case, so an exported image or a
screenshot was indistinguishable from Base. Now: a mono badge beside the
"Stage breakdown" heading (`stage-breakdown-case`), the case appended to the
export filename, and a `Sensitivity case` column on the table matching the
Excel export's header. All three render only when more than Base ran, so a
single-case run is byte-identical to before.

**Inert cases can reach the tab bar, by one route only.** `effectiveCases`
filters to `varyingCases(...)` BEFORE a run, so an inert case can never be
selected into a run. It becomes reachable when the user runs a case and THEN
edits the parameter table so it stops varying: the results are still on screen
and the tab is now inert. That is the state the marking exists for, and the
state the test constructs. Marking derives from the same `varyingCases` the
checklist uses, so the two can't disagree.

#### The Stage breakdown chart's Export button is BROKEN (pre-existing)

`exportChart` does `findChartSvg(container)` and throws
`No <svg> found inside chart container` when there is none.
`<StageBreakdownChart>` is a **proportional div stack** — zero `<svg>` elements
— and `<ChartExportContainer>` is a plain `<div>`, so its export button throws
in production. The lucide icons in the button row are SVGs but sit OUTSIDE the
ref'd container.

Fixing it means rendering the bars as SVG (with the credit hatch becoming an
SVG `<pattern>` rather than a `repeating-linear-gradient`), which changes how
the chart draws on screen. Deliberately NOT done alongside a provenance change
whose brief said not to change the default view. The case label is in the
filename and the badge regardless, so it will be carried the moment the export
works.

#### What NOT to do

- **Don't add a case selector to Single-product Static.** One exists. Look for
  `ScenarioTabBar` before concluding a per-case view is unreachable.
- **Don't render the case badge or the table column for a single-case run.**
  Both gate on `isMulti`, so the default view is untouched.
- **Don't derive "inert" independently of the checklist.** Both call
  `varyingCases(paramTable)`; a second derivation would drift.
- **Don't assume a chart with a ChartExportButton has a working export.** The
  button renders regardless; `findChartSvg` decides at click time. A div-based
  chart needs an SVG rendition before its export means anything.


### Chart export resolution is OPT-IN, not largest-by-area

`findChartSvg` returns the `<svg>` matching
`svg.recharts-surface, svg[data-chart-export-target]` and nothing else.
Recharts marks its own surface, so Recharts-based charts need no action;
anything hand-drawn opts in with `CHART_EXPORT_ATTR`.

**Why the old rule was dangerous.** It took the LARGEST `<svg>` in the
container, so a container holding no chart still returned something if it held
any icon: the Contribution supply tree is indented `<div>`s plus lucide
chevrons, and its export silently wrote a **12px chevron** to disk as the
user's contribution tree. A file nobody would necessarily open and check.

**Why opt-in rather than a size threshold.** A threshold ("ignore anything
under 32×32") was the other candidate and lost on two counts. It fails by
GUESSING — a decorative graphic or logo dropped into a chart card silently
becomes the export, and nobody finds out until a figure looks wrong — where
the marker fails by THROWING, on the first click. And it depends on layout
measurement, so it cannot be tested: jsdom reports every rect as 0×0, which is
why this function had no test for its entire life. The selector rule is pure
DOM, so the behaviour is now checkable, including the supply-tree regression.

The cost is that a NEW hand-drawn chart must add the attribute, and forgetting
it produces a loud immediate error rather than a wrong file. That is the
intended trade.

**Marked today**: AESA `RadarView` + `BoxPlotView`, the three
`UncertaintyCharts`, `MultiScenarioImpactChart`'s faceted view, `SankeyChart`.
NOT marked, deliberately: `TimelineView`'s three 14px legend swatches (its
chart is Recharts), `ConfigSidebar`'s preview and `FlowSankey` (no export
button).

### Div-based charts export as raster

Four charts draw with positioned `<div>`s and have no vector source:
**Stage breakdown**, **Sensitivity range/tornado**, **Multi-item sensitivity**
(both views), **Contribution supply tree**. They pass `rasterOnly` to
`<ChartExportButton>`, which hides SVG and PDF from the menu, and
`exportChart` falls through to `exportContainerAsRaster` (html2canvas,
dynamically imported so the ~200 KB stays out of the initial bundle).

`html2canvas` is now a DIRECT dependency. It was already present transitively
via jspdf; relying on that would break silently the day jspdf drops it.

**Stage breakdown is raster by decision, not by omission.** Rendering it as
SVG would mean turning the credit hatch from a CSS `repeating-linear-gradient`
into an SVG `<pattern>` — re-rendering something that shipped in #43, on the
one chart where a hatch silently reverting to solid would read as a burden
rather than a credit. A working PNG beats a vector figure carrying that risk.
If it is ever needed as vector for a paper figure, that is its own change with
the hatch verified.

**The error string names an action, not a precondition**: "This chart can't be
exported as SVG or PDF. Try PNG." The old text named `findChartSvg`'s internal
requirement and told the user nothing to do.

**Multi-scenario impact hides its export button when every series is hidden** —
the container holds only the empty-state placeholder, so there is nothing to
export.

#### What NOT to do

- **Don't restore largest-by-area, or add a size heuristic beside the
  selector.** Either reintroduces silent wrong-file exports. Locked by
  `tests/chartExportResolution.test.tsx`, verified load-bearing (restoring the
  old rule fails 3 tests).
- **Don't add a hand-drawn chart export without `data-chart-export-target`.**
  It will throw on first click. The coverage guard in the same file fails CI
  for a chart that is neither svg-based nor `rasterOnly`.
- **Don't mark a legend swatch or an icon.** The marker means "this is THE
  chart". `TimelineView`'s swatches are deliberately unmarked.
- **Don't offer a vector format on a div-based chart.** `rasterOnly` hides
  them; letting someone pick SVG and get an error is the behaviour being
  removed.


### Every worker-launching route needs a test that REACHES the launch

Written here twice as prose and walked into twice, most recently as a 500 on
every `POST /lca/monte-carlo` that shipped to a packaged build. It is now a
test: `tests/test_worker_launch_coverage.py`.

**The bug shape.** A worker route validates, then launches. Tests that only
exercise the 4xx paths -- missing methods, bad iteration count, unknown id --
all return BEFORE the launch, so the launch line is never executed and a wiring
error there is invisible. That is exactly how `run_in_thread(work)` (wrong
arity for that helper, which is `run_in_thread(task, fn, *args)` and calls
`fn(task, ...)`) reached a build: the sampling was tested directly and
correctly, the wiring was never run.

**Coverage is MEASURED, not read.** The guard discovers launch sites by AST,
then runs the suite in a subprocess with `threading.Thread.start`
instrumented; a site counts as covered only if it appears in a real call
stack. Two things that broke a naive version of this probe, both worth
remembering:

- **Walk the FULL stack, not the innermost frame.** A `run_in_thread` caller
  sits several frames up, so innermost-frame attribution credits
  `core/tasks.py` and loses the route.
- **anyio's threadpool is not one of ours.** `await file.read()` in an upload
  route starts threads; matching on any mapper frame attributed those to
  `subsystems.py`, which launches no worker at all. Match against the
  discovered launch LINES.

**Three categories, and the third was learned in CI.** Covered:
`monte_carlo.py:post_monte_carlo` and `impact.py:post_calculate`.
`ENV_DEPENDENT` holds `lca.py:start_multi_year_contribution`, which is covered
locally but whose tests SKIP without a technosphere database -- so from CI, the
environment that gates merges, it reads as uncovered. The guard passed locally
and failed in CI on exactly that, which is why the category exists.
`KNOWN_UNCOVERED` declares the six real gaps with a reason each.

**`impact.py:post_calculate` is covered deliberately and needs no bw2.** Every
Sustainability Ratio comes through it and it is the same shape as the route
that shipped dead. Its gates -- system, simulation, cohort mapping, methods,
archetype validation, unlinked materials -- are all satisfiable in memory,
because the LCA happens INSIDE the worker. A test that needed real databases
would skip in CI, which is the hole `ENV_DEPENDENT` documents.

**Spy on `Thread.start` by calling THROUGH, never by stubbing.** `TestClient`
runs the ASGI app on its own portal thread; replacing `start` with something
that does not start deadlocks `client.post`, which waits forever for a portal
that never ran. Calling through is also safe for these workers -- they catch
every exception and mark the task errored, so they fail fast on fake ecoinvent
links.

**Seed registries under the ACTUAL current project.** `dsm`, `bom` and
`impact` each resolve the project through their own helper, so a fake name
patched into one leaves `_get_system` looking elsewhere and the route 404s
before reaching anything worth testing.

A declared gap that later gains coverage must be REMOVED from the list --
`test_declared_gaps_are_still_gaps` fails naming it, so the list cannot rot
into a set of permanent exemptions.

#### What NOT to do

- **Don't add a worker-launching route without a test that reaches the
  launch.** The guard fails, naming the route. Declaring it in
  `KNOWN_UNCOVERED` is allowed but needs the reason written down.
- **Don't assert a route is covered by reading its tests.** That is what let
  this through twice. The probe measures.
- **Don't use `core.tasks.run_in_thread` for a route that owns its own
  WS-oriented `_TaskState`.** It drives a `core.tasks.Task`
  (status/finish/fail) and calls `fn(task, ...)`. `plca`, `impact` and
  `monte_carlo` all start a plain daemon thread instead.

### Clear `__pycache__` before a PyInstaller freeze

A standing step in DESKTOP.md, because the failure is invisible. Python treats
a `.pyc` as fresh when the source's `(mtime, size)` match what the `.pyc`
recorded. A version bump from `0.1.8` to `0.2.0` leaves the size IDENTICAL,
and a merge or branch switch can write the source inside the same second the
`.pyc` was written.

That combination occurred on 2026-08-29: `inspect.getsource` showed
`return "0.2.0"` while the executing bytecode returned `0.1.8`, and two
version tests failed locally while CI (a fresh checkout, no cache) stayed
green. No source change was needed -- the code was right throughout.

    ( cd mapper-backend && find . -name '__pycache__' -type d -prune -exec rm -rf {} + )

**A frozen build that picks up stale bytecode reports a version nothing in the
tree contains**, which is the kind of thing that surfaces months later against
a released artefact.


### Monte Carlo Excel export

`POST /lca/monte-carlo/export`. Routed through the shared helpers, not a
private builder: `build_export_filename(archetype_name, [], "MC")` for the one
filename scheme and `excel_response(..., kind="data")` so the demo stamping is
by construction rather than by remembering.

**Domain token `MC`**, alongside `LCA` / `pLCA` / `AESA` / `DSM` / `MFA`. Added
to `ExportDomain` on the frontend and to the SHARED `PARITY_FIXTURES` on both
sides, so the two filename implementations cannot drift on the new token.
Single-product has no DSM system, so the ARCHETYPE takes the system slot and
there is never a subsystem segment.

**Five sheets.** Summary (configuration, scoring provenance, seed, caveat),
Distributions (per indicator, with the deterministic score and the
median/deterministic ratio beside it), Variance contribution, Pedigree scores,
Samples.

**The seed is in the workbook twice** -- Summary and beside every indicator on
Distributions -- because a Monte Carlo result nobody can reproduce is not a
research output, and one sheet should be enough to reproduce it.

**`ScoredInput` is captured at RUN time, not resolved at export time.** The
material library and the parameter table are both editable, so resolving later
would describe the CURRENT scores and silently mis-describe the run -- the
opposite of what a reproducibility record is for. Each entry carries the six
indicator values, the basic variance, the resulting GSD² and whether the row
inherited from the material library or carried its own score.

**Summary states the LOWER BOUND** -- ~12% of ecoinvent's technosphere
exchanges carry no distribution and are sampled as fixed -- and says so when
NOTHING was scored, because a background-only run is a real but partial result
that the numbers alone do not distinguish.

**Impact-weighted coverage is in the Summary**, with a line saying it is
weighted by impact and not row count. A distribution is not interpretable
without knowing what share of the foreground carried uncertainty. `coverage`
is optional on the request; when absent the sheet SAYS it was not recorded
rather than omitting the row.

**Samples writes a NOTE sheet when draws were not retained, never omits it.**
An absent sheet is ambiguous with "this build does not produce one", and a
reader comparing two workbooks could not tell which. Ragged sample lengths pad
with blanks rather than truncating to the shortest.

#### What NOT to do

- **Don't write a new builder or a new filename scheme.** Every Excel export
  goes through `build_export_filename` + `excel_response`; that is what makes
  the demo warning impossible to forget.
- **Don't resolve pedigree scores at export time.** Capture them on the result
  at run time; the library and the parameter table move underneath.
- **Don't omit the Samples sheet.** Write the note.
- **Don't drop the seed** from either place it appears.
- **Don't add a domain token to one side only.** `ExportDomain`, both
  `PARITY_FIXTURES` sets, or the two filename implementations drift silently.

### The material-scoring table says what it cannot reach

An expression row inherits its uncertainty from the parameters in its
expression and can never carry its own score, so it is not listed in the
material table. On a heavily parameterised project that leaves the table nearly
empty while the whole model's uncertainty lives in the parameter editor, and a
bare short list gives no hint why.

`GET /lca/material-pedigree/materials` therefore returns a
`MaterialScoringScope` -- the names PLUS `expression_rows`,
`expression_names`, `literal_rows`, `archetypes` -- so the UI states the
project's ACTUAL numbers rather than a generic sentence. The two real projects
read as opposites, which is the point:

- **Battery Circularity**: 2 scoreable materials, 140 expression rows. The
  note also says the table is *not where this project's uncertainty lives* and
  links to the parameter editor.
- **MAp-test**: 148 scoreable materials, 38 expression rows. Same note, no
  such warning, because here the table IS the right place.

The extra warning fires on `expression_rows > literal_rows`; when
`expression_rows == 0` the note does not render at all.

**`impact_share` is `float | None`, and `None` is not 0%.** `None` means the
archetype has NO scoreable rows -- every row is a parameter expression -- and
the banner says "Nothing scoreable in this archetype", explicitly adding that
this is not 0% coverage. A zero percentage tells the user they are missing
something fixable; on `A - Circular EV` (0 literal rows of 43) there is nothing
on that table to fix.

**The names walk is SPLICED, and shared with coverage.** Both derive from
`_project_scoring_scope()`, so the count and the impact-weighted denominator
cannot be computed over different row sets. Coverage was already spliced (it
comes from `_build_archetype_source_demand`); the list was not.

**Honest scope of that splice: project-wide totals do NOT change.** An
`ArchetypeInclude` references an archetype id, so every child is itself a
registered archetype and its materials were already counted on their own pass.
A first version of the tests asserted otherwise and PASSED with the splice
removed -- vacuous for exactly that reason. What the splice fixes is
per-archetype reach (`_spliced_roots`) and the shared derivation; the guard
that bites is `test_count_and_coverage_use_the_SAME_spliced_row_set`, which
fails if coverage re-derives its own walk.

A dangling include degrades to the archetype's own rows rather than 500-ing --
compute reports the broken reference loudly, and this endpoint should not take
the whole list down with it.

#### What NOT to do

- **Don't list expression rows in the material table.** They cannot carry a
  score; listing them offers a control that does nothing.
- **Don't render 0% when `impact_share` is null.** They mean different things
  and the difference is the whole point of the field being nullable.
- **Don't let coverage re-derive the project name set.** One walk, or the two
  drift on a composed archetype.
- **Don't claim the splice changes project-wide counts.** It does not, and a
  test asserting that it does will pass with the splice removed.


### Multi-item uncertainty is PAIRED, and only paired

One sampled world per iteration, every item solved against it. There is no
independent mode and no toggle, because the alternative exists only to produce
the wrong answer.

**Measured on Battery Circularity**, where A and A0 share 23 parameters and
ALL 27 ecoinvent activities (identical activity sets, differing only in
quantities):

| | paired | independent |
|---|---|---|
| corr(A, A0) | 0.9860 | −0.0258 |
| sd(A−A0) | 0.00117 | 0.00797 — 6.8× wider |
| 95% CI | [−0.0160, −0.0112] | [−0.0288, **+0.0024**] |
| P(A < A0) | **100.0%** | 95.0% |

The independent interval CROSSES ZERO: it reports "not distinguishable" where
the paired run says A is lower in every iteration. An opposite conclusion, not
a wider error bar. Same correlation error the expression-row rule prevents, one
level up.

**Paired is also CHEAPER**, because sampling the matrices is the expensive part
and it happens once per iteration rather than once per item: 59 s for one item
per 1000 iterations, then ~39 s per additional item (4 items = 176 s, 1.34×
cheaper than four independent runs). That formula IS the picker's estimate --
`estimatePairedSeconds` in `client.ts`.

**ONE seed for the whole job.** It defines the shared draw sequence every item
is solved against, so a per-item seed would decorrelate them and undo the
pairing. `MonteCarloMultiRequest` has no `seeds` field and no mode field;
`test_no_sampling_mode_toggle_exists` guards both.

**Pairing alters only the JOINT distribution**, and that is asserted rather
than assumed. The RNG sequence depends only on the seed, not on which demand
consumes it, so item i sees the same sampled worlds as a single-item run at the
same seed. Measured: item 0 is **bit-identical** (max relative difference
0.000e+00); later items agree to **2.3e-05**, not bit-exactly, because
`MonteCarloLCA` warm-starts CGS from the previous solve and in a paired run
that previous solve is a different item. CGS converges to the same answer
within tolerance, so the residual is solver noise, not a distribution change.
`test_the_measured_residual_is_solver_noise_not_a_distribution_change` records
the number to compare against.

**The CF draw belongs to the ITERATION, not the item.** Every item is
characterised with the same sampled factors; drawing per item would reacquire
exactly the decorrelation pairing removes.

**Correlation is reported as INFORMATION, not a warning.** A weakly correlated
pair gives a genuinely wide difference and that is correct; the correlation
tells the reader where the precision comes from. The UI says "little shared
structure, so this difference is genuinely wide" -- never "unreliable".

**Cancellation stops the whole job.** One task id, and the check sits at the
iteration boundary BEFORE any item is solved, so a stop never leaves some items
with i draws and others with i−1.
`test_cancellation_is_checked_at_the_ITERATION_boundary` pins the ordering.

**Export**: `Item` column beside `Sensitivity case` on Distributions, matching
how every other multi-axis export carries its discriminator, and pairwise
differences on their OWN sheet -- they are the headline of a paired run, not an
annotation, and one row per (pair × indicator) does not fit beside one row per
(item × indicator).

#### What NOT to do

- **Don't add an independent-sampling option.** It exists only to produce the
  wrong answer; the measurement above is why.
- **Don't seed per item.** One seed governs the shared sequence.
- **Don't draw characterisation factors per item.** Per iteration, shared.
- **Don't sort the box plot or the pairwise table by value.** Comparison order,
  so the reader's mental ordering carries across.
- **Don't present correlation as a caveat.** It explains the width; it does not
  undermine it.
- **Don't claim paired marginals are bit-identical for every item.** Item 0 is;
  later items agree to solver tolerance because of the CGS warm start.


## Future Extension: Product Systems (deferred to v1.1)

Product systems — a bag of archetypes with multipliers, drag-drop builder in LCA Architect, cross-tab integration into Impact Assessment Single product mode — was considered for v1.0 but deferred. Reasoning: archetypes already serve as product systems for the load-bearing research questions in MApper's domain (vehicle archetypes, charging infrastructure, wind farm components). Multi-archetype bundling is a sufficient-but-not-necessary feature for v1.0 — current users handle bundling via post-hoc summation of separate archetype results. Revisit for v1.1 if real user demand surfaces post-distribution.

Pre-work decisions for eventual implementation (preserved so a future thread doesn't re-litigate):

- **Interpretation**: bag of archetypes with multipliers (count semantics), not functional-unit normalization.
- **Storage**: new SQLite table or file format, JSON-serializable.
- **Compute**: separate backend endpoint (`/lca/calculate-product-system`); result shape includes per-component + per-stage breakdown.
- **UI**: segmented picker (Archetype / Product System) in Impact Assessment Single product mode; drag-drop tab in LCA Architect.
- **Import/export**: JSON with archetype references by ID; missing archetypes fail with a clear error.
- **Naming**: keep the existing "Single-product LCA" tab name in LCA Architect. The workshop-vs-canonical distinction between LCA Architect's calculator and Impact Assessment's Single product mode is meaningful as-is. Any "LCIA Calculator" rename is an independent decision — not bundled with product systems.

## Future Extension: Fixed Prospective LCI mode

Possible feature, not currently planned: a third Impact Assessment mode that computes cohorts against a **single** prospective database applied uniformly across all years (not year-matched). Distinct from both Static (base ecoinvent only) and Projected (year-matched per cohort year).

Use case: comparing what the fleet would look like if every cohort were produced under one specific future technology mix, regardless of actual production year. The other two modes don't express this — Static collapses to today's tech, Projected always varies tech by year.

Surface this only if a user requests it. Redefining Static or Projected to support it would be more confusing than adding a third mode. Implementation seam: extend `ImpactAssessmentRequest.mode` enum to `'static' | 'projected' | 'fixed_prospective'` and add a `fixed_prospective_db: str` field.

## Future Extension: Product-Based AESA

Currently AESA computes Sustainability Ratios from system-level Impact Assessment results
(DSM × archetypes × pLCA pipeline). A planned future extension is product-based AESA —
applying the same framework to Single-product LCA results.

### Architectural seams already in place

1. **Result type discriminator** — both `ContributionAnalysisResult` (`result_type =
   "single_product"`) and `ImpactAssessmentResult` (`result_type = "system_level"`)
   carry a `result_type` field. Future AESA endpoints can dispatch on this to apply
   different downscaling chains.

2. **Stable persistable serialization** — `ContributionAnalysisResult.to_persistable_dict()`
   produces a session-independent shape (`computed_at`, `mapper_version`, full method
   tuple, `compute_database`, `target_label`, score + unit). Stored product-level
   results stay meaningful 6+ months later, in a different MApper version, without
   the original session context — also good practice for paper reproducibility.

3. **Prospective database is a first-class field** — `ContributionAnalysisRequest.compute_database`
   and `ContributionAnalysisResult.compute_database` make the database the result was
   computed against explicit on every product-level result. Product-level AESA must
   include this in its cache key (the same product against `ecoinvent-3.10-cutoff` vs.
   `..._premise_remind_ssp2-pkbudg1150_2030` produces different SRs).

4. **AESA sharing presets are pluggable** — the existing N-layer chain editor can
   accommodate new preset families. A future "Product-based" preset family will define
   different default downscaling logic (per functional unit, per global market production
   volume, etc.) without modifying the chain math.

### Methodological notes for the future implementer

- Product-level SR requires a different default downscaling chain than fleet-level.
  System-level: country × sector × company. Product-level: per functional unit OR
  global market share OR product category SOS.
- A user applying a system-level preset to a product-level impact will get meaningless
  SRs. The AESA endpoint should detect mismatches and either refuse the computation,
  auto-suggest the appropriate preset family, or show a clear warning.
- Cache keys for AESA results must include `result_type` to avoid serving system-level
  cached SRs to a product-level query (or vice versa).

### What NOT to do when implementing

- Don't bolt product-level support onto the existing system-level AESA endpoint via
  conditionals. Add a sibling endpoint or a clean dispatcher.
- Don't break backward compatibility of the existing "Ferhati 2026 Multi-D" preset.
- Don't auto-mix product-level and system-level results in a single AESA computation.
