# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Export-filename subsystem gathering — the ONE shared gatherer, one bug.

Bug: the AESA export hardcoded ``[]`` as its subsystem list, so
``Car_Fleet+Fueling_Infrastructure_AESA.xlsx`` came out as ``Car_Fleet_AESA.xlsx``
even though the SR numerator (``yr.total_impact``) SUMS the primary + every
dependent subsystem — i.e. the subsystem DID contribute (Case A).

Fix: every export caller (LCA / pLCA / AESA) routes its cohort keys through the
single ``contributing_subsystem_names`` gatherer (bom.py). These tests lock:

* the shared gatherer (subsystem-prefixed keys → names; primary-only → []);
* the pLCA caller path (``_contrib_subsystem_names`` over a projected result,
  and the multi-LCI inline generator) yields the subsystem when its cohorts are
  present — proving the pLCA caller is NOT the AESA bug;
* the AESA export endpoint now names the contributing subsystem, and omits it
  when only primary cohorts are present.
"""
from __future__ import annotations

import asyncio
import types

from openpyxl import load_workbook

from mapper.api import aesa as aesa_api
from mapper.api import bom as bom_api
from mapper.api import subsystems as subs_api
from mapper.api.bom import contributing_subsystem_names
from mapper.api.impact import _contrib_subsystem_names
from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESAExportRequest,
    AESAYearSummary,
    MultiDConfig,
    SustainabilityRatioResult,
)
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
)

SYS_ID = "e5442abf-fa89-4804-b192-667f6ecd08bf"
SUB_ID = "670be0bf-eb95-4479-b5f1-dea938d0e46f"
SUB_NAME = "Fueling Infrastructure"
METHOD = ["EF v3.1", "climate change", "GWP100"]


def _patch_subs(monkeypatch):
    """`get_subsystems_for_system` → one dependent subsystem named SUB_NAME."""
    monkeypatch.setattr(
        subs_api, "get_subsystems_for_system",
        lambda system_id, project=None: {SUB_ID: types.SimpleNamespace(name=SUB_NAME)},
    )


# ── Shared gatherer ──────────────────────────────────────────────────────────


def test_gatherer_names_subsystem_from_prefixed_keys(monkeypatch):
    _patch_subs(monkeypatch)
    keys = [f"{SYS_ID}::BEV-LFP|SUV", f"{SUB_ID}::CNG Station|Default"]
    assert contributing_subsystem_names(keys, SYS_ID, "test") == [SUB_NAME]


def test_gatherer_empty_when_only_primary(monkeypatch):
    _patch_subs(monkeypatch)
    # Primary-only cohorts (prefixed with the system id, and a bare key) → [].
    keys = [f"{SYS_ID}::BEV-LFP|SUV", "BEV-LFP|Sedan"]
    assert contributing_subsystem_names(keys, SYS_ID, "test") == []


# ── pLCA caller path (Case A — caller already gathers, unlike AESA) ───────────


def _dsmlca(impact_by_cohort: dict[str, float]) -> DSMLCAResult:
    yr = DSMLCAYearResult(
        year=2030, total_impact=sum(impact_by_cohort.values()),
        impact_by_cohort=impact_by_cohort, impact_by_material={}, unit="kg CO2eq",
    )
    return DSMLCAResult(
        mfa_system_id=SYS_ID, method=METHOD, scope="all", unit="kg CO2eq",
        years=[yr],
        summary=DSMLCASummary(total_impact=yr.total_impact, peak_year=2030, peak_impact=yr.total_impact),
        stages_included=["Manufacturing"],
    )


def test_plca_single_caller_gathers_subsystem(monkeypatch):
    # `_contrib_subsystem_names` is what the single/paired/multi-DSM/multi-param
    # PROJECTED export branches call. A projected result with subsystem cohorts
    # yields the subsystem → filename would be `{sys}+{sub}_pLCA.xlsx`.
    _patch_subs(monkeypatch)
    results = [_dsmlca({f"{SYS_ID}::BEV-LFP|SUV": 100.0, f"{SUB_ID}::CNG Station|Default": 20.0})]
    names = _contrib_subsystem_names(results, SYS_ID, "test")
    assert names == [SUB_NAME]
    assert bom_api.build_export_filename("Car Fleet", names, "pLCA") == \
        "Car_Fleet+Fueling_Infrastructure_pLCA.xlsx"


def test_plca_multi_lci_inline_gathers_subsystem(monkeypatch):
    # The multi-LCI branch reads the SAME per-scenario cohort keys the
    # By-subsystem sheet reads — filename and sheet can't disagree.
    _patch_subs(monkeypatch)
    scenarios = [
        _dsmlca({f"{SYS_ID}::BEV-LFP|SUV": 100.0, f"{SUB_ID}::CNG Station|Default": 20.0}),
        _dsmlca({f"{SYS_ID}::BEV-LFP|SUV": 90.0, f"{SUB_ID}::CNG Station|Default": 18.0}),
    ]
    keys = (ck for r in scenarios for yr in r.years for ck in yr.impact_by_cohort)
    names = contributing_subsystem_names(keys, SYS_ID, "test")
    assert names == [SUB_NAME]


def test_plca_caller_omits_subsystem_when_absent(monkeypatch):
    # If the projected result carries NO subsystem cohort, the honest filename
    # omits it (this is the Case-B boundary — never fabricate a name).
    _patch_subs(monkeypatch)
    results = [_dsmlca({f"{SYS_ID}::BEV-LFP|SUV": 100.0})]
    assert _contrib_subsystem_names(results, SYS_ID, "test") == []


# ── AESA export endpoint (Case A fix) ────────────────────────────────────────


def _sr(pb_id: str, impact_by_cohort: dict[str, float]) -> SustainabilityRatioResult:
    return SustainabilityRatioResult(
        year=2030, pb_id=pb_id, pb_name=pb_id, ef_indicator=pb_id,
        method_label=f"EF v3.1 | {pb_id}",
        impact=sum(impact_by_cohort.values()), allocated_sos=1.0e10, sr=0.5,
        zone="safe", sharing_principle="EpC",
        layer_factors=[0.001], total_sharing_factor=0.001,
        boundary_type="flow", unit="kg CO2-eq",
        impact_by_cohort=impact_by_cohort,
    )


def _aesa_body(impact_by_cohort: dict[str, float]) -> AESAExportRequest:
    result = AESAComputeResult(
        config_id="cfg-1",
        results=[_sr("acidification", impact_by_cohort)],
        summary_by_year=[AESAYearSummary(year=2030, safe=1, zone_of_uncertainty=0, high_risk=0, total_assessed=1)],
    )
    config = AESAConfiguration(
        id="cfg-1", name="Test", mfa_system_id=SYS_ID, dsm_scenario_id="SSP2",
        multi_d=MultiDConfig(layer1={}, layer2_sector_share=0.12, layer2_source="grandfathering"),
        created_at="2025-01-01T00:00:00Z",
    )
    return AESAExportRequest(config=config, result=result)


def _run_aesa_export(body):
    return asyncio.run(aesa_api.post_export(body))


def _filename_of(resp) -> str:
    cd = resp.headers["Content-Disposition"]
    return cd.split('filename="', 1)[1].rstrip('"')


def test_aesa_export_names_contributing_subsystem(monkeypatch):
    _patch_subs(monkeypatch)
    monkeypatch.setattr(aesa_api, "_get_system", lambda sid: types.SimpleNamespace(name="Car Fleet"))
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "test")
    body = _aesa_body({f"{SYS_ID}::BEV-LFP|SUV": 6.0e9, f"{SUB_ID}::CNG Station|Default": 1.0e9})
    resp = _run_aesa_export(body)
    assert _filename_of(resp) == "Car_Fleet+Fueling_Infrastructure_AESA.xlsx"
    # Workbook is still a valid xlsx.
    load_workbook(__import__("io").BytesIO(resp.body))


def test_aesa_export_omits_subsystem_when_only_primary(monkeypatch):
    _patch_subs(monkeypatch)
    monkeypatch.setattr(aesa_api, "_get_system", lambda sid: types.SimpleNamespace(name="Car Fleet"))
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "test")
    body = _aesa_body({f"{SYS_ID}::BEV-LFP|SUV": 6.0e9})
    resp = _run_aesa_export(body)
    assert _filename_of(resp) == "Car_Fleet_AESA.xlsx"
