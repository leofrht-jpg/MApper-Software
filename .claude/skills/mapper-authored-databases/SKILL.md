---
name: mapper-authored-databases
description: "Authored databases (user-defined activities by biosphere flows), 'Not specified' markers and exchange-level uncertainty basis in the backend. Use when touching authored databases, partial activities or uncertainty basis."
---

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
