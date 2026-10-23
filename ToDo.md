# ToDo

Open items, newest release first. The developer's own running list lives
outside the repository; this file holds items recorded from work done in it.

## 0.3.2

- [ ] **AESA: renaming a configuration does not save.** Editing the name of an
  AESA configuration and pressing Save leaves the old name. Reported in the
  0.3.1 walkthrough (5). Not investigated yet.
- [ ] **AESA radar: show the point's SR values on hover.** Hovering a dot on the
  radar chart should show the Sustainability Ratio of the selected point (and
  its boundary). Requested in the 0.3.1 walkthrough (5).
- [ ] **Single-product "Change it in LCA Architect → Manager" link goes
  nowhere.** It calls `onNavigate('archetypes')`, which is not a tab id
  (`App.tsx` knows `lca`), so the content area shows the "Select a database"
  placeholder. Found while working on walkthrough 5; not fixed there.
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
  - **Multi-item comparison**: one synchronous `POST /lca/calculate-multi-product`.
  - **Project export / import**: synchronous; export streams a tar of the
    whole project.
  Making any of these stoppable means turning it into a registered task with
  checkpoints (the plca/impact/monte_carlo pattern), not a frontend change.
- [ ] **pLCA generation honours cancel only between premise stages.** The
  checkpoint is premise_engine's stage callback, so a Stop during one long
  premise transformation waits until that stage ends.
