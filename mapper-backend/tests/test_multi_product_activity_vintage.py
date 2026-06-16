"""Per-item-vintage activity comparison (multi-product).

An activity can be added at multiple vintages — base ecoinvent (static) and
premise SSP×year databases — each as its own comparison item. Each item names
its own `database`; the existing activity compute path resolves the activity
in that DB (premise preserves codes) and computes against it. No prospective
re-resolution is reimplemented — the frontend picks the concrete premise DB
name from the pLCA registry.

These tests lock the LOAD-BEARING property: each (activity × vintage) item
computes against ITS OWN database, and the per-vintage result reflects that
DB's intrinsic intensity. We stub the runner so the score depends on the DB
(SSP1 > SSP5 for the DK grid, mirroring the audited premise/REMIND ordering
from the SSP diagnostic) — proving the per-item DB is threaded through, without
needing real premise DBs in CI.
"""
from __future__ import annotations

import asyncio

import pytest

from mapper.models.schemas import (
    ActivityProductItem,
    MultiProductLCARequest,
)

BASE_DB = "ecoinvent-3.10-cutoff"
SSP1_DB = "ecoinvent-3.10-cutoff_premise_remind_ssp1-pkbudg1150_2040"
SSP5_DB = "ecoinvent-3.10-cutoff_premise_remind_ssp5-pkbudg1150_2040"
CODE = "e" * 32  # "market for electricity, low voltage" (DK)

# Intrinsic per-kWh GWP by database — SSP1 > SSP5 for the DK grid, matching the
# audited ordering the SSP diagnostic confirmed (2040: 0.031 / 0.020 kg CO2/kWh).
DB_INTENSITY = {BASE_DB: 0.5, SSP1_DB: 0.031, SSP5_DB: 0.020}
METHOD = ["EF v3.1", "climate change", "global warming potential (GWP100)"]


class _DBSensitiveRunner:
    """Score depends on the demand key's DATABASE — proving each item computes
    against its own vintage's technosphere (not a single shared DB)."""
    UNIT_NAME = "kg CO2-eq"

    def __call__(self, demand, methods):
        out = {}
        for mt in methods:
            score = sum(
                amt * DB_INTENSITY.get(db, 0.0)
                for (db, _code), amt in demand.items()
            )
            out[tuple(mt)] = (score, self.UNIT_NAME)
        return out


class _FakeActivity(dict):
    pass


def _patch(monkeypatch):
    from mapper.api import lca as lca_mod

    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _DBSensitiveRunner)

    # `calculate_activity_lca` + `_activity_label` validate/label via
    # bw2data.get_activity((database, code)). Premise preserves codes, so the
    # same code resolves in every vintage; we model that here.
    def fake_get_activity(key):
        db, code = key
        if code != CODE or db not in DB_INTENSITY:
            raise KeyError(key)
        return _FakeActivity(**{
            "reference product": "electricity, low voltage",
            "name": "market for electricity, low voltage",
            "location": "DK", "unit": "kWh",
        })

    monkeypatch.setattr(lca_mod.bw2data, "get_activity", fake_get_activity, raising=False)
    return lca_mod


def _activity_item(db: str, vintage_label: str) -> ActivityProductItem:
    return ActivityProductItem(database=db, code=CODE, amount=1.0, vintage_label=vintage_label)


def test_activity_computes_against_its_own_vintage_db(monkeypatch):
    """Static + SSP1-2040 + SSP5-2040 → three items, each resolved against its
    OWN database, scores reflecting that DB's intrinsic intensity."""
    lca_mod = _patch(monkeypatch)
    body = MultiProductLCARequest(
        items=[
            _activity_item(BASE_DB, "ecoinvent"),
            _activity_item(SSP1_DB, "SSP1 2040"),
            _activity_item(SSP5_DB, "SSP5 2040"),
        ],
        methods=[METHOD],
    )
    res = asyncio.run(lca_mod.calculate_multi_product_lca(body))

    assert res.success_count == 3 and res.error_count == 0
    by_id = {it.item_id: it for it in res.items}
    static = by_id[f"{BASE_DB}|{CODE}"]
    ssp1 = by_id[f"{SSP1_DB}|{CODE}"]
    ssp5 = by_id[f"{SSP5_DB}|{CODE}"]

    # Each item computed against its own DB → score == that DB's intensity.
    assert static.activity_result.results[0].score == pytest.approx(0.5)
    assert ssp1.activity_result.results[0].score == pytest.approx(0.031)
    assert ssp5.activity_result.results[0].score == pytest.approx(0.020)

    # Correctness tie-in: SSP1 > SSP5 for the DK grid (audited premise ordering).
    assert ssp1.activity_result.results[0].score > ssp5.activity_result.results[0].score


def test_vintage_label_is_composed_into_item_label(monkeypatch):
    """Two vintages of one activity get distinct, vintage-aware labels +
    distinct item_ids → no chart-axis collision, stable per-vintage color key."""
    lca_mod = _patch(monkeypatch)
    body = MultiProductLCARequest(
        items=[_activity_item(SSP1_DB, "SSP1 2040"), _activity_item(SSP5_DB, "SSP5 2040")],
        methods=[METHOD],
    )
    res = asyncio.run(lca_mod.calculate_multi_product_lca(body))
    labels = [it.label for it in res.items]
    assert "electricity, low voltage [SSP1 2040]" in labels
    assert "electricity, low voltage [SSP5 2040]" in labels
    # item_ids are unique per vintage (DB name is part of the key).
    assert len({it.item_id for it in res.items}) == 2


def test_no_vintage_label_falls_back_to_plain_label(monkeypatch):
    """Backward compat: an activity item without a vintage_label keeps the
    bare reference-product label (existing single-vintage callers)."""
    lca_mod = _patch(monkeypatch)
    body = MultiProductLCARequest(
        items=[ActivityProductItem(database=BASE_DB, code=CODE, amount=1.0)],
        methods=[METHOD],
    )
    res = asyncio.run(lca_mod.calculate_multi_product_lca(body))
    assert res.items[0].label == "electricity, low voltage"


def test_missing_activity_in_vintage_is_isolated_error(monkeypatch):
    """If the activity doesn't resolve in a vintage, that item fails in
    isolation (status=error) without aborting the others."""
    lca_mod = _patch(monkeypatch)
    body = MultiProductLCARequest(
        items=[
            _activity_item(BASE_DB, "ecoinvent"),
            ActivityProductItem(database="nonexistent_db", code=CODE, amount=1.0, vintage_label="SSP9 9999"),
        ],
        methods=[METHOD],
    )
    res = asyncio.run(lca_mod.calculate_multi_product_lca(body))
    assert res.success_count == 1 and res.error_count == 1
    bad = [it for it in res.items if it.status == "error"][0]
    # The error slot still carries the vintage-aware label (so the UI can name
    # which vintage failed) and the error is isolated to that item.
    assert "SSP9 9999" in bad.label
    good = [it for it in res.items if it.status == "success"][0]
    assert good.activity_result.results[0].score == pytest.approx(0.5)
