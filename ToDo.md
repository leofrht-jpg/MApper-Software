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
