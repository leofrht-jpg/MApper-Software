---
name: mapper-prospective-lca
description: "Prospective LCA backend: link translation, premise fallback, Monte Carlo reachability and the mapper-tailpipe activity. Use when touching premise, prospective databases or tailpipe."
---

## Prospective link translation: only the BASE database translates

Two functions translate a BOM link to a prospective database, and they had
drifted apart:

| | probe target? | fall back? |
|---|---|---|
| `api/lca.py:_translate_demand_to_database` (single product) | yes | yes, + warning |
| `core/dsm_lca_engine.py:_rewrite_db` (fleet) | **no** | **no** |

The fleet version rewrote EVERY link's database to the premise anchor
unconditionally. It worked only because every BOM row pointed at base
ecoinvent and premise preserves codes. The first row linking a GENERATED
database took the whole prospective run down with
`ActivityDataset ... does not exist` — measured on MAp-test: **61 of 61
ecoinvent codes carry into the premise DB, 0 of 2 `mapper-tailpipe` codes do**.

**The decision now lives once**, in `core/prospective_links.resolve_link_db`,
called by both. They differ in SHAPE — one walks a demand dict, the other a
flattened material list — not in intent, so the iteration stayed separate and
only the rule moved. The third sibling-divergence in as many weeks; a third
copy is how the second one survived.

```
if not target_db or src_db == target_db:       keep
if base_db is not None and src_db != base_db:  keep, SILENTLY
if exists(target_db, code) is False:           keep, + WARNING
otherwise:                                     translate
```

**Pinning a non-base database is the correct model, not a fallback**, which is
why it does not warn. `mapper-tailpipe` holds only biosphere exchanges and no
technosphere inputs, so premise never generated a variant and there is nothing
in it premise could have changed — tailpipe CO2 per kg of fuel is combustion
stoichiometry, invariant to the electricity mix. A warning would fire on every
such row in every year and train people to ignore warnings.

**`exists()` returns `True | False | None`, and only a known `False` falls
back.** "Cannot tell" is not "absent": absence of the target DATABASE says
nothing about the CODE. The first implementation conflated them and broke 8
interpolation tests whose fixtures use synthetic database names — it pinned
every row instead of translating. Treating an unverifiable probe as absence
CHANGES NUMBERS rather than crashing, which is the worse failure.

`base_db` comes from the caller's declared base, falling back to the pLCA
registry (`base_db_for`) — the same registry `resolve_prospective_dbs` reads,
so the two cannot disagree about what a database's base is. `base_db=None`
deliberately degrades to the probe, so a caller that cannot say which base it
targets still gets the guarded behaviour rather than the crash.

**The fleet result has nowhere to put a warning.** `ImpactAssessmentResult` has
no `warnings` field (the single-product result does), so a fleet translation
warning is logged at WARNING level — reaching `mapper.log` and Settings → Logs
— and collected on the pipeline. Adding a field is a schema change with
frontend implications; it was left, deliberately.

**The fleet pipeline must actually KNOW its base (walkthrough 4).** The UI
never sets `ImpactAssessmentRequest.base_db` — the base travels inside each
`lci_scenarios` entry — and `_prospective_base_db()`'s registry fallback read
`prospective_dbs[0].get("name")` while `prospective_dbs` is a list of
`(name, year)` tuples. So the base was always `None`, rule 2 never applied, and
every system-level prospective run warned "mapper-tailpipe/… not found … fell
back" twice per anchor year for a pin that is correct. The route now passes
each scenario's own `base_db`, the fallback reads the tuple, and intentional
pins are summarised in ONE INFO line per run with the count
(`tests/test_prospective_tailpipe_pinning.py`). A base-db code that fails to
carry over still warns.

**premise disables loggers at import.** `premise/transformation.py` calls
`logging.config.dictConfig(...)` with the default
`disable_existing_loggers=True`, which silently disables every logger created
before it — `mapper.core.dsm_lca_engine` included, in a dev process. So a
missing log line is not proof a code path did not run. `configure_logging()`
calls `reenable_mapper_loggers()` after the routers (and premise) are imported;
locked by `test_premise_does_not_silence_mappers_own_loggers`.

#### What NOT to do

- **Don't rewrite a link's database without checking its SOURCE.** A BOM may
  link a generated or custom database that no premise run ever touched.
  `tests/test_parameter_resolution_never_gated.py` asserts both translators
  route through `resolve_link_db`; reverting either fails by name.
- **Don't treat "cannot probe" as "absent".** Only a positive `False` may fall
  back. The `None` branch is what keeps a run whose target database is merely
  unloaded computing the same numbers as before.
- **Don't warn when pinning a non-base database.** It is correct behaviour, and
  a warning that fires on every row of every year is a warning nobody reads.
- **Don't add a third copy of the rule.** Both callers keep their own
  iteration; the decision is shared.

## Prospective Monte Carlo is UNREACHABLE, and premise carries no uncertainty

Two facts that only matter together, so they are written together.

### No button hands a prospective result to Monte Carlo

`MonteCarloRequest.archetype_id` and `MonteCarloMultiRequest.archetype_ids` —
Monte Carlo is **archetype-scoped**. Tracing every entry point:

- **Single-product Static** → "Run uncertainty" passes `computeDatabase: null`,
  and that is CORRECT: Static is base-ecoinvent by definition.
- **Single-product Prospective** → has no "Run uncertainty" button at all.
- **Multi-item Archetypes** → `handleCompute` calls
  `compute({ scope, methods, cases })` and never passes `computeDatabase`, so
  the comparison itself runs against base ecoinvent (archetypes resolve through
  their BOM's ecoinvent links). The handoff's `computeDatabase: null` therefore
  MATCHES what was compared.
- **Multi-item Activities** → carries the premise vintages, and Monte Carlo
  cannot run there at all: an activities comparison has no archetype. The
  button is hidden for that reason (not a banner — see below).

**So the only route to a prospective Monte Carlo today is a direct API call**
with `compute_database` set. Nothing in the UI reaches it.

### When it becomes reachable, settle this FIRST

Measured on the frozen build, same archetype, 25 iterations, seed 9:

| background | GSD² |
|---|---|
| base ecoinvent | **1.1202** |
| premise remind/SSP2-PkBudg1150 2030 | **1.0004** |

A near-total collapse. Checking the exchanges directly (400 activities each):

| | base ecoinvent | premise 2030 |
|---|---|---|
| `uncertainty type` | 84.5 % lognormal (2) | **99.9 % undefined (0)** |
| `scale` usable (>0, not NaN) | **84.5 %** | **0 %** |
| `scale` = NaN | 0 % | **78.2 %** |

**The distributions are genuinely absent, not merely flagged off.** `scale` is
present as a KEY on 78 % of premise exchanges but its value is `NaN` — a
destroyed parameter, not a preserved one. (Watch for this: `nan is not None` is
True, so an `is not None` check reports these as present. It did, and the first
reading of this survey was wrong because of it.)

And the loss is **not confined to exchanges premise rewrote**. `clay brick
production` — which an IAM scenario has no reason to touch — is `ut=2,
scale=0.051` in base ecoinvent and `ut=0, scale=nan` in the premise copy. So
this is a property of how premise WRITES the database, not of which exchanges
it modifies. It is upstream behaviour; MApper only reads what premise wrote.

**Why this is worse than the ~12 % undefined-exchange caveat already
surfaced:** that caveat makes a reported spread a LOWER BOUND, and the UI says
so. Here the background contributes essentially NOTHING, so a prospective run
returns a near-zero spread that reads as *confidence* rather than as *missing
data*. A tight interval is the most persuasive possible presentation of an
absence.

**TRIGGER — this is testable, not asserted.** If a background selector is ever
added to multi-item Archetypes, or a "Run uncertainty" button to the
single-product Prospective panel, then a prospective Monte Carlo becomes
reachable from the UI and **this question must be settled before that ships**.
The check is the table above: re-run the exchange survey against the premise
database of the day. If `scale` is still 0 % usable, either the run must refuse,
or every prospective MC result must say in the UI that its background spread is
absent rather than small. Do not ship the selector and the caveat separately.

### `compute()`'s `computeDatabase` parameter is DEAD, deliberately kept

`useMultiProductLCAStore.compute` declares `computeDatabase?: string | null`
and threads it to `compute_database`, and **no caller passes it**. It is dead.

It stays. Deleting it removes the only trace in the code that this path was
expected to carry a background, and that expectation is exactly what the
trigger above is about. A future background selector wires into this parameter;
finding it already present, with this note, is the difference between
implementing a feature and rediscovering a design.

#### What NOT to do

- **Don't add a background selector to multi-item Archetypes without settling
  the premise-uncertainty question.** The selector is the trigger.
- **Don't read `computeDatabase: null` on a Monte Carlo handoff as a bug.** It
  matches what the comparison computed against on every path that has one.
- **Don't delete the dead parameter** to satisfy a linter.
- **Don't test for a NaN scale with `is not None`.** `nan is not None` is True,
  and it turned "0 % usable" into "78 % present" on the first pass here.

## The premise superstructure fallback is recorded, not gated

The audit asked for the fallback to be **opt-in** rather than merely visible,
on the principle that *"a run that silently computes against a different
database than requested is a different result"*. The principle is sound. This
instance does not match it, and the reasoning is written as a chain someone can
re-check rather than a conclusion to take on trust:

1. **The fallback fires only in the WRITE step.** `ndb.update()` — the
   expensive, methodologically load-bearing transformation — has already run
   and produced the per-year databases. Superstructure writes them as one DB
   plus an SDF; the fallback writes *the same content* as N per-year DBs.
2. **The result is honestly labelled.** It returns `mode="separate"` with the
   separate names. Nothing downstream is told it got a superstructure.
3. **`resolve_prospective_dbs` does `int(entry.get("year"))`.** Superstructure
   entries carry `year=None`, so they are rejected — **superstructure
   databases are not computable in MApper at all**. The vintage picker lists
   them disabled for the same reason.
4. **Therefore** the fallback yields the only format the compute pipeline can
   use, and an opt-in flag would ask the user to opt in to a *usable* result
   instead of an unusable one.

**Step 3 is the load-bearing link, and it is tested directly.** If
`resolve_prospective_dbs` ever learns to read a superstructure database with a
year slice — an SDF year-slice activation engine, say — then step 4 no longer
follows and the opt-in question is live again.
`test_the_reasoning_still_holds` and `test_a_superstructure_entry_is_actually_rejected`
both fail at that moment, so the trigger fires on its own rather than waiting
for someone to reconstruct the argument.

**What did change.** `fallback_warning` reached the task and the WS `done`
frame but nothing durable, so a dismissed toast left no trace. The registry
entry now carries `fallback: true`, and the pLCA database list shows a
`From superstructure fallback` sub-label in the slot that already renders
`Superstructure · N scenarios`.

**The badge is not a quality signal**, and its tooltip says so: the content is
identical, the fallback only changes how it was written, and per-year is the
form Impact Assessment can actually compute against.

#### What NOT to do

- **Don't add an opt-in flag without re-checking step 3.** If it still holds,
  the flag gates the only usable output.
- **Don't read the badge as "these databases are worse".** They are the same
  databases, written differently.
- **Don't set `fallback` on the superstructure branch.** A superstructure that
  SUCCEEDED is not a fallback; a test pins that the branch never sets it.
- **Don't default it to anything but `False`.** Every entry written before this
  — all 36 in MAp-test — has no key and must load unchanged.
## `mapper-tailpipe` — the tank-to-wheel half ecoinvent does not isolate

A fleet whose ICEV use-phase rows link only `market for petrol, low-sulfur`
carries **well-to-tank supply and no combustion at all**. The single largest
CO2 term in an ICEV lifecycle is simply absent, and nothing warns: the row
resolves, validates and computes, it just describes refining rather than
driving. On WP5 the missing term is ~2,275 kg CO2 per vehicle-year.

**ecoinvent 3.10 cannot be linked to fix this.** Searched and confirmed:
`operation, passenger car` / `van` / `lorry` all return **0**, and of the
**151** non-market `EURO`-labelled datasets, **zero** lack a vehicle or road
technosphere input. The tailpipe flows exist only inside
`transport, passenger car, ...` leaves, which bundle the fuel, the vehicle
(`market for passenger car`), `market for road` and road maintenance. A BOM
that already models the vehicle and the fuel separately cannot link one
without double-counting two of the three. (Note the naming: it is `EURO 5`
with a SPACE — searching `euro-` returns 0 and reads as "none exist".)

So `scripts/build_tailpipe_db.py` derives the missing half from those same
datasets and writes two activities into a **`mapper-tailpipe`** database:

| | per kg fuel | GWP100 | WTT sibling | TTW share |
|---|---|---|---|---|
| `petrol combustion, EURO 5` | 3.18 kg CO2 | **3.2236** | 1.0928 | 74.7 % |
| `diesel combustion, EURO 5` | 3.14 kg CO2 | **3.1549** | 1.0408 | 75.2 % |

Each holds ONLY the eight tailpipe biosphere exchanges plus the mandatory
`type='production'` self-exchange — **no fuel input**, so it sits ALONGSIDE the
existing supply row and double-counts nothing.

**The factors are DERIVED at build time, never pasted.** The script reads
`transport, passenger car, small size, {petrol,diesel}, EURO 5 [RER]` and
divides each biosphere amount by that dataset's own fuel input, so the
derivation is reproducible and re-runnable against a future ecoinvent. The
source activity keys and the ecoinvent database name are written into each
activity's `comment`, which is what a reader of a result — who has no access to
the script — actually sees. **Round-trip closure: the derived activity times
the fuel input reproduces the source leaf's own direct biosphere GWP to
0.0003 %** (0.162296 vs 0.162297 kg CO2-eq/km), the residual being the 35
flows not carried, which are negligible for GWP100.

**Codes are deterministic md5, and that is load-bearing.** A BOM row links by
`(database, code)`. `uuid4()` would dangle every link on rebuild — the exact
failure that orphaned WP5's cohort mapping on 2026-08-04. A recipient who runs
the script gets byte-identical codes and existing links keep resolving.

**Uncertainty is inherited, not invented.** All 16 exchanges carry ecoinvent's
own lognormal `scale` and `pedigree` from the source exchange, so Monte Carlo
does not treat the model's dominant CO2 term as fixed. Inheriting rather than
flattening preserves real signal: diesel NOx and PM2.5 come through at
**GSD² 1.2127** where the other fourteen are **1.5015**. The scale is carried
across the renormalisation unchanged, which is CONSERVATIVE rather than exact —
the source dispersion covers both fuel-per-km and emissions-per-fuel, and
dividing the fuel out arguably removes the first — and overstating a spread is
the defensible direction. A `FALLBACK_PEDIGREE` exists for a future ecoinvent
that ships an exchange without uncertainty; it is currently unreached, and the
build records per exchange which path it took.

**Why the three biosphere blockers do not bite.** Linking `biosphere3` directly
fails three ways; a custom activity fails none:

- **32-char code rule** (`bom_validator._EXPECTED_CODE_LENGTH`) rejects
  biosphere3's 36-char hyphenated UUIDs. Our code is ours to mint.
- **The four biosphere refusals** (`lca.py:169`, `:248`, `:1188`, and
  `technosphere_only` in `bw2_wrapper.py:387`) all test the literal substring
  `"biosphere"` in the DATABASE NAME. `mapper-tailpipe` trips none — which is
  also why the name must never contain that substring.
- **Demand-vector key**: a raw flow raises `OutsideTechnosphere: Can't find key
  ... in product dictionary`. A `type='process'` activity with a production
  exchange is in the product dictionary by construction. (ecoinvent itself
  contains 400+ activities with zero technosphere inputs and only biosphere
  exchanges — the identical shape.)

Verified end-to-end: a BOM row linking `mapper-tailpipe` validates with
**0 errors, 0 warnings** beside its ecoinvent supply row.

**Portability.** `project_storage._GENERATED_DATABASES` maps the database to
its build script, and `database_inventory` reports `installed_generated` +
`regenerate_with` separately from `installed_premise`. The distinction is the
one a recipient cares about: a premise database must be regenerated by running
premise against an IAM scenario, whereas this ships with a script, so "you are
missing this" arrives with the command that fixes it. The pointer is emitted
whenever the project **links** to the database, even if it is not installed on
the exporting machine — that is precisely the case that matters.

### What NOT to do

- **Don't link a `transport, passenger car, ... EURO n` dataset to add
  combustion.** It bundles the vehicle and the road; a BOM that models those
  separately would count them twice. That bundling is the whole reason this
  database exists.
- **Don't paste the factors as a table.** They are derived from ecoinvent at
  build time so they track the installed version. A transcribed table is the
  `remaining_gt_from_2025` mistake in a new place.
- **Don't mint codes with `uuid4()`, and don't change `stable_code`'s input
  string.** Either dangles every BOM link into the database on the next
  rebuild.
- **Don't rename the database to anything containing `biosphere`.** Four
  separate refusals filter on that substring; the activity would become
  unlinkable and invisible in the picker at once.
- **Don't drop the `type='production'` self-exchange.** Without it the activity
  never enters the product dictionary and every demand raises
  `OutsideTechnosphere`.
- **Don't leave the exchanges unscored, and don't flatten them to one stated
  pedigree.** Inheriting preserves ecoinvent's per-flow distinctions (diesel
  NOx and PM2.5 are genuinely tighter); a single blanket score would erase
  them, and an unscored dominant CO2 term is the failure this database was
  built to avoid.
- **Don't add a generated database without adding it to
  `_GENERATED_DATABASES`.** It would be reported under `installed_base`,
  telling a recipient they need an ecoinvent licence for something they could
  rebuild in one command.
- **Relinking WP5's use-phase rows is a separate data decision.** This database
  is reference data; no BOM is touched by building it.
