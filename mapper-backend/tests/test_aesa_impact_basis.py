# SPDX-License-Identifier: MPL-2.0
"""AESA impact basis: "as computed" vs "per year" for single-product runs.

The SR divides an impact by a per-year SOS. Found on an EVS40 run: the AESA
tab compared a whole-life pLCA total with a per-year SOS. The guarded "per
year" option divides a whole-life impact by its lifetime, and refuses where
that would be wrong -- above all on a BOM that already divides by the lifetime
itself (the EV9 archetype does), where it would divide twice.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api import bom as bom_api
from mapper.api.aesa import post_compute
from mapper.core.aesa_impact_basis import annualise, lifetime_division_rows
from mapper.core.aesa_engine import single_product_to_impact_result
from mapper.models.aesa_schemas import AESAComputeRequest
from mapper.models.bom_schemas import Archetype, BOMNode
from mapper.models.schemas import StageAmountsMeta
from tests.test_aesa_single_product import CLIMATE, _single_product, _sp_config


def _node(name, expr=None, children=()):
    return BOMNode(name=name, node_type="material" if not children else "component",
                   quantity=1.0, quantity_expression=expr, children=list(children))


def _arc(mfg_expr: str | None) -> Archetype:
    return Archetype(id="arc-bev", name="BEV-LFP", bom=[
        _node("Manufacturing", children=[_node("Car body", mfg_expr)]),
        _node("Use Phase", children=[_node("Electricity", "ev_use_kwh")]),
    ])


# ── detection (pure) ──────────────────────────────────────────────────────────

def test_a_row_dividing_by_the_referenced_lifetime_parameter_is_found():
    rows = lifetime_division_rows(_arc("(m_kg - 670) / lifetime_yr").bom, 16, "lifetime_yr", {})
    assert rows == ["Manufacturing > Car body"]


def test_a_parameter_EQUAL_to_the_lifetime_counts_under_a_typed_lifetime():
    # The lifetime was typed (no parameter reference), but the BOM divides by a
    # parameter worth exactly that much: still the same double division.
    rows = lifetime_division_rows(_arc("m_kg / car_life").bom, 16, None, {"car_life": 16.0})
    assert rows == ["Manufacturing > Car body"]


def test_a_multiplication_or_a_numerator_use_is_not_a_division():
    assert lifetime_division_rows(_arc("lifetime_yr * 2").bom, 16, "lifetime_yr", {}) == []
    assert lifetime_division_rows(_arc("lifetime_yr / 4").bom, 16, "lifetime_yr", {}) == []
    assert lifetime_division_rows(_arc(None).bom, 16, "lifetime_yr", {}) == []


def test_annualise_divides_every_magnitude_and_nothing_else():
    imp = single_product_to_impact_result(_single_product(), reference_year=2025)
    out = annualise(imp, 16)
    for a, b in zip(imp.results, out.results):
        assert b.years[0].total_impact == pytest.approx(a.years[0].total_impact / 16)
        assert b.summary.total_impact == pytest.approx(a.summary.total_impact / 16)
        assert b.unit == a.unit and b.years[0].year == a.years[0].year
    assert imp.results[0].years[0].total_impact == 8.0e3, "the input must not be mutated"


# ── through the compute route ─────────────────────────────────────────────────

@pytest.fixture
def registered(request):
    expr = getattr(request, "param", None)
    bom_api._proj_archetypes()["arc-bev"] = _arc(expr)
    yield
    bom_api._proj_archetypes().pop("arc-bev", None)


def _compute(basis: str, meta: StageAmountsMeta | None):
    cfg = _sp_config().model_copy(update={"impact_basis": basis})
    body = AESAComputeRequest(config=cfg, single_product_result=_single_product(),
                              reference_year=2025, single_product_stage_meta=meta)
    return asyncio.run(post_compute(body))


def _climate(res):
    return next(r for r in res.results if r.pb_id == "climate_change")


LIFETIME_16 = StageAmountsMeta(preset="lifetime", lifetime=16, amounts={"Use Phase": 16})


def test_as_computed_is_unchanged_and_says_so(registered):
    res = _compute("as_computed", LIFETIME_16)
    assert _climate(res).impact == pytest.approx(8.0e3)
    assert res.impact_basis == "as_computed" and res.lifetime_years is None


def test_per_year_divides_the_impact_by_the_lifetime_and_the_SR_with_it(registered):
    before = _climate(_compute("as_computed", LIFETIME_16))
    after = _climate(_compute("per_year", LIFETIME_16))
    assert after.impact == pytest.approx(before.impact / 16)
    assert after.sr == pytest.approx(before.sr / 16)
    assert after.allocated_sos == pytest.approx(before.allocated_sos), "the SOS is not touched"


def test_per_year_echoes_its_basis_and_lifetime(registered):
    res = _compute("per_year", LIFETIME_16)
    assert res.impact_basis == "per_year" and res.lifetime_years == 16


@pytest.mark.parametrize("preset", ["1year", "custom"])
def test_per_year_is_refused_unless_the_run_was_on_the_lifetime_preset(registered, preset):
    with pytest.raises(HTTPException) as e:
        _compute("per_year", StageAmountsMeta(preset=preset, lifetime=15))
    assert e.value.status_code == 400 and preset in e.value.detail


def test_per_year_is_refused_without_stage_meta(registered):
    with pytest.raises(HTTPException) as e:
        _compute("per_year", None)
    assert e.value.status_code == 400 and "not recorded" in e.value.detail


@pytest.mark.parametrize("registered", ["(m_kg - 670) / lifetime_yr"], indirect=True)
def test_per_year_is_refused_on_a_BOM_that_already_divides_by_the_lifetime(registered):
    meta = LIFETIME_16.model_copy(update={"lifetime_param": "lifetime_yr"})
    with pytest.raises(HTTPException) as e:
        _compute("per_year", meta)
    assert e.value.status_code == 400
    assert "Manufacturing > Car body" in e.value.detail and "already divides" in e.value.detail


def test_per_year_is_refused_for_a_fleet_source(registered):
    from tests.test_aesa_single_product import _single_product as sp
    imp = single_product_to_impact_result(sp(), reference_year=2025)
    cfg = _sp_config().model_copy(update={"impact_basis": "per_year"})
    with pytest.raises(HTTPException) as e:
        asyncio.run(post_compute(AESAComputeRequest(config=cfg, impact_result=imp)))
    assert e.value.status_code == 400 and "single-product" in e.value.detail


def test_the_basis_is_stored_on_a_saved_configuration():
    from mapper.models.aesa_schemas import AESAConfiguration
    cfg = AESAConfiguration(**_sp_config().model_copy(update={"impact_basis": "per_year"}).model_dump())
    assert cfg.impact_basis == "per_year"
    legacy = {k: v for k, v in _sp_config().model_dump().items() if k != "impact_basis"}
    assert AESAConfiguration(**legacy).impact_basis == "as_computed", "old configs load as before"
