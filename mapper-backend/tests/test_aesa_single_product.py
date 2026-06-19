"""AESA on a single (non-fleet) LCA result — static single-product source.

Part A: an ArchetypeLCACalculateResult (scalar score per method) is adapted into
the per-year ImpactAssessmentResult the engine consumes, and assessed against the
planetary boundaries with NO DSM system (mfa_system_id optional). The fleet path
(both impact + config carry a system id) is unchanged. The CO2e budget basis
rides through unchanged. Part B: the fresh-config default budget is 1.5°C/50.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api.aesa import post_compute
from mapper.core.aesa_engine import (
    AESAEngine,
    build_carbon_budget,
    build_default_sharing_preset,
    load_boundary_sets,
    single_product_to_impact_result,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import AESAComputeRequest, AESAConfiguration
from mapper.models.bom_schemas import (
    DSMLCAResult, DSMLCASummary, DSMLCAYearResult,
    ImpactAssessmentMeta, ImpactAssessmentResult,
)
from mapper.models.schemas import ArchetypeLCACalculateResult, ArchetypeLCAMethodResult

CLIMATE = ["EF v3.1", "climate change", "global warming potential (GWP100)"]
ACID = ["EF v3.1", "acidification", "accumulated exceedance (AE)"]
METHODS = [CLIMATE, ACID]


def _single_product(scope: str = "all") -> ArchetypeLCACalculateResult:
    return ArchetypeLCACalculateResult(
        archetype_id="arc-bev", archetype_name="BEV-LFP", scope=scope, amount=1.0,
        stage_amounts={}, stages_included=["Manufacturing"], elapsed_seconds=0.2,
        results=[
            ArchetypeLCAMethodResult(method=CLIMATE, method_label="EF v3.1 › climate change › GWP100",
                                     score=8.0e3, unit="kg CO2 eq", contributions=[]),
            ArchetypeLCAMethodResult(method=ACID, method_label="EF v3.1 › acidification › AE",
                                     score=5.0e1, unit="mol H+ eq", contributions=[]),
        ],
    )


def _sp_config(*, basis: str = "CO2", system_id: str | None = None) -> AESAConfiguration:
    bset = load_boundary_sets()["Sala2020_EF"]
    budget = build_carbon_budget().model_copy(update={"budget_basis": basis})
    return AESAConfiguration(
        id="cfg-sp", name="single-product", mfa_system_id=system_id, impact_mode="static",
        boundary_set_id="Sala2020_EF", carbon_budget=budget,
        sharing=build_default_sharing_preset(), sharing_preset_id="ferhati_2026_multi_d",
        method_mapping=suggest_method_mapping(METHODS, bset), multi_d=None,
        created_at="2025-01-01T00:00:00Z",
    )


# ── adapter (pure) ────────────────────────────────────────────────────────────

def test_adapter_shapes_static_lca_into_impact_result():
    imp = single_product_to_impact_result(_single_product(), reference_year=2025)
    assert imp.result_type == "system_level"
    assert imp.meta.mfa_system_id is None              # non-fleet
    assert {"|".join(r.method) for r in imp.results} == {"|".join(CLIMATE), "|".join(ACID)}
    for r in imp.results:
        assert len(r.years) == 1
        assert r.years[0].year == 2025
        assert r.years[0].impact_by_cohort == {}       # no fleet cohorts
        assert r.years[0].count_by_cohort == {}
    clim = next(r for r in imp.results if r.method == CLIMATE)
    assert clim.years[0].total_impact == 8.0e3


def test_adapter_reference_year_is_parameterized():
    imp = single_product_to_impact_result(_single_product(), reference_year=2040)
    assert all(r.years[0].year == 2040 for r in imp.results)


# ── compute via the route (non-fleet) ────────────────────────────────────────

def test_single_product_computes_sr_for_all_mapped_boundaries():
    cfg = _sp_config()                                  # mfa_system_id=None
    req = AESAComputeRequest(config=cfg, single_product_result=_single_product(), reference_year=2025)
    result = asyncio.run(post_compute(req))             # must not 400 on the missing system
    pbs = {r.pb_id for r in result.results}
    assert "climate_change" in pbs and "acidification" in pbs
    assert all(r.year == 2025 for r in result.results)


def test_single_product_precedence_over_task_inline():
    # single_product_result wins even if an inline impact is also (mistakenly) set.
    cfg = _sp_config()
    bogus = ImpactAssessmentResult(task_id="x", meta=ImpactAssessmentMeta(mode="static", scope="all"), results=[])
    req = AESAComputeRequest(config=cfg, single_product_result=_single_product(), impact_result=bogus)
    result = asyncio.run(post_compute(req))
    assert any(r.pb_id == "climate_change" for r in result.results)


# ── CO2e basis rides through the single-product path ─────────────────────────

def test_co2e_basis_scales_single_product_climate_sr():
    base = asyncio.run(post_compute(AESAComputeRequest(
        config=_sp_config(basis="CO2"), single_product_result=_single_product())))
    e = asyncio.run(post_compute(AESAComputeRequest(
        config=_sp_config(basis="CO2e_GHG"), single_product_result=_single_product())))
    f = build_carbon_budget().co2e_conversion.factor       # 1.6019 (1.5C/50 default)
    cb = next(r for r in base.results if r.pb_id == "climate_change")
    ce = next(r for r in e.results if r.pb_id == "climate_change")
    assert ce.sr == pytest.approx(cb.sr / f, rel=1e-9)
    # Non-climate boundary unaffected by the basis.
    ab = next(r for r in base.results if r.pb_id == "acidification")
    ae = next(r for r in e.results if r.pb_id == "acidification")
    assert ae.sr == ab.sr


# ── fleet path unchanged ─────────────────────────────────────────────────────

def _fleet_impact(system_id: str) -> ImpactAssessmentResult:
    yr = DSMLCAYearResult(year=2030, total_impact=6.0e9, unit="kg CO2 eq",
                          impact_by_cohort={"BEV": 6.0e9}, impact_by_material={}, count_by_cohort={})
    res = DSMLCAResult(mfa_system_id=system_id, method=CLIMATE, method_label="GWP100", scope="stock",
                       unit="kg CO2 eq", years=[yr],
                       summary=DSMLCASummary(total_impact=6.0e9, peak_year=2030, peak_impact=6.0e9))
    return ImpactAssessmentResult(task_id="t",
        meta=ImpactAssessmentMeta(mode="static", mfa_system_id=system_id, scope="stock"), results=[res])


def test_fleet_match_check_still_rejects_mismatch():
    cfg = _sp_config(system_id="sys-A")
    req = AESAComputeRequest(config=cfg, impact_result=_fleet_impact("sys-B"))
    with pytest.raises(HTTPException) as ei:
        asyncio.run(post_compute(req))
    assert ei.value.status_code == 400
    assert "different DSM system" in str(ei.value.detail)


def test_fleet_matching_system_computes():
    cfg = _sp_config(system_id="sys-A")
    result = asyncio.run(post_compute(AESAComputeRequest(config=cfg, impact_result=_fleet_impact("sys-A"))))
    assert any(r.pb_id == "climate_change" for r in result.results)


# ── Part B — default budget temperature ──────────────────────────────────────

def test_default_budget_is_1p5c_50():
    cb = build_carbon_budget()
    assert cb.initial_budget_gt == 300.0                     # 1.5°C / 50th from 2025
    assert cb.co2e_conversion is not None
    assert cb.co2e_conversion.factor == pytest.approx(1.6019, abs=1e-4)
