# MApper — AI Context Document

> This file helps AI assistants understand MApper's architecture for debugging and development support.

## Where the rest of the guidance lives

- `mapper-frontend/CLAUDE.md`: UI conventions, charts, frontend testing (loads under that directory).
- `mapper-backend/CLAUDE.md`: LCA/DSM backend, authored databases, uncertainty, registries (loads under that directory).
- Skills in `.claude/skills/`: `mapper-impact-assessment`, `mapper-single-product`, `mapper-monte-carlo`, `mapper-multi-product`, `mapper-archetypes` (invoke when working on those features).
- Stack, directory layout and route list: read `package.json`, `pyproject.toml`, `ls`, and `mapper-backend/mapper/routers/`.

## Hard rules

- Never create a tag unless Leo says so. Never publish a release; Leo publishes. Create the draft release right after the tag push.
- Never force-push. Never delete branches.
- Squash-merge only, and only with Leo's conditional authorisation: all three CI jobs green on the exact head sha, only the expected files changed, main has not moved. Merge main into a branch with `git merge origin/main`, never rebase. Check CI once, no polling.
- Never touch `~/Library/WebKit/com.leonardoferhati.mapper` (the app's localStorage). Clear only `~/Library/Caches/com.leonardoferhati.mapper`. No `pkill -f`; stop processes by PID. Port 8000 belongs to NOUS: never use or kill it.
- Move old apps to the Trash, never delete. Only the `mapper-tauri` entry may change in `Cargo.lock`.
- Tests must never write into real user data or real projects; use temp copies and delete what you create.
- Before any irreversible or externally visible action, stop and ask.
- Build traps: use `npm run build:desktop`, not `npm run build`; run the Finder test before `tauri build`; grep for port 8765 at four stages (frontend `dist/`, frozen `dist/mapper-backend`, staged resource, bundled `MApper.app`). The exact steps and order are in [RELEASING.md](RELEASING.md) (macOS build, steps 1-8) and [DESKTOP.md](DESKTOP.md) (Build).

## What is MApper?

MApper (Multi-method Assessment of Products, Processes and Environmental Resources) is a desktop application for environmental sustainability assessment. It unifies four methods:
- **LCA** (Life Cycle Assessment) — environmental impacts per product lifecycle
- **DSM** (Dynamic Stock Modeling) — cohort-based fleet/stock dynamics with Weibull survival
- **pLCA** (Prospective LCA) — future technology scenarios via premise + IAM models
- **AESA** (Absolute Environmental Sustainability Assessment) — comparing impacts against planetary boundaries

> **Scope**: MApper is a general-purpose assessment tool. The Danish automotive fleet is **one example case study** — all features must work for arbitrary product systems (wind turbines, buildings, electronics, food systems, etc.). Avoid case-study-specific text, defaults, or hardcoded values in UI placeholders, templates, and onboarding.

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

## The packaged app is a REMOTE http origin, not a Tauri page

`mapper-tauri/src/main.rs` navigates the webview to `http://localhost:8765/index.html`
— the backend serves the built SPA so the page is same-origin with the API. That
one decision removes two things people assume are there:

- **No Tauri IPC.** `window.__TAURI__` is never injected into a remote origin,
  so no Tauri plugin (clipboard-manager, dialog, fs) is reachable from app code.
  Adding the plugins does not help; the page would need an IPC grant to an http
  origin. `isPackagedDesktop()` therefore keys on `window.location.port ===
  '8765'`, which is the honest discriminator — it is what actually differs.
- **Downloads: `blob:` downloads DO work in the packaged app.** Almost every
  export is a `blob:` URL clicked through a hidden `<a download>`: 30 of the 32
  file-saving functions in `client.ts` (13 of them xlsx workbooks), plus every
  chart image export (`chartExport.ts`). The 0.3.0 walkthrough (October 2026)
  downloaded the pLCA, LCA and Monte Carlo workbooks from the INSTALLED app
  through exactly that path. An earlier version of this section said WKWebView
  ignores such a download with no delegate; that was inferred from the Settings
  › Logs "Export" no-op and never checked against an export that worked. Of the
  two no-ops it was used to explain, the AESA one had code causes, proven in
  #170 (the button returned early with no DSM system and the route 404'd); the
  Logs one was never isolated.

  **Two exports save server-side in the packaged app**, and only those two:
  Settings › Logs (`POST /system/logs/save`) and AESA (`POST /aesa/export/save`),
  both through `system.save_to_downloads`, writing to `~/Downloads` (else a
  fallback folder) and showing the path for 8 s. In a browser both use the
  blob download like everything else. They are kept because they work and
  tell the user where the file went; the other exports are left on the blob
  path because THEY work. Whichever mechanism a button uses, the UI must show
  a failure rather than log it to the console, because a silent failure looks
  exactly like the old no-op.

The same screen carried the quieter half of the class. `document.execCommand('copy')`
**returns `false` when it does nothing; it does not throw**, so a `try` with no
check on the return value reports a failed copy as a success — and `handleCopy`
discarded the return entirely, so a *successful* copy showed nothing either. A
boolean result that nobody reads is the same defect as a swallowed exception.
Both outcomes are now on screen: "Copied" on the button, or a visible line
telling the reader to select the text manually.

What tests can reach: which branch runs, that the packaged branch does NOT touch
an anchor, that a backend failure propagates, and every visible outcome
(`tests/logsCopyAndExport.test.ts`, `tests/logsPanelFeedback.test.tsx`,
`tests/test_logs_save_route.py`). What they cannot: whether WKWebView actually
grants clipboard access on a user gesture, and whether the real build reaches
port 8765. Those two need the installed app.

### Never use native window dialogs

`window.confirm`, `window.prompt` and `window.alert` (and the bare `confirm(`,
`prompt(`, `alert(`) do nothing useful in the packaged app: the WKWebView has
no dialog delegate, so confirm answers false, prompt returns null and alert
shows nothing. A guarded delete never happens, a name can never be entered, a
failure shows nothing. Use the helpers in `components/ui/dialogs.tsx`:

- `confirmDialog({ title, body?, destructive? })` -> boolean (destructive:
  danger button, `role="alertdialog"`, focus on Cancel);
- `promptDialog({ title, label?, defaultValue?, validate? })` -> trimmed
  string or null;
- `choose({ title, options })` -> value or null. Escape ABORTS; never map
  Cancel to one of the branches (the old `confirm` "Cancel = Merge" pattern);
- `messageDialog(title)` -> a blocking acknowledgement, for a validation
  message that stops an action;
- `notify(message, { tone })` -> a toast, for the outcome of an async action
  (errors stay until dismissed).

`<DialogHost />` is mounted once in `App.tsx`, outside the per-tab
ErrorBoundary; a helper called with no host throws. Row-level "second click to
delete" buttons (AESA configurations dropdown, ProjectSwitcher) are a separate,
inline pattern and stay as they are.

**The guard is absolute: there is no allow-list.** Every native call was
migrated (dialogs PRs 1-4), so `tests/noNativeDialogs.test.ts` scans every
file under `src` and fails on any native `confirm`, `prompt` or `alert`: bare,
`window.`/`globalThis.`/`self.`-prefixed, passed around as a reference, or by
index access (`window['alert']`). The only exception is
`components/ui/dialogs.tsx`, which owns the dialog UI and calls none itself.
Don't reintroduce an allow-list or an exemption to land a native call; use
the helpers.

### A modal closes on a background click only if the press started there

Selecting text in a modal's field and releasing the mouse over the dimmed
background fires `click` on the background (the common ancestor), so an
`onClick` that checks `e.target === e.currentTarget` closes the modal mid-edit.
That is how "Add parameter" kept closing while a name was being corrected. Use
`useBackdropDismiss(onClose)` (`components/ui/useBackdropDismiss.ts`): it
closes only when the press also started on the background, and not while a
dialog is open above the modal. `tests/modalBackdropDismiss.test.ts` checks the
modals that use it.

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

## Releasing

The release procedure (version sites, the macOS build, the tag, the draft
release the Windows workflow waits for, publishing, Zenodo, the website) is in
[RELEASING.md](RELEASING.md). Follow it rather than memory.

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

## Tests wrote into the user's real projects for at least three days

Every storage module holds a module-level
`STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / <name>`, and a test
that does not redirect it writes into **live user data**. Three test files did.

Found by accident, while dating files for an unrelated investigation. Nothing
was looking, and the damage was already visible in the app: **Battery
Circularity had 30 DSM systems, every one of them named `GuardlessProbe`** —
one per run of `test_project_guard_e2e.py`, accumulating since 2026-08-31 —
plus three orphaned `sys_promote_*` states from `test_dsm_scenarios.py`. That
project has **no real DSM system at all** (it is archetype-based), so 100% of
what its dropdown listed was test leakage.

**Measured, not guessed.** A temporary pytest plugin wrapped `Path.mkdir` and
`Path.write_text` (the only two write idioms the storage layer uses) and
attributed every write under `user_data_dir("mapper")` to the running test:
**3 files, 5 nodes**. Worse than "writes to a fixture project" — the target is
whatever bw2 project happens to be CURRENT, so which real project gets polluted
depends on run order and on what the developer last opened.

**The fix is redirection by DEFAULT**, in the conftest that already existed for
the parameter-registry clear. `_isolate_storage_roots` is autouse and points
all seven roots at a per-test temp dir. The eight files that already
monkeypatched a root by hand keep working — their `setattr` overrides an
already-redirected value, and monkeypatch unwinds in reverse. And
`project_storage.storage_roots()` reads these module attributes live, so the
copy/rename/export helpers are redirected with them.

Two things that are easy to get wrong here:

- **`aesa_storage` and `aesa_session_storage` share one directory** — sessions
  live at `aesa/{project}/sessions/` — so they must redirect to the SAME temp
  path or that relationship breaks.
- **`dsm_storage._LEGACY_STORAGE_DIR` (mfa) must be redirected too.**
  `hydrate_from_disk` migrates from it on first use, so leaving it live lets a
  test read real data.

### Six tests read live data ON PURPOSE, and blanket redirection broke them

The first cut turned 1495 passed into **1489 passed + 6 skipped**. The six
assert against the developer's real projects: the content-hash round-trip walks
the real archetypes, and the paired Monte Carlo foreground tests need Battery
Circularity's A / A0, whose rows are 100% expressions and are the only place
that foreground carries any uncertainty at all — which is how the missing
paired foreground was found in the first place.

They already skip when the project is absent, so they contribute nothing in CI
and never have; the value is entirely local. Silently converting them to skips
would have removed the only coverage that catches that class.

So there is an explicit opt-out: a test that requests the **`live_storage`**
fixture keeps the real roots. Reading is what it permits; **writing is still
caught**, because the guard does not exempt it.

### The guard fires at the WRITE, not at session end

`_forbid_live_store_writes` (session-scoped, autouse) patches `Path.mkdir` and
`Path.write_text` to raise `LiveStoreWriteError` naming the offending test and
path. Failing at the moment of the write means the failure is attributable and
does not depend on a reporting test running last.

Scoped to the **seven project-data roots**, resolved from platformdirs directly
rather than from the (redirected) module attributes. Deliberately NOT the whole
`user_data_dir`: a premise import creates a `workspace` scratch dir there, which
is not project data and not ours to police.

Verified load-bearing by pointing `test_dsm_scenarios.py` back at the live
store — the guard fires immediately on both offending tests, naming each.

### The log file and every real Brightway project are guarded too (walkthrough 4)

`mapper.main` calls `configure_logging()` at import, so every test that
imported the app wrote into the user's real `mapper.log` — about 2,400 lines
across the four rotations by 2026-10-22, including planted lines ("a real
error", "index exploded") that then showed in Settings › Logs and in exported
logs. `log_config.LOG_DIR` now honours `MAPPER_LOG_DIR`; the conftest sets it
to a temp dir AT IMPORT (the app is imported during collection, and
`api/system.py` binds `LOG_FILE` by value) and refuses any `FileHandler` opened
inside the real log directory (`RealLogWriteError`, raised before the file is
opened).

Brightway: the per-test guard checks only the project current at the start of
a test. The backstop fingerprints every real project's `databases.json` and
`methods.json` (read-only, no project switch) at conftest import and again at
`pytest_sessionfinish`, and fails the run naming each project and database
that was added, removed or rewritten. If the MApper app is open on the same
data during a run, its own writes show up there too; the message says so.

**Never run the backend suite on a branch whose conftest lacks these guards.**
Runs on branches cut before #174 recreated `guard-db` in default and Battery
Circularity on 2026-10-21/22.

### `GuardlessProbe` and the run-level fingerprint of the MApper store (walkthrough 5)

EVS40's DSM list filled with systems named `GuardlessProbe`. The only source
of that name was `test_project_guard_e2e.py::test_create_dsm_system_without_header_is_unguarded`,
which POSTed a VALID system to `/api/dsm/systems` with no `X-Mapper-Project`
header and nothing mocked but the guard's project lookup, so the handler
created it for real (a uuid-named directory under `dsm/<project>/` with
`"name": "GuardlessProbe"`) in whatever bw2 project was current. Every run
that escaped the storage redirect left one more.

- The test now sends a well-formed body the HANDLER rejects (end_year <
  start_year → 400), which proves the guard let it through while saving
  nothing, and asserts `save_system`/`save_state` were never called. A sibling
  case checks the same body with a mismatched header is a 409, so the 400
  cannot mask the guard.
- The per-write guard now also refuses `open(..., "w"/"a"/"x"/"+")` (via both
  `builtins.open` and `io.open`, which `Path.open` uses) and `os.replace` into
  the live roots; it used to see only `Path.mkdir`/`Path.write_text`.
- **Run-level backstop**, like the Brightway one: `_store_fingerprint()` lists
  every file under the real `dsm`, `mfa`, `aesa`, `parameters`, `plca`,
  `aesa_presets` roots (size + mtime, stat only) at conftest import and at
  `pytest_sessionfinish`, and fails the run on any added, removed or rewritten
  file, naming a new DSM system by its name. It catches writes no in-process
  guard can see (a subprocess server, a test run without the redirect).
- Locked by `tests/test_live_store_guard.py`, whose write probes aim at a
  directory that does not exist, so a broken guard fails with
  FileNotFoundError instead of writing.

**Cleanup of existing entries** goes through the app, never by hand-editing
files: switch to the project (`POST /api/projects/switch {"name": ...}`), list
`GET /api/dsm/systems`, and `DELETE /api/dsm/systems/{system_id}` for each
`name == "GuardlessProbe"`. The delete acts on the CURRENT project and also
purges that system's cohort mappings.

#### What NOT to do

- **Don't add a storage module without adding its root to `_STORAGE_ROOTS`.**
  The guard will catch the write, but it will read as a mysterious failure
  rather than as the one-line registration it is.
- **Don't make the redirect opt-IN.** It would only ever cover the tests
  somebody remembered, and the offenders are precisely the ones nobody did.
- **Don't exempt `live_storage` tests from the write guard.** Reading a real
  project is the point of them; writing to one never is.
- **Don't scope the guard to the whole `user_data_dir`.** A third-party import
  creates `workspace` there and the guard would fight it for no benefit.
- **Don't "fix" a live-data test by redirecting it.** Six of them exist because
  real data catches things synthetic fixtures do not. Give them `live_storage`.
- **A full-suite green does not prove tests are isolated.** These wrote into
  real projects for days while every run passed. The guard is what makes it
  observable; before it, only a manual `ls` of the store would have shown it.

## Repository location

Do not keep the repo in an iCloud-synced folder (`~/Desktop`, `~/Documents`): evicted files break builds. `~/Developer` is not synced.

## A test that skips is a test that stopped asserting

`test_supply_chain_truncation_keeps_high_value_paths` took `candidates[0]` off
database iteration order and then `pytest.skip`-ped when the chosen activity
happened to discover fewer nodes than the hard-coded cap of 10. Database
iteration order varies between bw2 sessions, so the skip fired in **1–2 of 6
runs** — a green line meaning the truncation assertions never ran, on a
coin flip.

Two changes, both needed. Candidates are **sorted** by (name, location, code)
so the pick is reproducible. And the cap is **derived** from what the activity
actually discovers (`min(10, discovered - 1)`) instead of hard-coded, so
truncation is forced by construction — the algorithm under test is the same at
any cap below the discovered count. The only remaining skip condition became an
`assert`: fewer than 2 nodes discovered is a degenerate database, not a flaky
pick. 6/6 runs deterministic afterwards.

#### What NOT to do

- **Don't `pytest.skip` when a fixture's random pick fails to reach the
  condition under test.** Either pin the pick, or derive the condition's
  threshold from what the pick produced. A conditional skip is only honest when
  the thing missing is an environmental precondition (no ecoinvent installed),
  never when it is luck.
- **Don't order a test fixture on database iteration order.** It varies between
  bw2 sessions. Sort explicitly.

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

## A guard that cannot fail — the project's dominant defect class

Recorded as a list because it keeps recurring in new disguises, and because
each instance was caught only by deliberately breaking the thing the guard
watches. **Write the revert test before trusting the guard.**

| # | the guard | why it could not fail | the fix |
|---|---|---|---|
| 1 | cohort-leak render case for `ExpandedCohortChart`'s TOOLTIP | asserted `container.textContent` after a static mount. Recharts renders a tooltip only on hover, and jsdom cannot drive Recharts' pixel hit-detection — so the assertion ran against a DOM the series names never reach. Reverting the fix changed nothing. | assert the `<Area name>` VALUE, harvested from the element tree the component returns. That is the formatter's output, not the existence of a prop. |
| 2 | cohort-leak render case for `DetailTable` | the component was **never mounted**. The file-level discovery listed it, the describe block read as if it covered it, and nothing rendered it. | mount it — and expand the disclosure: the per-cohort cells are not in the DOM while the row is collapsed, so even a mounted-but-collapsed test asserts on absent markup. |
| 3 | `chartExpandModalAffordances` "legend label uses the cohort key as the display name" | it asserted the legend `textContent` **contained the raw cohort key**. The fixture pinned the bug: the test passed *because* the defect was live, and would have failed when fixed. | corrected to assert the display string, with the test id still holding the raw key. |

The shapes, stated generally:

- **Asserting on output a static mount cannot produce** (hover, focus,
  animation, a collapsed disclosure). The assertion is real; the DOM is empty.
  `expect('').not.toMatch(...)` always passes.
- **Declaring coverage the test does not perform.** A discovery list, a
  describe name, or a comment that says a component is covered, with no mount.
- **A fixture that encodes the defect.** The oldest form: the test was written
  against observed behaviour rather than intended behaviour, so it defends the
  bug.

#### What NOT to do

- **Don't trust a guard you have not seen fail.** Revert the fix, run it,
  confirm it fails BY NAME. For a multi-site fix, one aggregate failure is not
  enough — six sites must produce six distinct named failures, or some site is
  uncovered and the aggregate is hiding it.
- **Don't assert that a formatter/prop EXISTS.** Assert its return value or the
  rendered output.
- **Don't anchor a leak regex.** `^...$` against a text node passes while
  `<uuid>::BEV-LFP|2030` is live. Search; and keep a fixture carrying a suffix
  so the anchored version cannot be reintroduced quietly.
- **Don't key an exemption on a line number.** It went stale one import later,
  inside this very change. Key on the enclosing function.

## A cohort key is an IDENTITY. Its `<owner id>::` prefix never reaches the user.

`aggregate_subsystem_results` prefixes cohort keys with the owning system's or
subsystem's id (`SUBSYSTEM_KEY_SEP`) so two owners holding the same bare name do
not merge. Measured on MAp-test, that is not hypothetical: **all 51 primary
cohort names also exist under a second system id**.

It leaked into six places at once, in two subsystems and one export:

1. the Projected by-cohort legend when no Stack-by is set (`projectLegendLabels`
   returned the keys verbatim — a documented "fallback" that predated the strip);
2. **dim parsing** — `parseCohortKey` split on `|` without stripping first, so
   the first dim value came back as `<uuid>::BEV-LFP`, into the legend AND the
   colour grouping;
3. and 4. `ExpandedCohortChart`'s facet-expand legend, and its `<Area>` with no
   `name` at all, so the tooltip fell through to `dataKey`;
5. the AESA detail table cell;
6. the AESA "By Fuel Type" Excel sheet, the one writer with no `CohortResolver`
   in scope.

**One display rule, one strip.** `cohortDisplayString()` on the frontend and
`cohort_export.strip_cohort_prefix()` on the backend. `stripCohortPrefix` alone
is NOT the display rule — it leaves the `|`, so a legend built on it reads
`CNG Station|Large` while the tooltip reads `CNG Station Large`. Two names for
one band is the same defect in a quieter form, and it was introduced *while
fixing the loud one*.

**Identity stays raw.** Colour lookup (`rowColorOverrides[cohortKey]`), React
keys and test ids all keep the full key. `projectLegendLabels` returns
`{ key, label }` for exactly this reason; returning one string was what let the
key reach the legend, and it forced a colour REVERSE-LOOKUP hack that is now
gone.

- **Don't strip for grouping.** Safe today only because the owners that can
  co-occur in one chart — a primary system and its own subsystems — have
  disjoint dim-0 label sets (17 powertrains vs 7 station types). A subsystem
  reusing a primary dim-0 label, or a chart rendering two SYSTEMS together,
  would merge them.
- **Don't assert that a formatter exists.** `tests/cohortKeyNeverRendered.test.tsx`
  asserts on rendered output and on the `<Area name>` VALUE, and searches for
  the prefix shape anywhere in the text — an anchored `^...$` match passes while
  `<uuid>::BEV-LFP|2030` is live.
- The guard DISCOVERS its sites by query and then guards the query: it asserts
  the discovered set still contains every known leak site, so narrowing it
  breaks a test instead of shrinking coverage silently. The backend half asks
  "which writers emit a cohort key WITHOUT the strip" — the question that found
  site 6; asking "where is the resolver called" is what missed it.
- An existing test asserted the legend `textContent` **contained the raw key**.
  It was pinning the bug, and it is now corrected.

Six rules, each reverted in turn, each caught by its own named test. The SVG/PNG
export inherits the fix because `extractLegendItems` reads `row.textContent` —
verified by exporting before and after, not by reading the code.
