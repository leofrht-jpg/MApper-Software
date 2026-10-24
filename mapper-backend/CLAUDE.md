# MApper backend: conventions and gotchas

> Moved out of the root CLAUDE.md. Loads when working under mapper-backend/.

## Logging

- Backend writes a rotating log file at `{platform user-log dir}/mapper/mapper.log` (1 MB × 3 rotations).
- Format: `[YYYY-MM-DD HH:MM:SS] [LEVEL] [module] message`
- Unhandled exceptions are routed through `logging` (both `sys.excepthook` and a FastAPI `@app.exception_handler(Exception)`).
- Frontend captures uncaught errors (`window.onerror`, `onunhandledrejection`, React `ErrorBoundary`) and non-2xx `fetch()` responses into a Zustand `logStore` (last 50 entries).
- Users view combined frontend + backend logs under Settings → Logs (filter, copy, export to `.txt`).
  Both of those buttons were broken in the packaged app; see below.

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
  404. **A 404 is NOT proof the task finished**: callers whose task is still
  running say Stop did not reach it and offer Stop again, and only the task's
  own terminal frame ends the run (`CANCEL_NOT_FOUND_MESSAGE`).
- **The route lived at `/api/api/tasks/{id}/cancel` until 0.3.1** (`tasks.py`
  had `prefix="/api/tasks"` under main's `/api` mount), so every cancel was a
  404, read as "finished": every Stop button did nothing, silently, and the
  unit tests missed it because they called the handler directly.
  `tests/test_cancel_route_through_app.py` cancels a running task through
  `mapper.main.app` and fails on any route starting `/api/api`. Test a route
  through the app, not its handler.
- `<ComputeOverlay cancelling cancelError>`: after Stop the card says
  "Stopping" with a disabled button, never just loses the button; the panel
  then shows a stopped state (Monte Carlo `mc-cancelled`, Prospective
  `projected-stopped`).

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

### Neither Car Fleet total is a baseline (2026-09-02 vs 2026-09-04)

**Car Fleet's fleet-level GWP100 moved by more than the tailpipe relink
accounts for, and the residual is UNIDENTIFIED.** Do not treat either figure as
a reference.

| | |
|---|---|
| measured during the #65 station pass, 2026-09-02 | **136,077,173,549.18** kg CO2-eq |
| measured 2026-09-04 (static, scope=all, base scenario) | **241,761,757,901.48** kg CO2-eq |
| of the +105.68 Gt gap, the tailpipe relink explains | 36,338,956,529 (15.0 %) |
| **residual, cause unknown** | **~69.3 Gt** |

Ruled out, each by measurement rather than reasoning:

- **Archetypes.** All 24 non-station archetypes diff byte-identical against the
  2026-09-02 snapshot except the 12 tailpipe rows and the three chargers'
  e-waste activity code — and those two codes differ by 0.0035 kg CO2-eq/kg,
  immaterial.
- **DSM inputs.** `state.json` (initial stock, inflows, survival config) is
  unchanged since **2026-08-11**; `system.json` (year range, dimensions) since
  **2026-07-18**. The fleet configuration did not move.
- **Scenario.** Car Fleet has only `base`.
- **Scope.** all 241.76 / stock 170.76 / inflows 70.99 / outflows 0.009 Gt —
  they sum correctly and none is 136.08.
- **The station repair.** Infrastructure is 0.6 % of the Car Fleet total, and
  WP5 recomputed **bit-identical** (199517946180.3539, delta exactly 0) across
  that repair.

One near-miss, recorded as a hypothesis and NOT a conclusion: scope=stock minus
the tailpipe contribution is 134.42 Gt, 1.2 % under the 09-02 figure. Close, but
it does not land, and inventing a reconciliation from a 1.2 % gap is how a wrong
baseline gets adopted.

**WP5 is unaffected and remains verified** — it is the paper's system; Car Fleet
is not. The #65 station restoration is confirmed structurally (6/6 concrete and
asphalt links, 25 EoL waste-stream rows, the R134a row with its description,
Fuel Station scrap steel at 2250 kg), which is what actually establishes it.

#### What NOT to do

- **Don't quote either Car Fleet number as a before/after pair.** The 09-02
  figure predates an intended change (tailpipe) AND an unexplained one.
- **Don't reconcile the residual by picking the scope that comes closest.**
  Four scopes were measured; none matches, and the nearest is 1.2 % off.
- **Don't infer the DSM inputs drifted.** They are older than both figures.

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

### Two channels, not one: dependency rules resolve per year too

Parameters reach DSM output through **two** channels, and the scaling-rules fix
closed one. The second is **subsystem dependency-rule expressions**
(`compute_dependent_subsystem`), and it is the more exposed of the two: unlike
the scaling-rules editor (removed 2026-05-01), `DependencyRulesEditor.tsx` is
live in the UI.

Keyframes collapsed **twice** on the way in. `get_parameter_set` calls
`table.resolve_all(scenario)` with **no year**, so a time-varying parameter was
already flattened to its `base_value` before the engine existed; and
`ParameterEngine(pset.parameters)` is the legacy pre-resolved shape, which
ignores `year` outright. Passing the raw table closes both — `_table_kwargs`
in `subsystems.py` supplies it alongside `_build_engine`'s pre-resolved engine,
and `impact.py` / `bom.py` already held the table for their pipelines.

Same year distinction as the scaling-rules fix: the loop is per-year and
already injects `year` as an EXPRESSION variable, which is a different thing
from resolving a parameter's VALUE for that year. Only the second was broken.

**The reserved-name collision check runs ONCE, up front.** Parameter names do
not vary by year, so a per-year check would repeat the work and — worse — name
a year that has nothing to do with the collision. Pinned by a test asserting
the message contains no year.

**Live data shows the workaround.** MAp-test's `Fueling Infrastructure` rules
hand-roll their year dependence inline —
`filtered_stock * (0.60 - (year - 2025) * 0.006)` — which is exactly what a
keyframed parameter is for. Those trends are now expressible as parameters;
migrating them is optional and separate.

#### What NOT to do

- **Don't assume the scaling-rules fixture covers this.** It exercises
  `DSMScalingRule` through `DynamicStockModel` and never touches the subsystem
  path. Its LOOKING like it covered both is why this survived.
  `test_the_scaling_rules_fixture_does_NOT_cover_this_channel` pins the
  boundary and fails if that file grows a subsystem import — at which point
  say so THERE and delete the pin, rather than leaving two files each assuming
  the other covers it.
- **Don't hand a subsystem only a pre-resolved `ParameterSet`.** It has already
  lost the keyframes. The raw table is what carries them.
- **Don't move the collision check inside the per-year loop.**

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
## Nothing cleared the parameter registry between tests

`parameters._tables` is a module-level `dict[project -> ParameterTable]`, and
until `tests/conftest.py` existed **there was no conftest at all** — no
teardown, no autouse fixture, nothing. A table installed by test *n* was still
there for test *n+40*, so a fixture could name a sensitivity case it never
registered and another test's table would quietly satisfy it. Three did. The
full suite passed on all three locally; CI failed on one.

`tests/conftest.py` now clears that ONE registry on both setup and teardown.
Measured before landing: **zero breakage** (1357 passed), and **load-bearing** —
reverting one of the three fixture corrections is invisible without it (1357
passed) and caught with it.

**Twenty other module-level registries share the property** and are
deliberately NOT cleared: `bom._archetypes / _cohort_mappings /
_dsm_lca_results`, `dsm._systems / _states / _results / _multi_results`,
`subsystems._subsystems / _subsystem_results`, `project_settings._settings`,
`lca._lca_results / _contribution_cache`, the five task registries,
`tasks._events / _started_at`, `core.tasks._tasks`, `bw2_wrapper._distinct_cache`.
Clearing all twenty-one also breaks nothing but costs ~25 % suite time, and the
standalone sweep proves none is leaned on. (`material_pedigree_storage` is
disk-only and has no registry at all.)

Merge-vs-replace is a **production** distinction — it is why `_prune_registries`
exists — and NOT the one that matters here. `install_parameters` replaces,
`dsm.hydrate_from_disk` merges; no test calls either as teardown, so all
twenty-one leaked equally. The property is "nothing clears it".

### The per-file CI loop IS the standalone sweep

The Windows backend job already runs **one pytest process per test file** on
every push and PR. It was added as a native-library workaround (premise's GDAL
stack and openpyxl's libxml2 crash one interpreter), but it is structurally the
isolation sweep: fresh interpreter per file, no leakage possible, names the
failing file. It is what caught the third leaky fixture.

So the sweep is not a procedure someone has to remember — it runs. The risk is
that it gets collapsed into a single-process run as a tidy-up once the native
issue is fixed, silently retiring the guarantee with no test failing. The
comment now records BOTH reasons and `tests/test_ci_isolation_guard.py` asserts
the loop still exists. **If it goes red, the failing file is named, and that is
the signal to revisit clearing the other twenty.**

Ground truth as of this patch: all 123 test files pass standalone.

#### What NOT to do

- **Don't collapse the Windows per-file loop into a single-process run**, even
  if the native-library crash is fixed. The isolation reason stands on its own.
  The guard test fails if the loop, its body, or the documented isolation
  reason disappears.
- **Don't extend the conftest to the other twenty registries** without a
  measurement. It costs ~25 % suite time for no demonstrated benefit; the CI
  sweep is the cheaper answer and it names the file when it fires.
- **A full-suite green does not prove a fixture registers what it names.** Run
  the candidate files in isolation, one process each.

## Prospective link translation: only the BASE database translates

Two functions translate a BOM link to a prospective database, and they had
drifted apart:

| | probe target? | fall back? |
|---|---|---|
| `api/lca.py:_translate_demand_to_database` (single product) | yes | yes, + warning |
| `core/dsm_lca_engine.py:_rewrite_db` (fleet) | **no** | **no** |

The fleet version rewrote EVERY link's database to the premise anchor
unconditionally. It worked only because every BOM row pointed at base
ecoinvent and premise preserves codes. The first row linking a GENERATED
database took the whole prospective run down with
`ActivityDataset ... does not exist` — measured on MAp-test: **61 of 61
ecoinvent codes carry into the premise DB, 0 of 2 `mapper-tailpipe` codes do**.

**The decision now lives once**, in `core/prospective_links.resolve_link_db`,
called by both. They differ in SHAPE — one walks a demand dict, the other a
flattened material list — not in intent, so the iteration stayed separate and
only the rule moved. The third sibling-divergence in as many weeks; a third
copy is how the second one survived.

```
if not target_db or src_db == target_db:       keep
if base_db is not None and src_db != base_db:  keep, SILENTLY
if exists(target_db, code) is False:           keep, + WARNING
otherwise:                                     translate
```

**Pinning a non-base database is the correct model, not a fallback**, which is
why it does not warn. `mapper-tailpipe` holds only biosphere exchanges and no
technosphere inputs, so premise never generated a variant and there is nothing
in it premise could have changed — tailpipe CO2 per kg of fuel is combustion
stoichiometry, invariant to the electricity mix. A warning would fire on every
such row in every year and train people to ignore warnings.

**`exists()` returns `True | False | None`, and only a known `False` falls
back.** "Cannot tell" is not "absent": absence of the target DATABASE says
nothing about the CODE. The first implementation conflated them and broke 8
interpolation tests whose fixtures use synthetic database names — it pinned
every row instead of translating. Treating an unverifiable probe as absence
CHANGES NUMBERS rather than crashing, which is the worse failure.

`base_db` comes from the caller's declared base, falling back to the pLCA
registry (`base_db_for`) — the same registry `resolve_prospective_dbs` reads,
so the two cannot disagree about what a database's base is. `base_db=None`
deliberately degrades to the probe, so a caller that cannot say which base it
targets still gets the guarded behaviour rather than the crash.

**The fleet result has nowhere to put a warning.** `ImpactAssessmentResult` has
no `warnings` field (the single-product result does), so a fleet translation
warning is logged at WARNING level — reaching `mapper.log` and Settings → Logs
— and collected on the pipeline. Adding a field is a schema change with
frontend implications; it was left, deliberately.

**The fleet pipeline must actually KNOW its base (walkthrough 4).** The UI
never sets `ImpactAssessmentRequest.base_db` — the base travels inside each
`lci_scenarios` entry — and `_prospective_base_db()`'s registry fallback read
`prospective_dbs[0].get("name")` while `prospective_dbs` is a list of
`(name, year)` tuples. So the base was always `None`, rule 2 never applied, and
every system-level prospective run warned "mapper-tailpipe/… not found … fell
back" twice per anchor year for a pin that is correct. The route now passes
each scenario's own `base_db`, the fallback reads the tuple, and intentional
pins are summarised in ONE INFO line per run with the count
(`tests/test_prospective_tailpipe_pinning.py`). A base-db code that fails to
carry over still warns.

**premise disables loggers at import.** `premise/transformation.py` calls
`logging.config.dictConfig(...)` with the default
`disable_existing_loggers=True`, which silently disables every logger created
before it — `mapper.core.dsm_lca_engine` included, in a dev process. So a
missing log line is not proof a code path did not run. `configure_logging()`
calls `reenable_mapper_loggers()` after the routers (and premise) are imported;
locked by `test_premise_does_not_silence_mappers_own_loggers`.

#### What NOT to do

- **Don't rewrite a link's database without checking its SOURCE.** A BOM may
  link a generated or custom database that no premise run ever touched.
  `tests/test_parameter_resolution_never_gated.py` asserts both translators
  route through `resolve_link_db`; reverting either fails by name.
- **Don't treat "cannot probe" as "absent".** Only a positive `False` may fall
  back. The `None` branch is what keeps a run whose target database is merely
  unloaded computing the same numbers as before.
- **Don't warn when pinning a non-base database.** It is correct behaviour, and
  a warning that fires on every row of every year is a warning nobody reads.
- **Don't add a third copy of the rule.** Both callers keep their own
  iteration; the decision is shared.

## Prospective Monte Carlo is UNREACHABLE, and premise carries no uncertainty

Two facts that only matter together, so they are written together.

### No button hands a prospective result to Monte Carlo

`MonteCarloRequest.archetype_id` and `MonteCarloMultiRequest.archetype_ids` —
Monte Carlo is **archetype-scoped**. Tracing every entry point:

- **Single-product Static** → "Run uncertainty" passes `computeDatabase: null`,
  and that is CORRECT: Static is base-ecoinvent by definition.
- **Single-product Prospective** → has no "Run uncertainty" button at all.
- **Multi-item Archetypes** → `handleCompute` calls
  `compute({ scope, methods, cases })` and never passes `computeDatabase`, so
  the comparison itself runs against base ecoinvent (archetypes resolve through
  their BOM's ecoinvent links). The handoff's `computeDatabase: null` therefore
  MATCHES what was compared.
- **Multi-item Activities** → carries the premise vintages, and Monte Carlo
  cannot run there at all: an activities comparison has no archetype. The
  button is hidden for that reason (not a banner — see below).

**So the only route to a prospective Monte Carlo today is a direct API call**
with `compute_database` set. Nothing in the UI reaches it.

### When it becomes reachable, settle this FIRST

Measured on the frozen build, same archetype, 25 iterations, seed 9:

| background | GSD² |
|---|---|
| base ecoinvent | **1.1202** |
| premise remind/SSP2-PkBudg1150 2030 | **1.0004** |

A near-total collapse. Checking the exchanges directly (400 activities each):

| | base ecoinvent | premise 2030 |
|---|---|---|
| `uncertainty type` | 84.5 % lognormal (2) | **99.9 % undefined (0)** |
| `scale` usable (>0, not NaN) | **84.5 %** | **0 %** |
| `scale` = NaN | 0 % | **78.2 %** |

**The distributions are genuinely absent, not merely flagged off.** `scale` is
present as a KEY on 78 % of premise exchanges but its value is `NaN` — a
destroyed parameter, not a preserved one. (Watch for this: `nan is not None` is
True, so an `is not None` check reports these as present. It did, and the first
reading of this survey was wrong because of it.)

And the loss is **not confined to exchanges premise rewrote**. `clay brick
production` — which an IAM scenario has no reason to touch — is `ut=2,
scale=0.051` in base ecoinvent and `ut=0, scale=nan` in the premise copy. So
this is a property of how premise WRITES the database, not of which exchanges
it modifies. It is upstream behaviour; MApper only reads what premise wrote.

**Why this is worse than the ~12 % undefined-exchange caveat already
surfaced:** that caveat makes a reported spread a LOWER BOUND, and the UI says
so. Here the background contributes essentially NOTHING, so a prospective run
returns a near-zero spread that reads as *confidence* rather than as *missing
data*. A tight interval is the most persuasive possible presentation of an
absence.

**TRIGGER — this is testable, not asserted.** If a background selector is ever
added to multi-item Archetypes, or a "Run uncertainty" button to the
single-product Prospective panel, then a prospective Monte Carlo becomes
reachable from the UI and **this question must be settled before that ships**.
The check is the table above: re-run the exchange survey against the premise
database of the day. If `scale` is still 0 % usable, either the run must refuse,
or every prospective MC result must say in the UI that its background spread is
absent rather than small. Do not ship the selector and the caveat separately.

### `compute()`'s `computeDatabase` parameter is DEAD, deliberately kept

`useMultiProductLCAStore.compute` declares `computeDatabase?: string | null`
and threads it to `compute_database`, and **no caller passes it**. It is dead.

It stays. Deleting it removes the only trace in the code that this path was
expected to carry a background, and that expectation is exactly what the
trigger above is about. A future background selector wires into this parameter;
finding it already present, with this note, is the difference between
implementing a feature and rediscovering a design.

#### What NOT to do

- **Don't add a background selector to multi-item Archetypes without settling
  the premise-uncertainty question.** The selector is the trigger.
- **Don't read `computeDatabase: null` on a Monte Carlo handoff as a bug.** It
  matches what the comparison computed against on every path that has one.
- **Don't delete the dead parameter** to satisfy a linter.
- **Don't test for a NaN scale with `is not None`.** `nan is not None` is True,
  and it turned "0 % usable" into "78 % present" on the first pass here.

## The premise superstructure fallback is recorded, not gated

The audit asked for the fallback to be **opt-in** rather than merely visible,
on the principle that *"a run that silently computes against a different
database than requested is a different result"*. The principle is sound. This
instance does not match it, and the reasoning is written as a chain someone can
re-check rather than a conclusion to take on trust:

1. **The fallback fires only in the WRITE step.** `ndb.update()` — the
   expensive, methodologically load-bearing transformation — has already run
   and produced the per-year databases. Superstructure writes them as one DB
   plus an SDF; the fallback writes *the same content* as N per-year DBs.
2. **The result is honestly labelled.** It returns `mode="separate"` with the
   separate names. Nothing downstream is told it got a superstructure.
3. **`resolve_prospective_dbs` does `int(entry.get("year"))`.** Superstructure
   entries carry `year=None`, so they are rejected — **superstructure
   databases are not computable in MApper at all**. The vintage picker lists
   them disabled for the same reason.
4. **Therefore** the fallback yields the only format the compute pipeline can
   use, and an opt-in flag would ask the user to opt in to a *usable* result
   instead of an unusable one.

**Step 3 is the load-bearing link, and it is tested directly.** If
`resolve_prospective_dbs` ever learns to read a superstructure database with a
year slice — an SDF year-slice activation engine, say — then step 4 no longer
follows and the opt-in question is live again.
`test_the_reasoning_still_holds` and `test_a_superstructure_entry_is_actually_rejected`
both fail at that moment, so the trigger fires on its own rather than waiting
for someone to reconstruct the argument.

**What did change.** `fallback_warning` reached the task and the WS `done`
frame but nothing durable, so a dismissed toast left no trace. The registry
entry now carries `fallback: true`, and the pLCA database list shows a
`From superstructure fallback` sub-label in the slot that already renders
`Superstructure · N scenarios`.

**The badge is not a quality signal**, and its tooltip says so: the content is
identical, the fallback only changes how it was written, and per-year is the
form Impact Assessment can actually compute against.

#### What NOT to do

- **Don't add an opt-in flag without re-checking step 3.** If it still holds,
  the flag gates the only usable output.
- **Don't read the badge as "these databases are worse".** They are the same
  databases, written differently.
- **Don't set `fallback` on the superstructure branch.** A superstructure that
  SUCCEEDED is not a fallback; a test pins that the branch never sets it.
- **Don't default it to anything but `False`.** Every entry written before this
  — all 36 in MAp-test — has no key and must load unchanged.
## A weak, honest fingerprint of the databases and LCIA methods

`compute_database` is a mutable string, premise regenerates databases **in
place**, and the Method Library installs and uninstalls methods at runtime — so
a result named things that could point at different content than they did at
compute time, and nothing detected it.

**A full checksum is not viable, and the number is why: the MAp-test project
directory is 40.85 GB.** Even one database means materialising every exchange —
the `Database.load()` cost the multi-year performance notes already warn about.

**A weak fingerprint that detects the common case beats a strong one nobody can
compute.** Brightway already tracks everything needed, and reading it is free —
**0.02 ms for all 38 databases**, 0.010 ms for 16 EF methods. Both are dict
reads on metadata bw2 holds anyway; nothing is loaded.

| field | detects | misses |
|---|---|---|
| `modified` | **regeneration** — premise rewriting in place | **tampering**; it moves only when bw2 saves |
| `number` | a database swapped for a different one | any count-preserving edit |
| `num_cfs` | a method replaced by one with different coverage | a **count-preserving CF edit** |
| `abbreviation` | uninstall + reinstall (the Method Library case) | in-place factor edits |

**`abbreviation` is Brightway's persisted registration id, NOT a content
hash.** The trailing hex was checked against `md5(str(name))` and
`md5(" ".join(name))` — neither matches — and it is not documented as
content-derived, so it identifies a **registration**, not content. A test fails
if the module ever describes it otherwise.

**The limits note travels with the warning.** `LIMITS_NOTE` is appended to the
export's reproducibility block, because a reader of an exported file cannot see
the docstring, and *absence of a warning is not evidence the data is
unchanged*.

#### What NOT to do

- **Don't describe any of these as integrity or content verification.** They
  detect the ordinary ways a database or method moves under a stored result and
  nothing more. Overstating converts "we do not know" into a false assurance,
  which is worse than having no fingerprint.
- **Don't reach for a real checksum without measuring.** 40.85 GB.
- **Don't report an uninstalled name as a mismatch.** Absent from *this*
  project is not the same as changed — it is skipped at fingerprint time and
  reported as "not installed any more" only when it was present at compute
  time.
- **Don't let fingerprinting fail a compute.** Every read is guarded; an
  unreadable name is simply absent.

## Two content hashes: the authored BOM, and the parameter table

**Two, not one.** They change for different reasons and at different rates, so
separating them makes a change **attributable** rather than merely detectable —
the export names *which* moved, and "someone edited a parameter" is a different
investigation from "someone edited the BOM".

**Hash the AUTHORED content, never the resolved.** A BOM whose quantities are
expressions hashes the EXPRESSIONS. Hashing resolved values would move the BOM
hash every time a parameter moved, double-counting the parameter hash and
destroying exactly the attribution the split exists for.

**WARN on mismatch, never refuse.** The result is a true record of what was
computed; it just no longer reproduces from current state.

### A hash that moves on a cosmetic round trip is worse than no hash

It cries wolf until someone stops reading the warning. Everything below serves
that one property, and the test that proves it is
`test_export_then_merge_import_moves_NEITHER_hash` — export a project's
archetypes, re-import under merge, require both hashes unchanged. **Measured:
36 real archetypes across both projects, all 36 unchanged, none skipped.**
Verified load-bearing: hashing the node id fails it on both projects.

**Child DIGESTS are sorted, not children by a key.** A key-based sort leaves
ties — two siblings can share a name, a link and an expression while differing
in their SUBTREES — and Python's stable sort then falls back to authored order,
so a reorder would move the hash. Reordering children changes no result
(`flatten` sums), so it must not warn. A digest is a total order with no tie to
break, and it SUBSUMES the obvious key: it derives from name + link +
expression + quantity + subtree, so it is strictly more discriminating.

*(For the record, the key that prompted this: MAp-test's six duplicated names
in `Fuel Station` are all cross-parent — Diesel vs Petrol sub-assemblies — never
siblings, so name alone would collide zero times today. That is a property of
today's data, not a guarantee, and the failure mode is a nondeterministic sort
order producing a hash that flips between runs on identical content.)*

**Exclusions, each with a reason in `BOM_NODE_EXCLUDED`.** `id` is the critical
one: `assign_node_ids` fills only MISSING ids and the workbook parser builds
nodes without them, so a merge re-import mints a fresh uuid for every node.
Also excluded: `description` (nothing computes from it), `is_annual` (a UI
hint; only `basis` decides the multiplier), and `validation_status` /
`validation_message` (derived from bw2 state at upload, not authored).

**Canonicalisation, verified rather than assumed:** absent == null through
`model_dump()`; raw JSON `1` stays an int while Pydantic coerces to float, so
hashing the MODEL normalises it where hashing file bytes would not; `repr`
round-trips floats stably; **`-0.0` is the trap** — it survives a JSON round
trip, its `repr` differs from `0.0`, and `-0.0 == 0.0`, so it is normalised
explicitly. `sort_keys=True` is mandatory because `model_dump()` follows
field-DECLARATION order.

**Whole-table for parameters, not scenario-scoped.** A result under
`Optimistic` depends only on Base plus those overrides, so scoping would warn
less — but a scoped hash cannot be compared across results computed under
different cases, and the scenario is already recorded separately.

### Schema evolution is the real cry-wolf risk

`BOMNode` has gained fields repeatedly. With a wholesale `model_dump()`, the
NEXT field added with a default would silently move every stored hash and every
old result would start warning — discrediting the warning within one release.
Two mitigations, both present: an explicit **allowlist** (adding a field is a
no-op unless deliberately added), and a **version prefix** (`bom:v1:…`) so a
scheme change reports "hash scheme changed in a newer MApper — cannot compare"
rather than "content changed", which would be a lie.
`test_every_bom_node_field_is_decided` fails on any field that is neither
hashed nor excluded-with-a-reason, so a new field forces the decision when it
is added.

#### What NOT to do

- **Don't hash resolved quantities.** Authored only, or the two hashes stop
  being independent and the attribution is gone.
- **Don't hash `id`.** It is re-minted on every import; the round-trip test
  fails on both real projects if you do.
- **Don't sort children by a key.** Sort their digests — a key leaves ties that
  fall back to authored order.
- **Don't use `model_dump()`.** The allowlist is what stops the next added
  field from invalidating every stored hash.
- **Don't refuse on a mismatch.** Warn, and name which of the two moved.
- **Don't treat an absent hash as a mismatch.** Every result stored before this
  shipped has none; absent is "nothing to say".
- **Don't let hashing fail a compute.** Both entry points swallow and return
  empty — provenance must never be the thing that breaks a run.

## A result records when it was computed. The export reads it.

Ten workbook builders stamped `datetime.now()` on a row labelled "Calculation
date" or "Generated". That is the **export** date — re-export last week's
result and the workbook claimed it was calculated today. A wrong date in a file
attached to a paper is worse than a missing one, and the builders had nothing
better to write because no result carried a compute stamp.

`computed_at` (ISO-8601 UTC) + `mapper_version` now ride on every
backend-produced result, stamped at compute time via
`mapper/core/run_provenance.py`. The two contribution results have carried them
since they shipped (`to_persistable_dict` is the documented "archive this for
reproducibility" shape) — this generalises that precedent rather than inventing
a second convention.

**An old stored result has `None`, and a builder writes "not recorded" — never
`now()`.** The fallback IS the bug. A result computed before this shipped
genuinely does not know when it ran; saying so is honest, and substituting
today's date reintroduces the defect where it is hardest to notice.

**Stamp the innermost backend-produced result; envelopes derive.**
`MultiParamImpactResult`, `MultiDSMImpactResult` and `MultiPairedImpactResult`
are assembled by the FRONTEND — constructed nowhere in the backend — so
`_prov_from_envelope` reads the stamp off an inner `ImpactAssessmentResult`
(earliest of the fan-out). Trusting a client to supply a compute timestamp
would make the field unverifiable at exactly the point it is load-bearing.

**Adapters carry through; they do not re-stamp.**
`single_product_to_impact_result` and
`prospective_single_product_to_impact_result` RESHAPE an already-computed
result for AESA. Stamping `now()` there is the same defect one layer in — the
adapted result would claim to have been computed at the moment it was reshaped,
possibly days later. The prospective adapter takes N per-year results from one
run and uses the earliest.

### The multipliers, and the multi-MC

`basis_amounts` was never echoed on any result, though it is load-bearing on
the NUMBER — `flatten_root_with_amounts` uses it as the per-unit/per-year
multiplier, so a lifetime-15 run and a 1-year run differ 15× on the annual
stages. Its companion `stage_amounts` **was** echoed, so a result recorded half
the multiplier. Both now ride, together with **`use_phase_basis`**: the
multiplier alone is ambiguous, because under `life_cycle` the BOM already holds
whole-life quantities and it does not apply at all.

`MonteCarloMultiResult` gained `scored_inputs` + the scored counts + the
multipliers, matching its single-item sibling. The paired path SAMPLES the
foreground as of the foreground patch, so a run that does not record WHAT was
scored is unreproducible in exactly the mode where the scoring decides the
answer. Row draws are per item (name-prefixed with the item); the parameter
draw is shared, so it is recorded once.

#### What NOT to do

- **Don't write `datetime.now()` into a row a reader will take as the
  calculation date.** `test_no_builder_stamps_the_export_date_as_the_calculation_date`
  sweeps the package for it. Read the result's `computed_at` and render it with
  `provenance_rows`.
- **Don't fall back to `now()` when `computed_at` is None.** "not recorded" is
  the answer. The fallback is the original bug.
- **Don't stamp in an adapter.** It reshapes; it does not compute.
- **Don't let a frontend-assembled envelope supply its own timestamp.** Derive
  it from an inner backend-produced result.
- **Don't echo one half of a multiplier pair.** `stage_amounts` without
  `basis_amounts` was exactly that, and `basis_amounts` without
  `use_phase_basis` would be the same mistake again.
- **The detector is AST-based, not a line grep.** The first version matched
  `run_provenance.py`'s own docstring, which DESCRIBES the defect. Exempting
  that module would have hidden the next real site in it — the fix was matching
  `datetime.now()` as CODE, the same structural-not-declarative rule the route
  decorators needed.

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

## `mapper-tailpipe` — the tank-to-wheel half ecoinvent does not isolate

A fleet whose ICEV use-phase rows link only `market for petrol, low-sulfur`
carries **well-to-tank supply and no combustion at all**. The single largest
CO2 term in an ICEV lifecycle is simply absent, and nothing warns: the row
resolves, validates and computes, it just describes refining rather than
driving. On WP5 the missing term is ~2,275 kg CO2 per vehicle-year.

**ecoinvent 3.10 cannot be linked to fix this.** Searched and confirmed:
`operation, passenger car` / `van` / `lorry` all return **0**, and of the
**151** non-market `EURO`-labelled datasets, **zero** lack a vehicle or road
technosphere input. The tailpipe flows exist only inside
`transport, passenger car, ...` leaves, which bundle the fuel, the vehicle
(`market for passenger car`), `market for road` and road maintenance. A BOM
that already models the vehicle and the fuel separately cannot link one
without double-counting two of the three. (Note the naming: it is `EURO 5`
with a SPACE — searching `euro-` returns 0 and reads as "none exist".)

So `scripts/build_tailpipe_db.py` derives the missing half from those same
datasets and writes two activities into a **`mapper-tailpipe`** database:

| | per kg fuel | GWP100 | WTT sibling | TTW share |
|---|---|---|---|---|
| `petrol combustion, EURO 5` | 3.18 kg CO2 | **3.2236** | 1.0928 | 74.7 % |
| `diesel combustion, EURO 5` | 3.14 kg CO2 | **3.1549** | 1.0408 | 75.2 % |

Each holds ONLY the eight tailpipe biosphere exchanges plus the mandatory
`type='production'` self-exchange — **no fuel input**, so it sits ALONGSIDE the
existing supply row and double-counts nothing.

**The factors are DERIVED at build time, never pasted.** The script reads
`transport, passenger car, small size, {petrol,diesel}, EURO 5 [RER]` and
divides each biosphere amount by that dataset's own fuel input, so the
derivation is reproducible and re-runnable against a future ecoinvent. The
source activity keys and the ecoinvent database name are written into each
activity's `comment`, which is what a reader of a result — who has no access to
the script — actually sees. **Round-trip closure: the derived activity times
the fuel input reproduces the source leaf's own direct biosphere GWP to
0.0003 %** (0.162296 vs 0.162297 kg CO2-eq/km), the residual being the 35
flows not carried, which are negligible for GWP100.

**Codes are deterministic md5, and that is load-bearing.** A BOM row links by
`(database, code)`. `uuid4()` would dangle every link on rebuild — the exact
failure that orphaned WP5's cohort mapping on 2026-08-04. A recipient who runs
the script gets byte-identical codes and existing links keep resolving.

**Uncertainty is inherited, not invented.** All 16 exchanges carry ecoinvent's
own lognormal `scale` and `pedigree` from the source exchange, so Monte Carlo
does not treat the model's dominant CO2 term as fixed. Inheriting rather than
flattening preserves real signal: diesel NOx and PM2.5 come through at
**GSD² 1.2127** where the other fourteen are **1.5015**. The scale is carried
across the renormalisation unchanged, which is CONSERVATIVE rather than exact —
the source dispersion covers both fuel-per-km and emissions-per-fuel, and
dividing the fuel out arguably removes the first — and overstating a spread is
the defensible direction. A `FALLBACK_PEDIGREE` exists for a future ecoinvent
that ships an exchange without uncertainty; it is currently unreached, and the
build records per exchange which path it took.

**Why the three biosphere blockers do not bite.** Linking `biosphere3` directly
fails three ways; a custom activity fails none:

- **32-char code rule** (`bom_validator._EXPECTED_CODE_LENGTH`) rejects
  biosphere3's 36-char hyphenated UUIDs. Our code is ours to mint.
- **The four biosphere refusals** (`lca.py:169`, `:248`, `:1188`, and
  `technosphere_only` in `bw2_wrapper.py:387`) all test the literal substring
  `"biosphere"` in the DATABASE NAME. `mapper-tailpipe` trips none — which is
  also why the name must never contain that substring.
- **Demand-vector key**: a raw flow raises `OutsideTechnosphere: Can't find key
  ... in product dictionary`. A `type='process'` activity with a production
  exchange is in the product dictionary by construction. (ecoinvent itself
  contains 400+ activities with zero technosphere inputs and only biosphere
  exchanges — the identical shape.)

Verified end-to-end: a BOM row linking `mapper-tailpipe` validates with
**0 errors, 0 warnings** beside its ecoinvent supply row.

**Portability.** `project_storage._GENERATED_DATABASES` maps the database to
its build script, and `database_inventory` reports `installed_generated` +
`regenerate_with` separately from `installed_premise`. The distinction is the
one a recipient cares about: a premise database must be regenerated by running
premise against an IAM scenario, whereas this ships with a script, so "you are
missing this" arrives with the command that fixes it. The pointer is emitted
whenever the project **links** to the database, even if it is not installed on
the exporting machine — that is precisely the case that matters.

### What NOT to do

- **Don't link a `transport, passenger car, ... EURO n` dataset to add
  combustion.** It bundles the vehicle and the road; a BOM that models those
  separately would count them twice. That bundling is the whole reason this
  database exists.
- **Don't paste the factors as a table.** They are derived from ecoinvent at
  build time so they track the installed version. A transcribed table is the
  `remaining_gt_from_2025` mistake in a new place.
- **Don't mint codes with `uuid4()`, and don't change `stable_code`'s input
  string.** Either dangles every BOM link into the database on the next
  rebuild.
- **Don't rename the database to anything containing `biosphere`.** Four
  separate refusals filter on that substring; the activity would become
  unlinkable and invisible in the picker at once.
- **Don't drop the `type='production'` self-exchange.** Without it the activity
  never enters the product dictionary and every demand raises
  `OutsideTechnosphere`.
- **Don't leave the exchanges unscored, and don't flatten them to one stated
  pedigree.** Inheriting preserves ecoinvent's per-flow distinctions (diesel
  NOx and PM2.5 are genuinely tighter); a single blanket score would erase
  them, and an unscored dominant CO2 term is the failure this database was
  built to avoid.
- **Don't add a generated database without adding it to
  `_GENERATED_DATABASES`.** It would be reported under `installed_base`,
  telling a recipient they need an ecoinvent licence for something they could
  rebuild in one command.
- **Relinking WP5's use-phase rows is a separate data decision.** This database
  is reference data; no BOM is touched by building it.


## Authored databases — user-defined activities by biosphere flows (step 2: backend)

A user creates a bw2 database and authors activities in it by specifying
**biosphere exchanges**, never an impact score: bw2 has no representation for a
characterised result, and a synthetic flow characterised in one method would
contribute exactly zero to every other boundary. Authoring flows means every
installed method characterises the activity. The mechanism is the one
`mapper-tailpipe` proved (#94): `type='process'`, a mandatory production
self-exchange, 32-hex codes, a database name without "biosphere".

**Biosphere-only in v1, and that is load-bearing, not a simplification.**
`resolve_link_db` deliberately never translates a link into a non-base database,
so an authored activity with a technosphere input would keep base-ecoinvent
electricity in every premise year, silently. Nothing in the engine can write a
technosphere exchange.

**The definition file is the source of truth; bw2 is a materialisation.**
`dsm/{project}/authored_databases.json` (`mapper/core/authored_storage.py`) — a
file inside the existing dsm root, like `project_settings.json`, so it travels
with duplicate / rename / **modelling-only** export / import with no change to
`project_storage`. Every mutation: validate → `Database.write()` → save the
file. If the bw2 write fails nothing is saved. A CORRUPT file raises (409) rather
than reading as empty — empty-then-save would delete every authored activity.
Writes are atomic.

**Uncertainty — an authored activity must never report itself as better
constrained than ecoinvent's own data for the same flow:**

- Every exchange is lognormal (`uncertainty type 2`). No path writes a fixed
  exchange (GSD² exactly 1.0).
- Pedigree: all five indicators required on every exchange; no defaults.
- Basic variance: ecoinvent's median `scale without pedigree`² for THAT flow,
  not a constant. #94's fallback used fossil CO₂'s 0.0006 for every flow; PM2.5's
  ecoinvent median is 0.30. Not user-settable where ecoinvent has one. Where it
  does not, the user enters one AND a reason, both stored.
- Floor: composed GSD² vs ecoinvent's median GSD² for the flow. Below it, the
  write is refused unless `floor_reason` is given; the reason is stored on the
  exchange so the claim travels with the number.
- **`floor_status` is always explicit**: `floored`, `below_floor_with_reason`, or
  `unfloored` (with `floor_detail` saying why). An activity with any unfloored
  exchange reports `has_unfloored_exchange`, serialised into the file.
- `MIN_FLOOR_SAMPLES = 10`: below 10 lognormal ecoinvent exchanges for a flow,
  neither its median basic variance nor its median GSD² is used. **Arbitrary,
  and documented as such** — see "The 10-exchange floor minimum is a documented
  choice" below.
- Stored exchanges validate their own arithmetic on load (`sigma` must equal the
  composition of pedigree + basic variance, `gsd2 = exp(2σ)`), so a hand-edited
  file cannot carry numbers its scores do not produce.

**Coverage declaration from the first write.** `scope ∈ {complete, partial}` is
required on every activity with no default; `scope_note` is required for
`partial`. Step 4 will surface it on results as "not specified" — it exists now
so no activity ever needs backfilling.

**ecoinvent statistics are one pass, not per flow.** `Bw2Backend._all_stats`
reads base ecoinvent's biosphere exchanges through the OUTPUT index (~2.5 s for
445,588 exchanges), cached per (project, base db `modified`). A per-flow query
through the input index costs 4–11 s EACH on a project carrying premise copies:
MAp-test holds 122,817 rows for one NOx flow, 2,793 of them in base ecoinvent.

**Codes are minted once (`uuid4().hex`) and stored**, never hashed from the
name: a rename would change a name-derived code and dangle every BOM link.
Deleting an authored database or activity that any archetype links to is
refused with the links named. Negative amounts are refused in v1.

**Rebuild after import.** `reconcile` rebuilds any authored database whose bw2
fingerprint (`mapper_authored_fingerprint` in bw2 metadata) differs from the
file. It runs after project import and after an ecoinvent import. A
modelling-only import usually has no biosphere yet → `pending`, never a failure;
a flow key that resolves to a DIFFERENT flow in the recipient's biosphere3 (name,
compartment or unit) is also `pending`, never written. The export manifest lists
authored databases under `authored`, not `installed_base` (which would tell a
recipient to license ecoinvent for them).

Routes: `/api/authored-databases` (list/read/create/delete, activities
add/update/delete, `POST /reconcile`), in `mapper/api/authored.py`. Tests:
`tests/test_authored_databases.py` (fake bw2 backend; CI has no biosphere).

#### The 10-exchange floor minimum is a documented choice, not a derived one

Measured on ecoinvent 3.10 cutoff (2026-09-18) to decide whether 10 was right.
The answer: **the data supports no clean threshold for the median, so 10 stays,
with its arbitrariness recorded here and in the constant's comment.**

Usable exchanges per flow (2,545 flows carry lognormal GSD²; basic variance is
almost identical, 2,519 flows):

| exchanges | 1 | 2 | 3–4 | 5–9 | 10–19 | 20–49 | 50+ |
|---|---|---|---|---|---|---|---|
| flows | 147 | 145 | 354 | 449 | 395 | 354 | 701 |
| cumulative | 5.8% | 11.5% | 25.4% | **43.0%** | 58.5% | 72.5% | 100% |

How a k-exchange median behaves, from 300 random subsets of each of the 507
flows with ≥100 exchanges, as the share of subsets whose median sets the GSD²
floor too LOW (the direction that lets an understated authored value pass):

| k | 1 | 2 | 3 | 5 | 10 | 20 | 50 |
|---|---|---|---|---|---|---|---|
| >10% too low | 26.0% | 24.3% | 20.8% | 18.0% | 14.5% | 10.6% | 6.4% |
| >20% too low | 18.5% | 15.7% | 13.6% | 11.0% | 8.1% | 5.4% | 2.9% |

The error falls smoothly, with no knee. 3 is not close enough to 30 to lower the
bar, and 10 does not make the median safe either. Basic variance behaves the
same way, with fatter tails.

**The subsampling is also an imperfect model of rare flows.** Flows with 1–4
exchanges mostly carry one repeated value (59–100% of them), and their typical
GSD² differs (median of flow medians 1.53–1.75 for 2–9 exchanges vs 2.49 for
50+). So neither analysis licenses a number.

**A different estimator changes more than any threshold would** — recorded as
a proposal, NOT implemented. Using the MAXIMUM of a small sample instead of its
median makes the floor err strict instead of lenient: at k = 3 it is >10% too
low for only 3.7% of subsamples (median: 20.8%), at k = 5 for 0.6%. The cost is
the other direction: at k = 3, 30% of floors land >50% too high, so users give
more reasons.

**Decided against (2026-09-18), and why — the better-looking error rate is the
worse failure mode.** The floor works only because refusing is rare. Under the
current median, the failure is that some understated values pass; they remain
visible on the exchange (GSD², floor, status) and the user can still see and
correct them. Under the max, the failure is that correct values are refused
often enough that `floor_reason` gets filled routinely — and a reason field
filled routinely stops being read, which trains people to write a reason
without thinking. That disables the guard for every exchange, not just the
ones it misjudged. The second failure is worse even though its too-low rate is
lower. Do not adopt the max (or any stricter small-sample estimator) without
also measuring how often it refuses values that are actually fine.

#### What NOT to do

- **Don't add a technosphere exchange type** without first making the
  prospective translator handle authored databases. It would silently mix base
  and premise backgrounds.
- **Don't let a missing uncertainty field mean "fixed" or "default".** Every
  exchange carries all five pedigree scores, a basic variance with provenance,
  and an explicit `floor_status`.
- **Don't reuse #94's `FALLBACK_BASIC_VARIANCE` for authored flows.** It is
  CO₂'s value.
- **Don't query flow statistics through the input index per flow.** One pass
  over the output index, cached.
- **Don't save the definition before the bw2 write succeeds**, and don't read
  a corrupt definition file as empty.

## A method is its TUPLE. The label is display only.

`method[-1]` is not unique. Across EF v3.1's 25 indicators there are **14**
distinct ones: "global warming potential (GWP100)" names four (climate change
and its biogenic / fossil / land-use variants), "comparative toxic unit for
human (CTUh)" six, "comparative toxic unit for ecosystems (CTUe)" three, and
"accumulated exceedance (AE)" names **both acidification and terrestrial
eutrophication**.

Used as a dict key, that silently dropped **11 of 25** indicators from the
single-product and multi-product exports, each group collapsing onto whichever
member was written last. The per-item `SB_*` sheets were the worst of the set:
they wrote all 25 rows and gave the four climate rows ONE shared stage vector,
so the sheet looked complete. Measured on delivered workbooks: the Stage
breakdown sheet held 14 rows against a 25-indicator result, and the surviving
"global warming potential (GWP100)" row was *climate change: land use and land
use change*.

**The fleet pipeline was never affected**, for two independent reasons, and
this is worth knowing before anyone "fixes" it there: every dict on that path
is keyed on `tuple(r.method)`, and its own `method_label` is
`" › ".join(m)` — the whole tuple — which is 25/25 distinct.

- **Key on the full tuple.** `stage_breakdown` is a `list[StageBreakdownEntry]`
  where each entry carries `method: list[str]`, not a `{label: ...}` dict.
  `method` is REQUIRED on that model: an entry that can be built without one
  can be written without one.
- **Labels come from `core/method_labels.py`**, the one implementation
  (`flow_characterisation._labels` delegates to it). A label is a property of
  the SET: `m[1]` where that category appears once, `" / ".join(m[1:])` where
  it does not. The frontend mirrors it in `utils/methodLabels.ts` — the two
  must agree or a column header and its export disagree.
- **Fleet sheet headers are disambiguated too.** Not a computation error: the
  numbers under four identically-named "global warming potential (GWP100)"
  columns were always correct and in request order. But a reader transcribing
  by column name cannot tell which climate variant they took, and these sheets
  are read off for publication. `_short_method_label(method, among)` takes the
  sheet's method set.
- **Don't reintroduce a label key.**
  `tests/test_methods_keyed_by_tuple.py` walks the AST of `api/lca.py`,
  `api/impact.py`, `api/bom.py`, `api/cohort_export.py`, `api/aesa.py`,
  `core/dsm_lca_engine.py` and `core/aesa_engine.py` and fails on any dict
  whose KEY is `.method_label`, `_sp_short_method(...)`, `_short_method_label(...)`
  or `method[-1]`. A label in a value or in a sheet row is fine.

**AESA was already safe and is unchanged**: `results_by_method` keys on
`"|".join(r.method)`, and `suggest_method_mapping` matches on `method[1]`,
which is 25/25 distinct for EF v3.1. Measured against Sala 2020 PB-EF: the 25
indicators map to 16 boundaries, one method each, so the `(year, pb_id)` SR
matrix cannot collapse anything. It would only bite with two LCIA packages in
one run, where two methods can share `method[1]`.

**`is_annual` is a UI hint, by design, not a multiplier.** The schema says so
(`bom_schemas.BOMNode.is_annual`: "DEPRECATED as a decision input… It must
never determine a multiplier; `basis` does that") and `content_hash` excludes
it for the same reason. So the stage-amount preset consulting `basis` and not
`is_annual` is correct — see the separate note on the lifetime preset.

## No undefined names -- pyflakes guards the package

Three names were called without ever being defined, and each shipped, because
each sat behind a route no test drove to that line:

| name | since | what broke |
|---|---|---|
| `lca._current_project` | #97, v0.2.1 | every single-product computation against an INSTALLED premise database (Prospective tab, prospective contribution, trajectory, Monte Carlo with a background) -- NameError |
| `dsm.build_template_filename` | #103, v0.2.2 | all five DSM "Download template" links -- 500 |
| `dsm.simulate_scenarios` `table` | v0.1.0 | `simulate-scenarios` for a scenario WITH scaling rules -- 500 (latent: no project has rules) |

The first is the instructive one: the unit tests only reached its early
returns, the integration tests skip without a premise database, and CI has
none -- so the line that raised was reachable only on a real user's machine.

`tests/test_undefined_names.py` drives each through its entry point, and runs
**pyflakes' undefined-name check over the whole package with no exemptions**
(annotation-only hits were fixed too, via `TYPE_CHECKING` / a real import, so
the rule stays "zero"). pyflakes is pinned in `environment.yml`; the guard
skips locally when it is absent but FAILS on CI (`CI` is set there), because a
guard that skips where it gates merges is not a guard.

`dsm` cannot import `bom` at module level (bom imports dsm), so dsm reaches
bom's helpers through thin lazy wrappers -- `_sanitize_filename`,
`build_template_filename`.

## "Not specified" markers (step 4 of authored databases)

A PARTIAL authored activity says only its listed flows were specified. So an
indicator none of those flows is characterised by is not small for that
activity -- it is UNKNOWN, and every result that used the activity inherits
that. Each such (indicator, activity) is a `CoverageGap`, computed by the
backend and carried on the result as `coverage_gaps`; the UI only shows it.

- **Computed from what the run USED, never from a solve.**
  `core/authored_coverage.coverage_gaps(keys, methods, project)` takes the
  `(database, code)` keys of the run's actual demand -- single-product and
  Monte Carlo pass `total_demand`, the fleet passes `fleet_link_keys`, which
  splices and filters roots with `stage_to_scope` exactly as the fleet counts
  them. So a partial activity sitting only in the Use Phase does not mark an
  inflows run. SPECIFIED = a listed flow has a factor under the method (0
  included) AND the author declared the partial inventory complete for it --
  see "Per-indicator coverage declaration" below. A COMPLETE activity never
  gaps: there a missing flow really is zero.
- **Cannot change a number.** Pinned by a test that runs the same product with
  the boiler declared partial and complete and requires identical scores and
  stage breakdowns.
- **Never fails a run, never vanishes silently.** A failure becomes a result
  warning ("... NOT marked"), because an absent annotation reads as "nothing
  unspecified". Fast path: no linked partial activity -> the characterisation
  index is never built.
- **Carried on:** `ArchetypeLCACalculateResult` (so multi-item archetypes too),
  `ActivityLCAResult` (an authored activity picked directly in Activities
  mode), `DSMLCABatchResult` + `ImpactAssessmentResult` (both fleet paths --
  the Static tab's N=1 run goes through `/dsm-lca`, not `/impact/calculate`;
  `GET /dsm-lca` RECOMPUTES it rather than caching, so a rehydrated result is
  not silently clean), `MonteCarloResult`, `ItemDistribution` (per paired
  item), and the AESA adapters. `AESAComputeResult.coverage_gaps` adds the
  `pb_id`, mapped with `resolve_method_mapping` -- the SAME function compute
  uses, so a marked axis cannot disagree with the SR it marks.
  `test_every_result_constructor_passes_coverage_gaps` fails on any
  constructor of those types that omits the field.
- **Shown:** a `not specified` marker per indicator (Static / Projected /
  multi-item / system-level sidebars / AESA detail table) and a
  `CoverageGapNote` per result, including the author's scope note. AESA radar:
  the axis is HATCHED and the vertex drawn hollow -- the SR is a LOWER BOUND,
  not a value to read. Timeline: the series is dotted (`1 3`, deliberately not
  the reference lines' `4 4`) and the legend says so. Monte Carlo: a note per
  result/item, and `Not specified` rows on the workbook Summary.
- **Keyed by the full method tuple, never the label.** `EF v3.1` and its
  `no LT` variant share last elements; `gapsFor` joins the whole tuple.

#### What NOT to do

- **Don't derive gaps in the frontend.** Read `coverage_gaps` off the result.
- **Don't colour "not specified" with a zone colour.** It is grey
  (`NOT_SPECIFIED_HATCH`, a literal so it survives export): unknown must not
  read as "in the uncertainty zone".
- **Don't cache the fleet annotation in a new registry.** Recompute it; a
  tenth project-keyed dict is a tenth thing to prune on rename.
- **Don't default `coverage_gaps` to `[]`.** The default is `None` = NOT
  RECORDED (a result computed before the check existed). `[]` means "checked,
  none" -- a stored old result deserialising to `[]` would claim a check that
  never happened. Carry `None` through adapters and mirrors; never `?? []` it
  into a store that feeds an export.

### Per-indicator coverage declaration (partial activities)

The step-4 rule was "an indicator is covered when ANY listed flow has a factor
for it". The worked example (a methane flare, CO2 + unburnt CH4, partial)
broke it: methane carries small factors for photochemical ozone formation,
freshwater ecotoxicity and non-carcinogenic toxicity, so those read as
SPECIFIED while in a real flare they are dominated by exactly the NOx and
NMVOC left out. **A nonzero factor means a flow contributes, not that the
listed flows suffice -- and only the author knows which.**

So a PARTIAL activity carries `complete_indicators` (full method tuples): the
indicators its author declares the partial inventory complete for.

- **Default: nothing complete.** An author who ticks nothing gets every
  indicator marked -- the honest reading of an unfinished declaration. Never
  prefill from reach; the editor shows the reached indicators UNticked.
- **The old rule is the floor, enforced twice.** Only indicators a listed flow
  reaches can be ticked: refused at save (`indicator_not_reached`, in
  `build_activity`, outside the resolve-only exchange loop), and re-checked at
  compute (`authored_coverage.gaps`: specified = reached AND ticked), so a
  tick whose reach was lost since (method reinstalled) is marked, not trusted.
  The declaration can narrow what counts as specified, never widen it.
- **Complete activities carry no ticks** (refused by the schema) and get no
  step in the editor.
- **Each gap says why**: `kind` = `not_reached` (no listed flow characterised)
  or `not_declared` (flows contribute, not declared complete). Shown in the
  marker tooltip and a `Why` column on the Coverage sheet.
- **The editor asks the backend what is reachable**
  (`POST /authored-databases/reached-indicators`, the same `reached_methods`
  the save floor calls) -- it never derives reach itself -- and blocks saving
  on a tick that lost its reach after a flow was removed.

**Migration.** Activities written before the field loaded with
`complete_indicators = []`: strictly MORE markers, never fewer. The field is
an annotation, so it is **excluded from the materialisation fingerprint** --
hashing it would have marked every existing authored database stale
("Rebuild") on upgrade; a test pins the fingerprint to the pre-field formula.
It never reaches Brightway. No `extra="forbid"` on the models, so a 0.3.0 build
reading a newer file loads it and ignores the ticks (and would drop them if it
re-saved the activity).

### Every result workbook states coverage for EVERY indicator

A workbook that names some indicators "not specified" and says nothing about
the rest invites the reader to infer the rest were checked -- worse than never
mentioning it. So every workbook reporting impact or SR values (8 in
`impact.py`, the fleet `_build_mfa_lca_workbook`, the LCA Calculator,
contribution + multi-year contribution, AESA, both Monte Carlo) ends with a
**`Coverage` sheet listing every indicator it reports** (every boundary, for
AESA) with one of three statuses -- `specified`, `NOT SPECIFIED` (+ activity,
database, the author's scope note), `not recorded` -- and a pointer line at
the foot of its FIRST sheet with the headline ("1 of 25 indicator(s) NOT
SPECIFIED", "Checked: all 25 specified", "NOT RECORDED for ..."). One helper,
`core/coverage_export.finalize_coverage`, so the wording is identical in every
file; appended, so no existing cell moves. Multi-result workbooks carry a
discriminator column (LCI Scenario / Sensitivity case / DSM scenario / Pair /
Trajectory / Item / Year). The fleet `/dsm-lca` export recomputes the gaps
like `GET /dsm-lca`; a Static-vs-Projected export states both results.

`test_every_result_workbook_states_coverage` discovers every `_build_*workbook`
in `mapper/api` and fails on one that neither calls `finalize_coverage` nor is
in `EXEMPT` with a reason (BOM, DSM stock, parameters, sharing presets -- no
result values). A new result workbook cannot ship silent.

## Exchange-level uncertainty basis (step 5 of authored databases)

The floor above assumes the amount on an exchange IS an emission, so ecoinvent's
spread for that flow is the right reference. One real use breaks that
assumption: a supplier's cradle-to-gate PCF entered as one characterised CO2e
figure against fossil CO2, so GWP100 reproduces the supplier's number. No
emission of that size occurs. Its uncertainty is the supplier's, and ecoinvent's
per-flow median describes a different quantity -- the floor there is a category
error, and the UI was pushing authors toward a `floor_reason` justifying a
comparison that was never made.

`ExchangeInput.uncertainty_basis` / `AuthoredExchange.uncertainty_basis`:

- **`ecoinvent` is the default and is unchanged.** Every exchange written before
  the field is `ecoinvent` on load. It is also outside `fingerprint()`, so
  adding the field did not mark one existing authored database stale.
- **`supplied` asks for MORE than the default, never less.** `_resolve_supplied`
  requires `basic_variance` AND `basic_variance_reason` (`bv_required`,
  `bv_reason_required`) -- the two things the default path does not ask for when
  ecoinvent has a median. The same input the ecoinvent basis accepts is REFUSED
  on the supplied one; `test_supplied_is_more_work_than_the_default_never_less`
  pins exactly that.
- It refuses `floor_reason` (`floor_reason_not_applicable`) instead of storing a
  meaningless one, and reports `floor_status="not_applicable"` -- distinct from
  `unfloored`, which means the check could not run. `has_unfloored_exchange`
  stays false, and the activity does not warn.
- The basis never reaches Brightway. Only the variance it implies does.

**It is reachable, and deliberately unattractive.** In the editor it is a closed
`<details>` at the foot of the row, in the tertiary colour, phrased as a question
about what the amount IS -- never as a remedy. A `below_floor` complaint does not
open it, does not mention it, and the panel itself says "If the amount is an
emission, leave this as it is, including when the floor says your GSD2 is low."
`authoredActivityEditor.test.tsx` "is not offered as the way out of a
below-floor complaint" fails if the disclosure opens on a floor verdict. **Don't surface the basis from an error
path.** An author who takes this route to silence the floor has made their
number look better without changing what they know.

**The basis survives into the result, not just the editor.**
`authored_coverage.uncertainty_notes()` lists every authored exchange a run used
with its basis, on six result models (`authored_uncertainty`). It lists BOTH
bases: a block naming only the exceptions leaves the reader to assume the rest
are ecoinvent-referenced, which is the silence the coverage statement exists to
avoid. It reaches the Coverage sheet of every result workbook AND the Monte
Carlo **Pedigree scores** sheet -- that is where a reader compares GSD2s, and
authored exchanges are sampled as background, so they appear in no scored-input
row and the reader would otherwise have no way to know the two are not
comparable.

`test_every_result_constructor_passes_authored_uncertainty` derives its carrier
list FROM the models (classes declaring the field) rather than a hand-kept set,
so adding the field to a seventh result brings that result's call sites under
the guard. It caught both AESA adapters on the way in.

**The chain had coverage at both ENDS and none in the middle.** Reported as a
bug -- a stored `supplied` exchange seemed to reopen on the ecoinvent basis --
it did not reproduce: the definition file, the model, the declared
`response_model` and the editor all carried `supplied`. But the only tested
links were file -> model (`test_uncertainty_basis.py`) and response -> editor
(`authoredActivityEditor.test.tsx`); **model -> HTTP response had nothing**, and
that is precisely where this field would vanish without a sound. The default is
`"ecoinvent"` and the TypeScript field is optional, so a response that omitted
it would raise nothing anywhere: the editor would fall back, show the ecoinvent
basis, and demand a floor justification for an amount that is not an emission.
A silent downgrade to the STRICTER default is the worst shape this can take,
because the resulting screen looks correct.
`test_authored_basis_survives_the_response.py` pins that link, over both bases,
with an anti-vacuity case proving a dropped field is detectable.

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
