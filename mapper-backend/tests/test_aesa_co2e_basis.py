"""Patch 2d — carbon-budget CO2 vs CO2e/GHG basis (denominator-only).

The climate-SR numerator is EF GWP100 (CO2e, all GHGs); the budget (denominator)
was CO2-only — a scope mismatch that inflates the climate SR. Patch 2d adds an
opt-in CO2e/GHG basis via mechanism (b): a single per-scenario ratio that scales
the budget AND the depletion pathway uniformly, so the whole climate SR timeline
scales by 1/factor. Default basis "CO2" is byte-identical (no drift); CO2e_GHG is
INERT until a sourced ratio is supplied (compute rejects otherwise).

The factor 1.3 used below is an OBVIOUS PLACEHOLDER, not a real CO2→CO2e
conversion — the real per-SSP factor is sourced separately and dropped in later.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api.aesa import _build_aesa_workbook, post_compute
from mapper.core.aesa_engine import (
    AESAEngine,
    build_carbon_budget,
    build_default_sharing_preset,
    load_boundary_sets,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import (
    AESAComputeRequest,
    AESAConfiguration,
    CarbonBudgetConfig,
    RatioCO2eConversion,
)
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
)

PLACEHOLDER_FACTOR = 1.3  # NOT a real CO2→CO2e ratio — fixture only.
METHODS = [["EF v3.1", "climate change", "global warming potential (GWP100)"],
           ["EF v3.1", "acidification", "accumulated exceedance (AE)"]]


# ── fixtures ─────────────────────────────────────────────────────────────────

def _impact_results() -> list[DSMLCAResult]:
    climate = DSMLCAResult(
        mfa_system_id="sys-1",
        method=METHODS[0],
        method_label="EF v3.1 › climate change › GWP100", scope="stock", unit="kg CO2 eq",
        years=[
            DSMLCAYearResult(year=2030, total_impact=6.0e9, unit="kg CO2 eq",
                             impact_by_cohort={"BEV": 6.0e9}, impact_by_material={}, count_by_cohort={}),
            DSMLCAYearResult(year=2040, total_impact=5.0e9, unit="kg CO2 eq",
                             impact_by_cohort={"BEV": 5.0e9}, impact_by_material={}, count_by_cohort={}),
        ],
        summary=DSMLCASummary(total_impact=1.1e10, peak_year=2030, peak_impact=6.0e9),
    )
    acid = DSMLCAResult(
        mfa_system_id="sys-1",
        method=METHODS[1],
        method_label="EF v3.1 › acidification › AE", scope="stock", unit="mol H+ eq",
        years=[DSMLCAYearResult(year=2030, total_impact=1.0e8, unit="mol H+ eq",
                                impact_by_cohort={"BEV": 1.0e8}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=1.0e8, peak_year=2030, peak_impact=1.0e8),
    )
    return [climate, acid]


def _impact_envelope() -> ImpactAssessmentResult:
    return ImpactAssessmentResult(
        task_id="t-1",
        meta=ImpactAssessmentMeta(mode="static", mfa_system_id="sys-1", scope="stock"),
        results=_impact_results(),
    )


def _config(*, basis: str = "CO2", conversion: RatioCO2eConversion | None = None) -> tuple[AESAConfiguration, object]:
    bset = load_boundary_sets()["Sala2020_EF"]
    # Default budget is 2°C/50 × SSP1-2.6 (non-depleting through 2100) → climate
    # SR is finite at the fixture's 2030/2040 years.
    budget = build_carbon_budget().model_copy(update={
        "budget_basis": basis,
        "co2e_conversion": conversion,
    })
    config = AESAConfiguration(
        id="cfg-1", name="cfg", mfa_system_id="sys-1", impact_mode="static",
        boundary_set_id="Sala2020_EF",
        carbon_budget=budget,
        sharing=build_default_sharing_preset(),
        sharing_preset_id="ferhati_2026_multi_d",
        method_mapping=suggest_method_mapping(METHODS, bset),
        multi_d=None,
        created_at="2025-01-01T00:00:00Z",
    )
    return config, bset


def _sig(result):
    return sorted(
        (r.pb_id, r.year, r.impact, r.allocated_sos, r.sr,
         r.remaining_budget_gt, r.global_allocation_gt)
        for r in result.results
    )


def _climate_rows(result):
    return sorted((r for r in result.results if r.pb_id == "climate_change"),
                  key=lambda r: r.year)


# ── NO-DRIFT (gate) ──────────────────────────────────────────────────────────

def test_co2_basis_no_drift_vs_old_shape():
    """Default "CO2" basis is byte-identical to a pre-2d config (no
    budget_basis / co2e_conversion fields at all)."""
    config_new, bset = _config(basis="CO2")
    new = AESAEngine.compute(_impact_results(), config_new, bset)

    # Old-shape carbon budget: strip the 2d fields → defaults CO2 / None.
    raw = config_new.model_dump()
    raw["carbon_budget"].pop("budget_basis", None)
    raw["carbon_budget"].pop("co2e_conversion", None)
    config_old = AESAConfiguration.model_validate(raw)
    assert config_old.carbon_budget.budget_basis == "CO2"      # back-compat default
    assert config_old.carbon_budget.co2e_conversion is None
    old = AESAEngine.compute(_impact_results(), config_old, bset)

    assert _sig(new) == _sig(old)


def test_with_basis_applied_is_identity_for_co2():
    """CO2 basis → with_basis_applied returns an unchanged budget (no scaling)."""
    cb = build_carbon_budget()  # basis defaults to CO2
    applied = cb.with_basis_applied()
    assert applied.initial_budget_gt == cb.initial_budget_gt
    assert applied.projected_emissions == cb.projected_emissions
    assert cb.co2e_ratio() is None


# ── CO2e ratio scaling ───────────────────────────────────────────────────────

def test_co2e_ratio_scales_climate_sr_by_inverse_factor():
    """CO2e_GHG + ratio(1.3): climate (cumulative) allocated_sos ×1.3, SR ÷1.3
    across the whole timeline; flow rows unchanged."""
    cfg_co2, bset = _config(basis="CO2")
    base = AESAEngine.compute(_impact_results(), cfg_co2, bset)

    cfg_e, _ = _config(basis="CO2e_GHG",
                       conversion=RatioCO2eConversion(factor=PLACEHOLDER_FACTOR,
                                                      source="TEST PLACEHOLDER — not a real ratio"))
    e = AESAEngine.compute(_impact_results(), cfg_e, bset)

    base_clim = _climate_rows(base)
    e_clim = _climate_rows(e)
    assert len(base_clim) == len(e_clim) >= 2
    for b, x in zip(base_clim, e_clim):
        assert b.year == x.year
        assert b.allocated_sos > 0
        assert x.allocated_sos == pytest.approx(b.allocated_sos * PLACEHOLDER_FACTOR, rel=1e-12)
        assert x.sr == pytest.approx(b.sr / PLACEHOLDER_FACTOR, rel=1e-12)
        # surfaced chain intermediates scale too (now CO2e Gt)
        assert x.remaining_budget_gt == pytest.approx(b.remaining_budget_gt * PLACEHOLDER_FACTOR, rel=1e-12)
        assert x.global_allocation_gt == pytest.approx(b.global_allocation_gt * PLACEHOLDER_FACTOR, rel=1e-12)
        # cumulative-vs-annual chain identity holds under scaling
        assert x.global_allocation_gt * 1e12 * x.total_sharing_factor == pytest.approx(x.allocated_sos, rel=1e-9)

    # flow boundary (acidification) is unaffected by the carbon-budget basis
    base_acid = next(r for r in base.results if r.pb_id == "acidification")
    e_acid = next(r for r in e.results if r.pb_id == "acidification")
    assert e_acid.allocated_sos == base_acid.allocated_sos
    assert e_acid.sr == base_acid.sr


def test_co2e_ratio_helper_values():
    cb_co2 = build_carbon_budget()
    assert cb_co2.co2e_ratio() is None                                  # CO2 basis
    cb_e = cb_co2.model_copy(update={"budget_basis": "CO2e_GHG",
                                     "co2e_conversion": RatioCO2eConversion(factor=1.3, source="x")})
    assert cb_e.co2e_ratio() == 1.3
    cb_none = cb_co2.model_copy(update={"budget_basis": "CO2e_GHG", "co2e_conversion": None})
    assert cb_none.co2e_ratio() is None                                 # inert
    cb_bad = cb_co2.model_copy(update={"budget_basis": "CO2e_GHG",
                                       "co2e_conversion": RatioCO2eConversion(factor=0.0, source="x")})
    assert cb_bad.co2e_ratio() is None                                  # non-positive → inert


# ── graceful inert guard ─────────────────────────────────────────────────────

def test_co2e_without_conversion_rejected_gracefully():
    cfg, _ = _config(basis="CO2e_GHG", conversion=None)
    req = AESAComputeRequest(config=cfg, impact_result=_impact_envelope())
    with pytest.raises(HTTPException) as ei:
        asyncio.run(post_compute(req))
    assert ei.value.status_code == 400
    msg = str(ei.value.detail)
    assert "CO2e/GHG basis" in msg and "no sourced" in msg


def test_co2e_with_ratio_computes_via_route():
    cfg, _ = _config(basis="CO2e_GHG",
                     conversion=RatioCO2eConversion(factor=PLACEHOLDER_FACTOR, source="TEST PLACEHOLDER"))
    req = AESAComputeRequest(config=cfg, impact_result=_impact_envelope())
    result = asyncio.run(post_compute(req))  # must not raise
    assert any(r.pb_id == "climate_change" for r in result.results)


# ── export relabel + chain identity ──────────────────────────────────────────

def test_export_labels_co2_default():
    cfg, _ = _config(basis="CO2")
    result = AESAEngine.compute(_impact_results(), cfg, load_boundary_sets()["Sala2020_EF"])
    wb = _build_aesa_workbook(cfg, result, "Test System")
    header = [c.value for c in wb["Impacts vs SOS"][1]]
    assert "Remaining Budget (Gt)" in header
    assert "Global Allocation (Gt/yr)" in header
    assert "Remaining Budget (Gt CO2e)" not in header


def test_export_labels_co2e_relabelled_and_chain_identity():
    cfg, bset = _config(basis="CO2e_GHG",
                        conversion=RatioCO2eConversion(factor=PLACEHOLDER_FACTOR, source="TEST PLACEHOLDER"))
    result = AESAEngine.compute(_impact_results(), cfg, bset)
    wb = _build_aesa_workbook(cfg, result, "Test System")
    ws = wb["Impacts vs SOS"]
    header = [c.value for c in ws[1]]
    assert "Remaining Budget (Gt CO2e)" in header
    assert "Global Allocation (Gt CO2e/yr)" in header
    assert "Remaining Budget (Gt)" not in header

    # chain identity on the climate row, read straight from the exported cells
    rows = [dict(zip(header, r)) for r in ws.iter_rows(min_row=2, values_only=True)]
    clim = next(r for r in rows if r["PB ID"] == "climate_change")
    assert (clim["Global Allocation (Gt CO2e/yr)"] * 1e12 * clim["System Share"]
            == pytest.approx(clim["Allocated SOS"], rel=1e-9))


# ── round-trip ───────────────────────────────────────────────────────────────

def test_config_roundtrip_with_basis_and_ratio():
    cfg, _ = _config(basis="CO2e_GHG",
                     conversion=RatioCO2eConversion(factor=1.3, source="TEST PLACEHOLDER"))
    reloaded = AESAConfiguration.model_validate_json(cfg.model_dump_json())
    assert reloaded.carbon_budget.budget_basis == "CO2e_GHG"
    assert reloaded.carbon_budget.co2e_conversion is not None
    assert reloaded.carbon_budget.co2e_conversion.kind == "ratio"
    assert reloaded.carbon_budget.co2e_conversion.factor == 1.3
    assert reloaded == cfg
