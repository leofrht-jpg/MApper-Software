"""Patch 4AG.1 — backend tests for multi-product LCA comparison.

Coverage:
  - Schema discriminator: archetype vs activity items parse correctly
  - Schema validation: at least one item / one method required
  - Fan-out: N items in → N results out, each in source order
  - Per-item error isolation: one failure doesn't abort the fan-out
  - Dispatch routing: archetype items → calculate_archetype_lca;
    activity items → calculate_activity_lca
  - Mixed-type request: archetypes + activities in one fan-out
  - Aggregate counters: success_count + error_count == len(items)
  - Empty methods, empty items: 400 responses

These tests stub the underlying compute helpers via monkeypatch
because a real LCA run requires a fully-set-up brightway2 project +
ecoinvent. The dispatch + envelope assembly logic is the unit-test
target; integration testing against real bw2 belongs in a separate
manual / end-to-end harness.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.models.schemas import (
    ActivityContribution,
    ActivityLCAMethodResult,
    ActivityLCAResult,
    ActivityProductItem,
    ArchetypeLCACalculateResult,
    ArchetypeLCAMethodResult,
    ArchetypeProductItem,
    MultiProductLCARequest,
)


def _fake_archetype_result(arc_id: str, name: str, score: float) -> ArchetypeLCACalculateResult:
    return ArchetypeLCACalculateResult(
        archetype_id=arc_id, archetype_name=name,
        scope="all", amount=1.0, stage_amounts={},
        stages_included=["Manufacturing", "Use Phase"],
        results=[ArchetypeLCAMethodResult(
            method=["EF v3.1", "climate change", "GWP100"],
            method_label="EF v3.1 › climate change › GWP100",
            score=score, unit="kg CO2 eq", contributions=[],
        )],
        stage_breakdown={"EF v3.1 › climate change › GWP100": {"Manufacturing": score * 0.7, "Use Phase": score * 0.3}},
        elapsed_seconds=0.1,
    )


def _fake_activity_result(score: float) -> ActivityLCAResult:
    return ActivityLCAResult(
        results=[ActivityLCAMethodResult(
            method=["EF v3.1", "climate change", "GWP100"],
            method_label="EF v3.1 › climate change › GWP100",
            score=score, unit="kg CO2 eq",
            contributions=[ActivityContribution(
                name="some product", location="GLO", database="ecoinvent",
                code="abc123", demand_amount=1.0, demand_unit="kg",
                impact=score, percentage=100.0,
            )],
        )],
        elapsed_seconds=0.05,
    )


def test_schema_discriminator_archetype() -> None:
    """`type: "archetype"` parses as ArchetypeProductItem; required
    field `archetype_id` validates."""
    req = MultiProductLCARequest.model_validate({
        "items": [{"type": "archetype", "archetype_id": "arc-1"}],
        "methods": [["EF v3.1", "climate change", "GWP100"]],
    })
    assert len(req.items) == 1
    assert isinstance(req.items[0], ArchetypeProductItem)
    assert req.items[0].archetype_id == "arc-1"


def test_schema_discriminator_activity() -> None:
    """`type: "activity"` parses as ActivityProductItem; required
    fields `database` + `code` validate; default amount=1.0."""
    req = MultiProductLCARequest.model_validate({
        "items": [{"type": "activity", "database": "ei", "code": "x1"}],
        "methods": [["m"]],
    })
    assert isinstance(req.items[0], ActivityProductItem)
    assert req.items[0].database == "ei"
    assert req.items[0].code == "x1"
    assert req.items[0].amount == 1.0


def test_schema_mixed_types_in_one_request() -> None:
    """Mixed archetype + activity items round-trip correctly. The
    discriminator picks each model independently per element."""
    req = MultiProductLCARequest.model_validate({
        "items": [
            {"type": "archetype", "archetype_id": "arc-1"},
            {"type": "activity", "database": "ei", "code": "x1"},
            {"type": "archetype", "archetype_id": "arc-2"},
        ],
        "methods": [["m"]],
    })
    types = [item.type for item in req.items]
    assert types == ["archetype", "activity", "archetype"]


def test_fanout_all_archetypes_in_source_order(monkeypatch: pytest.MonkeyPatch) -> None:
    """N archetype items → N results, each at the same index as its
    request slot. Source-order preservation is the contract the
    frontend chart rendering relies on."""
    from mapper.api import lca

    async def fake_calc_archetype(body):
        # Return a result keyed off the archetype_id so we can verify
        # each request mapped to its own response slot correctly.
        return _fake_archetype_result(body.archetype_id, f"name-{body.archetype_id}", 100.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)

    req = MultiProductLCARequest(
        items=[
            ArchetypeProductItem(archetype_id="arc-A"),
            ArchetypeProductItem(archetype_id="arc-B"),
            ArchetypeProductItem(archetype_id="arc-C"),
        ],
        methods=[["EF v3.1", "climate change", "GWP100"]],
    )
    res = asyncio.run(lca.calculate_multi_product_lca(req))

    assert len(res.items) == 3
    assert [r.item_id for r in res.items] == ["arc-A", "arc-B", "arc-C"]
    assert all(r.status == "success" for r in res.items)
    assert res.success_count == 3
    assert res.error_count == 0
    # Each archetype's payload is present and labelled.
    for r in res.items:
        assert r.archetype_result is not None
        assert r.activity_result is None
        assert r.label == f"name-{r.item_id}"


def test_fanout_all_activities(monkeypatch: pytest.MonkeyPatch) -> None:
    """Activity items dispatch to `calculate_activity_lca` with a
    one-element activities list per call. The per-item label falls
    back to the bare code when bw2data lookup fails (which is the
    expected case in tests without a live bw2 project)."""
    from mapper.api import lca

    async def fake_calc_activity(body):
        # The multi-product endpoint wraps each activity item in a
        # one-element list, so body.activities has exactly one entry.
        assert len(body.activities) == 1
        return _fake_activity_result(50.0)

    monkeypatch.setattr(lca, "calculate_activity_lca", fake_calc_activity)

    req = MultiProductLCARequest(
        items=[
            ActivityProductItem(database="ei", code="a1"),
            ActivityProductItem(database="ei", code="a2"),
        ],
        methods=[["m"]],
    )
    res = asyncio.run(lca.calculate_multi_product_lca(req))

    assert len(res.items) == 2
    assert res.items[0].item_id == "ei|a1"
    assert res.items[1].item_id == "ei|a2"
    assert all(r.status == "success" for r in res.items)
    for r in res.items:
        assert r.activity_result is not None
        assert r.archetype_result is None


def test_fanout_mixed_archetype_and_activity(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mixed-type request dispatches each item to the right compute
    path; per-type discriminator on the response items distinguishes
    archetype results from activity results."""
    from mapper.api import lca

    archetype_calls: list[str] = []
    activity_calls: list[str] = []

    async def fake_calc_archetype(body):
        archetype_calls.append(body.archetype_id)
        return _fake_archetype_result(body.archetype_id, f"arc-{body.archetype_id}", 100.0)

    async def fake_calc_activity(body):
        activity_calls.append(body.activities[0].code)
        return _fake_activity_result(50.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)
    monkeypatch.setattr(lca, "calculate_activity_lca", fake_calc_activity)

    req = MultiProductLCARequest(
        items=[
            ArchetypeProductItem(archetype_id="A1"),
            ActivityProductItem(database="ei", code="x1"),
            ArchetypeProductItem(archetype_id="A2"),
            ActivityProductItem(database="ei", code="x2"),
        ],
        methods=[["m"]],
    )
    res = asyncio.run(lca.calculate_multi_product_lca(req))

    # Each compute path called exactly with its items, in source order.
    assert archetype_calls == ["A1", "A2"]
    assert activity_calls == ["x1", "x2"]
    # Result ordering matches request ordering (no per-type batching).
    assert [r.type for r in res.items] == ["archetype", "activity", "archetype", "activity"]
    assert res.success_count == 4
    assert res.error_count == 0


def test_per_item_error_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    """If one item's compute raises HTTPException, the remaining
    items still compute; the failing item's slot carries status=error
    with the detail string. Aggregate counters reflect the split."""
    from mapper.api import lca

    async def fake_calc_archetype(body):
        if body.archetype_id == "bad":
            raise HTTPException(status_code=404, detail="archetype not found")
        return _fake_archetype_result(body.archetype_id, body.archetype_id, 100.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)

    req = MultiProductLCARequest(
        items=[
            ArchetypeProductItem(archetype_id="ok-1"),
            ArchetypeProductItem(archetype_id="bad"),
            ArchetypeProductItem(archetype_id="ok-2"),
        ],
        methods=[["m"]],
    )
    res = asyncio.run(lca.calculate_multi_product_lca(req))

    assert len(res.items) == 3
    assert res.items[0].status == "success"
    assert res.items[1].status == "error"
    assert res.items[1].error_message == "archetype not found"
    assert res.items[1].archetype_result is None
    assert res.items[2].status == "success"
    assert res.success_count == 2
    assert res.error_count == 1


def test_per_item_error_isolation_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """Any uncaught (non-HTTPException) exception is still isolated
    to the item — the fan-out doesn't 500 the whole request. The
    error_message records the exception type + message."""
    from mapper.api import lca

    async def fake_calc_archetype(body):
        if body.archetype_id == "boom":
            raise RuntimeError("unexpected database disconnect")
        return _fake_archetype_result(body.archetype_id, body.archetype_id, 100.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)

    req = MultiProductLCARequest(
        items=[
            ArchetypeProductItem(archetype_id="boom"),
            ArchetypeProductItem(archetype_id="ok"),
        ],
        methods=[["m"]],
    )
    res = asyncio.run(lca.calculate_multi_product_lca(req))

    assert res.items[0].status == "error"
    assert "RuntimeError" in (res.items[0].error_message or "")
    assert "unexpected database disconnect" in (res.items[0].error_message or "")
    assert res.items[1].status == "success"


def test_empty_items_returns_400() -> None:
    """Empty items list → 400 (matches the existing single-product
    endpoints' validation rule)."""
    from mapper.api import lca

    req = MultiProductLCARequest(items=[], methods=[["m"]])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(lca.calculate_multi_product_lca(req))
    assert exc.value.status_code == 400


def test_empty_methods_returns_400() -> None:
    """Empty methods list → 400 (consistent with single-product
    rule)."""
    from mapper.api import lca

    req = MultiProductLCARequest(
        items=[ArchetypeProductItem(archetype_id="x")],
        methods=[],
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(lca.calculate_multi_product_lca(req))
    assert exc.value.status_code == 400


def test_scope_threaded_to_archetype_items(monkeypatch: pytest.MonkeyPatch) -> None:
    """Request-level `scope` propagates to each archetype item's
    compute call. Activity items ignore the field (no lifecycle
    stages)."""
    from mapper.api import lca

    seen_scopes: list[str] = []

    async def fake_calc_archetype(body):
        seen_scopes.append(body.scope)
        return _fake_archetype_result(body.archetype_id, body.archetype_id, 1.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)

    req = MultiProductLCARequest(
        items=[
            ArchetypeProductItem(archetype_id="a"),
            ArchetypeProductItem(archetype_id="b"),
        ],
        methods=[["m"]],
        scope="inflows",
    )
    asyncio.run(lca.calculate_multi_product_lca(req))
    assert seen_scopes == ["inflows", "inflows"]


def test_compute_database_threaded_to_archetype_items(monkeypatch: pytest.MonkeyPatch) -> None:
    """Request-level `compute_database` propagates to archetype
    items. Acceptance for Prospective LCI fan-out on multi-product
    comparisons (consistent with single-product Patch 4D)."""
    from mapper.api import lca

    seen_dbs: list[str | None] = []

    async def fake_calc_archetype(body):
        seen_dbs.append(body.compute_database)
        return _fake_archetype_result(body.archetype_id, body.archetype_id, 1.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)

    req = MultiProductLCARequest(
        items=[ArchetypeProductItem(archetype_id="a")],
        methods=[["m"]],
        compute_database="ecoinvent-3.10_remind_SSP2_2030",
    )
    asyncio.run(lca.calculate_multi_product_lca(req))
    assert seen_dbs == ["ecoinvent-3.10_remind_SSP2_2030"]


def test_per_item_overrides_threaded_correctly(monkeypatch: pytest.MonkeyPatch) -> None:
    """Per-item `stage_amounts` and `parameter_scenario` overrides
    on ArchetypeProductItem reach the dispatched compute body
    (and don't bleed between items)."""
    from mapper.api import lca

    seen: list[tuple[str | None, dict[str, float] | None]] = []

    async def fake_calc_archetype(body):
        seen.append((body.parameter_scenario, body.stage_amounts))
        return _fake_archetype_result(body.archetype_id, body.archetype_id, 1.0)

    monkeypatch.setattr(lca, "calculate_archetype_lca", fake_calc_archetype)

    req = MultiProductLCARequest(
        items=[
            ArchetypeProductItem(archetype_id="a", parameter_scenario="Optimistic"),
            ArchetypeProductItem(archetype_id="b", stage_amounts={"Manufacturing": 1, "Use Phase": 15}),
            ArchetypeProductItem(archetype_id="c"),
        ],
        methods=[["m"]],
    )
    asyncio.run(lca.calculate_multi_product_lca(req))
    assert seen[0] == ("Optimistic", None)
    assert seen[1] == (None, {"Manufacturing": 1.0, "Use Phase": 15.0})
    assert seen[2] == (None, None)
