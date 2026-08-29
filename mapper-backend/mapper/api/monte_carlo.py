# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""``POST /lca/monte-carlo`` -- single-product uncertainty propagation.

Task-registry + WebSocket + cancellation, the pattern ``plca`` and ``impact``
use. Cancellation is checked EVERY iteration: at ~0.066 s each, Stop lands
within one iteration and feels instant.

The methodology -- what is sampled, the per-iteration order of operations, and
why the iterative solver is the right one -- lives in
``mapper.core.monte_carlo_engine``. Read that before changing this file.
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from mapper.api import tasks as task_registry
from mapper.api.tasks import CancelledOperation
from mapper.core import monte_carlo_engine as mce
from mapper.core.monte_carlo_engine import (
    UncertaintyConfigError,
    collect_param_draws,
    collect_row_draws,
    lognormal_factor,
    summarize,
    variance_shares,
)
from mapper.models.bom_schemas import MaterialPedigreeLibrary
from mapper.models.schemas import (
    ArchetypeLCAMethodDistribution,
    MonteCarloExportRequest,
    MonteCarloRequest,
    MonteCarloResult,
    MonteCarloStartResponse,
    PedigreeCoverage,
    ScoredInput,
    PedigreeTableResponse,
    UnscoredMaterial,
    VarianceContributor,
)

router = APIRouter()

MAX_ITERATIONS = 20_000


class _TaskState:
    def __init__(self) -> None:
        self.stage: str = "queued"
        self.pct: float = 0.0
        self.done: bool = False
        self.error: str | None = None
        self.cancelled: bool = False
        self.result: MonteCarloResult | None = None
        self.subscribers: list[asyncio.Queue] = []


_TASKS: dict[str, _TaskState] = {}
_TASK_LOCK = threading.Lock()


def _notify_all(task: _TaskState, payload: dict[str, Any]) -> None:
    for q in list(task.subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


def _emit(task: _TaskState, stage: str, pct: float) -> None:
    task.stage = stage
    task.pct = pct
    _notify_all(task, {"type": "progress", "stage": stage, "pct": pct})


# ── The run ───────────────────────────────────────────────────────────────────


def _run_monte_carlo(
    body: MonteCarloRequest,
    task: _TaskState,
    task_id: str,
) -> MonteCarloResult:
    """Draw ``body.iterations`` samples and summarise them per indicator."""
    import bw2calc

    from mapper.api.lca import _build_archetype_source_demand, _translate_demand_to_database
    from mapper.api.parameters import _table_for
    from mapper.core.bom_engine import (
        filter_roots_by_scope,
        flatten_root_with_amounts,
        resolve_archetype_with_engine,
    )
    from mapper.core.bw2_wrapper import PersistentLCARunner
    from mapper.core.parameter_engine import ParameterEngine

    t_start = time.perf_counter()
    _emit(task, "preparing", 0.01)

    # The deterministic run, reusing the ordinary single-product builder. This
    # both validates the request (same 4xx as /lca/calculate-archetype) and
    # gives the point score the distribution is shown against.
    bundle = _build_archetype_source_demand(
        archetype_id=body.archetype_id,
        scope=body.scope,
        amount=body.amount,
        stage_amounts=body.stage_amounts,
        methods=body.methods,
        parameter_scenario=body.parameter_scenario,
        basis_amounts=body.basis_amounts,
    )
    method_tuples = bundle.method_tuples
    base_demand, warnings = _translate_demand_to_database(
        bundle.total_demand, body.compute_database
    )
    if not base_demand:
        raise HTTPException(
            status_code=400,
            detail="No linked materials resolved against the selected database.",
        )

    runner = PersistentLCARunner()
    det_scores = runner(base_demand, method_tuples)

    # What actually carries uncertainty. `collect_row_draws` is where the
    # expression-row rule is enforced.
    table = _table_for()
    referenced = _referenced_parameters(bundle.arc)
    from mapper.core.material_pedigree_storage import load_library

    library = load_library(_current_project())
    try:
        row_draws = collect_row_draws(bundle.linked, library.entries)
        param_draws = collect_param_draws(table, referenced)
    except UncertaintyConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))

    seed = body.seed if body.seed is not None else int(uuid.uuid4().int % (2**31 - 1))
    rng = np.random.default_rng(seed)
    n = body.iterations

    # One MonteCarloLCA per method would resample the background independently
    # per indicator, which would decorrelate indicators that share an
    # inventory. One chain, characterised against every method, keeps them on
    # the same draw -- and costs ~0.2 ms per extra indicator.
    mc = bw2calc.MonteCarloLCA(base_demand, method_tuples[0], seed=seed)
    next(mc)  # loads data, builds the RNGs
    cf_samplers = _method_cf_samplers(mc, method_tuples, seed)

    samples: dict[tuple, list[float]] = {m: [] for m in method_tuples}
    input_draws: dict[str, list[float]] = {}
    if body.variance_contributions:
        for r in row_draws:
            input_draws[f"row::{r.name}"] = []
        for p in param_draws:
            input_draws[f"param::{p.name}"] = []

    base_materials = _linked_with_amounts(
        bundle.arc, body.scope, bundle.effective_amounts, body.basis_amounts
    )
    base_values = table.resolve_all(body.parameter_scenario, 2025)

    # Source-db key -> the key actually present in the technosphere being
    # solved against. Derived ONCE: an activity link never changes across
    # iterations (only its quantity does), and `_translate_demand_to_database`
    # does bw2data lookups, so re-deriving it per iteration would cost more
    # than the solve it feeds.
    key_map = _translation_map(
        {(m.ecoinvent_activity.database, m.ecoinvent_activity.code) for m, _ in base_materials},
        body.compute_database,
    )

    # Nothing in the foreground varies -> the demand is constant, so skip
    # rebuilding it entirely and let the run vary the background alone. This is
    # a legitimate configuration (and the default before any row or parameter
    # is tagged), not a degenerate one.
    static_demand = None if (row_draws or param_draws) else base_demand

    for i in range(n):
        if task_registry.is_cancelled(task_id):
            raise CancelledOperation(task_id)

        # ── 1. draw each PARAMETER once ──────────────────────────────────────
        if param_draws:
            drawn = dict(base_values)
            for p in param_draws:
                f = lognormal_factor(rng, p.sigma)
                drawn[p.name] = base_values.get(p.name, p.base_value) * f
                if body.variance_contributions:
                    input_draws[f"param::{p.name}"].append(f)
            # ── 2. re-resolve every expression against those draws ───────────
            arc_i = resolve_archetype_with_engine(bundle.arc, ParameterEngine(drawn))
            materials_i = _linked_with_amounts(
                arc_i, body.scope, bundle.effective_amounts, body.basis_amounts
            )
        else:
            materials_i = base_materials

        # ── 3. apply per-row uncertainty to LITERAL rows only ────────────────
        # `collect_row_draws` has already rejected any expression row carrying
        # its own uncertainty, so nothing here can double-count a driver. The
        # factors are keyed by node_id and applied DURING demand construction,
        # because several rows may share one ecoinvent code and scaling the
        # aggregated entry would leak a row's factor onto its neighbours.
        factors: dict[str, float] = {}
        for r in row_draws:
            f = lognormal_factor(rng, r.sigma)
            factors[r.node_id] = f
            if body.variance_contributions:
                input_draws[f"row::{r.name}"].append(f)

        demand_i = static_demand if static_demand is not None else _aggregate(
            materials_i, factors, key_map
        )

        mc.demand = demand_i
        mc.build_demand_array()
        next(mc)                      # resamples A, B and C, then solves
        # Per-flow totals as a matvec. Equivalent to summing the rows of the
        # materialised inventory (B * diag(supply)), but without touching the
        # 4.7k x 23k sparse product a second time.
        flow_totals = mc.biosphere_matrix * mc.supply_array
        for m in method_tuples:
            rows, cf_rng = cf_samplers[m]
            samples[m].append(float(cf_rng.next() @ flow_totals[rows]))

        if (i + 1) % 10 == 0 or i + 1 == n:
            _emit(task, f"iteration {i + 1}/{n}", 0.02 + 0.96 * (i + 1) / n)

    if task_registry.is_cancelled(task_id):
        raise CancelledOperation(task_id)
    _emit(task, "summarising", 0.99)

    distributions: list[ArchetypeLCAMethodDistribution] = []
    for m in method_tuples:
        s = summarize(samples[m])
        det, unit = det_scores.get(m, (0.0, ""))
        distributions.append(
            ArchetypeLCAMethodDistribution(
                method=list(m),
                method_label=" | ".join(m[1:]) or m[0],
                unit=unit,
                deterministic=det,
                n_iterations=n,
                seed=seed,
                samples=samples[m] if body.keep_samples else None,
                **s,
            )
        )

    contributors: list[VarianceContributor] = []
    if body.variance_contributions and input_draws:
        primary = samples[method_tuples[0]]
        arrays = {k: np.asarray(v) for k, v in input_draws.items() if len(v) == n}
        sigma_by_name = {f"row::{r.name}": r.sigma for r in row_draws}
        sigma_by_name.update({f"param::{p.name}": p.sigma for p in param_draws})
        for key, share in variance_shares(arrays, primary):
            kind, _, name = key.partition("::")
            contributors.append(
                VarianceContributor(
                    name=name,
                    kind="row" if kind == "row" else "parameter",
                    share=share,
                    gsd2=mce.gsd2_from_sigma(sigma_by_name.get(key, 0.0)),
                )
            )

    scored: list[ScoredInput] = []
    for r in row_draws:
        unc = _uncertainty_for_row(bundle.linked, r.node_id, library.entries)
        scored.append(ScoredInput(
            name=r.name, kind="row",
            pedigree=dict((unc.pedigree or {}) if unc else {}),
            basic_variance=(unc.basic_variance if unc else 0.0),
            gsd2=mce.gsd2_from_sigma(r.sigma), inherited=r.inherited,
        ))
    for p in param_draws:
        pu = getattr(table.parameters.get(p.name), "uncertainty", None)
        scored.append(ScoredInput(
            name=p.name, kind="parameter",
            pedigree=dict((pu.pedigree or {}) if pu else {}),
            basic_variance=(pu.basic_variance if pu else 0.0),
            gsd2=mce.gsd2_from_sigma(p.sigma),
        ))

    return MonteCarloResult(
        archetype_id=body.archetype_id,
        archetype_name=bundle.arc.name,
        scope=body.scope,
        n_iterations=n,
        seed=seed,
        elapsed_seconds=round(time.perf_counter() - t_start, 3),
        compute_database=body.compute_database,
        parameter_scenario=body.parameter_scenario,
        distributions=distributions,
        contributors=contributors,
        rows_with_uncertainty=len(row_draws),
        rows_inherited=sum(1 for r in row_draws if r.inherited),
        parameters_with_uncertainty=len(param_draws),
        scored_inputs=scored,
        warnings=warnings,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _uncertainty_for_row(materials: Any, node_id: str, library: dict) -> Any:
    """The RowUncertainty a given node actually used: its own, else the
    material-library entry it inherited."""
    for m in materials:
        if getattr(m, "node_id", None) != node_id:
            continue
        return m.uncertainty or library.get(m.name)
    return None


def _referenced_parameters(arc: Any) -> set[str]:
    """Every parameter name appearing in any of the archetype's expressions."""
    import re

    names: set[str] = set()
    ident = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

    def walk(n: Any) -> None:
        expr = getattr(n, "quantity_expression", None)
        if expr:
            names.update(ident.findall(expr))
        for lever in (getattr(n, "global_levers", None) or []):
            names.add(lever)
        for c in (getattr(n, "children", None) or []):
            walk(c)

    for root in arc.bom:
        walk(root)
    return names


def _linked_with_amounts(
    arc: Any,
    scope: str,
    effective_amounts: dict[str, float],
    basis_amounts: dict[str, float] | None,
) -> list[tuple[Any, float]]:
    """Flatten to (material, stage_amount) pairs, in scope.

    Mirrors the tail of ``_build_archetype_source_demand`` -- the same
    ``flatten_root_with_amounts`` pairing -- so a per-iteration demand is built
    exactly the way the deterministic one is. Kept as pairs rather than an
    aggregated dict so a per-row factor can be applied before aggregation.
    """
    from mapper.core.bom_engine import filter_roots_by_scope, flatten_root_with_amounts

    out: list[tuple[Any, float]] = []
    for root in filter_roots_by_scope(arc.bom, scope):
        for m, amt in flatten_root_with_amounts(root, effective_amounts, basis_amounts):
            if m.ecoinvent_activity is not None:
                out.append((m, amt))
    return out


def _aggregate(
    materials: list[tuple[Any, float]],
    factors: dict[str, float],
    key_map: dict[tuple[str, str], tuple[str, str] | None],
) -> dict[tuple[str, str], float]:
    """Sum materials into a demand, applying per-node factors BEFORE the sum.

    Before, not after: several rows can link one ecoinvent code, and scaling
    the aggregated entry would apply one row's draw to every other row sharing
    it. ``key_map`` re-keys to the database actually being solved against; a
    key that maps to ``None`` is absent there and is dropped, matching
    ``_translate_demand_to_database``.
    """
    demand: dict[tuple[str, str], float] = {}
    for m, amt in materials:
        link = m.ecoinvent_activity
        target = key_map.get((link.database, link.code))
        if target is None:
            continue
        q = m.quantity * amt * factors.get(m.node_id, 1.0)
        demand[target] = demand.get(target, 0.0) + q
    return demand


def _translation_map(
    keys: set[tuple[str, str]],
    compute_database: str | None,
) -> dict[tuple[str, str], tuple[str, str] | None]:
    """Map each source-db key to its key in ``compute_database`` (or itself)."""
    from mapper.api.lca import _translate_demand_to_database

    if not compute_database:
        return {k: k for k in keys}
    out: dict[tuple[str, str], tuple[str, str] | None] = {}
    for k in keys:
        translated, _ = _translate_demand_to_database({k: 1.0}, compute_database)
        out[k] = next(iter(translated), None) if translated else None
    return out


def _method_cf_samplers(mc: Any, method_tuples: list[tuple], seed: int) -> dict:
    """One characterisation-factor RNG per method, all on the same inventory.

    Two traps here, both hit on the way in.

    ``load_lcia_data()`` reads ``self.method_filepath``, NOT ``self.method`` --
    so assigning ``mc.method = m`` and reloading silently returns the ORIGINAL
    method's factors. That produced sixteen identical distributions on the
    first end-to-end run. ``switch_method`` is the call that recomputes the
    filepath, so it is the one to use.

    And ``switch_method`` replaces ``cf_params`` while the chain's ``cf_rng``
    still holds the previous method's array, which makes the next draw raise
    "Incompatible data & indices". The chain is therefore switched back to its
    original method and its ``cf_rng`` rebuilt before any iteration runs.

    Characterisation is diagonal, so a score is a dot product of the sampled
    factors with the per-flow inventory totals -- no need to rebuild a sparse
    matrix per method per iteration. Every method gets its OWN sampled factors
    this way, rather than the chain's one method being sampled and the other
    fifteen held fixed.
    """
    from stats_arrays.random import MCRandomNumberGenerator

    per: dict = {}
    original = mc.method
    for m in method_tuples:
        mc.switch_method(m)
        per[m] = (mc.cf_params["row"].copy(), MCRandomNumberGenerator(mc.cf_params, seed=seed))
    mc.switch_method(original)
    mc.cf_rng = MCRandomNumberGenerator(mc.cf_params, seed=seed)
    return per


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/lca/pedigree", response_model=PedigreeTableResponse)
async def get_pedigree_table() -> PedigreeTableResponse:
    """Serve the pedigree constants to the UI.

    The scoring UI needs the factors to show a live GSD^2 as a user picks
    scores. Serving them keeps ONE table: a hard-coded copy in the frontend
    would drift silently, since both copies would keep producing plausible
    numbers.
    """
    from mapper.core.pedigree import (
        DEFAULT_BASIC_VARIANCE,
        INDICATORS,
        UNCERTAINTY_FACTORS,
    )

    return PedigreeTableResponse(
        indicators=list(INDICATORS),
        factors={k: list(v) for k, v in UNCERTAINTY_FACTORS.items()},
        default_basic_variance=DEFAULT_BASIC_VARIANCE,
        convention="sigma_i^2 = [ln(f_i) / 2]^2 — the factor is a 95% range, hence the /2.",
    )



# ── Excel export ──────────────────────────────────────────────────────────────

#: Field acronym for the shared filename scheme, alongside LCA / pLCA / AESA /
#: DSM / MFA. Single-product Monte Carlo has no DSM system, so the archetype
#: name takes the ``system`` slot and there are never subsystems.
MC_DOMAIN = "MC"

#: Repeated in the Summary because a distribution read without it is
#: over-confident: roughly 12% of ecoinvent's non-production exchanges carry no
#: uncertainty distribution and are sampled as fixed.
LOWER_BOUND_NOTE = (
    "LOWER BOUND. About 12% of ecoinvent's technosphere exchanges carry no "
    "uncertainty distribution and are sampled as FIXED, so their contribution "
    "to the spread is missing from every figure in this workbook."
)


def _scope_label(scope: str) -> str:
    """Reuse Impact Assessment's labels so one scope never reads two ways."""
    from mapper.api.impact import _SCOPE_LABELS

    return _SCOPE_LABELS.get(scope, "Full Lifecycle" if scope == "all" else scope)


def _build_monte_carlo_workbook(
    result: MonteCarloResult,
    coverage: PedigreeCoverage | None,
) -> "Workbook":
    from openpyxl import Workbook

    from mapper.api.cohort_export import apply_sci, autosize, style_header

    wb = Workbook()

    # ── Summary ───────────────────────────────────────────────────────────────
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Field", "Value"])
    style_header(ws)

    rows: list[tuple[str, object]] = [
        ("Archetype", result.archetype_name),
        ("Sensitivity case", result.parameter_scenario or "Base"),
        ("Scope", _scope_label(result.scope)),
        ("Background database", result.compute_database or "base ecoinvent"),
        ("Iterations", result.n_iterations),
        # Not optional. A Monte Carlo result nobody can reproduce is not a
        # research output, and the seed is the whole of the reproduction.
        ("Seed", result.seed),
        ("Elapsed (s)", round(result.elapsed_seconds, 2)),
        ("", ""),
        ("SCORING PROVENANCE", ""),
        ("Rows scored", result.rows_with_uncertainty),
        ("  ...inheriting a material score", result.rows_inherited),
        ("Parameters scored", result.parameters_with_uncertainty),
    ]
    if coverage is not None:
        rows += [
            ("Materials scored (project)",
             f"{coverage.materials_scored} of {coverage.materials_total}"),
            ("Materials scored (this archetype)",
             f"{coverage.archetype_materials_scored} of {coverage.archetype_materials_total}"),
            ("Impact-weighted coverage",
             f"{coverage.impact_share * 100:.1f}% of {coverage.method_label}"),
            ("Coverage basis",
             "Weighted by impact, not row count: the share of THIS archetype's "
             "total |impact| carried by rows whose uncertainty was scored."),
        ]
    else:
        rows.append(
            ("Impact-weighted coverage",
             "not recorded for this export — re-export with coverage available")
        )
    if result.rows_with_uncertainty == 0 and result.parameters_with_uncertainty == 0:
        rows.append(
            ("Foreground uncertainty",
             "NONE scored. This run varied the BACKGROUND only, so the spread "
             "reflects ecoinvent's own exchange uncertainty and nothing about "
             "the foreground data.")
        )
    rows += [("", ""), ("Caveat", LOWER_BOUND_NOTE)]
    if result.warnings:
        rows.append(("Warnings", " | ".join(result.warnings)))

    for k, v in rows:
        ws.append([k, v])
    autosize(ws)

    # ── Distributions ─────────────────────────────────────────────────────────
    ws = wb.create_sheet("Distributions")
    ws.append([
        "Indicator", "Unit", "Deterministic", "Median", "Median / deterministic",
        "Mean", "p2.5", "p25", "p75", "p97.5", "GSD2", "Iterations", "Seed",
    ])
    style_header(ws)
    for d in result.distributions:
        ratio = (d.median / d.deterministic) if d.deterministic else None
        ws.append([
            d.method_label, d.unit, d.deterministic, d.median,
            round(ratio, 4) if ratio is not None else "n/a",
            d.mean, d.p2_5, d.p25, d.p75, d.p97_5,
            round(d.gsd2, 4) if d.gsd2 else "n/a",
            d.n_iterations, d.seed,
        ])
    if result.distributions:
        # Scores span orders of magnitude across indicators; the ratio and GSD2
        # columns are small and stay readable as plain numbers.
        apply_sci(ws, min_row=2, min_col=3, max_col=4)
        apply_sci(ws, min_row=2, min_col=6, max_col=10)
    autosize(ws)

    # ── Variance contribution ─────────────────────────────────────────────────
    ws = wb.create_sheet("Variance contribution")
    ws.append(["Input", "Kind", "Share of spread", "GSD2"])
    style_header(ws)
    for c in result.contributors:
        ws.append([c.name, c.kind, round(c.share, 6), round(c.gsd2, 4)])
    if not result.contributors:
        ws.append([
            "No foreground input carried uncertainty, so the whole spread comes "
            "from the background database.", "", "", "",
        ])
    else:
        ws.append([])
        ws.append([
            "Shares are an approximate attribution (squared rank correlation, "
            "normalised) — the inputs are not orthogonal.", "", "", "",
        ])
    autosize(ws)

    # ── Pedigree scores ───────────────────────────────────────────────────────
    ws = wb.create_sheet("Pedigree scores")
    ws.append([
        "Input", "Kind", "Source",
        "Reliability", "Completeness", "Temporal", "Geographical",
        "Technological", "Basic variance", "GSD2",
    ])
    style_header(ws)
    for si in result.scored_inputs:
        ped = si.pedigree or {}
        ws.append([
            si.name, si.kind,
            "material library" if si.inherited else "own",
            ped.get("reliability", ""),
            ped.get("completeness", ""),
            ped.get("temporal correlation", ""),
            ped.get("geographical correlation", ""),
            ped.get("further technological correlation", ""),
            si.basic_variance, round(si.gsd2, 4),
        ])
    if not result.scored_inputs:
        ws.append([
            "Nothing was scored. Every foreground row and parameter was held at "
            "its resolved value.", "", "", "", "", "", "", "", "", "",
        ])
    else:
        ws.append([])
        ws.append([
            "Scores compose as sigma_i^2 = [ln(factor_i)/2]^2 using the "
            "Weidema/Frischknecht factors ecoinvent applied to the background, "
            "so a foreground score and a background exchange share one matrix.",
            "", "", "", "", "", "", "", "", "",
        ])
    autosize(ws)

    # ── Samples ───────────────────────────────────────────────────────────────
    # Written as a NOTE sheet when the draws were not retained, never omitted.
    # An absent sheet is ambiguous with "this build does not produce one", and
    # a reader comparing two workbooks would have no way to tell which.
    ws = wb.create_sheet("Samples")
    with_samples = [d for d in result.distributions if d.samples]
    if not with_samples:
        ws.append(["Samples were not retained for this run."])
        style_header(ws)
        ws.append([
            "The run was launched with keep_samples disabled, so the "
            "per-iteration values were summarised and discarded. Re-run with "
            "samples retained to populate this sheet; the percentiles on "
            "Distributions are unaffected."
        ])
    else:
        ws.append(["Iteration"] + [d.method_label for d in with_samples])
        style_header(ws)
        n = max(len(d.samples or []) for d in with_samples)
        for i in range(n):
            ws.append(
                [i + 1]
                + [(d.samples[i] if d.samples and i < len(d.samples) else None)
                   for d in with_samples]
            )
        apply_sci(ws, min_row=2, min_col=2, max_col=1 + len(with_samples))
    autosize(ws)

    return wb


@router.post("/lca/monte-carlo/export")
async def post_monte_carlo_export(body: MonteCarloExportRequest) -> Any:
    from mapper.api.bom import build_export_filename
    from mapper.api.cohort_export import excel_response

    wb = _build_monte_carlo_workbook(body.result, body.coverage)
    # Single-product: the archetype takes the system slot, never a subsystem.
    filename = build_export_filename(body.result.archetype_name, [], MC_DOMAIN)
    return excel_response(wb, filename, kind="data")



# ── Material pedigree library ────────────────────────────────────────────────


def _current_project() -> str:
    import bw2data

    return bw2data.projects.current


@router.get("/lca/material-pedigree", response_model=MaterialPedigreeLibrary)
async def get_material_pedigree() -> MaterialPedigreeLibrary:
    from mapper.core.material_pedigree_storage import load_library

    return load_library(_current_project())


@router.put("/lca/material-pedigree", response_model=MaterialPedigreeLibrary)
async def put_material_pedigree(body: MaterialPedigreeLibrary) -> MaterialPedigreeLibrary:
    from mapper.core.material_pedigree_storage import load_library, save_library

    save_library(_current_project(), body)
    return load_library(_current_project())


@router.get("/lca/material-pedigree/materials", response_model=list[str])
async def list_project_materials() -> list[str]:
    """Every distinct LITERAL material name in the project, sorted.

    The rows of the scoring table. Expression rows are excluded: they inherit
    their uncertainty from the parameters in their expression and can never
    carry a score, so listing them would offer a control that does nothing.
    """
    from mapper.api.bom import _proj_archetypes

    names: set[str] = set()
    for arc in _proj_archetypes().values():
        for root in arc.bom:
            _collect_names(root, names)
    return sorted(names)


def _collect_names(node: Any, out: set[str]) -> None:
    if node.node_type == "material" and not node.quantity_expression:
        out.add(node.name)
    for c in (node.children or []):
        _collect_names(c, out)


@router.get("/lca/material-pedigree/coverage", response_model=PedigreeCoverage)
async def get_pedigree_coverage(
    archetype_id: str,
    method: str,
    scope: str = "all",
    compute_database: str | None = None,
) -> PedigreeCoverage:
    """How much of one archetype's impact rests on scored data.

    ``method`` is the ``|``-joined tuple, e.g.
    ``EF v3.1|climate change|global warming potential (GWP100)``.

    The impact weighting is the point. A row count reports clicking; this
    reports how much of the ANSWER is assessed, which is where the next hour of
    scoring is worth spending and what makes a reported GSD^2 legible.
    """
    from mapper.api.lca import _build_archetype_source_demand, _translate_demand_to_database
    from mapper.core.bw2_wrapper import PersistentLCARunner
    from mapper.core.material_pedigree_storage import load_library

    method_tuple = tuple(method.split("|"))
    if len(method_tuple) < 2:
        raise HTTPException(status_code=400, detail="method must be a '|'-joined tuple")

    bundle = _build_archetype_source_demand(
        archetype_id=archetype_id, scope=scope, amount=1.0, stage_amounts={},
        methods=[list(method_tuple)], parameter_scenario=None,
    )
    library = load_library(_current_project())

    # Per-(db, code) UNIT score, one back-substitution each after the first
    # factorization -- so contributions cost ~0.02 s per distinct activity
    # rather than a solve per row.
    runner = PersistentLCARunner()
    unit: dict[tuple[str, str], float] = {}
    for m in bundle.linked:
        link = m.ecoinvent_activity
        key = (link.database, link.code)
        if key in unit:
            continue
        d, _ = _translate_demand_to_database({key: 1.0}, compute_database)
        if not d:
            unit[key] = 0.0
            continue
        scores = runner(d, [method_tuple])
        unit[key] = scores.get(method_tuple, (0.0, ""))[0]

    unit_label = ""
    if bundle.linked:
        first = bundle.linked[0].ecoinvent_activity
        d, _ = _translate_demand_to_database({(first.database, first.code): 1.0}, compute_database)
        if d:
            unit_label = runner(d, [method_tuple]).get(method_tuple, (0.0, ""))[1]

    # |impact| per material NAME, and whether that row is scored.
    by_name: dict[str, float] = {}
    scored_names: set[str] = set()
    for m in bundle.linked:
        if m.quantity_expression:
            # Not scoreable -- it inherits from its parameters. Counting it as
            # unscored would understate coverage and point the user at a row
            # they cannot fix.
            continue
        link = m.ecoinvent_activity
        amt = getattr(m, "_stage_amount", 1.0)
        contrib = abs(m.quantity * amt * unit[(link.database, link.code)])
        by_name[m.name] = by_name.get(m.name, 0.0) + contrib
        if m.uncertainty is not None or m.name in library.entries:
            scored_names.add(m.name)

    total = sum(by_name.values())
    covered = sum(v for k, v in by_name.items() if k in scored_names)
    top = sorted(
        ((k, v) for k, v in by_name.items() if k not in scored_names),
        key=lambda kv: -kv[1],
    )[:10]

    project_names: set[str] = set()
    from mapper.api.bom import _proj_archetypes

    for arc in _proj_archetypes().values():
        for root in arc.bom:
            _collect_names(root, project_names)

    return PedigreeCoverage(
        materials_total=len(project_names),
        materials_scored=len(set(library.entries) & project_names),
        archetype_materials_total=len(by_name),
        archetype_materials_scored=len(scored_names),
        impact_share=(covered / total) if total > 0 else 0.0,
        method_label=" | ".join(method_tuple[1:]) or method_tuple[0],
        unit=unit_label,
        top_unscored=[
            UnscoredMaterial(name=k, share=(v / total) if total else 0.0, impact=v)
            for k, v in top if v > 0
        ],
    )


@router.post("/lca/monte-carlo", response_model=MonteCarloStartResponse)
async def post_monte_carlo(body: MonteCarloRequest) -> MonteCarloStartResponse:
    if not body.methods:
        raise HTTPException(status_code=400, detail="At least one method is required")
    if body.iterations < 1 or body.iterations > MAX_ITERATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"iterations must be between 1 and {MAX_ITERATIONS}",
        )

    task_id = str(uuid.uuid4())
    task = _TaskState()
    with _TASK_LOCK:
        _TASKS[task_id] = task
    task_registry.register(task_id)

    def work() -> None:
        try:
            task.result = _run_monte_carlo(body, task, task_id)
            task.done = True
            _notify_all(task, {"type": "done", "task_id": task_id})
        except CancelledOperation:
            task.cancelled = True
            task.done = True
            _notify_all(task, {"type": "cancelled", "task_id": task_id})
        except HTTPException as e:
            task.error = str(e.detail)
            task.done = True
            _notify_all(task, {"type": "error", "error": task.error})
        except Exception as e:  # noqa: BLE001 - surfaced to the client
            task.error = f"{type(e).__name__}: {e}"
            task.done = True
            _notify_all(task, {"type": "error", "error": task.error})
        finally:
            task_registry.unregister(task_id)

    # A plain daemon thread, as `plca` and `impact` do for the same shape.
    # NOT `core.tasks.run_in_thread`: that drives a `core.tasks.Task`
    # (status/finish/fail) and calls `fn(task, ...)`, whereas this route owns a
    # WS-oriented `_TaskState` and a zero-arg closure. Passing the closure
    # alone raised `run_in_thread() missing 1 required positional argument`
    # on every call, so the endpoint 500'd before any sampling began.
    threading.Thread(target=work, daemon=True).start()
    return MonteCarloStartResponse(task_id=task_id)


@router.get("/lca/monte-carlo/{task_id}", response_model=MonteCarloResult | dict)
async def get_monte_carlo(task_id: str) -> Any:
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown task id")
    if task.cancelled:
        return {"cancelled": True, "task_id": task_id}
    if task.error:
        raise HTTPException(status_code=500, detail=task.error)
    if not task.done or task.result is None:
        raise HTTPException(status_code=409, detail="Task is still running")
    return task.result


@router.websocket("/lca/monte-carlo/ws/{task_id}")
async def ws_monte_carlo(websocket: WebSocket, task_id: str) -> None:
    await websocket.accept()
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
    if task is None:
        await websocket.send_json({"type": "error", "error": "Unknown task id"})
        await websocket.close()
        return

    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    task.subscribers.append(queue)
    await websocket.send_json({"type": "progress", "stage": task.stage, "pct": task.pct})
    if task.done:
        if task.cancelled:
            await websocket.send_json({"type": "cancelled", "task_id": task_id})
        elif task.error:
            await websocket.send_json({"type": "error", "error": task.error})
        else:
            await websocket.send_json({"type": "done", "task_id": task_id})
        await websocket.close()
        return

    try:
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
            if payload.get("type") in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            task.subscribers.remove(queue)
        except ValueError:
            pass
        task_registry.maybe_cancel_on_last_subscriber_leave(
            task_id,
            remaining_subscribers=len(task.subscribers),
            task_done=task.done,
        )
        try:
            await websocket.close()
        except Exception:
            pass
