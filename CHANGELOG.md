# Changelog

All notable changes to MApper are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and MApper adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.3.1 are on the
[Releases page](https://github.com/leofrht-jpg/MApper-Software/releases) and
archived on [Zenodo](https://doi.org/10.5281/zenodo.22246255); this file starts
at 0.3.1 and is kept from here on.

## [Unreleased]

### Changed

- **Runtime dependency updates.** React and React DOM 19.3.1, d3 7.9.2, lucide-react 1.68.0, zustand 5.0.16 and the React type packages 19.3.0. Two updates were held back on purpose: svg2pdf.js stays at 2.7.0 (later versions break chart export loading) and @tanstack/react-virtual was held at 3.14.10 at that time (3.14.26 emptied the Database Explorer list in tests) and moved to 3.14.26 in the next entry.
- **Tooling and CI updates.** CI actions in the Windows release workflow (cache 6, upload-artifact 7), ESLint 10, vitest 5 with @vitest/ui, and TypeScript major versions are ignored by Dependabot (TypeScript 7 is not yet supported by typescript-eslint).
- **@tanstack/react-virtual 3.14.26** (virtual-core 3.19.11), with its Dependabot hold removed. The Database Explorer list test now mocks `clientHeight` and `clientWidth`, which the new version reads. The held-back note on the runtime updates line no longer applies.
- **"Stop waiting" on the Calculating LCA cards.** LCA Architect (activity and archetype), Multi-item comparison and single-product Static and Prospective now have a Stop waiting button. It ends the screen's wait and shows a neutral "Stopped" line; the server still finishes the calculation, so the next one can queue behind it.
- **The note under "Stop waiting" is two lines.** "The calculation may keep running in the background." and, on its own row, "The next one can take longer." One shared component serves all the Calculating LCA cards.
- **Long (i) text in the Method Library is short.** An entry whose (i) text is over 350 characters (EF v3.1: about 1,700) now shows what it installs and its note on offline use and what it needs, then "More under Details." The rest of the description and the factor source moved into that entry's Details, word for word.
- **The Years box says what unlocks it.** While a stage still has no basis, the box has a tooltip ("Choose a basis for every stage first"), the hint line beside it is in normal size and contrast, and clicking the box moves the focus to the first stage that is "not declared". Single-product Impact Assessment, LCA Architect and the Multi-item global Years box; the gating itself is unchanged.
- **Windows installer: fast solver (UMFPACK).** The Windows release build now installs scikit-umfpack and fails if it does not load, agree with SciPy's solver, and ship with its DLLs and report "UMFPACK solver: OK" from the built sidecar. Included from the first release built after this change, and confirmed on one Windows machine with an installer built by hand from this change: the log said "UMFPACK solver: OK", and one single-product LCA gave 2.1194 kg CO2-Eq, the same value as on the Mac and with the 0.4.0 installer, in about 5 s instead of 153.88 s (one machine, one calculation; the supply chain tree and the first-launch time were not measured). The 0.4.0 Windows installer does not include it.

### Fixed

- **LCA Architect search timer.** The 300 ms delay on the activity search is now cancelled when the page is left, so it no longer fires after the page is gone. No visible change; it removes an occasional "window is not defined" error at the end of a test run.
- **The (i) help popover is no longer cut off at the window edge.** It is placed against the window: below the button when it fits, above when it does not, shifted to stay 8 px inside, and narrowed in a small window. It also opens in front of panels that clip their content.
- **Search, filter, code and numeric fields no longer get the macOS suggestion bubble.** The Settings search offered "Row" for "row". Search boxes, filters, activity and database codes, units, expressions, years and every numeric field now switch off autocomplete, autocorrect, auto-capitalisation and spell check; names, descriptions and comments are untouched.
- **The (i) popover keeps its size and position while a container scrolls.** Its width is fixed at 306 px (or the window minus the margins) and its height is capped at the window height minus the margins, with the text scrolling inside. Before, the height cap was lost after the first scroll and, inside a blurred modal such as the Method Library, the box could sit away from its button and run past the window edge.
- **A request the app cancels itself is no longer logged as an error.** Stop waiting, the supply chain tree Discard, leaving a screen, switching project and a search that replaces the previous one each aborted a request, and every abort wrote "network error: signal is aborted without reason, AbortError" to the Settings log (and into the exported log), pushing real errors out of its 50 entries. Those aborts now write nothing. Network failures, server errors and timeouts are logged as before.
- **The Contribution analysis header shows the real run time.** It printed "0.00s" for a result that took seconds: a repeat of the same request is served from the backend's memory in milliseconds, and the header showed that lookup. The time of the run that produced the result is now kept with it and shown with "(cached)" when it is served again; a time under 0.01 s reads "<0.01s". The multi-year header and the multi-item time use the same rule. The API response gains a `cached` field; `elapsed_seconds` keeps its name.

## [0.4.0] — 2026-11-07

### Added

- **Warnings and errors are one line, with Help.** The BOM validation report, the Method Library install warning and failure, the BOM import refusal, the authored Excel errors, the ecoinvent import failure and the DSM simulation warnings now show ONE visible line (a marker, the count and a summary), never hidden; the full original message is behind "Details". A warning with no help entry yet is shown in full. Settings has a new collapsed section, "Most frequent warnings/errors", with a search box: each entry gives the cause and the fix, and the Help link on a warning opens its entry. 72 entries cover every code the backend emits; a test fails if a new code has none. The other screens follow in later releases.

- **Authored databases through Excel.** Database Explorer has "Import from Excel", "Download template" and, on an authored database, "Export to Excel". The workbook (Read me, Database, Activities, Exchanges, Lists) is checked as a whole before anything is written: every error is listed with its sheet, row and column, and a dry run shows a preview. It goes through the same authored engine as the editor, so every existing rule applies (flow checks, pedigree, ecoinvent variance and floor, scope). A flow can be given by code, or by exact name and compartment (refused if zero or several flows match, with the candidates). An existing database name is refused. Files are size- and zip-checked, formulas are rejected, and exported text that starts with = + - @ is neutralised and restored on import. Activity descriptions and exchange comments are not supported yet (a follow-up); activity codes are new on import.

- **One-click EF v3.1 in the LCIA Method Library.** A project imported from ecoinvent has no LCIA methods; the library now installs the 25 EF v3.1 methods offline from the factors shipped with the installed Brightway software, linked to the project's existing biosphere3 (never modified). It reports how many factors were found, linked and skipped, and lists the 10 most frequent skipped flows.

- **One-click ReCiPe 2016 and CML v4.8 in the LCIA Method Library.** ReCiPe 2016 midpoint and endpoint (hierarchist, individualist and egalitarian together) and CML v4.8 2016, with and without long-term emissions, install offline from the factors shipped with the installed Brightway software, on the same installer as EF v3.1 (linked by flow code, then name and compartment; `biosphere3` only read; skipped factors counted, listed, and the indicators that lost a quarter or more named). Every Library entry now says in one sentence where its characterisation factors come from.

- **Supply chain tree in Impact Assessment.** Single item > Static and the Multi-item results now offer the same explicit "Build supply chain tree" button as LCA Architect (nothing is built until you click; "Discard" and "Try again" work the same, with a real elapsed counter). A tree is for one indicator and one sensitivity case, picked next to the button, and is built from the result as it was calculated (archetype, scope, stage amounts, case, database; for an activity, its database, code, amount and vintage year), never from what the page holds now. Multi-item has one button per item and builds one tree at a time. System-level, Comparison and Projected are unchanged.

- **Long help sits behind an (i), warnings and details behind a "Details" toggle.** The Method Library entry shows its name, a one-line description and its status; the long description, factor counts, skipped-factor explanation and the offline note are in Details. "Installed with warnings" is one line ("9.1% of factors skipped") with its list behind Details. The supply chain tree notes ("Can take up to a minute…", "one at a time", "Discard stops waiting…") moved behind an (i). New shared controls `InfoButton` and `DetailsToggle`; the UI templates (Export, Discard/Delete/Remove, Cancel, primary) are written down in `mapper-frontend/CLAUDE.md`, and a test fails on any new raw or off-template button (today's list is the baseline).

### Fixed

- **The sheet row is in the warning line.** A BOM validation warning or error, and the "import refused" line for biosphere links, now name the row in the visible summary: "Activity code has the wrong length (row 5)", "(rows 5, 9, 12)", and "(rows 5, 9, 12 +4 more)" past three. The full original message is unchanged behind "Details". With no row the line reads as before.

- **A disabled button looks disabled.** The shared button had no disabled style, so "Continue" in the ecoinvent import wizard looked active after a failed "Verify" and did nothing when clicked. A disabled button is now dimmed with a "not allowed" cursor everywhere, and "Continue" stays disabled until the folder is verified (and again as soon as the path changes).

- **The Years box says what it needs, and LCA Architect can meet it.** Years stay available only when every stage has a basis (no number changed; a stage with no basis still counts once), but the hint now reads "Years need a basis on every stage. For Manufacturing and End of Life choose per unit (counted once).", and LCA Architect > Single-product LCA gets the per-stage basis dropdown that Impact Assessment already had (it stores the same stage basis), so the hint no longer points at a control that was not on that screen. In Multi-item, typing years now says which items did not take them ("Years not applied to: ...") and the box is disabled when none can. While no years are entered, the stage amounts say "Annual stages count 1 year".

- **The archetype validation banner follows your edits.** "This archetype has 1 validation warning", its "View report" and the counts were written once, at import, so after you fixed a row (for example a waste treatment's quantity from 0.5 to -0.5) the row's icon cleared but the banner stayed. Editing a row (amount, expression, unit, name or link), adding a row or deleting one now re-checks just those rows with the same validator and updates the banner, the report and the counts. Every other finding keeps the sheet row it came from. No validation rule changed.

- **Authored Excel import: a taken database name is one clear error, and the name box is filled in.** A name that already existed was reported twice (an authored database is both an installed database and an authored one, and each check raised its own error) with a vague text. It is now one error, "A database named 'x' already exists. Choose another name.", and the "Database name" box shows the name from the file instead of being empty, so you can edit it.

- **Method Library entries keep their long text behind an (i).** The long description, the factor source, the note and the install facts (size, versions) are in the (i) next to the name; Details keeps the source link, the indicator count and the install report line, and stays collapsed. "Offline" is said once instead of twice.

- **BOM import messages cite the row you see in Excel.** The importer numbered rows after filtering them per archetype and sorting stage roots first, so "Row 6" could be a cell on sheet row 3, in warnings, validation errors and the biosphere-link refusal alike. Every row number is now the real sheet row (the header is row 1). The BOM template's Instructions sheet also gains a Description row (optional free text, informational, not used in any calculation). Validation rules and results are unchanged.

- **The downloadable BOM workbook template is aligned again.** `mapper_archetypes_template.xlsx` had a Basis column in its header but no Basis cell in its example rows, so from the fourth column on every value sat one column to the left of its header (a stage name under Parent, `component` under Name, `1` under Type). Importing the file as downloaded gave 70+ structure warnings and no linked material. The example rows are now written by column name, so a header change cannot shift them again. Basis is set on the stage root rows only ("per unit", or "per year" for use-phase and maintenance consumption); the examples are otherwise the same. The only import errors left are the placeholder `EXAMPLE_CODE_*` links, which point at nothing on purpose.

- **ReCiPe 2016 midpoint climate indicators are shown under the name of the factors they hold.** The bundled data calls the climate indicator of the hierarchist and individualist perspectives "GWP1000", but the hierarchist one holds 100-year factors (CH4 36, N2O 298) and the individualist one 20-year factors (CH4 85, N2O 264); only the egalitarian one is 1000-year. Picking "ReCiPe (I) GWP1000" therefore gave 20-year results. MApper now shows GWP100 and GWP20 in the method picker, results, charts and export labels (the "no LT" variants too), and the Method Library entry explains it. Display only: no method is renamed, no factor changes, existing projects and stored results are untouched, and a project that already has the corrected names is not corrected twice. Path columns in exports keep the registered tuple so the method can be found again.

- **A BOM row linked to a biosphere flow is refused with the real reason.** It used to be reported as a "truncated code" (a flow's uuid is 36 characters), or reached the solver and failed with an HTTP 500. The import now refuses the file naming the sheet, row and column, writes nothing, and points to authored activities for direct emissions; the same row reaching a calculation answers a clear 422 instead of a 500. Calculations that succeed are unchanged.

- **A positive quantity on a waste-treatment activity now warns.** ecoinvent enters waste inputs with a negative quantity, and MApper uses the quantity as given, so a positive one silently gave a credit instead of a burden. The import report and the editor row now say so (a warning: the import still succeeds). A negative quantity on an ordinary activity, a legitimate avoided burden, is not flagged. Expression rows are not checked.

- **Authoring works in a brand-new project.** Creating or editing an authored activity in a project that holds only a small biosphere failed with "no such index: exchangedataset_output": the statistics pass forced an SQLite index that Brightway builds only when one write carries 100 or more activities (an ecoinvent or biosphere import). The index is now used only where it exists. The query returns the same rows either way, nothing is created or changed in the project's database, and projects that have the index run exactly as before.

- **LCA Architect no longer builds the supply chain tree by itself after Calculate.** It is built when you click "Build supply chain tree" (with the hint that it can take up to a minute), from a snapshot taken at Calculate so the tree always belongs to the score shown, even if an amount is edited afterwards. One run at a time, a real elapsed counter instead of invented phases, "Discard" (it ends the client's wait; the server may keep computing until it finishes), "Try again" after an error; a recalculation or leaving the page drops the request in flight. Removes the unused, auto-fetching `lcaStore`.

- **The Export buttons use the standard button style.** "Export XLSX" in LCA Architect and the Export buttons of Impact Assessment > Single-product (Static, Projected, Comparison) are now the standard secondary `Button`, with one export spinner that actually turns (the `lca-spin` class had no rule, so the contribution-analysis export spinner never moved).

- **The LCIA Method Library text on skipped metal factors now says what was measured.** The EF v3.1, ReCiPe 2016 and CML v4.8 entries no longer claim the metal indicator "loses more than half of its factors": the skipped factors sit on old ore-style flows that no ecoinvent 3.10 or 3.11 exchange uses, and the real gap is rare earths, hafnium, scandium, some platinum-group metals and graphite, which the bundled ecoinvent 3.9 data does not characterise (about 26% of metal exchanges in the audited projects, about 0.005% of the metal mass of an NMC811 battery).

- **Long imports and other background tasks report progress and failures honestly.** A failed task now sends its error text (`error`, next to the unchanged `message`) instead of only the last progress line, logs the full traceback, and ends in a failed state on any exception instead of staying "running"; the credentials import no longer uses a multiprocessing pool and shows elapsed time with a "no progress for N minutes" warning; the import wizard shows "Connection lost", polls the new `GET /api/tasks/{id}` when its socket drops, shows the final state or error it finds, and highlights the downloading step.

- **Database Explorer list no longer overlaps rows or jumps back while it loads.** A search that shrinks the result set resets the scroll and focus to the top; appending the next page no longer scrolls back to the focused row; a page or search answered after a newer search is ignored (the previous request is aborted); rows are keyed by database and code; ties in the list order are broken by activity code, so pages never repeat or skip a row; and the count reads "146 matching activities" instead of "146 matching filters".

- **An ecoinvent import no longer silently loses biosphere exchanges.** Importing a release into a project whose `biosphere3` came from an older release dropped every exchange on a flow the old `biosphere3` lacked, with no warning (3.11 into a 3.10-era `biosphere3`: 41,915 of 541,321 exchanges, 7.7%). Both import routes now add the release's missing flows to `biosphere3` (never changing an existing one, and stopping with a clear message if one disagrees), and report how many biosphere exchanges were found, linked and dropped, with a warning when any were dropped.

- **Uninstalling a method clears its install report.** The "Installed with warnings" box and the factor counts stayed on screen after Uninstall; they are removed with the method (the backend manifest already dropped the project's entry, now pinned by a test).

- **Discard on the supply chain tree is red like the other destructive buttons**, and Uninstall in the Method Library is the same filled red `danger` button.

- **Single-product LCA shows the full-screen elapsed overlay while it calculates**, the same one Impact Assessment uses (a real counter, no invented progress). It used to show only a small inline line.

### Changed

- **Windows LCA runs factorise the technosphere once.** Without UMFPACK the runner ran a full SuperLU `spsolve` for every solve (about 71 for a 70-process product). It now factorises once with `splu` and reuses the factor, re-factorising whenever the matrix changes.

## [0.3.2] — 2026-10-24

### Changed

- **In-app dialogs replace every native window dialog.** The packaged app's
  webview has no dialog handler: `window.confirm` answered "no", `prompt`
  returned nothing and `alert` showed nothing. So guarded deletes never
  happened, a new name could not be typed, and failure messages were lost.
  All 65 calls are now in-app confirmations, name prompts, choices,
  messages and toasts, across AESA, the BOM editor, the parameter manager,
  LCA Architect, the Method Library, pLCA, Archetypes, DSM and subsystems.
  A choice that offered "Cancel" as one of its branches now aborts on Escape
  instead. A test fails on any native dialog call under `src`.
- **The no-native-dialogs guard is absolute (#190).** With every call
  migrated, its allow-list is gone: any native `confirm`, `prompt` or `alert`
  anywhere under `src` fails the test, and only the dialog module itself is
  exempt.
- **The app page can no longer navigate away.** In a 0.3.2 development build
  the window once replaced the whole app with a page it could not leave until
  quit. Links to `blob:`, `data:`, `file:` or another site are now cancelled
  with a short "Navigation blocked" message. Exports still save, through
  one shared download helper. A file dropped outside a drop zone is no longer
  opened in place of the app. The two external links (the premise GitHub page
  in Settings and a method's source in the Method Library) are blocked the
  same way.
- **Identifier fields are not auto-capitalised.** Parameter, case, scenario,
  folder, stage and database names, principle ids and dimension names turn
  off macOS auto-capitalisation, autocorrect and spell check, and so do name
  prompts. Auto-capitalisation kept producing a capital letter that the
  snake_case rule then rejected.
- **premise's `unlinked.log` is capped at warnings.** It was written at INFO
  and grew large in the app's workspace. The existing file is left as it is.

### Fixed

- **"Add parameter" closed while editing the name.** Selecting text in the
  Name field and releasing the mouse over the dimmed background counted as a
  click on the background and closed the window. A window now closes from the
  background only when the press also started there. The same applies to the
  Scenario manager, the Method Library, the bulk learning-rate and rebound
  windows, the AESA principle and layer editors and the Archetypes folder
  picker. Keys and clicks on a dialog shown above one of these windows no
  longer reach the window underneath.
- **AESA export no longer overwrites a file of the same name.** A second
  export with the same name is saved as `name (1).xlsx`, then `name (2).xlsx`,
  and the page shows the name it was saved under. Log exports keep their
  timestamped names.
- **Renaming an AESA configuration saves.** Save was disabled whenever the
  source toggle read System-level and no DSM system was selected, even for a
  configuration that was already saved, and the hint only mentioned Compute.
  A saved configuration now saves without a system, keeping the one it was
  saved for. A new System-level configuration still needs one, and the page
  says so.
- **The AESA radar shows a point's values on hover.** Hovering or focusing a
  dot shows the boundary, year, Sustainability Ratio and zone, impact and
  allocated SOS. On a not-specified axis the ratio is shown as a lower bound.
- **"Change it in LCA Architect → Manager" opens LCA Architect.** The link on
  the single-product page led to an empty "Select a database" page.
- **Windows CI and the Windows release build pin Miniforge 26.7.2-1.**
  Miniforge 26.9.4-0 failed in `conda init` on the Windows runner. macOS stays
  on the latest Miniforge.

## [0.3.1] — 2026-10-22

0.3.0 was prepared but never tagged or released; its entries are included here.

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

- **Reveal in Finder for a saved log.** In the desktop app, Settings › Logs ›
  Export now shows a "Reveal in Finder" button ("Show in folder" on Windows)
  beside the path it wrote. The backend, which saved the file, asks the system
  to show it, and it refuses any path outside the folders it saves to. "Copy
  all" writes no file, so it has nothing to reveal.
- **A warning when every AESA ratio is below 0.001.** A single-product run
  under a downscaling chain that stops at a sector divides one product's impact
  by a whole sector's share of each boundary, and every ratio reads as safe. The
  AESA page now says that the chain probably does not reach a single product.
  No value changes.

### Changed

- **Impact-category abbreviations follow one convention**: AP, GWP100, ETfw,
  EPf, EPm, EPt, HTPc, HTPnc, IRP, LU, ODP, PM, POCP, ADPf, ADPmm, WU, on screen
  and in the export's Abbreviation column. Eight changed (for example ETP-fw
  became ETfw, ADP-mm became ADPmm). No other place used the old forms.
- **Authored-editor messages use the names on screen.** A refusal said
  "basic_variance_reason" or "floor_reason"; it now names the Basic variance
  box, the reason under it, and the Partial inventory note.
- **Settings › Logs is no longer flooded by Brightway.** bw2calc wrote "Switching
  LCIA method" and "Redoing LCIA" at INFO on every characterisation, thousands of
  lines per run. Its INFO lines are dropped; its warnings and errors still come
  through.

- **Loading cards, checked against measured times.** Every calculation entry
  point was timed on a sidecar against EVS40 and MAp-test. Five take more than
  10 s, and each shows the shared loading card (what is running, elapsed time;
  the page stays usable):
  - AESA with four parameter cases × all sharing, 77 s;
  - Monte Carlo, 1000 iterations, 69 s;
  - system-level Prospective, 63 s;
  - single-product Prospective over four years, 19 s;
  - system-level Static with 25 indicators, 11 s.

  DSM simulation, subsystem compute, material flows and every export finished
  in under a second. The AESA card now says what it is running ("5 cases ×
  6 sharing · 4 LCA reruns"). It also appears on the dashboard when the
  Configuration panel is collapsed, which used to hide it during a minute-long
  case run.

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

- **macOS asks for Downloads access as "MApper".** The first export showed
  "mapper-tauri would like to access files in your Downloads folder." The app
  is ad-hoc signed without its Info.plist bound, so macOS named it after the
  executable, which was the Rust package name. The executable is now `MApper`
  (`mainBinaryName`), and the Info.plist carries a Downloads usage string.
  Windows installs `MApper.exe` in place of `mapper-tauri.exe`; the installer
  name is unchanged. macOS asks once more after updating, because the renamed
  executable is a new identity to it.
- **No more tailpipe warnings on prospective runs.** A system-level
  prospective run logged two warnings per year saying the `mapper-tailpipe`
  activities were "not found" in the premise database and "fell back". Keeping
  them on their own database is correct (premise makes no variant of them);
  the warning came from the run not knowing which base database its premise
  databases were generated from. It now does, and logs one INFO line per run
  with the number of such links. A base ecoinvent activity that premise really
  dropped still produces a warning. Also fixed: importing premise silently
  disabled MApper's own loggers created before it (premise reconfigures
  logging at import), so depending on import order some warnings never
  reached the log; they are re-enabled once the app has loaded.
- **The backend test suite no longer writes into your data.** It logged
  into the real `mapper.log` (thousands of test lines, some of them planted
  "errors"), and test runs on older branches recreated an empty `guard-db`
  database in real projects. Tests now log to a temporary directory, and the
  suite fails if anything opens the real log or changes the database or method
  registry of any real Brightway project. `MAPPER_LOG_DIR` overrides the log
  directory.
- **Long calculations show a full-screen card.** AESA compute, Impact
  Assessment Calculate (system-level Static and Prospective, single-product
  Static and Prospective, Multi-item), Monte Carlo (single and paired), DSM
  simulate and project export/import now dim the screen and show a centred
  card in the style of the startup screen: what is running, what it is doing
  (for example "5 cases × 6 sharing · 4 LCA reruns"), the elapsed time, and
  Stop where the run can be stopped. The rest of the app cannot be clicked
  while it runs. It replaces the small inline status lines. With the AESA
  Configuration panel collapsed, the AESA card now shows too.
- **System-level Prospective Calculate showed no progress after a
  Sensitivity-cases run.** The panel decided "running" from the finished
  sensitivity runs left in memory and ignored the new calculation, so neither
  the progress card nor Stop appeared, and Stop could not have cancelled it.
  Both now look at every kind of run.
- **AESA reset says what it resets.** The confirmation now reads "Reset the
  configuration to the default template? Unsaved changes are lost." and lists
  everything it replaces: the name, boundary set, downscaling chain, sharing
  principles and assignments, carbon budget, method mapping and LCI
  background (it used to name four of these). When a saved template is loaded
  it warns that the template stays selected, so pressing Save afterwards
  overwrites it with the defaults. Deleting a template from the
  Configurations menu now asks with a second click in place; it used
  `window.confirm`, which does nothing in the packaged app, so deletion never
  happened there.
- **AESA Configurations pill after a project switch.** The pill now shows on
  every state of the AESA page, including a project with no DSM system and one
  with no templates yet, and lists every saved template of the current project
  with what each was saved for. Switching project while on AESA used to empty
  the list until you left the page: the list is now reloaded on the switch.
  AESA requests also now carry the project header and `no-store`, like every
  other request; without them a webview could answer the template list from
  cache with the previous project's templates. The compute source (single
  product or system-level) is remembered per project for the session instead
  of falling back to system-level on every switch.
- **The not-specified note counted labels, not indicators.** It said "Not
  specified for 14 indicators" beside a table marking 23, because EF v3.1's 25
  indicators share 14 short names and the note counted the names. It now counts
  indicators and names each one unambiguously ("climate change: fossil").
- **The AESA export said "Impact Mode: static" for a Prospective single-product
  run.** It printed the configuration's fleet Background setting. The result now
  records what fed it, and the Summary row is "Impact source" (for example
  "Single product (LCA), Prospective"). Results saved before this say "not
  recorded" rather than guess.
- **Opening a dependent subsystem before computing it logged an ERROR.** The
  view asks for the result on open, and "not computed yet" came back as a 404.
  It is now an ordinary empty answer; an unknown subsystem is still an error.

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

- **Multi-item Monte Carlo across two authored databases.** A paired run whose
  items live in databases that do not reach each other (the polycarbonate
  enclosure in "Supplier PCFs (worked example)" with the flare in "Flaring
  (worked example)") stopped on its first iteration with
  `OutsideTechnosphere`: the sampled matrices were built from the first item's
  databases only. They now hold the databases every item reaches. When all
  items share one background, as with ecoinvent archetypes, nothing changes:
  the same seed gives identical samples before and after.
- **One header per impact-category list.** The system-level Static and
  Prospective panels wrapped the picker in a second collapsible ("Indicator
  selection · 25 of 25 selected") around the shared one ("Impact categories ·
  25 of 25 selected"), and the LCA Calculator put an "All indicators" heading
  above each of its three results tables. Each list now has the single
  "Impact categories" header with its summary.
- **`guard-db` in the database list.** A test wrote an empty database called
  `guard-db` into whichever Brightway project was current on the machine
  running the tests (found in default, Battery Circularity and EVS40). The test
  now uses a stand-in backend, and the test suite fails any test that adds a
  database to a real Brightway project.
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
