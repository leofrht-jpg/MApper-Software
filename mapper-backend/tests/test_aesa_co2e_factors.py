# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Phase 2 — per-budget CO2→CO2e conversion factors wired into build_carbon_budget.

Two affine fits (Bjorn 2023 for 1.5C / AR6 C3+C4 analog for 2C) map the from-2020
CO2 budget to a from-2020 CO2e budget; C re-baselines to from-2025; f = y25/x25.
These tests LOCK the arithmetic (recompute from stored coefficients + C — no magic
number), confirm the CO2e basis is now selectable for every budget (no 400), and
confirm the basis touches ONLY the climate SR (other PBs unchanged) with no drift
under the default CO2 basis.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api.aesa import post_compute
from mapper.core.aesa_engine import (
    AESAEngine,
    AR6_C3C4_2C,
    BJORN_2023_1P5C,
    CO2E_2020_2024_GT,
    build_carbon_budget,
    build_default_sharing_preset,
    co2e_conversion_for_budget,
    co2e_factor_for_budget,
    load_boundary_sets,
    load_carbon_budget_options,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import AESAComputeRequest, AESAConfiguration
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
)

METHODS = [["EF v3.1", "climate change", "global warming potential (GWP100)"],
           ["EF v3.1", "acidification", "accumulated exceedance (AE)"]]

# Expected factors recomputed independently here from the published inputs.
EXPECTED_F = {
    "IPCC_AR6_1p5C_50": (1.1614 * 500 + 157.27 - 257.4) / 300,
    "IPCC_AR6_1p5C_67": (1.1614 * 400 + 157.27 - 257.4) / 200,
    "IPCC_AR6_2C_50":   (1.2935 * 1350 + 218.41 - 257.4) / 1150,
    "IPCC_AR6_2C_67":   (1.2935 * 1150 + 218.41 - 257.4) / 950,
}


# ── factor arithmetic lock (pure) ────────────────────────────────────────────

def test_coefficients_match_sources():
    assert BJORN_2023_1P5C == (1.1614, 157.27)   # Bjorn et al. 2023
    assert AR6_C3C4_2C == (1.2935, 218.41)        # ar6_2c_analog_fit.json
    assert CO2E_2020_2024_GT == 257.4             # AR6 C3+C4 2020-2024 median


def test_factor_recomputes_from_inputs_per_budget():
    opts = {o["id"]: o for o in load_carbon_budget_options()}
    assert set(opts) == set(EXPECTED_F)            # all 4 budgets covered
    for bid, opt in opts.items():
        f = co2e_factor_for_budget(opt)
        assert f == pytest.approx(EXPECTED_F[bid], rel=1e-12)


def test_factor_values_in_sanity_band():
    f = {bid: co2e_factor_for_budget(o)
         for bid, o in {x["id"]: x for x in load_carbon_budget_options()}.items()}
    # Stricter (smaller from-2025 budget) → higher factor.
    assert f["IPCC_AR6_2C_50"] < f["IPCC_AR6_2C_67"] < f["IPCC_AR6_1p5C_50"] < f["IPCC_AR6_1p5C_67"]
    # All within a generous correctness band (1.5C_67 sits just above 1.80).
    for v in f.values():
        assert 1.45 <= v <= 1.85


def test_15C_uses_bjorn_2C_uses_ar6():
    opts = {o["id"]: o for o in load_carbon_budget_options()}
    # 1.5C/67 (x20=400) via Bjorn:
    assert co2e_factor_for_budget(opts["IPCC_AR6_1p5C_67"]) == pytest.approx(
        (1.1614 * 400 + 157.27 - 257.4) / 200, rel=1e-12)
    # 2C/67 (x20=1150) via AR6 analog:
    assert co2e_factor_for_budget(opts["IPCC_AR6_2C_67"]) == pytest.approx(
        (1.2935 * 1150 + 218.41 - 257.4) / 950, rel=1e-12)


# ── build_carbon_budget wiring ───────────────────────────────────────────────

def test_build_carbon_budget_populates_conversion_per_option():
    for bid, opt in {o["id"]: o for o in load_carbon_budget_options()}.items():
        cb = build_carbon_budget(budget_option_id=bid)
        assert cb.co2e_conversion is not None
        assert cb.co2e_conversion.kind == "ratio"
        assert cb.co2e_conversion.factor == pytest.approx(EXPECTED_F[bid], rel=1e-12)
        assert "README" in cb.co2e_conversion.source


def test_default_basis_is_co2_no_drift():
    cb = build_carbon_budget()                     # default 2C/50 × SSP1-2.6
    assert cb.budget_basis == "CO2"                # populated factor stays inert
    assert cb.co2e_ratio() is None                 # because basis != CO2e_GHG
    applied = cb.with_basis_applied()
    assert applied.initial_budget_gt == cb.initial_budget_gt   # identity under CO2


def test_with_basis_applied_scales_budget_and_pathway_by_f():
    cb = build_carbon_budget().model_copy(update={"budget_basis": "CO2e_GHG"})  # default 2C/50
    f = cb.co2e_ratio()
    assert f == pytest.approx(EXPECTED_F["IPCC_AR6_2C_50"], rel=1e-12)
    applied = cb.with_basis_applied()
    assert applied.initial_budget_gt == pytest.approx(cb.initial_budget_gt * f)
    for y, v in cb.projected_emissions.items():
        assert applied.projected_emissions[y] == pytest.approx(v * f)


# ── route + SR scope (compute) ───────────────────────────────────────────────

def _impact_results() -> list[DSMLCAResult]:
    climate = DSMLCAResult(
        mfa_system_id="sys-1", method=METHODS[0],
        method_label="EF v3.1 › climate change › GWP100", scope="stock", unit="kg CO2 eq",
        years=[DSMLCAYearResult(year=2030, total_impact=6.0e9, unit="kg CO2 eq",
                                impact_by_cohort={"BEV": 6.0e9}, impact_by_material={}, count_by_cohort={}),
               DSMLCAYearResult(year=2040, total_impact=5.0e9, unit="kg CO2 eq",
                                impact_by_cohort={"BEV": 5.0e9}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=1.1e10, peak_year=2030, peak_impact=6.0e9))
    acid = DSMLCAResult(
        mfa_system_id="sys-1", method=METHODS[1],
        method_label="EF v3.1 › acidification › AE", scope="stock", unit="mol H+ eq",
        years=[DSMLCAYearResult(year=2030, total_impact=1.0e8, unit="mol H+ eq",
                                impact_by_cohort={"BEV": 1.0e8}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=1.0e8, peak_year=2030, peak_impact=1.0e8))
    return [climate, acid]


def _config(basis: str = "CO2") -> tuple[AESAConfiguration, object]:
    bset = load_boundary_sets()["Sala2020_EF"]
    # Default budget is 2°C/50 × SSP1-2.6 (non-depleting through 2100), so the
    # ÷f relationship is testable at the fixture's 2030/2040 years.
    budget = build_carbon_budget().model_copy(update={"budget_basis": basis})
    cfg = AESAConfiguration(
        id="cfg-1", name="cfg", mfa_system_id="sys-1", impact_mode="static",
        boundary_set_id="Sala2020_EF", carbon_budget=budget,
        sharing=build_default_sharing_preset(), sharing_preset_id="ferhati_2026_multi_d",
        method_mapping=suggest_method_mapping(METHODS, bset), multi_d=None,
        created_at="2025-01-01T00:00:00Z")
    return cfg, bset


def test_co2e_basis_selectable_for_default_budget_no_400():
    cfg, _ = _config(basis="CO2e_GHG")
    env = ImpactAssessmentResult(task_id="t-1",
        meta=ImpactAssessmentMeta(mode="static", mfa_system_id="sys-1", scope="stock"),
        results=_impact_results())
    result = asyncio.run(post_compute(AESAComputeRequest(config=cfg, impact_result=env)))
    assert any(r.pb_id == "climate_change" for r in result.results)   # computed, not 400


def test_basis_scales_only_climate_sr():
    bset = load_boundary_sets()["Sala2020_EF"]
    base = AESAEngine.compute(_impact_results(), _config("CO2")[0], bset)
    e = AESAEngine.compute(_impact_results(), _config("CO2e_GHG")[0], bset)
    # f matches the default budget _config uses (2°C/50).
    f = build_carbon_budget().model_copy(update={"budget_basis": "CO2e_GHG"}).co2e_ratio()

    clim_base = {r.year: r for r in base.results if r.pb_id == "climate_change"}
    clim_e = {r.year: r for r in e.results if r.pb_id == "climate_change"}
    assert clim_base and clim_base.keys() == clim_e.keys()
    for y, rb in clim_base.items():
        assert clim_e[y].sr == pytest.approx(rb.sr / f, rel=1e-9)        # climate ÷ f

    # Every NON-climate boundary SR is byte-identical across the basis.
    non_base = sorted((r.pb_id, r.year, r.sr) for r in base.results if r.pb_id != "climate_change")
    non_e = sorted((r.pb_id, r.year, r.sr) for r in e.results if r.pb_id != "climate_change")
    assert non_base == non_e
