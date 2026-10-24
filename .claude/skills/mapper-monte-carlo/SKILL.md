---
name: mapper-monte-carlo
description: "Monte Carlo uncertainty propagation for single-product LCA. Use when touching sampling, uncertainty bases or MC results."
---

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

**The Iterations fields are `<NumberInput integerOnly min={1} max={MAX_ITERATIONS}
emptyValue={1}>`, never a clamped `<input>`.** Clamping in `onChange`
(`Math.max(1, Number(v) || 1)`) made the field impossible to clear: an empty
string is falsy, so it snapped back to 1 and the next key appended to it.
`MAX_ITERATIONS` (20 000) matches the backend's own 400 bound. A test that sets
the whole value with `fireEvent.change` passes on the broken version;
`monteCarloIterationsField.test.tsx` appends keystrokes to what the field shows.

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

### In a Claude Code shell, `grep -r` skips gitignored files — silently

In Claude Code's shell, `grep` is not `/usr/bin/grep`: it is a shell function
that runs ugrep with `--ignore-files` (and `--exclude-dir=.git`). **Anything
listed in `.gitignore` is skipped, and a search whose only matches are in
ignored files returns no matches, exit 1, no warning** — which reads as a clean
result. Your own Terminal uses the real `/usr/bin/grep` and is not affected.

Found on 2026-09-18 during the repo move: a `grep -r` path audit returned 0
files while `.claude/settings.local.json` (gitignored) held 11 stale paths and
`mapper-backend/unlinked.log` (gitignored) held more. It was first mistaken for
an iCloud-eviction artefact; it happened on the fully local `~/Developer` copy,
so it is not.

What it does and does not affect:

- **Searches over tracked source are fine.** Tracked files are never ignored.
- **Searches for things that live in ignored places are unreliable:** local
  settings (`.claude/`), logs (`*.log`), exports (`mapper-backend/export/`,
  `export/`), `_reference/`, `mapper-backend/data/`, `.env*`, build output.
- **A "no occurrences" conclusion needs the real grep** whenever the answer
  could sit in an ignored file:

      find <dir> -type f -not -path "*/node_modules/*" -print0 | xargs -0 /usr/bin/grep -lIE "<pattern>"

  or call `/usr/bin/grep -r` explicitly. `.xlsx` files are zip archives and
  need unzipping; neither grep sees inside them.

### Break-checks run with bytecode caching OFF

A break-check (deliberately breaking code to prove a test catches it, then
restoring) must run with `PYTHONDONTWRITEBYTECODE=1`, and `__pycache__` must be
cleared before trusting the restored run.

**This has now silently invalidated a verification twice.** Python treats a
`.pyc` as fresh when the source's `(mtime, size)` match what it recorded. A
break that only REORDERS lines keeps the size identical, and a restore within
the same second keeps the mtime — so the restored source runs the BROKEN
bytecode. On 2026-09-18, during step 2 of the authored databases, a reordering
break in `api/authored.py` kept running after restore: the "restored" suite
reported 1 failure, and two unrelated breaks appeared to trip a test they do not
touch. The first time was the 0.1.8 → 0.2.0 version literal below.

A break-check is exactly where a false result is most costly: a stale-bytecode
PASS reports that a test catches a defect it may not catch. Run it as:

    PYTHONDONTWRITEBYTECODE=1 python -m pytest ...     # during the break
    find . -name __pycache__ -type d -prune -exec rm -rf {} +   # before the restored run

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

**`impact_share = None` has TWO meanings, and neither is a number.**
`get_pedigree_coverage` returns `None` when the archetype has no scoreable rows
(every row a parameter expression) AND when its scoreable rows carry zero total
|impact| under the indicator — measured on the 0.3.0 demo: both worked-example
archetypes are 0.0 % under GWP100 and `None` under land use, because their
authored activity has no land-use factor. The Summary formatted it as
`impact_share * 100`, which was a 500 on every export in either state.
`impact_coverage_text()` writes the right sentence for each; the frontend
`CoverageBanner` splits on `archetype_materials_total` the same way. Tested
through the real route, not the builder
(`test_monte_carlo_export_no_share.py`). Audited at the same time: the
multi-item builder reads no optional field arithmetically, and every other
`* 100` in `api/` and `core/` is already guarded.

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

**The foreground is sampled too, and its draw is SHARED.** For a whole patch
cycle it was not: `_run_monte_carlo_multi` had no foreground RNG at all —
demands were built once per item before the loop and `mc.demand` was only ever
assigned a pre-built constant. `next(mc)` shared the technosphere, biosphere
and characterisation factors correctly; the foreground simply was not drawn.
Measured on Battery Circularity with one scored parameter, the paired run
reported **GSD² 1.1099 against the single-item path's 1.2015** at the same seed
— **67.7 % of the total log-variance missing**.

It bit hardest exactly where paired mode is most useful. Battery Circularity's
A and A0 are **42/42 and 43/43 EXPRESSION rows** — not one literal row between
them — so their foreground uncertainty is entirely parametric and the paired
A-vs-A0 comparison, the number that would be reported, had no foreground
component at all. MAp-test is the mirror image (931 of 969 rows literal), so
it is a poor place to notice this.

**Parameters are drawn once per ITERATION, across the union of every item's
referenced names, and applied to all items.** That is the foreground half of
the pairing: A and A0 share 23 parameters, and drawing them per item would let
one shared driver take two values in the same iteration — precisely the
decorrelation paired mode exists to remove, reintroduced one layer down. Row
draws stay PER ITEM (keyed by `node_id`) because a row belongs to one
archetype; two archetypes sharing a material NAME are still two rows, exactly
as in the single-item path.

**`next(mc)` must fire exactly ONCE per iteration, with item 0's demand pushed
in BEFORE it.** The chain solves for whatever demand is loaded when `next`
runs, so item 0 is NOT special — pushing its demand after the advance leaves it
with a deterministic foreground while every later item gets a sampled one, and
calling `next` per item gives each a different world, which destroys the
pairing. Both failure modes are pinned, and each is caught by a different set
of tests.

After the fix, paired item A's GSD² matches the single-item run to **0.000 %**
(identical RNG stream), the A-vs-A0 correlation is **0.9966**, and `sd(A−A0)`
is **20.7 %** of `sd(A)` — the shared parameter cancelling, which is the whole
point of pairing. The 95 % interval widens honestly from `[−0.0154, −0.0112]`
to `[−0.0180, −0.0099]` and stays entirely below zero.

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
- **Don't build the paired demands once, outside the iteration loop.** That is
  what left the foreground unsampled for a whole patch cycle. If anything in
  any item's foreground varies, every item's demand is rebuilt per iteration.
- **Don't draw a parameter inside the item loop.** Once per iteration, shared —
  or a shared driver takes two values in one iteration and the pairing is
  undone in the foreground while looking intact in the background.
- **Don't call `next(mc)` per item, and don't push item 0's demand after it.**
  One advance per iteration; item 0's demand goes in first. Advancing twice
  decorrelates the items; pushing late silently exempts item 0 from the
  foreground.
- **Don't verify a paired foreground with a correlation test alone.** It passes
  on a foreground that is correlated but too small. Assert the MAGNITUDE too:
  paired item i's GSD² must match a single-item run at the same seed.
- **Don't claim paired marginals are bit-identical for every item.** Item 0 is;
  later items agree to solver tolerance because of the CGS warm start.
