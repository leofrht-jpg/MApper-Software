# ToDo

Open items, newest release first. The developer's own running list lives
outside the repository; this file holds items recorded from work done in it.

## 0.3.2

- [ ] **Multi-item Uncertainty tab blank in the packaged app (walkthrough 5,
  item 1): confirm on the installed build.** It did not reproduce in jsdom,
  Chromium (dev server and the backend-served production build) or against a
  live backend with the demo project. fix/0.3.1-walkthrough-5 adds a per-tab error boundary, so
  if it still happens the tab should now show the error; send the Settings ›
  Logs entry.
- [ ] **Most backend write routes ignore a mismatching `X-Mapper-Project`.**
  Since fix/0.3.1-project-header every frontend request carries the header,
  but only 13 write routes check it (409 on mismatch): `POST /dsm/systems`,
  `/bom/archetypes`, `/bom/archetypes/import`, `/aesa/configurations`,
  `/aesa/sessions`, `/parameters/import`, `/parameters/table/scenarios`, and the
  authored-database writes. The other 121 POST/PUT/PATCH/DELETE routes ignore
  the header and act on the backend's current Brightway project. Verified:
  `PUT /project-settings` with a mismatching header returns 200 and saves under
  the backend's project. Routes scoped by an id usually 404 on a mismatch
  instead, but a duplicated project keeps its ids, so a write to a duplicate's
  archetype or system can land in the original. The ones with no id at all are
  the riskiest: `PUT /parameters/table`, `PATCH /parameters/table/scenarios`,
  `DELETE /parameters/table/scenarios/{name}`, `POST/DELETE /parameters/sets`,
  `PUT /project-settings`, `PUT /lca/material-pedigree`,
  `POST /bom/folders/{create,rename,delete}`, `POST /bom/archetypes/move`,
  `POST /dsm/import-system`, `POST /aesa/config/import`,
  `POST /aesa/sharing-presets`, `POST /plca/generate`,
  `DELETE /plca/databases/{name}`, `POST /impact/methods/install[-custom]`,
  `DELETE /impact/methods/{id}`, `POST /ecoinvent/import[-local]`. Do not guard
  `/projects/*` (switch, create, rename, ...): they name their project
  explicitly. Suggested: one router-level dependency that refuses every write
  on a mismatch.
- [ ] **Subsystem routes SWITCH the backend's project to the header's.**
  `subsystems.py` `_reconcile_project_from_header` calls
  `bw2data.projects.set_current(header)` when the header names a different
  known project, for all 17 subsystem writes (and reads). That makes the
  request work, but it changes the global current project for every later
  request, which is the opposite of what the 409 guard does. Decide one
  policy.
- [ ] **Most long calculations have no Stop at all.** The cancel route works
  since fix/0.3.1-cancel-route, and two long operations honour it: Monte Carlo
  (single and paired; checked every iteration) and system-level Prospective
  (checked every LCA solve, and at each LCI-scenario boundary). These run with
  a full-screen card and NO Stop, because they are not cancellable tasks:
  - **AESA compute** (77 s measured with cases): a synchronous
    `POST /aesa/compute`, no task id, no checkpoint.
  - **System-level Static**: the single run is a synchronous
    `POST /dsm/systems/{id}/dsm-lca`; the Sensitivity-cases / multi-DSM
    fan-out does go through `/impact/calculate-scenarios`, whose tasks DO
    check the flag, but the Static card offers no Stop.
  - **Single-product Prospective and Static**: N sequential synchronous
    `POST /lca/calculate-archetype` calls from the browser. A Stop could at
    least end the loop between background databases client-side.
  - **Multi-item comparison**: one synchronous `POST /lca/calculate-multi-product`,
    so a long comparison cannot be stopped either.
  - **Project export / import**: synchronous; export streams a tar of the
    whole project.
  Making any of these stoppable means turning it into a registered task with
  checkpoints (the plca/impact/monte_carlo pattern), not a frontend change.
- [ ] **pLCA generation honours cancel only between premise stages.** The
  checkpoint is premise_engine's stage callback, so a Stop during one long
  premise transformation waits until that stage ends.
- [ ] **pageErrorBoundary.test.tsx times out at 5000 ms on a cold first run
  (dynamic import of the whole App).** Seen once in three frontend runs on
  main after #180 (run 1 only); runs 2 and 3 passed. Not investigated.
- [ ] **`test_content_hash[Battery Circularity]` fails on the developer's
  machine.** A `live_storage` test that reads the real project, so it skips in
  CI and in a fresh container and only shows locally. Not investigated.
- [ ] **Two backend tests fail only in the cloud container:**
  `test_aesa_export_real_path::test_a_write_failure_is_reported_not_swallowed`
  and `test_reveal_saved_file::test_a_saved_file_is_revealed`. Both fail on
  main there and pass in CI. Not investigated.
- [ ] **Open external links in the default browser.** Since the navigation
  guard (#191), the two external links (the premise GitHub link in Settings and
  a method's source link in the Method Library) are blocked with the
  "Navigation blocked" toast. Open them in the system browser through a Tauri
  opener instead. Note: the packaged page is a remote `http://localhost:8765`
  origin with no Tauri IPC (CLAUDE.md, "The packaged app is a REMOTE http
  origin"), so this needs either an IPC grant for that origin or a backend
  route that opens the URL, as Reveal in Finder does.
- [ ] **A Rust-level navigation block in the app shell.** Add an
  `on_navigation` handler in `mapper-tauri/src/main.rs` that refuses any
  navigation away from `http://localhost:8765`, as a second layer behind the
  page-level guard in `utils/navigationGuard.ts`.
- [ ] **The scenario manager's Duplicate button is easy to miss.** It is an
  unlabelled Copy icon in the far-right Actions column of a table that scrolls
  sideways inside the modal, so it can be off-screen. Give it a label or move
  it.
- [ ] **Delete the old `unlinked.log` by hand.** premise's `unlinked.log` is
  now capped at warnings, but the existing file (about 1.7 GB in the user's
  workspace folder, `~/Library/Application Support/mapper/workspace` on macOS)
  stays. Delete it by hand; the app does not and should not.
