"""Tests for the Single-Product LCA contribution analysis feature.

Covers:
  • get_biosphere_contributions returns top emissions with percentages
  • get_recursive_contribution_tree builds a tree honoring cutoff/max_depth
  • Cache reuse and recompute conditions in the API path
  • Edge cases: empty demand, biosphere flow rejected as functional unit

These tests are conditional on a brightway2 project with at least one
technosphere database + one LCIA method being available. When unavailable
the tests are skipped, mirroring the pattern used in test_persistent_lca.py.
"""
from __future__ import annotations

import pytest


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
pytestmark = pytest.mark.skipif(not _ok, reason=_why)


def _pick_activity():
    import bw2data
    db_name = next(d for d in bw2data.databases if "biosphere" not in d.lower())
    db = bw2data.Database(db_name)
    for act in db:
        # Pick an activity with at least one technosphere exchange so the
        # recursive tree has something to walk.
        if any(True for _ in act.technosphere()):
            return act
    return next(iter(db))


def _pick_method():
    import bw2data
    return tuple(next(iter(bw2data.methods)))


def test_biosphere_contributions_returns_items_or_empty():
    import bw2calc
    import bw2data
    from mapper.core.bw2_wrapper import get_biosphere_contributions

    act = _pick_activity()
    method = _pick_method()

    lca = bw2calc.LCA({act: 1.0}, method)
    lca.lci()
    lca.lcia()
    score = float(lca.score)

    result = get_biosphere_contributions(lca, score, limit=5)
    assert "items" in result
    assert "rest_amount" in result
    assert "rest_percentage" in result
    # Either a real flow list or empty (some methods + activities have none).
    assert isinstance(result["items"], list)
    for item in result["items"]:
        assert "flow_name" in item
        assert "amount" in item
        assert "percentage" in item
        assert isinstance(item["categories"], list)
    # If we got items, percentages should be non-negative and bounded.
    for item in result["items"]:
        assert item["percentage"] >= 0


def _find_activity(name_substr: str, location: str | None = None):
    """Locate an activity by (case-insensitive) name and optional location."""
    import bw2data
    target = name_substr.lower()
    for db_name in bw2data.databases:
        if "biosphere" in db_name.lower():
            continue
        db = bw2data.Database(db_name)
        for act in db:
            if target in (act.get("name") or "").lower():
                if location is None or act.get("location") == location:
                    return act
    return None


def _find_method(*tokens: str):
    """Locate an LCIA method whose tuple contains all tokens (case-insensitive)."""
    import bw2data
    needles = [t.lower() for t in tokens]
    for m in bw2data.methods:
        joined = " | ".join(m).lower()
        if all(n in joined for n in needles):
            return tuple(m)
    return None


def test_endpoint_returns_biosphere_for_clay_brick_co2_fossil():
    """End-to-end via the API handler — covers wrapper + cache + serialization.

    The unit-level test exercises ``get_biosphere_contributions`` in isolation;
    this one calls the actual route handler that the frontend hits. It would
    have caught the gap where the wrapper works but the endpoint silently
    swallows an exception or serves a stale-empty cache entry.
    """
    from mapper.api.lca import (
        _contribution_cache,
        calculate_contribution_analysis,
    )
    from mapper.models.schemas import ContributionAnalysisRequest

    act = _find_activity("clay brick production, extruded", location="RER")
    if act is None:
        pytest.skip("clay brick production (RER) not in this project")
    method = _find_method("ef v3.1", "climate change", "gwp100")
    if method is None:
        pytest.skip("EF v3.1 Climate change GWP100 not installed")

    # Wipe the cache so we hit the real compute path, not a leftover entry.
    _contribution_cache.clear()

    req = ContributionAnalysisRequest(
        target_type="activity",
        database=act.key[0],
        code=act.key[1],
        amount=1.0,
        method=list(method),
        limit=10,
        cutoff=0.005,
        max_depth=2,
    )
    result = _run(calculate_contribution_analysis(req))

    assert result.top_biosphere, (
        "endpoint returned empty top_biosphere for clay brick + GWP100 — "
        "the wrapper works but the endpoint path is broken"
    )
    names = [it.flow_name.lower() for it in result.top_biosphere]
    assert any("carbon dioxide, fossil" in n for n in names), (
        f"expected 'Carbon dioxide, fossil' in endpoint response, got {names}"
    )


def test_clay_brick_biosphere_contributions_includes_co2_fossil():
    """Regression test: bw2analyzer.annotated_top_emissions raised ValueError on
    sparse-matrix float indices, returning {} and a misleading "no biosphere
    contributions" UI message. Our bypass implementation must produce a real
    list dominated by Carbon dioxide, fossil for clay brick + EF v3.1 GWP100.
    """
    import bw2calc
    from mapper.core.bw2_wrapper import get_biosphere_contributions

    act = _find_activity("clay brick production, extruded", location="RER")
    if act is None:
        pytest.skip("clay brick production (RER) not in this project")
    method = _find_method("ef v3.1", "climate change", "gwp100")
    if method is None:
        pytest.skip("EF v3.1 Climate change GWP100 not installed")

    lca = bw2calc.LCA({act: 1.0}, method)
    lca.lci()
    lca.lcia()
    score = float(lca.score)

    result = get_biosphere_contributions(lca, score, limit=10)

    assert result["items"], "biosphere contributions must not be empty"
    names = [it["flow_name"].lower() for it in result["items"]]
    assert any("carbon dioxide, fossil" in n for n in names), (
        f"expected 'Carbon dioxide, fossil' in top flows, got {names}"
    )
    # CO2-fossil should be the dominant contributor for a brick kiln + GWP100.
    top = result["items"][0]
    assert "carbon dioxide, fossil" in top["flow_name"].lower(), (
        f"top flow should be CO2 fossil, got {top['flow_name']}"
    )
    assert top["percentage"] > 50, (
        f"CO2 fossil should dominate (>50%), got {top['percentage']}%"
    )


def test_recursive_tree_respects_max_depth():
    from mapper.core.bw2_wrapper import get_recursive_contribution_tree

    act = _pick_activity()
    method = _pick_method()
    demand = {act.key: 1.0}

    tree = get_recursive_contribution_tree(demand, method, cutoff=0.0, max_depth=1)

    # Depth-1 tree means the root may have children but those children must
    # have no further children.
    for child in tree["children"]:
        assert child["children"] == []


def test_recursive_tree_cutoff_prunes_small_branches():
    from mapper.core.bw2_wrapper import get_recursive_contribution_tree

    act = _pick_activity()
    method = _pick_method()
    demand = {act.key: 1.0}

    deep = get_recursive_contribution_tree(demand, method, cutoff=0.0, max_depth=3)
    pruned = get_recursive_contribution_tree(demand, method, cutoff=0.5, max_depth=3)

    # A 50% cutoff cannot produce more children than 0% cutoff at the same depth.
    assert len(pruned["children"]) <= len(deep["children"])


def test_recursive_tree_empty_demand():
    from mapper.core.bw2_wrapper import get_recursive_contribution_tree

    method = _pick_method()
    tree = get_recursive_contribution_tree({}, method)
    assert tree["score"] == 0.0
    assert tree["children"] == []


def test_recursive_tree_root_score_matches_lca():
    """The recursive tree's root score must equal a direct bw2calc.LCA run."""
    import bw2calc
    from mapper.core.bw2_wrapper import get_recursive_contribution_tree

    act = _pick_activity()
    method = _pick_method()
    demand = {act.key: 1.0}

    lca = bw2calc.LCA({act: 1.0}, method)
    lca.lci()
    lca.lcia()
    direct_score = float(lca.score)

    tree = get_recursive_contribution_tree(demand, method, cutoff=0.0, max_depth=0)

    # Allow tiny FP drift but require sign/magnitude match.
    if direct_score != 0:
        rel = abs(tree["score"] - direct_score) / abs(direct_score)
        assert rel < 1e-6, f"tree={tree['score']} vs lca={direct_score}"
    else:
        assert tree["score"] == 0


def _run(coro):
    """Run an async coroutine to completion in a fresh loop."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_contribution_analysis_endpoint_smoke():
    """Invoke the route handler directly (no httpx/TestClient dependency)."""
    from mapper.api.lca import calculate_contribution_analysis
    from mapper.models.schemas import ContributionAnalysisRequest

    act = _pick_activity()
    method = _pick_method()
    req = ContributionAnalysisRequest(
        target_type="activity",
        database=act.key[0],
        code=act.key[1],
        amount=1.0,
        method=list(method),
        limit=5,
        cutoff=0.20,
        max_depth=1,
    )
    result = _run(calculate_contribution_analysis(req))
    assert result.target_type == "activity"
    assert result.method == list(method)
    assert result.supply_chain_tree is not None
    # Cache hit on identical second call should give the same score.
    result2 = _run(calculate_contribution_analysis(req))
    assert result2.score == result.score


def test_contribution_analysis_rejects_biosphere_target():
    from fastapi import HTTPException
    from mapper.api.lca import calculate_contribution_analysis
    from mapper.models.schemas import ContributionAnalysisRequest

    method = _pick_method()
    req = ContributionAnalysisRequest(
        target_type="activity",
        database="biosphere3",
        code="anything",
        amount=1.0,
        method=list(method),
    )
    with pytest.raises(HTTPException) as ei:
        _run(calculate_contribution_analysis(req))
    assert ei.value.status_code == 400
    assert "biosphere" in str(ei.value.detail).lower()


def test_contribution_analysis_invalid_target_type():
    from fastapi import HTTPException
    from mapper.api.lca import calculate_contribution_analysis
    from mapper.models.schemas import ContributionAnalysisRequest

    method = _pick_method()
    req = ContributionAnalysisRequest(target_type="wrong", method=list(method))
    with pytest.raises(HTTPException) as ei:
        _run(calculate_contribution_analysis(req))
    assert ei.value.status_code == 400


def test_contribution_export_returns_xlsx():
    """Exercise the export route handler directly."""
    from mapper.api.lca import (
        calculate_contribution_analysis,
        export_contribution_analysis,
    )
    from mapper.models.schemas import (
        ContributionAnalysisExportRequest,
        ContributionAnalysisRequest,
    )

    act = _pick_activity()
    method = _pick_method()
    req = ContributionAnalysisRequest(
        target_type="activity",
        database=act.key[0],
        code=act.key[1],
        amount=1.0,
        method=list(method),
        limit=3,
        cutoff=0.20,
        max_depth=1,
    )
    result = _run(calculate_contribution_analysis(req))

    response = _run(export_contribution_analysis(
        ContributionAnalysisExportRequest(result=result)
    ))
    # FastAPI Response object: media_type + body
    assert response.media_type.startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert len(response.body) > 1000
