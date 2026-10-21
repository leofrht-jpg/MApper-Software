# Changelog

All notable changes to MApper are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and MApper adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.3.0 are on the
[Releases page](https://github.com/leofrht-jpg/MApper-Software/releases) and
archived on [Zenodo](https://doi.org/10.5281/zenodo.22246255); this file starts
at 0.3.0 and is kept from here on.

## [0.3.0] — unreleased

The version is bumped at every site and the desktop build is made and walked,
but the tag and the GitHub release are not cut yet.

### Added

- **Impact-category lists and tables collapse.** Every card or table that
  lists impact categories (the indicator picker on every Impact Assessment
  page and the LCA Calculator, the single-product and Multi-item result
  tables, the LCA Calculator result tables, the Monte Carlo distributions
  table, the AESA Detail table) now has a chevron like the Results header,
  through one shared component. Expanded by default; a collapsed block keeps a
  one-line summary ("25 of 25 selected"); the state is remembered per page
  when the browser allows it.
- **AESA sensitivity cases you can see and choose.** With "Sharing
  sensitivity" ticked or parameter sensitivity cases in the project, Compute
  first opens a window listing each case and what it changes; only the ticked
  ones are computed (the base always is). Parameter cases, which never reached
  AESA before, are now recomputed through the single-product LCA under each
  case, including every year of a prospective run. A case switcher shows the
  base or any case in Radar, Timeline and Detail, and a new Cases view plots
  each case's SR difference from the base per impact category, with zone
  changes marked. The export's Sensitivity sheet now has one row per impact
  category and a column group per case (SR, difference from the base, zone);
  the case definitions are in the Summary, and the previous long-format sheet
  is kept as "Sensitivity (long)".

- **Authored databases.** Create your own Brightway database inside MApper and
  author activities in it from biosphere flows — for a process whose impact is
  its direct emissions, or a supplier's cradle-to-gate figure entered as one
  characterised value. Authored activities link into a Bill of Materials like
  any ecoinvent activity. The definition file is the source of truth and travels
  with a project export, including a modelling-only one; the Brightway copy is
  rebuilt after a project or ecoinvent import. **Biosphere-only in v1**: an
  authored activity cannot take a technosphere input, because such a link would
  not be translated into a prospective background and would silently keep
  base-year electricity in every future year of a prospective run.
- **Authoring UI** in the Database Explorer, with a preview that saving must
  agree with — the preview and the save verdict come from the same function, so
  they cannot disagree. Deleting an authored activity that a BOM row links to is
  refused, and the refusal names the rows.
- **Biosphere-flow compartment picker.** Browse biosphere databases grouped by
  substance and see, per compartment, what each method's characterisation factor
  actually is, how many of the family's indicators characterise it, and how
  heavily ecoinvent uses it. Choosing NOx to urban air versus high stacks is a
  decision rather than a guess. No compartment is preselected.
- **Uncertainty discipline on authored exchanges.** Every exchange is lognormal
  with all five pedigree scores required. Its basic variance defaults to
  ecoinvent's median for that flow, and a GSD² below ecoinvent's median for the
  same flow is refused unless a written reason is given, which is then stored
  with the number. Each exchange reports its floor status explicitly.
- **Per-exchange uncertainty basis.** An amount that is not an emission but
  someone else's characterised result (a supplier PCF, an EPD) can be marked
  `supplied`, which asks for *more* than the default — a variance and its source
  — and reports that no floor applies rather than demanding a justification for
  a comparison that was never made. The basis follows the number into every
  result, onto the Coverage sheet of every workbook and onto the Monte Carlo
  pedigree sheet, so a reader comparing two GSD² values is told when they
  describe different quantities.
- **Coverage declaration and "not specified" markers.** An authored activity is
  declared complete or partial, and a partial one declares *per indicator* which
  it is complete for. Any result that used a partial activity marks the
  remaining indicators as unknown rather than reporting a number that would read
  as "no impact" — on every result panel, in the AESA detail table, and on the
  radar, where such an axis is hatched and its Sustainability Ratio reported as
  a lower bound. Scores are unchanged; this is annotation only.
- **A Coverage sheet on every workbook** that reports impact or
  sustainability-ratio values, naming each indicator it reports as specified,
  not specified, or not recorded, with a pointer line on the workbook's first
  sheet. A test discovers every workbook builder and fails one that neither
  states coverage nor is exempt with a recorded reason, so a new workbook cannot
  ship silent.
- `CHANGELOG.md` — this file.

### Changed

- **AESA cases and sharing as a matrix.** The case switcher mixed parameter
  cases (v1g, v2h_credit…) and sharing choices (Equal per Capita, Industrial
  Output…) in one row, so a case could only be seen under the base chain. There
  are now two selectors, Case (Base and the parameter cases) and Sharing (the
  base chain, EpC, IN, AGR, LA, AR), and any case can be read under any sharing.
  A parameter case reruns the LCA once. A sharing choice changes only the SOS,
  so every case is also evaluated under every ticked sharing without another
  LCA. The compute window lists the two groups separately and says which one
  reruns the LCA. The Cases view and the export's Sensitivity sheets take each
  difference against Base under the same sharing. Base's own sharing variants
  are taken against the base chain. Every column and row names its case and its
  sharing, and the Summary lists both axes with their definitions. Results saved
  before this still switch and export.

- **No Lifetime preset; the years are always entered.** Stage amounts offered
  "1 year | Lifetime (15yr) | Custom", but not every product lives 15 years.
  The preset is gone from Single item, Multi-item and the LCA Calculator, and
  so is the default of 15. Under Custom a Years box starts empty; entering N
  sets every per-year stage to N and every per-unit stage to 1. It stays locked
  until each stage declares its basis, Manufacturing and End of Life included.
  Editing a stage by hand clears the years, because they no longer describe the
  run. The exports' "Lifetime (yr)" row prints the years entered, or "not used",
  and AESA's per-year functional unit divides by them. A result computed before
  this change, on the Lifetime preset, still exports and still divides. The LCA
  Calculator also stops scaling stages by the scope-derived "annual" hint and
  uses the declared basis, like the other two.

- **Results are addressed by the full method tuple; the indicator label is
  display only.** An LCIA method's last tuple element is not unique: EF v3.1's
  25 indicators share only 14 distinct ones, and four are called "global warming
  potential (GWP100)". See *Fixed* for what this was doing.
- **Fleet sheet headers are disambiguated at the source.** Annual totals, By
  indicator, By stage, By archetype, By fuel type, By cohort and By subsystem no
  longer give four columns the same name. The numbers under them were always
  correct and in request order, but a reader transcribing by column name could
  not tell which indicator they had taken, and these sheets are read off for
  publication.
- **The Database Explorer shows biosphere compartments.** Nitrogen oxides has
  five in `biosphere3` and previously rendered as five identical rows with a
  blank location. Biosphere flows also stop repeating their name as a reference
  product.
- **AESA downscaling provenance.** Each grandfathering layer carries its own
  source string beside the value it describes, instead of one combined sentence
  shown twice in the export. The AR principle's description now reads
  "Grandfathering – share of current annual emissions or activity", matching the
  single-year basis actually used. No Sustainability Ratio values move.

### Fixed

- **One selected year in AESA.** The "Selected year" card at the top right
  and the slider under the Radar and Box plot views each kept their own year,
  so the card could read 2030 while the chart showed 2040. The dashboard's
  year is now the only one; both controls set it, and switching views keeps it.

- **Cohort colours on the by-cohort charts match the cohort mapping.** On the
  Prospective chart (system level, MAp-test), the charger subsystems' colours
  differed from the cohort mapping table. With a Stack-by set, a band and its
  legend swatch took their colours from different places. The band used the
  cohort's mapping colour; the legend used a group colour from a map that knew
  only the primary system's dimension labels. A subsystem group such as "Public
  AC Charger" was missing from that map, so its swatch, and the band of any
  uncoloured subsystem cohort, fell back to a palette slot chosen by position,
  with one position for the legend and another for the band. Every group the
  chart shows now has its own colour, and a group's legend swatch is the
  mapping colour when its cohorts share one. The bands, legend, facets and
  tooltip use that one source, and the AESA Detail table now shows each cohort
  in the same colour.

- **The "Unit" column of the AESA export's "Impacts vs SOS" sheet now follows
  the impact basis.** It printed the boundary's per-year unit (`kg CO2 eq/yr`)
  beside impacts that were per functional unit. It now reads e.g.
  `kg CO2 eq per functional unit` (as computed) or `kg CO2 eq/yr` (per year),
  and the "SOS basis" column states the SOS's own per-year unit. No column
  moved.
- **AESA configurations for single-product runs could not be saved, and every
  save dropped three fields.** Saving returned 404 because the routes required
  a DSM system, and both create and update left out the sharing chain, the
  preset it came from and the scenario pick, so a customised chain was never
  stored. Both routes now build the configuration from one shared function, a
  single-product configuration saves without a system and appears in the
  configurations list, and a newly saved custom chain survives its first load.

- **A one-row impact category looked empty in the indicator picker.** The
  category headers were sticky inside their own sections, so EF v3.1
  acidification scrolled its only row ("accumulated exceedance (AE)") under its
  own header while it was listed and selected. The headers no longer stick.
  The selected-indicator chips also named only the indicator, and EF v3.1 has
  two "accumulated exceedance (AE)"; they now use the same disambiguated label
  as the result tables.

- **The AESA tab had two CO₂ / CO₂-eq budget toggles; the one above the result
  views is gone.** It re-ran the compute on click and could disagree with the
  Configuration panel about which basis a result was computed on. The
  Configuration panel's Carbon budget section is now the only control, and the
  basis is still stated, read-only, in the export's Summary and Carbon Budget
  sheets.
- **The AESA export did nothing on a single-product run.** Three causes, all
  silent: the button returned early when no DSM system was active (always, for
  a single-product run); the export route 404'd for the same reason; and any
  error went only to the browser console. The export now runs without a DSM
  system, and in the packaged app the backend writes the workbook to
  `~/Downloads` and the tab shows the path for 8 seconds (the same mechanism as
  Settings › Logs). A failure is shown in the tab.
- **AESA now states what each impact is per, and can annualise a whole-life
  run.** The Sustainability Ratio divides an impact by a per-year allocated
  SOS, but nothing on screen said what the impact was per, so a whole-life
  pLCA total was compared with a per-year SOS unnoticed (EVS40: impact
  51,993.786 kg against 543.092 kg/yr, SR 95.7). A new **Functional unit**
  option in the Configuration panel chooses *As computed* (the default and the
  previous behaviour, unchanged numbers) or *Per year*, which divides by the
  lifetime the run's stage amounts were scaled with. *Per year* is refused for a
  run not on the Lifetime preset, for a fleet source, and for a BOM that already
  divides by its lifetime (the EV9 archetype does), where it would divide twice.
  The basis is shown under the zone cards, in the Detail table headers, in the
  Radar tooltip, in the export, and is saved with configurations and sessions.
- **A single-product export could print a lifetime its numbers were not
  computed with.** The "Lifetime (yr)" row was read from the stage-amount
  editor at export time, not from the run, and a lifetime taken from a
  parameter did not follow later edits of that parameter. An EVS40 export read
  "Lifetime 15" beside "Use Phase 16". Exports now carry the run's own stage
  amounts, frozen at compute time; the row says "not used" under the 1-year
  preset or custom amounts, names the parameter when one was used, and the
  Prospective workbook states that its year range is the background-database
  years, not the product lifetime. The Prospective tab says so too when the
  two differ.

- In the authored-activity editor, the exchange Amount field now looks like the
  other fields (it rendered with no border or background and read as plain
  text), and the below-floor message asks for "a reason" instead of naming the
  request field `floor_reason`.
- **A project switch kept the previous project's archetype in Single-product
  Impact Assessment.** After switching, the selection still held an archetype id
  from the other project, Calculate stayed enabled, and a Prospective run failed
  with "Archetype '…' not found"; the error then stayed on screen after picking
  an archetype from the new project. The single-product view now starts fresh on
  a project change, and the single-product and Multi-item stores reset with it.
- **The Uncertainty page's Iterations field could not be cleared.** It clamped
  to at least 1 on every keystroke, so emptying it snapped back to 1 and typing
  a new count produced "164" for "64". Both the single-item and multi-item
  fields now clamp on blur (to 1–20 000, the backend's own range); the default
  of 1000 and the run payload are unchanged.
- **The Monte Carlo export returned 500 when the impact-weighted coverage had
  no share.** The Summary formatted `impact_share * 100`, and `impact_share` is
  `None` in two ordinary states: an archetype whose every row is a parameter
  expression, and one whose scoreable rows carry zero total impact under the
  chosen indicator (an authored activity with no factor for it). Both now get a
  sentence saying which, never a number and never 0%. The Uncertainty page's
  coverage banner had the same conflation: it said "every row is a parameter
  expression" in the zero-impact case too, and now distinguishes them.

- **The authoring UI could not reach the backend at all.** Five client calls
  sent `JSON.stringify(...)` with no `Content-Type: application/json`, so
  Starlette handed FastAPI raw text and every one answered **422
  `model_attributes_type`** — "Input should be a valid dictionary or object to
  extract fields from", with the JSON quoted back as a string, which reads like
  a schema bug rather than a missing header. Creating an authored database,
  adding or updating an activity, previewing an exchange and fetching reached
  indicators were all dead — in the dev browser as much as in the packaged
  app, because `fetch` omits the header in both. The header is now set once,
  where the client builds headers, for any string body that does not already
  carry one; `FormData` is untouched so the browser still sets its multipart
  boundary.

- **Prospective single-product calculation raised `NameError` in v0.2.1 and
  v0.2.2.** Reached only when a premise database is installed — which CI does
  not have — so the Prospective tab, prospective contribution analysis, the
  trajectory endpoint and Monte Carlo against a prospective background all
  failed in released builds. Two further undefined names were fixed with it:
  every DSM "Download template" link returned 500 (v0.2.2), and a DSM scenario
  with scaling rules returned 500 (latent since v0.1.0). The package is now
  guarded by pyflakes' undefined-name check with no exemptions.
- **The Stage breakdown sheet under-reported indicators.** Keyed by the
  indicator label, it wrote 14 rows for a 25-indicator run, and the surviving
  row named "global warming potential (GWP100)" was *climate change: land use
  and land use change*. The per-item `SB_` sheets were worse: they wrote all 25
  rows and gave the four climate rows one shared stage vector, so the sheet
  looked complete. The comparison table and the stage-breakdown chart dropped
  the same 11 of 25, and the Line chart plotted the first climate variant
  whatever was selected. **The fleet pipeline and AESA were never affected** —
  both key on the full tuple throughout.
- **The Multi-item lifetime preset applied a multiplier of 1.** Where an
  archetype declared no per-stage basis, "Lifetime · 15 yr" was recorded over a
  multiplier of 1 — a whole product's manufacturing against one year of use,
  labelled whole-lifecycle. The fleet pipeline was never affected: it has no
  stage-amount input, and applies the use phase once per stock-year.
- **The Archetypes list returned 500 in the demo project.** Both seeded demo
  archetypes had stage roots with no id, which the archetype summary rejects, so
  the whole list was unreachable for that project on every install. Node ids are
  now assigned on load as well as on create, which repairs every project already
  on disk, and the demo builder assigns them itself.
- **Three AESA configuration overlays were unreachable.** They rendered inside a
  sticky sidebar, so the modal was visible while its buttons could not be
  clicked — intermittently, depending on whether a chart was painted underneath.
- Tailpipe factor derivation is keyed by biosphere flow rather than flow name,
  so compartments of the same substance no longer merge. The rebuilt data is
  unchanged.
- Bare `pytest` works from the backend directory; it previously failed at
  collection on every file, which read as a broken branch rather than a missing
  install.
- **Settings › Logs: "Copy all" and "Export" did nothing in the packaged app.**
  Two causes behind one symptom. Export built a `blob:` URL and clicked a
  hidden `<a download>`; the packaged app's webview has no download delegate on
  a remote http origin, so the click produced no file and no error. The backend
  now writes the file and the app reports the path it wrote. Copy treated
  `document.execCommand('copy')` as successful whenever it did not throw — it
  returns `false` instead — and the caller discarded even that, so neither
  outcome was ever shown. A copy that fails now says so, and one that works
  confirms on the button.
