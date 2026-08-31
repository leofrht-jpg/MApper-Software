# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A unit mismatch refuses at COMPUTE, on the fleet path too.

The upload check (#64) is where a NEW project gets caught. What the audit
actually named is that quantities enter demand vectors with no dimensional
check at all, so a project ALREADY carrying a mismatch computes in silence --
MAp-test's three charger rows asked for 7, 18.5 and 180 whole-vehicle
dismantlings, and were found by hand rather than by the code.

Three sites, one definition (`_canonical_unit`, shared with the upload check):
the two single-product builders, and `compute_demand_vector`'s caller on the
fleet path. THE FLEET SITE IS THE ONE THE OTHER TWO MISS -- a fleet run reaches
the demand vector through neither builder -- and it is the path with the most
at stake, so it is tested here specifically rather than by analogy.

NO CONVERSION, EVER. See `UnitMismatchError` for why a silent kg->tonne would
be the same class of defect this closes.
"""
from __future__ import annotations

import sys
import types

import pytest

from mapper.core.bom_validator import (
    UnitMismatchError,
    find_unit_mismatches,
    refuse_on_unit_mismatch,
)
# Imported at MODULE scope on purpose: the bw2 fixture below replaces
# `sys.modules['bw2data']`, and `mapper.api.lca` does its own
# `from bw2data import Database` at import time. Collection runs first,
# so the real module is still there when this binds.
from mapper.api.lca import _refuse_on_unit_mismatch
from mapper.core.dsm_lca_engine import DSMLCAPipeline
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.dsm_schemas import SimulationResult, SimulationSummary, YearResult

DB = "ecoinvent-3.10-cutoff"
METHOD = ("EF v3.1", "climate change", "GWP100")


@pytest.fixture
def bw2(monkeypatch):
    """bw2data stub: 'a'*32 is per kilogram, 'u'*32 is per unit."""
    fake = types.SimpleNamespace()
    fake.activities = {
        (DB, "a" * 32): {"name": "market for steel, low-alloyed", "unit": "kilogram"},
        (DB, "u" * 32): {"name": "market for manual dismantling of used electric "
                                 "passenger car", "unit": "unit"},
    }
    fake.lookups = []

    def _get_activity(key):
        fake.lookups.append(key)
        if key in fake.activities:
            spec = fake.activities[key]
            act = types.SimpleNamespace()
            act.get = lambda k, default="": spec.get(k, default)
            return act
        raise KeyError(key)

    fake.get_activity = _get_activity
    monkeypatch.setitem(sys.modules, "bw2data", fake)
    return fake


def _mat(name: str, code: str, unit: str, qty: float = 1.0) -> BOMNode:
    return BOMNode(
        id=f"n-{name}", name=name, node_type="material", quantity=qty, unit=unit,
        ecoinvent_activity=EcoinventLink(database=DB, code=code, name=name),
    )


def _arc(*mats: BOMNode) -> Archetype:
    return Archetype(id="arc1", name="Public DC Charger", bom=[BOMNode(
        id="s1", name="End of Life", node_type="component", quantity=1.0,
        unit="piece", scope="outflows", children=list(mats))])


# ── the checker itself ───────────────────────────────────────────────────────


def test_a_kg_row_against_a_per_unit_activity_is_reported(bw2):
    bad = find_unit_mismatches([_mat("Electronic waste treatment", "u" * 32, "kg", 180.0)])
    assert len(bad) == 1
    name, bom_unit, act_unit, act_name = bad[0]
    assert (name, bom_unit, act_unit) == ("Electronic waste treatment", "kg", "unit")
    assert "dismantling" in act_name


def test_a_spelling_variant_is_not_a_mismatch(bw2):
    """870 kg/kilogram pairs in MAp-test; firing on those buries the signal."""
    assert find_unit_mismatches([_mat("Steel", "a" * 32, "kg")]) == []
    assert find_unit_mismatches([_mat("Steel", "a" * 32, "kilogram")]) == []


def test_the_message_names_the_row_both_units_and_the_activity(bw2):
    with pytest.raises(UnitMismatchError) as e:
        refuse_on_unit_mismatch("ctx", [_mat("Electronic waste treatment", "u" * 32, "kg")])
    msg = str(e.value)
    assert "Electronic waste treatment" in msg          # the row
    assert " kg " in msg and "per unit" in msg           # BOTH units
    assert "dismantling" in msg                          # the activity
    assert "NO conversion" in msg or "no conversion" in msg.lower()
    assert "does not convert" in msg                     # and says so explicitly


def test_a_blank_unit_on_either_side_is_skipped_not_reported(bw2):
    """Unknown is not the same as different."""
    assert find_unit_mismatches([_mat("X", "u" * 32, "")]) == []
    bw2.activities[(DB, "b" * 32)] = {"name": "y", "unit": ""}
    assert find_unit_mismatches([_mat("Y", "b" * 32, "kg")]) == []


def test_an_unresolvable_link_is_not_this_guards_job(bw2):
    assert find_unit_mismatches([_mat("Z", "z" * 32, "kg")]) == []


# ── THE FLEET PATH ───────────────────────────────────────────────────────────


class _SumRunner:
    def __call__(self, demand, methods):
        total = sum(float(v) for v in demand.values())
        return {tuple(m): (total, "kg") for m in methods}


def _sim(years: list[int]) -> SimulationResult:
    yrs = [YearResult(year=y, stock={"arc1": 2.0}, stock_by_age={},
                      inflow={"arc1": 2.0}, outflow={"arc1": 1.0}, outflow_by_age={})
           for y in years]
    return SimulationResult(
        system_id="sys1", years=yrs,
        summary=SimulationSummary(total_stock_start=2.0, total_stock_end=2.0,
                                  total_inflows=2.0, total_outflows=1.0))


def _pipeline(arc: Archetype) -> DSMLCAPipeline:
    return DSMLCAPipeline(
        simulation_result=_sim([2025, 2026]),
        archetypes={"arc1": arc},
        cohort_mappings={"arc1": ("arc1", 1.0)},
        methods=[METHOD],
        lca_runner=_SumRunner(),
    )


def test_a_FLEET_run_refuses_on_a_mismatched_row(bw2):
    """The site the two single-product builders miss.

    A fleet run reaches `compute_demand_vector` through neither builder, so
    before this patch it computed the mismatch straight into the demand vector
    -- across every cohort and every year.
    """
    pipe = _pipeline(_arc(_mat("Electronic waste treatment", "u" * 32, "kg", 180.0)))
    with pytest.raises(UnitMismatchError) as e:
        pipe.calculate("outflows")
    msg = str(e.value)
    assert "Electronic waste treatment" in msg
    assert "Public DC Charger" in msg        # names the archetype
    assert "arc1" in msg                     # and the cohort


def test_a_FLEET_run_with_clean_units_still_computes(bw2):
    pipe = _pipeline(_arc(_mat("Steel frame", "a" * 32, "kg", 100.0)))
    results = pipe.calculate("outflows")
    assert results and results[0].years


def test_the_fleet_refusal_is_a_ValueError_so_the_api_returns_400(bw2):
    """`bom.py`'s dsm-lca route turns a ValueError into a 400, which is how
    DanglingArchetypeError and UnmappedCohortError already surface."""
    assert issubclass(UnitMismatchError, ValueError)


# ── the two single-product sites ─────────────────────────────────────────────


def test_the_single_product_wrapper_raises_422_in_the_unlinked_shape(bw2):
    """Same boundary, same shape as `_refuse_on_unlinked`: a 422 whose detail
    is a dict with an `error` discriminator, not a bare string."""
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        _refuse_on_unit_mismatch(
            "Public DC Charger",
            [_mat("Electronic waste treatment", "u" * 32, "kg", 180.0)],
            "all",
        )
    assert e.value.status_code == 422
    d = e.value.detail
    assert d["error"] == "unit_mismatch"
    assert d["archetype"] == "Public DC Charger" and d["scope"] == "all"
    assert "Electronic waste treatment" in d["message"]


def test_a_clean_archetype_passes_the_wrapper(bw2):
    _refuse_on_unit_mismatch("X", [_mat("Steel", "a" * 32, "kg")], "all")   # no raise


def test_BOTH_single_product_builders_call_it_not_just_one():
    """`_build_archetype_source_demand` (single-product LCA, trajectory, all
    three Monte Carlo entry points) and `_build_archetype_demand` (contribution
    analysis) are SEPARATE demand builders. Guarding one would leave a path
    computing a mismatch behind a guard that looks shut -- the same reasoning
    that put `_refuse_on_unlinked` in both.
    """
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "mapper" / "api" / "lca.py").read_text(
        encoding="utf-8")
    assert src.count("_refuse_on_unit_mismatch(") >= 3      # 1 def + 2 call sites


def test_all_THREE_sites_share_one_definition():
    """Upload and compute must agree on what a mismatch IS, or a row could warn
    at import and compute anyway (or the reverse)."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "mapper"
    api = (root / "api" / "lca.py").read_text(encoding="utf-8")
    engine = (root / "core" / "dsm_lca_engine.py").read_text(encoding="utf-8")
    validator = (root / "core" / "bom_validator.py").read_text(encoding="utf-8")

    # the two compute sites import the shared checker rather than rolling one
    assert "from mapper.core.bom_validator import" in api
    assert "refuse_on_unit_mismatch" in engine
    # and the checker folds through the SAME function the upload check uses
    assert "_canonical_unit(bom_unit) != _canonical_unit(act_unit)" in validator
    assert validator.count("def _canonical_unit(") == 1


def test_nothing_anywhere_converts_a_unit():
    """The honest answer to "should it convert" is no, and it is checkable.

    A silent kg->tonne would be the same class of defect this refusal closes.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "mapper"
    for rel in ("core/bom_validator.py", "core/dsm_lca_engine.py", "api/lca.py"):
        src = (root / rel).read_text(encoding="utf-8")
        for bad in ("* 1000", "/ 1000", "* 1e3", "/ 1e3"):
            for line in src.splitlines():
                if bad in line and "unit" in line.lower():
                    raise AssertionError(f"{rel}: looks like a unit conversion: {line.strip()}")


# ── the cache changes nothing ────────────────────────────────────────────────


def test_the_cache_does_not_change_the_refusal(bw2):
    """Same data, with and without the cache: same answer, both times."""
    mats = [_mat("Electronic waste treatment", "u" * 32, "kg", 180.0),
            _mat("Steel frame", "a" * 32, "kg", 100.0)]

    uncached = find_unit_mismatches(mats)                 # fresh dict each call
    cache: dict = {}
    cached_first = find_unit_mismatches(mats, cache)
    cached_again = find_unit_mismatches(mats, cache)      # now served from cache

    assert uncached == cached_first == cached_again
    assert len(uncached) == 1


def test_the_cache_does_not_change_a_CLEAN_verdict(bw2):
    mats = [_mat("Steel frame", "a" * 32, "kg")]
    cache: dict = {}
    assert find_unit_mismatches(mats) == find_unit_mismatches(mats, cache) == []
    assert find_unit_mismatches(mats, cache) == []


def test_the_cache_saves_lookups_ACROSS_calls_which_is_what_the_fleet_needs(bw2):
    """Within ONE call the function already dedupes by (db, code) -- three rows
    sharing an activity cost one lookup either way. What the caller-supplied
    cache buys is dedup ACROSS calls, and that is exactly the fleet's shape:
    `refuse_on_unit_mismatch` is called once per cohort per year, on the same
    handful of activities every time.
    """
    mats = [_mat("A", "a" * 32, "kg"), _mat("B", "a" * 32, "kg"),
            _mat("C", "a" * 32, "kg")]

    bw2.lookups.clear()
    find_unit_mismatches(mats)
    find_unit_mismatches(mats)
    without = len(bw2.lookups)          # a fresh dict per call -> one each

    bw2.lookups.clear()
    cache: dict = {}
    find_unit_mismatches(mats, cache)
    find_unit_mismatches(mats, cache)
    with_cache = len(bw2.lookups)

    assert without == 2                 # one per call
    assert with_cache == 1              # one for both


def test_the_fleet_pipeline_reuses_ONE_cache_across_years_and_cohorts(bw2):
    """Per cohort per year is far too hot for a bw2 lookup per row."""
    pipe = _pipeline(_arc(_mat("Steel frame", "a" * 32, "kg", 100.0)))
    bw2.lookups.clear()
    pipe.calculate("outflows")          # 2 years x 1 cohort
    assert len(bw2.lookups) == 1, bw2.lookups


def test_the_cache_is_per_run_not_module_level():
    """bw2's project state is mutable, so a cache outliving a run would answer
    from a different project. Same rule the row validator's code_cache follows.
    """
    import mapper.core.bom_validator as bv

    assert not [
        n for n in dir(bv)
        if n.isupper() and "CACHE" in n
    ], "a module-level unit cache would survive a project switch"
    pipe_attr = DSMLCAPipeline.__init__.__code__.co_names
    assert "_unit_cache" in DSMLCAPipeline.__init__.__code__.co_varnames + pipe_attr
