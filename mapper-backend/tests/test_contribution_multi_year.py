"""Tests for multi-year Single-product LCA contribution analysis (Session 3
of the pLCA + multi-year plan).

Covers:
  • Schemas: years list, MultiYearContributionResult discriminator, trajectory
    + evolution shapes, persistable round-trip
  • Aggregation helper: _build_multi_year_result builds trajectory in year
    order, evolution unions top-N keys across years, missing years filled
    with 0
  • Endpoint integration (bw2-skipif): start task, poll until done, fetch
    result; verify per-year results + cache reuse + DB pattern wiring
"""
from __future__ import annotations

import asyncio
import time

import pytest


# ── Schema-only tests ─────────────────────────────────────────────────────


def test_multi_year_request_requires_years_list():
    """``years`` defaults to empty; the endpoint rejects an empty list. The
    schema itself accepts empty lists so old payloads parse — endpoint
    enforcement is the place to fail loud."""
    from mapper.models.schemas import MultiYearContributionRequest

    req = MultiYearContributionRequest(
        target_type="activity",
        database="ecoinvent-3.10-cutoff",
        code="abc",
        method=["a", "b"],
        compute_database_pattern="ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150",
        years=[2030, 2040, 2050],
    )
    assert req.years == [2030, 2040, 2050]
    assert req.compute_database_pattern.endswith("ssp2-pkbudg1150")


def test_multi_year_request_accepts_static_pattern_none():
    """Trajectories against a static DB (only BOM expressions vary by year)
    are valid — pattern is None, every year computes against source DB."""
    from mapper.models.schemas import MultiYearContributionRequest

    req = MultiYearContributionRequest(
        target_type="archetype",
        archetype_id="brick-wall-v1",
        method=["a", "b"],
        years=[2025, 2030],
    )
    assert req.compute_database_pattern is None
    assert req.years == [2025, 2030]


def test_multi_year_result_discriminator():
    """``result_type`` is pinned — future product-based AESA will dispatch on
    this to choose the right downscaling chain."""
    from mapper.models.schemas import MultiYearContributionResult

    r = MultiYearContributionResult(
        target_type="activity",
        target_label="x",
        method=["a"],
        method_unit="kg CO2-eq",
        years=[],
        cutoff=0.005,
        max_depth=3,
    )
    assert r.result_type == "multi_year_single_product"


def test_build_multi_year_result_trajectory_and_evolution():
    """The aggregation helper produces:
      • trajectory in ascending year order
      • evolution with the union of top-N keys across years, filled with 0
        for years where a key was below cutoff
    """
    from mapper.api.lca import _build_multi_year_result
    from mapper.models.schemas import (
        ContributionAnalysisResult,
        ContributionTreeNode,
        ContributionsResponse,
        ContributionItem,
        MultiYearContributionRequest,
        SankeyData,
    )

    def make_per_year(year, score, items):
        return ContributionAnalysisResult(
            target_type="activity",
            target_label="clay brick",
            method=["EF", "Climate"],
            method_unit="kg CO2-eq",
            score=score,
            year=year,
            compute_database=f"ei_premise_remind_ssp2_{year}",
            top_technosphere=ContributionsResponse(
                items=[
                    ContributionItem(
                        activity_name=name,
                        activity_key=key,
                        location="GLO",
                        amount=amt,
                        unit="kg CO2-eq",
                        percentage=amt / score * 100,
                    )
                    for name, key, amt in items
                ],
                rest_amount=0.0,
                rest_percentage=0.0,
            ),
            top_biosphere=[],
            supply_chain_sankey=SankeyData(nodes=[], links=[]),
            supply_chain_tree=ContributionTreeNode(
                name="root", key="", amount=0, unit="", score=score,
                unit_score="", percentage=0,
            ),
            cutoff=0.01,
            max_depth=3,
        )

    per_year = {
        2030: make_per_year(2030, 1.0, [
            ("electricity", "ei|elec", 0.6),
            ("clay", "ei|clay", 0.4),
        ]),
        2050: make_per_year(2050, 0.7, [
            ("electricity", "ei|elec", 0.3),
            ("transport", "ei|truck", 0.4),
        ]),
    }
    body = MultiYearContributionRequest(
        target_type="activity",
        database="ecoinvent-3.10-cutoff",
        code="abc",
        method=["EF", "Climate"],
        compute_database_pattern="ei_premise_remind_ssp2",
        years=[2030, 2050],
    )

    out = _build_multi_year_result(body, per_year, elapsed=1.5)

    # Years sorted ascending
    assert [p.year for p in out.trajectory] == [2030, 2050]
    assert [p.score for p in out.trajectory] == [1.0, 0.7]
    assert out.years == [2030, 2050]

    # Evolution: union of {elec, clay, truck}; missing years filled with 0
    by_key = {ev.activity_key: ev for ev in out.evolution}
    assert set(by_key) == {"ei|elec", "ei|clay", "ei|truck"}
    assert by_key["ei|elec"].by_year == {"2030": 0.6, "2050": 0.3}
    assert by_key["ei|clay"].by_year == {"2030": 0.4, "2050": 0.0}
    assert by_key["ei|truck"].by_year == {"2030": 0.0, "2050": 0.4}

    # results dict keyed by str(year)
    assert set(out.results) == {"2030", "2050"}
    assert out.computed_at  # ISO timestamp present
    assert out.mapper_version
    assert out.elapsed_seconds == 1.5


def test_build_multi_year_result_keeps_same_named_activities_distinct():
    """Regression: two distinct ecoinvent activities (different ``(database,
    code)`` → different ``activity_key``) that share the same display name
    must remain separate entries in ``evolution``. Previously the frontend
    chart keyed on ``activity_name`` and collapsed them, but the backend
    aggregator must not aid that bug — and the frontend now keys on
    ``activity_key``. This test pins the backend contract.

    Real-world case: 'natural gas venting from petroleum/natural gas
    production' exists with multiple locations across premise vintages.
    """
    from mapper.api.lca import _build_multi_year_result
    from mapper.models.schemas import (
        ContributionAnalysisResult,
        ContributionTreeNode,
        ContributionsResponse,
        ContributionItem,
        MultiYearContributionRequest,
        SankeyData,
    )

    NAME = "natural gas venting from petroleum/natural gas production"

    def make_year(year, items):
        return ContributionAnalysisResult(
            target_type="activity",
            target_label="petrol car",
            method=["EF", "Climate"],
            method_unit="kg CO2-eq",
            score=1.0,
            year=year,
            top_technosphere=ContributionsResponse(
                items=[
                    ContributionItem(
                        activity_name=name,
                        activity_key=key,
                        location=loc,
                        amount=amt,
                        unit="kg CO2-eq",
                        percentage=amt * 100,
                    )
                    for name, key, loc, amt in items
                ],
                rest_amount=0.0,
                rest_percentage=0.0,
            ),
            top_biosphere=[],
            supply_chain_sankey=SankeyData(nodes=[], links=[]),
            supply_chain_tree=ContributionTreeNode(
                name="root", key="", amount=0, unit="", score=1.0,
                unit_score="", percentage=0,
            ),
            cutoff=0.01,
            max_depth=3,
        )

    per_year = {
        2030: make_year(2030, [
            (NAME, "ei_2030|venting_glo", "GLO", 0.4),
            (NAME, "ei_2030|venting_row", "RoW", 0.3),
        ]),
        2040: make_year(2040, [
            (NAME, "ei_2040|venting_glo", "GLO", 0.5),
            (NAME, "ei_2040|venting_row", "RoW", 0.2),
        ]),
    }
    body = MultiYearContributionRequest(
        target_type="activity",
        database="ecoinvent-3.10-cutoff",
        code="petrol_car",
        method=["EF", "Climate"],
        compute_database_pattern="ei_premise_remind_ssp2",
        years=[2030, 2040],
    )

    out = _build_multi_year_result(body, per_year, elapsed=0.1)

    # Four distinct activity_keys in evolution despite all sharing the same
    # activity_name. If the aggregator ever collapsed by name, this drops.
    by_key = {ev.activity_key: ev for ev in out.evolution}
    assert set(by_key) == {
        "ei_2030|venting_glo",
        "ei_2030|venting_row",
        "ei_2040|venting_glo",
        "ei_2040|venting_row",
    }
    # All four carry the same display name; consumers must disambiguate via
    # location (the frontend chart appends ``· <location>`` on collisions).
    assert all(ev.activity_name == NAME for ev in out.evolution)
    locations = {ev.activity_key: ev.location for ev in out.evolution}
    assert locations["ei_2030|venting_glo"] == "GLO"
    assert locations["ei_2030|venting_row"] == "RoW"


def test_build_multi_year_result_aggregates_warnings_with_year_prefix():
    """Per-year warnings flow into the aggregated list with a ``[year]``
    prefix so the UI can group them next to the trajectory chart."""
    from mapper.api.lca import _build_multi_year_result
    from mapper.models.schemas import (
        ContributionAnalysisResult,
        ContributionTreeNode,
        ContributionsResponse,
        MultiYearContributionRequest,
        SankeyData,
    )

    def make_year(y, warnings):
        return ContributionAnalysisResult(
            target_type="activity",
            target_label="x",
            method=["a"],
            method_unit="kg",
            score=1.0,
            year=y,
            top_technosphere=ContributionsResponse(items=[], rest_amount=0.0, rest_percentage=0.0),
            top_biosphere=[],
            supply_chain_sankey=SankeyData(nodes=[], links=[]),
            supply_chain_tree=ContributionTreeNode(
                name="root", key="", amount=0, unit="", score=0,
                unit_score="", percentage=0,
            ),
            cutoff=0.01,
            max_depth=3,
            warnings=warnings,
        )

    per_year = {
        2030: make_year(2030, []),
        2040: make_year(2040, ["Activity X not found in compute DB; fell back to source."]),
    }
    body = MultiYearContributionRequest(
        target_type="activity", database="d", code="c", method=["a"], years=[2030, 2040],
    )
    out = _build_multi_year_result(body, per_year, elapsed=0.0)
    assert any(w.startswith("[2040]") for w in out.warnings)
    # Trajectory carries per-point has_warnings flag too.
    flagged = {p.year: p.has_warnings for p in out.trajectory}
    assert flagged[2030] is False
    assert flagged[2040] is True


def test_multi_year_persistable_dict_round_trip():
    from mapper.models.schemas import MultiYearContributionResult

    r = MultiYearContributionResult(
        target_type="activity",
        target_label="clay brick",
        method=["EF", "Climate"],
        method_unit="kg CO2-eq",
        compute_database_pattern="ei_premise_remind_ssp2",
        years=[2030, 2050],
        cutoff=0.005,
        max_depth=3,
        computed_at="2026-04-28T12:00:00+00:00",
        mapper_version="0.1.0",
    )
    d = r.to_persistable_dict()
    assert d["result_type"] == "multi_year_single_product"
    assert d["compute_database_pattern"] == "ei_premise_remind_ssp2"
    assert d["years"] == [2030, 2050]
    assert d["computed_at"].startswith("2026-04-28")


# ── Endpoint validation tests (no bw2 needed) ─────────────────────────────


def test_start_multi_year_rejects_empty_years():
    from fastapi import HTTPException

    from mapper.api.lca import start_multi_year_contribution
    from mapper.models.schemas import MultiYearContributionRequest

    body = MultiYearContributionRequest(
        target_type="activity", database="d", code="c", method=["a"], years=[],
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(start_multi_year_contribution(body))
    assert exc.value.status_code == 400
    assert "years" in exc.value.detail.lower()


# ── Integration (bw2-skipif) ──────────────────────────────────────────────


def _bw2_available() -> tuple[bool, str]:
    try:
        import bw2data
    except ImportError:
        return False, "bw2data not installed"
    dbs = [d for d in bw2data.databases if "biosphere" not in d.lower()]
    if not dbs:
        return False, "no technosphere databases"
    if not list(bw2data.methods):
        return False, "no LCIA methods"
    return True, ""


_ok, _why = _bw2_available()


@pytest.mark.skipif(not _ok, reason=_why)
def test_multi_year_runs_against_static_db_with_no_pattern():
    """When ``compute_database_pattern`` is None every year computes against
    the source DB. Useful as a baseline trajectory (e.g. 'what does this look
    like with only parameters changing?')."""
    import bw2data

    from mapper.api.lca import (
        _MY_TASKS,
        get_multi_year_contribution,
        start_multi_year_contribution,
    )
    from mapper.models.schemas import MultiYearContributionRequest

    db_name = next(d for d in bw2data.databases if "biosphere" not in d.lower())
    db = bw2data.Database(db_name)
    act = next(iter(db))
    method = tuple(next(iter(bw2data.methods)))

    body = MultiYearContributionRequest(
        target_type="activity",
        database=act.key[0],
        code=act.key[1],
        amount=1.0,
        method=list(method),
        compute_database_pattern=None,
        years=[2030, 2050],
        limit=3,
        cutoff=0.20,
        max_depth=1,
    )

    async def runner():
        started = await start_multi_year_contribution(body)
        assert started.planned_years == [2030, 2050]
        assert started.compute_databases == ["", ""]
        deadline = time.time() + 30
        while time.time() < deadline:
            if _MY_TASKS[started.task_id].done:
                break
            await asyncio.sleep(0.1)
        assert _MY_TASKS[started.task_id].done, "task did not complete in 30s"
        return await get_multi_year_contribution(started.task_id)

    result = asyncio.run(runner())
    assert result.result_type == "multi_year_single_product"
    assert result.years == [2030, 2050]
    assert set(result.results) == {"2030", "2050"}
    # Both years used the same source DB → scores must match to numerical
    # precision. (Not bit-identical: the shared-runner optimization reuses a
    # UMFPACK factorization across years, so year 2 is a back-sub instead of
    # a fresh spsolve. Drift is at ~1e-13 relative — well below LCA precision.)
    s30 = result.results["2030"].score
    s50 = result.results["2050"].score
    assert s30 == pytest.approx(s50, rel=1e-9)
    # Trajectory ordered.
    assert [p.year for p in result.trajectory] == [2030, 2050]


@pytest.mark.skipif(not _ok, reason=_why)
def test_multi_year_planned_dbs_use_pattern_year_concat():
    """``compute_databases`` in the start response is built as
    ``f"{pattern}_{year}"`` for each year — surface for the frontend to show
    the resolved DB names before the run completes."""
    import bw2data

    from mapper.api.lca import _MY_TASKS, start_multi_year_contribution
    from mapper.models.schemas import MultiYearContributionRequest

    db_name = next(d for d in bw2data.databases if "biosphere" not in d.lower())
    db = bw2data.Database(db_name)
    act = next(iter(db))
    method = tuple(next(iter(bw2data.methods)))

    body = MultiYearContributionRequest(
        target_type="activity",
        database=act.key[0],
        code=act.key[1],
        method=list(method),
        compute_database_pattern="ei_premise_remind_ssp2-pkbudg1150",
        years=[2030, 2050],
        limit=2,
        cutoff=0.5,
        max_depth=1,
    )

    async def runner():
        # Wait for the worker thread to settle before returning — otherwise it
        # keeps populating ``_contribution_cache`` after the test exits and
        # poisons subsequent test ordering.
        started = await start_multi_year_contribution(body)
        deadline = time.time() + 30
        while time.time() < deadline:
            if _MY_TASKS[started.task_id].done:
                break
            await asyncio.sleep(0.1)
        return started

    started = asyncio.run(runner())
    assert started.compute_databases == [
        "ei_premise_remind_ssp2-pkbudg1150_2030",
        "ei_premise_remind_ssp2-pkbudg1150_2050",
    ]
