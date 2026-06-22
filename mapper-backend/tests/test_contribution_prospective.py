# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Tests for prospective-database support in Single-product LCA contribution
analysis (Session 1 of the pLCA + multi-year plan).

Covers:
  • compute_database is a first-class request field, surfaced on the result
  • Cache key includes compute_database (different DB → cache miss)
  • Activity key translation falls back to source DB + warning when the
    activity isn't carried over to the prospective DB
  • /api/lca/prospective-years lists years for a generated pattern, returns
    is_prospective=False for the static base
  • result_type discriminators are stable on both schemas
  • Persistable serialization round-trip is session-independent

These tests run without bw2 wherever possible; the integration paths are
skipped when no project + LCIA method is available, mirroring the existing
test_contribution_analysis.py pattern.
"""
from __future__ import annotations

import pytest


# ── Schema-only tests (no bw2 needed) ──────────────────────────────────────


def test_contribution_request_accepts_compute_database():
    from mapper.models.schemas import ContributionAnalysisRequest

    req = ContributionAnalysisRequest(
        target_type="activity",
        database="ecoinvent-3.10-cutoff",
        code="abc",
        method=["a", "b"],
        compute_database="ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030",
    )
    assert req.compute_database == (
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030"
    )


def test_contribution_request_compute_database_optional():
    """Backward compatibility: requests without compute_database still parse."""
    from mapper.models.schemas import ContributionAnalysisRequest

    req = ContributionAnalysisRequest(
        target_type="activity",
        database="ecoinvent-3.10-cutoff",
        code="abc",
        method=["a", "b"],
    )
    assert req.compute_database is None


def test_contribution_result_type_is_single_product():
    """The result_type discriminator must be present and pinned to the
    'single_product' literal — future AESA dispatchers depend on this."""
    from mapper.models.schemas import (
        ContributionAnalysisResult,
        ContributionTreeNode,
        ContributionsResponse,
        SankeyData,
    )

    r = ContributionAnalysisResult(
        target_type="activity",
        target_label="x",
        method=["a"],
        method_unit="kg CO2-eq",
        score=1.0,
        top_technosphere=ContributionsResponse(items=[], rest_amount=0.0, rest_percentage=0.0),
        top_biosphere=[],
        supply_chain_sankey=SankeyData(nodes=[], links=[]),
        supply_chain_tree=ContributionTreeNode(
            name="root", key="", amount=0, unit="", score=0,
            unit_score="", percentage=0,
        ),
        cutoff=0.01,
        max_depth=3,
    )
    assert r.result_type == "single_product"


def test_impact_assessment_result_type_is_system_level():
    """Sibling discriminator on the system-level result keeps the dispatch
    table closed — every result either dispatches to product-level or
    system-level AESA, never ambiguous."""
    from mapper.models.bom_schemas import (
        ImpactAssessmentMeta,
        ImpactAssessmentResult,
    )

    r = ImpactAssessmentResult(
        task_id="t1",
        meta=ImpactAssessmentMeta(mode="static", mfa_system_id="sys", scope="all"),
        results=[],
    )
    assert r.result_type == "system_level"


def test_persistable_dict_includes_reproducibility_fields():
    """to_persistable_dict() must produce a shape that's meaningful in
    isolation — the consumer should be able to identify what was computed
    against what, when, and by which MApper version."""
    from mapper.models.schemas import (
        ContributionAnalysisResult,
        ContributionTreeNode,
        ContributionsResponse,
        SankeyData,
    )

    r = ContributionAnalysisResult(
        target_type="activity",
        target_label="clay brick production, extruded",
        method=["EF v3.1", "Climate change", "GWP100"],
        method_unit="kg CO2-eq",
        score=0.42,
        compute_database="ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030",
        top_technosphere=ContributionsResponse(items=[], rest_amount=0.0, rest_percentage=0.0),
        top_biosphere=[],
        supply_chain_sankey=SankeyData(nodes=[], links=[]),
        supply_chain_tree=ContributionTreeNode(
            name="root", key="", amount=0, unit="", score=0,
            unit_score="", percentage=0,
        ),
        cutoff=0.01,
        max_depth=3,
        computed_at="2026-04-28T12:00:00+00:00",
        mapper_version="0.1.0",
    )
    d = r.to_persistable_dict()
    assert d["result_type"] == "single_product"
    assert d["target_label"] == "clay brick production, extruded"
    assert d["method"] == ["EF v3.1", "Climate change", "GWP100"]
    assert d["compute_database"] == (
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030"
    )
    assert d["score"] == 0.42
    assert d["computed_at"].startswith("2026-04-28")
    assert d["mapper_version"] == "0.1.0"


# ── Translation logic (no bw2 invocation needed) ───────────────────────────


def test_translate_demand_no_compute_database_is_passthrough():
    from mapper.api.lca import _translate_demand_to_database

    demand = {("ecoinvent-3.10-cutoff", "abc"): 1.0}
    out, warnings = _translate_demand_to_database(demand, None)
    assert out == demand
    assert warnings == []


def test_translate_demand_warns_when_compute_database_absent_from_project():
    """If the user passes a compute_database name that doesn't exist in this
    bw2 project, we must surface a warning (so the frontend can show 'this
    DB is gone — generate it via pLCA Developer') instead of silently
    computing wrong numbers."""
    pytest.importorskip("bw2data")
    from mapper.api.lca import _translate_demand_to_database

    demand = {("ecoinvent-3.10-cutoff", "abc"): 1.0}
    out, warnings = _translate_demand_to_database(
        demand, "ecoinvent-3.10-cutoff_premise_does_not_exist_2030"
    )
    # Falls back to source — better wrong DB name than wrong silent answer.
    assert out == demand
    assert warnings, "must warn when compute_database is missing from project"
    assert "not found" in warnings[0].lower()


# ── Integration tests (require a bw2 project) ──────────────────────────────


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
def test_prospective_years_static_returns_empty():
    """Static base DB → is_prospective=False, available_years=[]. Frontend
    treats this as 'all years available' (no gating)."""
    import asyncio

    from mapper.api.lca import list_prospective_years

    out = asyncio.run(list_prospective_years(database="ecoinvent-3.10-cutoff"))
    assert out["is_prospective"] is False
    assert out["available_years"] == []


@pytest.mark.skipif(not _ok, reason=_why)
def test_prospective_years_strips_year_suffix():
    """If the caller passes a fully-qualified single-year DB name, the year
    suffix is stripped before matching siblings — useful for the dropdown
    that holds the active selection in fully-qualified form."""
    import asyncio

    from mapper.api.lca import list_prospective_years

    # Even with no prospective DBs in this project, the response must echo
    # the stripped pattern so the frontend can validate user input.
    out = asyncio.run(list_prospective_years(
        database="ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030"
    ))
    assert out["pattern"] == "ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150"
    assert out["is_prospective"] is True
    assert isinstance(out["available_years"], list)


@pytest.mark.skipif(not _ok, reason=_why)
def test_cache_key_changes_when_compute_database_changes():
    """Same target + method but different compute_database must miss the
    cache, otherwise the user gets the static result silently when they
    asked for the prospective one."""
    import asyncio

    from mapper.api.lca import (
        _contribution_cache,
        calculate_contribution_analysis,
    )
    from mapper.models.schemas import ContributionAnalysisRequest
    import bw2data

    db_name = next(d for d in bw2data.databases if "biosphere" not in d.lower())
    db = bw2data.Database(db_name)
    act = next(iter(db))
    method = tuple(next(iter(bw2data.methods)))

    _contribution_cache.clear()

    req_static = ContributionAnalysisRequest(
        target_type="activity",
        database=act.key[0],
        code=act.key[1],
        amount=1.0,
        method=list(method),
        limit=3,
        cutoff=0.20,
        max_depth=1,
    )
    asyncio.run(calculate_contribution_analysis(req_static))
    static_keys = list(_contribution_cache.keys())
    assert len(static_keys) == 1

    # Same request but with a non-existent compute_database — must produce
    # a *different* cache key (regardless of whether the translation falls
    # back to source). The point is the keys don't collide.
    req_prosp = req_static.model_copy(update={
        "compute_database": "ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030",
    })
    asyncio.run(calculate_contribution_analysis(req_prosp))
    assert len(_contribution_cache) == 2, (
        f"compute_database must be in the cache key, got {list(_contribution_cache.keys())}"
    )


@pytest.mark.skipif(not _ok, reason=_why)
def test_compute_database_fallback_emits_warning_on_result():
    """When the compute_database is set but doesn't exist in the project,
    the result must (a) still be returned (graceful degradation) and (b)
    carry a warning so the UI can flag the partial translation."""
    import asyncio

    from mapper.api.lca import (
        _contribution_cache,
        calculate_contribution_analysis,
    )
    from mapper.models.schemas import ContributionAnalysisRequest
    import bw2data

    db_name = next(d for d in bw2data.databases if "biosphere" not in d.lower())
    db = bw2data.Database(db_name)
    act = next(iter(db))
    method = tuple(next(iter(bw2data.methods)))

    _contribution_cache.clear()

    result = asyncio.run(calculate_contribution_analysis(
        ContributionAnalysisRequest(
            target_type="activity",
            database=act.key[0],
            code=act.key[1],
            amount=1.0,
            method=list(method),
            limit=3,
            cutoff=0.20,
            max_depth=1,
            compute_database="ecoinvent-3.10-cutoff_premise_does_not_exist_2030",
        )
    ))
    assert result.compute_database == (
        "ecoinvent-3.10-cutoff_premise_does_not_exist_2030"
    )
    assert result.warnings, "missing compute_database must surface a warning"
    assert result.computed_at  # ISO timestamp present
    assert result.mapper_version  # version stamped for reproducibility
    assert result.result_type == "single_product"
