# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 2c — Ryberg 2018 PB-LCIA boundary-set SCAFFOLD (structure-only).

Ryberg2018_PBLCIA ships as STRUCTURE ONLY: 9 PB-framework boundaries with
control_variable + unit, but pb_value (SOS) = null and ef_indicator = null (no
PB-LCIA characterisation method yet), and the set marked computable=False.
Compute must reject it with a clear human message — never crash on the null
SOS / ef_indicator. Sala2020_EF (real values) is unaffected.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api.aesa import get_defaults, post_compute
from mapper.core.aesa_engine import (
    AESAEngine,
    load_boundary_sets,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import (
    AESAComputeRequest,
    AESAConfiguration,
    PlanetaryBoundary,
)
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
)

RYBERG_ID = "Ryberg2018_PBLCIA"
RYBERG_PBS = {
    "climate_change", "biosphere_integrity", "stratospheric_ozone_depletion",
    "ocean_acidification", "biogeochemical_flows", "land_system_change",
    "freshwater_use", "atmospheric_aerosol_loading", "novel_entities",
}


# ── fixtures ─────────────────────────────────────────────────────────────────

def _impact() -> ImpactAssessmentResult:
    climate = DSMLCAResult(
        mfa_system_id="sys-1",
        method=["EF v3.1", "climate change", "global warming potential (GWP100)"],
        method_label="EF v3.1 › climate change › GWP100", scope="stock", unit="kg CO2 eq",
        years=[DSMLCAYearResult(year=2030, total_impact=6.0e9, unit="kg CO2 eq",
                                impact_by_cohort={"BEV": 6.0e9}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=6.0e9, peak_year=2030, peak_impact=6.0e9),
    )
    acid = DSMLCAResult(
        mfa_system_id="sys-1",
        method=["EF v3.1", "acidification", "accumulated exceedance (AE)"],
        method_label="EF v3.1 › acidification › AE", scope="stock", unit="mol H+ eq",
        years=[DSMLCAYearResult(year=2030, total_impact=1.0e8, unit="mol H+ eq",
                                impact_by_cohort={"BEV": 1.0e8}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=1.0e8, peak_year=2030, peak_impact=1.0e8),
    )
    return ImpactAssessmentResult(
        task_id="t-1",
        meta=ImpactAssessmentMeta(mode="static", mfa_system_id="sys-1", scope="stock"),
        results=[climate, acid],
    )


def _config(boundary_set_id: str) -> AESAConfiguration:
    return AESAConfiguration(
        id="cfg-1", name="cfg", mfa_system_id="sys-1", impact_mode="static",
        boundary_set_id=boundary_set_id, multi_d=None,
        created_at="2025-01-01T00:00:00Z",
    )


# ── Ryberg loads (nulls allowed) ─────────────────────────────────────────────

def test_ryberg_loads_with_nulls():
    sets = load_boundary_sets()
    assert RYBERG_ID in sets
    ry = sets[RYBERG_ID]
    assert ry.computable is False
    assert set(ry.boundaries) == RYBERG_PBS
    assert len(ry.boundaries) == 9
    for pb in ry.boundaries.values():
        assert pb.pb_value is None            # SOS not fabricated
        assert pb.ef_indicator is None        # no PB-LCIA method link yet
        assert pb.zone_of_uncertainty is None
        assert pb.status_2023 is None
        assert pb.control_variable             # structural labels ARE present
        assert pb.unit


def test_get_defaults_serves_ryberg():
    bundle = asyncio.run(get_defaults())
    sets = {s["id"]: s for s in bundle["boundary_sets"]}
    assert RYBERG_ID in sets
    ry = sets[RYBERG_ID]
    assert ry["computable"] is False
    assert len(ry["boundaries"]) == 9


# ── compute rejected gracefully ──────────────────────────────────────────────

def test_compute_against_ryberg_rejected_gracefully():
    """Selecting Ryberg fails with a clear 400 — NOT a 500/crash on null SOS."""
    req = AESAComputeRequest(config=_config(RYBERG_ID), impact_result=_impact())
    with pytest.raises(HTTPException) as ei:
        asyncio.run(post_compute(req))
    assert ei.value.status_code == 400
    msg = str(ei.value.detail)
    assert "not yet computable" in msg
    assert "PB-LCIA" in msg and "SOS" in msg


def test_compute_against_ryberg_with_sensitivity_also_rejected():
    """The guard precedes both the sensitivity and the plain compute branch."""
    req = AESAComputeRequest(config=_config(RYBERG_ID), impact_result=_impact(),
                             run_sensitivity=True)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(post_compute(req))
    assert ei.value.status_code == 400
    assert "not yet computable" in str(ei.value.detail)


# ── Sala unregressed ─────────────────────────────────────────────────────────

def test_sala_still_loads_and_computes_no_regression():
    sets = load_boundary_sets()
    sala = sets["Sala2020_EF"]
    assert sala.computable is True                # default, back-compat
    assert all(pb.pb_value is not None for pb in sala.boundaries.values())

    bset = sala
    methods = [["EF v3.1", "climate change", "global warming potential (GWP100)"],
               ["EF v3.1", "acidification", "accumulated exceedance (AE)"]]
    config = _config("Sala2020_EF").model_copy(update={
        "method_mapping": suggest_method_mapping(methods, bset),
    })
    result = AESAEngine.compute(_impact().results, config, bset)
    pbs = {r.pb_id for r in result.results}
    assert "climate_change" in pbs and "acidification" in pbs
    for r in result.results:
        assert r.allocated_sos > 0
        assert r.sr is not None and r.sr > 0


def test_sala_compute_via_route_succeeds():
    """The guard must NOT fire for a computable set — Sala computes through the
    route handler and returns SR rows."""
    bset = load_boundary_sets()["Sala2020_EF"]
    methods = [["EF v3.1", "climate change", "global warming potential (GWP100)"],
               ["EF v3.1", "acidification", "accumulated exceedance (AE)"]]
    config = _config("Sala2020_EF").model_copy(update={
        "method_mapping": suggest_method_mapping(methods, bset),
    })
    req = AESAComputeRequest(config=config, impact_result=_impact())
    result = asyncio.run(post_compute(req))   # must not raise
    assert len(result.results) >= 2


# ── null boundary round-trips ────────────────────────────────────────────────

def test_null_pb_value_boundary_roundtrips():
    pb = PlanetaryBoundary(
        id="novel_entities", name="Novel entities",
        control_variable="Release of synthetic chemicals", unit="not yet defined",
        ef_indicator=None, pb_value=None, zone_of_uncertainty=None,
        boundary_type="flow", status_2023=None, provisional=True,
    )
    reloaded = PlanetaryBoundary.model_validate_json(pb.model_dump_json())
    assert reloaded == pb
    assert reloaded.pb_value is None
    assert reloaded.ef_indicator is None
    assert reloaded.zone_of_uncertainty is None
    assert reloaded.status_2023 is None
