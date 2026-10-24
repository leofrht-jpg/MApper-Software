---
name: mapper-archetypes
description: "Archetypes: validation lifecycle and composition as another archetype BOM input. Use when changing archetype code, validation or composition."
---

## Archetype validation lifecycle (Patch 2)

BOM rows are validated against `bw2data` at **upload time**, not at compute
time. Compute reads a persisted per-row status flag and refuses with a
structured 422 if any error rows exist. This decouples authoring (where the
user fixes a broken file) from computation (which must be predictable and
fast).

### Where the validator runs

- **Upload** (`POST /api/bom/import`): `mapper/api/bom.py:_parse_bom_workbook`
  yields a parallel `list[BOMValidationRow]` alongside the parsed BOM tree.
  After upsert, `validate_bom()` (`mapper/core/bom_validator.py`) runs once
  per archetype; `_apply_validation_to_archetype()` stamps each
  `BOMNode.validation_status` to `"ok" | "warning" | "error"` and stores
  the full `ValidationReport` on `Archetype.validation_report`.
- **Compute** (`POST /api/lca/standalone`, `POST /api/impact/calculate`):
  `validation_error_count(arc.bom)` walks the persisted node tree
  (no bw2 calls) and raises `HTTPException(422, detail=...)` if any node
  has `validation_status == "error"`. The detail dict contains
  `{error: "validation_failed", message, archetype_id, archetype_name,
  error_rows, report_url}` — the frontend uses `report_url` to fetch the
  persisted report via `GET /api/bom/archetypes/{arc_id}/validation-report`.

### Severity contract

- **Error** (blocks compute): `code_truncated`, `code_not_found`,
  `database_missing`, `code_no_database`, `database_no_code`. Compute is
  refused because we cannot resolve the row to an ecoinvent activity.
- **Warning** (allowed, surfaced): `name_mismatch`, `location_mismatch`,
  `unit_mismatch`. The `(db, code)` tuple still resolves to a real activity —
  the user-supplied annotation simply doesn't match. We trust the code.

### `BOMNode.description` — provenance that survives a re-import

Free-text on a row, for the assumption behind its quantity or its link.
**Nothing computes from it** (asserted by a test that mutates every
description and requires every quantity unmoved). It exists because a
modelling choice that lives only in someone's memory is not a modelling
choice a reviewer can check.

It **round-trips through the workbook's `Description` column**, and that is the
load-bearing half: re-import is the routine path for these projects, and a note
that dies there is worse than no note because it reads as documented when it is
not. A blank cell — or an older workbook with no such column — imports as
`None`, so nothing legacy changes. `BOMNodeUpdate.description` takes `"unset"`
to clear and `None` to leave alone, the same PATCH convention as `basis` and
`uncertainty`.

Two live examples, both in MAp-test's Hydrogen Station: the 8 kg of R134a
records that end of life is assumed **zero on full recovery** per EU
Regulation (EU) 2024/573, with real-world recovery at 50–90 % named as the
gap; the 400 kg carbon fibre wrap records that inert waste is a **proxy**
because ecoinvent 3.10 has exactly one CFRP activity, the production market,
and no waste route at all. Neither assumption is visible in a number and both
change one materially.

#### What NOT to do

- **Don't add a field carrying provenance without a workbook column.** The
  field alone survives until the next export/re-import, which is precisely
  when someone is most likely to believe it is still there.
- **Don't let anything read it at compute time.** It is a comment. If it ever
  gains meaning, the test that mutates every description to garbage and
  asserts byte-identical quantities will fail, and that is the intended alarm.
- **Don't export `None` into the cell.** It imports back as the literal string
  `"None"`. Write `""`.

### Silent paths fail closed — four answers, not one

Four lookups used to step over a missing input and carry on, and all four
produced a **smaller, entirely plausible** number with nothing said. That is
worse than a crash: a fleet total 8 % low still looks like a fleet total. They
do NOT get the same treatment, because the right behaviour differs per path.

| Path | Behaviour | Why |
|---|---|---|
| unlinked BOM row (`api/lca.py`, BOTH builders) | **refuse, 422** | the row is in the BOM because the user wants it counted |
| cohort carrying stock, no mapping (`dsm_lca_engine`, `material_flow_engine`) | **refuse**, `UnmappedCohortError` | same defect as a dangling mapping, one step earlier in the same lookup |
| stage name matching no keyword (`stage_to_scope`) | **warn + default** | the keyword table is an automotive vocabulary; MApper is general-purpose |
| node naming an undefined lever (`_apply_global_levers`) | **refuse**, `UndefinedLeverError`, ONLY when levers are in play | the 1.0 identity when they are not is a designed guarantee |

**Both single-product builders refuse, not just one.** `_build_archetype_source_demand`
(single-product LCA, trajectory, all three Monte Carlo entry points) and
`_build_archetype_demand` (contribution analysis) are separate demand builders.
Guarding one leaves a silent-drop path open behind a guard that looks shut.
This also ends an inconsistency: the fleet path has always refused, so the same
archetype used to compute fine single-product and 400 fleet-wide.

**Messages name the offending thing, never a count.** `"has 3 unlinked
material(s)"` is precisely the guard that costs a debugging session, so
`_refuse_on_unlinked` reports stage › row for each (capped at 10 + "and N
more"), the node_ids, and the fix. `UnmappedCohortError` names the cohort, its
count and year, and says explicitly what it is NOT — a dangling mapping — since
the fixes differ: add a mapping vs re-link an existing one. They are separate
exception types for the same reason.

**`count > 0` is checked BEFORE the mapping lookup.** A declared-but-empty
cartesian cohort contributes nothing and must never raise, or a sparse fleet
becomes unrunnable.

#### The stage fall-through warns because refusing would be wrong

`Decommissioning`, `Installation`, `Construction`, `Retirement`, `Replacement`,
`Commissioning`, `Transport`, `Distribution`, `Logistics` and `Raw materials`
all match no keyword and default to `inflows`. `Decommissioning` is the sharp
one: an obvious end-of-life stage counted at production. But refusing would
block a legitimate wind-farm or building project over a naming convention, so
`validate_bom` emits a `stage_scope_defaulted` **warning** beside
`unit_mismatch`, **once per stage** (a 250-row stage would otherwise raise 250
identical warnings), and an explicit `scope` on the stage root always wins,
which makes the fix one click. `stage_name_matches_a_keyword` exists so callers
can detect the fall-through without a second copy of the matching rule.

#### The lever flag is stated, never inferred

`_apply_global_levers` takes an explicit `levers_in_play: bool`, threaded
through `resolve_quantity` → `flatten_bom_for_year` →
`flatten_roots_for_year_and_scope`, and set by the engine from
`self._param_table is not None`. **Do not infer it from `lever_values` being
non-empty.** An empty dict cannot distinguish "no table threaded through" from
"a table with no entries", and inferring a semantic distinction from an empty
container is how a false positive arrives later — it would work on today's data
and break on the first project with an empty parameter table. The distinction
is a property of the CALL, so the caller states it.

The three-way identity — `p_bp=1.0` == absent == untagged == the pre-lever
engine — survives untouched, because it runs with levers not in play.

#### What NOT to do

- **Don't reintroduce a bare `continue` past a missing link, mapping, stage
  match or lever.** `tests/test_silent_paths_fail_closed.py` sweeps
  `api/lca.py`, `core/dsm_lca_engine.py`, `core/bom_engine.py` and
  `core/material_flow_engine.py` for `if <falsy check>: continue` on those
  lookups. It matches the CHECK rather than any one variable name, so it
  catches the next instance in a new file. Verified load-bearing: putting one
  `continue` back fails two of its cases. `_ALLOWED` carries the two
  legitimate skips WITH reasons, and a separate test fails if a declared
  exemption no longer exists.
- **Don't guard only the path named in the brief.** The sweep found a fifth
  and sixth: `material_flow_engine` carried both the unmapped-cohort skip AND
  the dangling-archetype skip — the latter being the original WP5 shape, still
  open there after `dsm_lca_engine` closed it. One engine raised while its
  sibling stepped over the same condition on the same data.
- **Don't build a test archetype whose ROOT is a material.** Three fixture
  helpers did (`bom=[node]` with a material named `cells` / `pack` / `steel`),
  leaning on the stage fall-through to be classified as inflows — a shape
  production never produces. They now wrap the material in a `Manufacturing`
  stage root. Under warn-only they would not have failed, which is exactly why
  leaving them would have meant the next person read them as canonical.

### The sweep walks the package. There is no watchlist.

Both shapes ran against a named list of six modules. The base rate stayed
non-zero across two widenings — the second found `material_flow_engine`'s two,
the third found the scaling-rules migration — so scope stopped being a
judgement call. `_package_modules()` is `BACKEND.rglob("*.py")`, and a new
module is swept the day it lands.

**The first package-wide run was 26 hits, 11 of them `@router.get(...)`** —
route decorators matched because their PATH STRINGS mention the words the sweep
watches for. That is a detector bug, not an exemption backlog; exempting them
would have buried the real finding under boilerplate. Excluded by DECORATOR
POSITION rather than receiver name, so it does not depend on the router
variable being called `router`. 26 → 14.

Final: **16 hits, 15 exempted, 1 real** — `scaling_rules` were not migrated.

#### Exemptions carry a CATEGORY, and one of them is checked

`guarded` (a raise or warn covers it), `validated` (checked at the write
boundary), `filter` (a miss is the intended semantics), `display_only`
(export/label resolution, derives no number).

`display_only` was the weak one: "it doesn't compute" was a stated assumption
that nothing verified, and an export that started deriving numbers would have
silently invalidated it. It is now checked —
`test_a_display_only_exemption_really_does_not_compute` asserts the enclosing
FUNCTION calls nothing in `_COMPUTE_CALLS`.

**Function granularity, not module.** Module was tried first and is useless
here: `api/bom.py` imports the compute layer six times AND hosts four of the
five display-only sites, because it is a 3000-line module holding both the
dsm-lca endpoint and the export builders. A companion test pins that the check
does fire on `run_dsm_lca`, so it cannot go vacuous.

It is a heuristic, not a proof — a function could derive a number without
calling a named entry point. It turns an assumption into something that breaks
loudly in the common case, which is the honest claim for it.

### Scaling rules were the one thing UI-hidden code cost us

`DSMScalingRule.dimension_filters` sits in the same `_INHERITABLE_SLOTS` tuple
as `mode_configs`, is filtered the same way (`cohort_dict.get(k) == v`), and
was the only one of the seven that `_migrate_state` did not reconcile. A
dimension rename left every rule matching nothing, and the call site is

```python
out[year][ck] = count if rule is None else self._resolve_rule(rule, count, year)
```

so a 1.4× growth rule quietly became 1.0×. **No user data was affected** — 593
JSON files scanned, zero with non-empty `scaling_rules`.

**It survived because no clicking reaches it.** The scaling-rules UI was
removed on 2026-05-01 while the backend stayed live, so every hand-driven check
missed it and only a package walk found it.

#### The other UI-unreachable surfaces, audited

Of 220 backend routes, **12 have no frontend caller**: five AESA reference-data
GETs (`/boundary-sets/{id}`, `/multi-d-defaults`, `/sharing-data`,
`/ssp-trajectories`, `/carbon-budget-options`), six subsystem manual-flow
routes (upload/template/clear × inflows/outflows), and
`POST /lca/calculate-archetype-trajectory`. **None carries either shape** —
checked function by function, including `compute_manual_subsystem` behind the
manual-flow routes. So scaling rules were the only one, and the rest are
unreachable-but-clean rather than unswept.

**A PARAMETER with no UI control is the same shape as a route with no UI
caller.** `POST /dsm/systems/{id}/simulate` takes an optional `case` (parameter
sensitivity case) that the frontend never sends — `simulateMFA` in `client.ts`
puts only `scenario_id` on the query string, and the DSM Dashboard has no
sensitivity-case selector. So the boundary is complete and correct, and
**unreachable by clicking**. Added deliberately in the Patch B path-1 binding
so the API is expressible and the other two call paths (`/impact/calculate`,
`.../material-flows`, which DO forward their case) go through one function —
but recorded here because this is exactly how the `scaling_rules` migration gap
survived: backend live, UI removed, every hand-driven check missing it.

Also on this list for the same reason: **scaling rules themselves**. The editor
was removed from the DSM config bar on 2026-05-01 while the backend stayed
live, so `DSMScalingRule` — the only channel from parameters into DSM output —
cannot be authored in-app at all. Both live projects have zero rules, which is
why every parameter-binding defect in that path has been latent rather than
live. Reinstating the editor makes them live; re-read the scaling-rule sections
before doing it.

That list is worth keeping current: an endpoint with no UI caller gets no
hand-testing, so the automated sweep is the only thing that reaches it. The
same applies to a REQUEST FIELD no UI populates — the sweeps walk routes, not
query parameters, so a field like `case` is only covered by the tests written
for it.

#### What NOT to do

- **Don't reintroduce a watchlist.** Both sweeps walk the package. Adding a
  name list back — even a longer one — restores the failure mode where scope is
  something a person has to remember.
- **Don't exempt a detector bug.** Route decorators were 11 of 26 hits; the fix
  was excluding them structurally, not declaring them.
- **Don't mark an exemption `display_only` without checking the function.** The
  category is verified, so a wrong one fails rather than sitting there.
- **Don't add a scenario slot without adding it to `_migrate_state`.**
  `scaling_rules` was in `_INHERITABLE_SLOTS` and not in the migration for
  months, which is exactly how a slot goes stale in silence.

### A stale reference and an empty match are not the same thing

`filter_primary_stock` summed to 0.0 for both, and only one of them is
ordinary. The distinction is the design:

- **legitimate empty match** — every key and label resolves, no cohort carries
  that combination this year (a fuel type with no vehicles yet). **Returns 0.0
  in silence.** Raising would make a sparse fleet unrunnable.
- **stale reference** — the filter names a dimension or label the primary
  system does not have. It cannot match in ANY year, so 0.0 reads as "this
  subsystem has no stock" when the reference is simply broken. **Raises
  `StaleDriverFilterError`.**

Pinned from both sides: a declared-but-unstocked label must NOT raise, an
undeclared one must. The `test_subsystem_engine` fixture used to express
"matches nothing" with an undeclared label — the exact conflation — and now
declares a third label carrying no stock instead.

**An empty value list is refused at the WRITE boundary.** `{"Fuel": []}` was
dropped by the normaliser, so the filter meant "no filter" and the rule got the
WHOLE primary stock: measured **350.0 against an intended 150.0**. It
**over-counts**, the opposite direction from every other defect in this family
and correspondingly harder to notice as "suspiciously small". Refused in
`validate_dependency_rule` so nothing already stored breaks; the branch stays
defined for rules saved before the check existed.

**The migration is the fix; the other two detect the symptom.**
`update_system` reconciles stock rows, inflows, stock targets, manual outflows,
mode configs and survival configs through its label-translation maps — and used
to say nothing about subsystem dependency rules, which live in a separate store
its migration never reached. So renaming a dimension silently orphaned every
rule that filtered on it. `_migrate_subsystem_filters` now carries them through
the SAME maps: renamed labels translated, removed labels and dimensions dropped
and counted, warned like the other six.

#### The class guard needed a SECOND shape

The `continue` sweep reported **zero** for `subsystem_engine`, which had two
real defects — because neither was a skipped iteration. Both were a silent
VALUE, and so was path 1's original:

```
allowed = {dim: set(vals) for dim, vals in driver_filter.items() if vals}
if all(cohort_dict.get(dim) in vals for dim, vals in allowed.items()):
linked = [m for m in all_materials if m.ecoinvent_activity is not None]
```

`_default_sites` is AST, not regex, because both distinctions are structural:

- **`.get()` with no default, consumed inline** (in a comparison, a boolean,
  another call) so a miss becomes `None` and flows on. `x = d.get(k)` alone is
  NOT flagged — the caller still holds the miss, and whether they check it is
  the `continue` sweep's job. `d.get(k, 0.0)` is not flagged either: an
  explicit numeric default in a running total means "nothing yet".
- **a comprehension whose `if` KEEPS the resolved rows**, thereby dropping the
  unresolved ones. The SIGN is the whole test: `is not None` / bare truthy
  keeps the valid and drops the invalid; `is None` / `not in` **collects** the
  offenders, which is what a guard does before raising on them. Flagging the
  second would make the sweep fire on its own fixes.

The first attempt was a regex over `[...]` and missed
`allowed = {dim: ... if vals}` entirely — a dict comprehension. That is why it
is AST.

**Verified against all three historical defects**, on the exact lines that
shipped rather than paraphrases, plus the corrected forms as negatives. It
reports four live sites, all four declared in `_ALLOWED_DEFAULTS` with reasons,
and a separate test fails if a declared exemption no longer exists.

#### What NOT to do

- **Don't raise on an empty match.** A filter that resolves and matches nothing
  is ordinary. Only a reference to something absent is an error.
- **Don't answer a failed lookup with a plausible default in a calculation
  path.** Both sweeps in `tests/test_silent_paths_fail_closed.py` cover the two
  shapes; an exemption needs a reason, not just an entry.
- **Don't flag a comprehension that collects offenders.** `[m for m in mats if
  m.ecoinvent_activity is None]` is a guard building its own error message.
- **Don't extend `update_system`'s migration without the subsystems.** They are
  the one slot that lives outside the system's state, which is exactly why they
  were missed for as long as they were.

### The compute path refuses on a unit mismatch. Upload warns. Both are right.

`unit_mismatch` at upload is where a NEW project gets caught. What the audit
actually named is that quantities enter demand vectors with **no dimensional
check at all**, so a project already carrying a mismatch computes in silence —
MAp-test's three charger rows asked for 7, 18.5 and 180 whole-vehicle
dismantlings, and were found by hand rather than by the code.

**The apparent contradiction dissolves once you separate *when* from *what*.**
Upload warns because the rows have not had a chance to be fixed and refusing an
import would strand a project at the door with nothing computable; its job is
to say the file has a problem. Compute refuses because the row is about to
become a number. That is exactly the shape `_refuse_on_unlinked` already
ships **in the same function** — unlinked rows warn at upload and 422 at
compute — and nobody found that contradictory, because it is one rule applied
at two moments.

**Three sites, one definition.** `_canonical_unit` is shared with the upload
check, so a row cannot warn at import and compute anyway:

| Site | Covers |
|---|---|
| `_build_archetype_source_demand` | single-product LCA, trajectory, **all three Monte Carlo entry points** |
| `_build_archetype_demand` | contribution analysis |
| **`compute_demand_vector`'s caller in `DSMLCAPipeline`** | **the fleet** |

**The fleet site is the one the other two miss**, and it is the path with the
most at stake: a fleet run reaches the demand vector through neither builder.
`monte_carlo.py` is covered transitively — it calls the first builder before
its loop, so its per-iteration `_aggregate` sees rows already checked.
`standalone_lca` is covered differently, refusing via `validate_roots` before
it builds. `calculate_activity_lca` is N/A: no BOM row, so no second unit.

**The fleet cache is per-run and never module-level.** `DSMLCAPipeline
._unit_cache` maps `(db, code) → (unit, name)`; the check runs per cohort per
year, far too hot for a bw2 lookup per row. It cannot be module-level because
bw2's project state is mutable — a database import or a premise generation
changes what a key resolves to — the same rule the row validator's `code_cache`
follows. Pinned: same refusal with and without the cache, on the same data.

#### NO CONVERSION, EVER

Nothing needs converting. Every unit pair in either live project folds to
identity — `kg`/`kilogram`, `kWh`/`kilowatt hour`, `tkm`/`ton kilometer`,
`m3`/`cubic meter` — which is spelling, not dimension.

And a genuine mismatch must **never** be converted. A silent kg→tonne would be
the same class of defect this refusal closes: a plausible number resting on an
assumption nobody stated. Worse here than elsewhere, because the two readings
are indistinguishable from inside the code — `kg` against a `unit` activity
might mean "convert by mass per unit" (a mass we do not have) or "this link is
wrong" (all three real cases were the second). Converting would have to guess.
`test_nothing_anywhere_converts_a_unit` checks no site does.

#### What NOT to do

- **Don't add a demand builder without the check.** Three sites today; the
  fleet one was missing from the first two and is the one that computes WP5.
- **Don't soften compute to a warning for consistency with upload.** They
  answer different questions at different moments, and `_refuse_on_unlinked`
  already sets the precedent in the same function.
- **Don't lift `_unit_cache` to module scope.** bw2 project state is mutable;
  a cache that outlives the run answers from a different project.
- **Don't convert.** Re-link the row or fix its unit. The alternative is a
  number nobody can audit.

### `unit_mismatch` — the BOM unit is a different QUANTITY

Quantities reach the demand vector with **no dimensional check**:
`_build_archetype_source_demand` does `total_demand[key] += m.quantity *
stage_amt` and nothing compares the BOM's unit to the activity's reference
unit. So a kg amount against a per-unit activity is charged as that many
units, silently. MAp-test's three charger `Electronic waste treatment` rows
carried 7, 18.5 and 180 **kg** against `market for manual dismantling of used
electric passenger car`, whose reference unit is **one vehicle** — 180 whole-EV
dismantlings for one DC charger's end of life. Nothing raised, warned or
logged, and a full audit of *stored* `validation_status` showed the project
100 % clean.

**The check must be quiet about SPELLING.** A BOM writes `kg` where ecoinvent
writes `kilogram`. MAp-test has 870 such pairs against 3 genuine errors, so a
verbatim string compare would bury the signal it exists to raise.
`_canonical_unit` folds a unit onto its quantity kind through `_UNIT_ALIASES`;
an unlisted unit folds to **itself**, so an unrecognised pair is reported
rather than waved through.

**A warning, not an error.** The `(db, code)` pair still resolves, so the row
is computable — and making it an error would refuse to compute for every
project already carrying one, including the project the check was written for.
Same reasoning that keeps `name_mismatch` a warning.

**It is upload-time, like the rest of the validator**, so it does not catch a
row relinked in-app afterwards. That is the existing design (see *Don't re-run
validation on every compute*), not a gap this check introduces.

Validation order is structural → database existence → code resolution →
name/location consistency. Cheapest checks first; later checks short-circuit
when an earlier one already errored on the same row.

### Caching

Within a single `validate_bom()` call, `(db, code)` lookups against bw2 are
cached. A typical archetype with ~250 rows referencing ~80 unique activities
makes ~80 bw2 calls instead of 250. **Never cache across calls** — bw2's
project state is mutable (database imports, premise generation), and a
stale cache would silently serve wrong answers.

### Frontend surface

- After upload, `LCAManager.tsx` renders one `ValidationReportPanel` per
  archetype with errors/warnings. Issues are grouped by
  `(severity, error_type, bad_value)` so "6 unique truncated codes
  affecting 41 rows" appears as 6 collapsible rows, not 41.
- `Archetypes.tsx` shows a persistent banner on the detail view of any
  archetype with errors, plus a red dot on its tree row.
- `LCACalculator.tsx` disables the **Calculate** button when any selected
  archetype has `validation_error_rows > 0`, with a tooltip listing the
  blocking archetype names.

### Anti-patterns — DO NOT

- **Don't re-run validation on every compute.** `validate_bom()` does
  ~80 bw2 lookups per archetype; doing this inside `/api/impact/calculate`
  would add hundreds of ms to every multi-archetype request and make
  cancellation semantics murkier. The whole point of persisting
  `validation_status` is that compute is O(n) walk, no I/O.
- **Don't reject uploads on validation errors.** The user needs to see
  the report to know what to fix. Persist the archetype with
  `validation_status` flags, surface the report, let them decide whether
  to re-upload a corrected file or open the archetype in the BOM editor
  to relink rows by hand.
- **Don't lift the per-call `(db, code)` cache to module scope.** It would
  serve stale data across project switches, premise database installs,
  and ecoinvent re-imports.
- **Don't add `name_mismatch`/`location_mismatch`/`unit_mismatch` to the error
  set.** A resolved code is the source of truth; a mismatched display name is a
  data-quality signal, not a blocker. `unit_mismatch` in particular would
  refuse to compute for any project already carrying one — which is every
  project this check was written to help.
- **Don't compare units verbatim.** Fold through `_canonical_unit` first, or
  the 870 legitimate `kg`/`kilogram` pairs in MAp-test drown the 3 real
  findings. And don't make an unknown unit fold to a wildcard — unlisted folds
  to itself so a genuinely different pair still reports.
- **Don't reach for a unit CONVERSION.** The check reports; it never rescales a
  quantity. A silent conversion would be a second invisible transformation on
  top of the one being surfaced, and the right amount for a relinked row is a
  modelling decision, not an arithmetic one.
- **Don't validate against prospective databases at upload time.** The
  validator runs against the active bw2 project's installed databases.
  pLCA-generated databases are produced post-upload, on demand. Cross-DB
  validation belongs (if at all) in the Impact Assessment configure step,
  not the BOM upload step. Out of scope for Patch 2.

### Acceptance shape

`tests/test_bom_validator.py` includes a synthesised reproduction of the
WP5 v1 failure mode: 943 valid rows + 41 broken rows distributed across
6 unique truncated codes. The expected report shape is `error_rows=41`,
`valid_rows=943`, exactly 6 error groups summing to 41 affected rows.
A corrected-file fixture round-trips to `error_rows=0`. The 422 contract
is asserted by registering an Archetype with a node bearing
`validation_status="error"` and invoking the route handler directly.

## Archetype composition — an archetype as another's BOM input

`Archetype.includes: list[ArchetypeInclude]`. The reference is by **archetype
id, never a node id**: node ids are re-minted on every import
(`assign_node_ids` only fills missing ones, and the workbook parser builds
nodes without them), while a merge-mode import matches archetypes by name and
preserves their id.

### Spliced stage-by-stage, MATCHED ON SCOPE

A child's Manufacturing lands in the parent's Manufacturing, its End of Life in
the parent's End of Life. This is the whole design constraint: `Battery Pack`
carries both stages, and collapsing it into whichever stage the reference sat
in would put end-of-life transport into manufacturing — wrong scope, wrong
basis, wrong point in the DSM. A scope the parent lacks gets a new stage rather
than being dropped into an unrelated one.

### Parameters resolve in the CALLER's context

There is one parameter table per project and one namespace, so the caller's
context is the only context. **Compute the parent under `Optimistic` and the
child's expressions take Optimistic values too.** A nested archetype is NOT a
frozen sub-assembly, and someone will expect it to be. Cross-project references
are forbidden in v1 precisely because two projects genuinely have two tables.

### Eager splice, so no cache changes

Splicing runs in `DSMLCAPipeline.__init__` before `self.archetypes` is set, and
in `_build_archetype_source_demand` before parameter resolution — upstream of
`_flat_cache` `(archetype_id, scope, year)`, `_flat_cache_year`
`(archetype_id, year, scope, db)` and `_resolved_arc_cache`
`(archetype_id, year)`. Every key therefore refers to an archetype whose
children are already baked in, and no cache learns about references.
`test_splicing_happens_upstream_of_every_flatten_cache` is the alarm if that
ever moves.

Quantity scaling is free: `flatten_bom` already cascades
`effective = parent_quantity × node.quantity`, so a ref at 2 doubles the
child's whole subtree. `ArchetypeInclude.quantity_expression` resolves like any
other quantity — which is what lets a reference carry a functional-unit
normaliser (see the acceptance case below).

### Cycles and depth

Detected at **save time and flatten time**, and the second is not redundant:
archetype JSON is edited on disk, arrives by project import, and round-trips
through Excel, none of which passes a save route. `MAX_INCLUDE_DEPTH = 4`,
surfaced verbatim in the error. A cycle error names the chain.

### Basis below the root

A spliced child stage becomes a NON-root node while keeping its own `basis`,
so basis had to become readable below the root. `flatten_root_with_amounts`
inherits the multiplier down the tree and lets the nearest basis-declaring
ancestor override it, so a per-year child under a per-unit parent stage still
scales with the lifetime. Driven by `basis_amounts`
(`{"per_unit": 1.0, "per_year": <lifetime>}`); absent, every material takes its
stage root's amount, byte-identical to pre-composition behaviour.

### Source-qualified material keys

DSM aggregation keys by material NAME (`mat_qty[...]`, `material_totals[...]`),
so a "Steel frame" in the parent and one in a child would merge into a single
contribution line. `material_key()` qualifies the leaf with the **nearest**
enclosing include using `INCLUDE_KEY_SEP = "::"` — the same string the
subsystem aggregation already uses, not a second scheme — so a grandchild
reports the grandchild and a reader recovers the source with
`key.split(INCLUDE_KEY_SEP)`. Rows outside any include are unchanged.

`lca.py` still reads only `path[0]` / `path[1]` for `stage` / `component`, so
for a chain deeper than one level the intermediate names do not fit there. The
**name** carries the nearest include instead; widening the contribution shape
to a full path is a separate UI decision.

### Dangling references are LOUD

`dsm_lca_engine` used to `continue` past a cohort mapping pointing at a missing
archetype while the API raised 404 for the same condition. That silent skip is
the WP5 failure verbatim, and composition adds a second class of dangling id,
so the engine now raises `DanglingArchetypeError`. A dangling include raises
`ArchetypeCompositionError`.

### Import modes

**Merge is safe for a project using composition** — it matches by name and
preserves the archetype id. **Replace orphans every reference**: it mints a
fresh `uuid4()`. Both re-mint node ids.

**The BOM workbook cannot express a reference**, so exporting a composed
archetype is **refused** with a 400 rather than silently writing the child's
spliced rows and re-importing a flattened copy that no longer tracks the child.
Use project export/import, which carries `includes` intact.

### Acceptance

`B0 - Reference BESS` hand-duplicates `Battery Pack` inline. Rebuilt as a
reference carrying `1 / b0_cumulative_ac_energy_delivered_kwh` as its include
quantity, the composed twin reproduces the original at **rel-diff 0.000e+00**
on GWP100 and acidification against the live project.

**Why the divisor is needed, and the design limit it reveals:** the standalone
`Battery Pack` is expressed per pack, while B0's inline copies are the same
expressions divided by the FU normaliser. One include quantity reproduces both
of its stages because both carry the same divisor. `BESS-Inverter` cannot be
referenced the same way: its Manufacturing is divided by the normaliser and its
Use Phase is not, and a single include quantity scales the whole child
uniformly. **A child whose stages carry different normalisations cannot be a
single reference** — split it, or leave it inline.

#### What NOT to do

- **Don't flatten a child into one of the parent's stages.** Match on scope.
- **Don't splice lazily inside `_flatten`.** The cache keys would go stale.
- **Don't reference a node id.** They are re-minted on every import.
- **Don't let a dangling reference `continue`.** Silent shrinkage is
  indistinguishable from a genuinely smaller result.
- **Don't invent a second key separator.** `INCLUDE_KEY_SEP` is the subsystem
  string on purpose.
- **Don't export a composed archetype to the BOM workbook.** The format has no
  reference row; the refusal is the feature.
