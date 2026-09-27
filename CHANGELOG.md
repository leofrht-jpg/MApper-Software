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
