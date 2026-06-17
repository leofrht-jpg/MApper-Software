"""Prospective-LCA temporal handling — block (default) vs interpolate (Option A).

block: each fleet year takes its nearest-earlier premise anchor db, held
constant → STEP at anchors. interpolate: for a non-anchor year bracketed by
anchors a<Y<b, solve the SAME year-Y demand against db_a AND db_b and linearly
blend the scalar scores (frac=(Y−a)/(b−a)) → smooth. Exact-anchor / clamped
years do a SINGLE solve. Rigorous because the LCIA CFs are year-invariant.

The fake runner scores a demand as Σ amount × DB_FACTOR[db], so the background
db is the only thing that moves the score — isolating the temporal logic from
bw2. It also counts calls (to prove single- vs double-solve).
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_lca_engine import (
    ProjectedDSMLCAPipeline,
    TemporalBracket,
    resolve_bracket,
)
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.dsm_schemas import SimulationResult, YearResult, SimulationSummary

METHOD = ("EF v3.1", "climate change", "GWP100")
# Per-db background intensity (decarbonizing over time): 2025 high → 2050 low.
DB_FACTOR = {
    "db2025": 10.0, "db2030": 6.0, "db2035": 4.0,
    "db2040": 3.0, "db2045": 2.5, "db2050": 2.0,
}
PROSPECTIVE = [(f"db{y}", y) for y in (2025, 2030, 2035, 2040, 2045, 2050)]


# ── resolve_bracket (pure) ───────────────────────────────────────────────────

def test_bracket_exact_anchor_is_single():
    br = resolve_bracket(2030, PROSPECTIVE)
    assert br == TemporalBracket("db2030", 2030, None, None, 0.0)


def test_bracket_clamp_before_first_is_single_earliest():
    br = resolve_bracket(2023, PROSPECTIVE)
    assert br.lower_db == "db2025" and br.upper_db is None  # no extrapolation


def test_bracket_clamp_after_last_is_single_latest():
    br = resolve_bracket(2060, PROSPECTIVE)
    assert br.lower_db == "db2050" and br.upper_db is None  # no extrapolation


def test_bracket_interior_is_pair_with_frac():
    br = resolve_bracket(2027, PROSPECTIVE)
    assert br.lower_db == "db2025" and br.upper_db == "db2030"
    assert br.lower_year == 2025 and br.upper_year == 2030
    assert br.frac == pytest.approx((2027 - 2025) / (2030 - 2025))  # 0.4


def test_bracket_missing_interior_anchor_brackets_wider_gap():
    # No 2035 db → 2035 brackets 2030↔2040, frac 0.5.
    sparse = [("db2030", 2030), ("db2040", 2040)]
    br = resolve_bracket(2035, sparse)
    assert br.lower_db == "db2030" and br.upper_db == "db2040"
    assert br.frac == pytest.approx(0.5)


def test_bracket_empty_is_none():
    assert resolve_bracket(2030, []) is None


# ── pipeline fixture ─────────────────────────────────────────────────────────

def _archetype() -> Archetype:
    # One linked material, 1 unit (base db is "base"; _rewrite_db swaps it).
    node = BOMNode(
        id="n1", name="steel", node_type="material", quantity=1.0, unit="kg",
        ecoinvent_activity=EcoinventLink(database="base", code="c1", name="steel act"),
    )
    return Archetype(id="arc1", name="Widget", bom=[node])


def _sim(years: list[int]) -> SimulationResult:
    yrs = []
    for y in years:
        yrs.append(YearResult(
            year=y,
            stock={"arc1": 1.0}, stock_by_age={},
            inflow={"arc1": 1.0}, outflow={}, outflow_by_age={},
        ))
    return SimulationResult(
        system_id="sys1", years=yrs,
        summary=SimulationSummary(total_stock_start=1.0, total_stock_end=1.0,
                                  total_inflows=float(len(years)), total_outflows=0.0),
    )


class _FakeRunner:
    """run_lca(demand, methods) → {method: (score, unit)}; score = Σ amount ×
    DB_FACTOR[db of the key]. Counts calls to prove single vs double solve."""
    def __init__(self):
        self.calls = 0

    def __call__(self, demand, methods):
        self.calls += 1
        score = 0.0
        for (db, _code), amount in demand.items():
            score += amount * DB_FACTOR[db]
        return {tuple(m): (score, "kg CO2eq") for m in methods}


def _pipeline(years, temporal_mode, runner=None):
    runner = runner or _FakeRunner()
    return ProjectedDSMLCAPipeline(
        simulation_result=_sim(years),
        archetypes={"arc1": _archetype()},
        cohort_mappings={"arc1": ("arc1", 1.0)},
        methods=[METHOD],
        lca_runner=runner,
        prospective_dbs=PROSPECTIVE,
        temporal_mode=temporal_mode,
    ), runner


def _scores_by_year(results):
    r = results[0]
    return {y.year: y.total_impact for y in r.years}


# ── block (no-drift) ─────────────────────────────────────────────────────────

def test_block_uses_nearest_earlier_anchor_step():
    # inflows scope → production-year db. 1 unit × DB_FACTOR.
    pipe, _ = _pipeline([2025, 2027, 2030, 2032], temporal_mode="block")
    sc = _scores_by_year(pipe.calculate("inflows"))
    assert sc[2025] == pytest.approx(10.0)   # db2025
    assert sc[2027] == pytest.approx(10.0)   # nearest-earlier = db2025 (STEP held)
    assert sc[2030] == pytest.approx(6.0)    # db2030 (step down)
    assert sc[2032] == pytest.approx(6.0)    # nearest-earlier = db2030


def test_block_single_solve_per_year():
    pipe, runner = _pipeline([2027], temporal_mode="block")
    pipe.calculate("inflows")
    assert runner.calls == 1  # one solve, no blend


# ── interpolate ──────────────────────────────────────────────────────────────

def test_interpolate_blends_bracket_years_linearly():
    pipe, _ = _pipeline([2025, 2027, 2030], temporal_mode="interpolate")
    sc = _scores_by_year(pipe.calculate("inflows"))
    assert sc[2025] == pytest.approx(10.0)   # exact anchor
    assert sc[2030] == pytest.approx(6.0)    # exact anchor
    # 2027: frac 0.4 → 0.6·10 + 0.4·6 = 8.4 (smooth, between the anchors)
    assert sc[2027] == pytest.approx(0.6 * 10.0 + 0.4 * 6.0)


def test_interpolate_midpoint_is_mean():
    # 2030↔2040 only; 2035 is the midpoint → mean of the two anchor scores.
    sparse = [("db2030", 2030), ("db2040", 2040)]
    pipe = ProjectedDSMLCAPipeline(
        simulation_result=_sim([2035]),
        archetypes={"arc1": _archetype()},
        cohort_mappings={"arc1": ("arc1", 1.0)},
        methods=[METHOD], lca_runner=_FakeRunner(),
        prospective_dbs=sparse, temporal_mode="interpolate",
    )
    sc = _scores_by_year(pipe.calculate("inflows"))
    assert sc[2035] == pytest.approx((DB_FACTOR["db2030"] + DB_FACTOR["db2040"]) / 2)


def test_interpolate_endpoints_equal_anchor_scores():
    pipe, _ = _pipeline([2025, 2050], temporal_mode="interpolate")
    sc = _scores_by_year(pipe.calculate("inflows"))
    assert sc[2025] == pytest.approx(10.0)
    assert sc[2050] == pytest.approx(2.0)


def test_interpolate_clamps_outside_range_no_extrapolation():
    pipe, _ = _pipeline([2023, 2060], temporal_mode="interpolate")
    sc = _scores_by_year(pipe.calculate("inflows"))
    assert sc[2023] == pytest.approx(10.0)   # clamp to earliest (db2025)
    assert sc[2060] == pytest.approx(2.0)    # clamp to latest (db2050)


def test_interpolate_anchor_and_clamp_years_single_solve():
    # Exact (2030) + clamp (2023) → 1 solve each; bracket (2027) → 2 solves.
    pipe, runner = _pipeline([2023, 2030], temporal_mode="interpolate")
    pipe.calculate("inflows")
    assert runner.calls == 2  # both single-solve

    pipe2, runner2 = _pipeline([2027], temporal_mode="interpolate")
    pipe2.calculate("inflows")
    assert runner2.calls == 2  # one bracket year → two solves (db_a, db_b)


# ── block vs interpolate agree at anchors/clamps; differ between ─────────────

def test_block_and_interpolate_agree_at_anchors_and_clamps_differ_between():
    years = [2023, 2025, 2027, 2030, 2060]
    block = _scores_by_year(_pipeline(years, "block")[0].calculate("inflows"))
    interp = _scores_by_year(_pipeline(years, "interpolate")[0].calculate("inflows"))
    # anchors + clamped years: identical (no drift)
    for y in (2023, 2025, 2030, 2060):
        assert block[y] == pytest.approx(interp[y])
    # interior non-anchor year: interpolate is strictly between, block holds
    assert block[2027] == pytest.approx(10.0)             # held at db2025
    assert interp[2027] == pytest.approx(8.4)             # blended
    assert interp[2027] != pytest.approx(block[2027])
