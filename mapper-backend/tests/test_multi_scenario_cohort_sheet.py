# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Prospective multi-LCI export now includes per-cohort results (shape (a):
one "By cohort" sheet with a leading LCI Scenario column, rows × scenario).

Locks: the sheet exists, header shape, UUID-free cohort labels, subsystem
cohorts present + attributed to the right System via the shared cohort writer.
"""
from __future__ import annotations

from types import SimpleNamespace

from mapper.api.impact import _build_multi_scenario_workbook
from mapper.models.bom_schemas import (
    Archetype,
    DSMLCAResult,
    DSMLCAYearResult,
    DSMLCASummary,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
    MultiScenarioProjectedImpactResult,
    ProspectiveScenarioRef,
    ScenarioProjectedResult,
)

SYS_ID = "sys-1"
SUB_ID = "sub-fuel"
PRIMARY_CK = f"{SYS_ID}::BEV-LFP|SUV"        # aggregation prefixes primary too
SUB_CK = f"{SUB_ID}::CNG Station|Default"


def _dsmlca(method: list[str], factor: float) -> DSMLCAResult:
    return DSMLCAResult(
        mfa_system_id=SYS_ID, scope="stock", method=method,
        method_label=" › ".join(method), unit="kg CO2-eq",
        years=[DSMLCAYearResult(
            year=2030, total_impact=100.0 * factor,
            impact_by_cohort={PRIMARY_CK: 80.0 * factor, SUB_CK: 20.0 * factor},
            impact_by_material={"battery": 60.0 * factor},
            count_by_cohort={PRIMARY_CK: 10.0, SUB_CK: 3.0},
            unit="kg CO2-eq",
        )],
        summary=DSMLCASummary(total_impact=100.0 * factor, peak_year=2030, peak_impact=100.0 * factor),
        stages_included=["Operation"],
    )


def _scenario(base_db, iam, ssp, factor) -> ScenarioProjectedResult:
    result = ImpactAssessmentResult(
        task_id="t1",
        meta=ImpactAssessmentMeta(mode="projected", mfa_system_id=SYS_ID, scope="stock"),
        results=[_dsmlca(["EF v3.1", "climate change", "GWP100"], factor)],
    )
    return ScenarioProjectedResult(
        scenario=ProspectiveScenarioRef(base_db=base_db, iam=iam, ssp=ssp),
        result=result,
    )


def _build():
    multi = MultiScenarioProjectedImpactResult(
        task_id="t1",
        meta=ImpactAssessmentMeta(mode="projected", mfa_system_id=SYS_ID, scope="stock"),
        scenarios=[
            _scenario("ecoinvent-3.10-cutoff", "remind", "SSP1-Base", 1.0),
            _scenario("ecoinvent-3.10-cutoff", "remind", "SSP2-Base", 1.1),
            _scenario("ecoinvent-3.10-cutoff", "remind", "SSP5-Base", 1.2),
        ],
    )
    sys_def = SimpleNamespace(
        name="Car Fleet",
        dimensions=[SimpleNamespace(name="fuel", is_age=False), SimpleNamespace(name="size", is_age=False)],
    )
    cohort_mapping = SimpleNamespace(mappings=[
        SimpleNamespace(cohort_key="BEV-LFP|SUV", archetype_id="arc-bev", scaling_factor=1.0),
    ])
    archetypes = {
        "arc-bev": Archetype(id="arc-bev", name="BEV-LFP SUV"),
        "arc-charge": Archetype(id="arc-charge", name="Charging Infrastructure"),
    }
    subsystems = [{"id": SUB_ID, "name": "Fueling Infrastructure",
                   "mappings": {"CNG Station|Default": ("arc-charge", 1.0)}}]
    sim_counts = {2030: {PRIMARY_CK: 10.0, SUB_CK: 3.0}}
    return _build_multi_scenario_workbook(
        system_name=sys_def.name, multi_result=multi, sys_def=sys_def,
        sim_counts=sim_counts, sim_result=None, archetypes=archetypes,
        cohort_mapping=cohort_mapping, subsystems=subsystems,
    )


def test_by_cohort_sheet_present_with_scenario_column():
    wb = _build()
    assert "By cohort" in wb.sheetnames
    ws = wb["By cohort"]
    header = [c.value for c in ws[1]]
    # Shape (a): leading Year, LCI Scenario, System columns.
    assert header[:3] == ["Year", "LCI Scenario", "System"]


def test_by_cohort_rows_multiplied_by_scenario_no_uuid_archetype_resolved():
    wb = _build()
    ws = wb["By cohort"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    # 3 scenarios × 1 year × 2 cohorts = 6 rows.
    assert len(rows) == 6
    scen_col = {r[1] for r in rows}
    assert scen_col == {"REMIND/SSP1-Base", "REMIND/SSP2-Base", "REMIND/SSP5-Base"}
    # No raw UUID / prefix anywhere.
    flat = "\n".join(str(c) for r in rows for c in r)
    assert "::" not in flat and SUB_ID not in flat and SYS_ID not in flat
    # Archetype resolved for both primary and subsystem cohorts.
    archetypes_seen = {r[header_index(ws, "Archetype")] for r in rows}
    assert "BEV-LFP SUV" in archetypes_seen
    assert "Charging Infrastructure" in archetypes_seen


def test_by_cohort_system_attribution():
    wb = _build()
    ws = wb["By cohort"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    sys_idx = 2  # System column
    # Primary cohort → "Car Fleet"; subsystem cohort → "Fueling Infrastructure".
    systems = {r[sys_idx] for r in rows}
    assert systems == {"Car Fleet", "Fueling Infrastructure"}


def test_by_subsystem_sheet_present_with_scenario_column():
    wb = _build()
    assert "By subsystem" in wb.sheetnames
    ws = wb["By subsystem"]
    header = [c.value for c in ws[1]]
    assert header[:3] == ["Year", "LCI Scenario", "Subsystem"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    # 3 scenarios × 1 subsystem cohort = 3 rows; no UUID.
    assert len(rows) == 3
    assert all("::" not in str(c) for r in rows for c in r)


def header_index(ws, name: str) -> int:
    return [c.value for c in ws[1]].index(name)
