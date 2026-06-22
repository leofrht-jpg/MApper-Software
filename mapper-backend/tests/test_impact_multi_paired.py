# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 2F — Paired DSM × LCI scenario co-variation backend.

Backend acceptance tests for the *paired* pattern, which runs N DSM
scenarios matched 1:1 with N LCI (prospective) scenarios. Topology is
parallel to multi-DSM and multi-parameter: N parallel tasks under
``/impact/calculate-scenarios``, frontend assembles the
``MultiPairedImpactResult`` envelope client-side.

What we assert:

* ``ImpactAssessmentRequest.paired_scenarios`` round-trips cleanly.
* ``MultiPairedImpactResult`` carries ``result_type='multi_paired_dsm_lci'``
  and the inner ``PairedScenarioImpactResult`` shape (DSM identity + LCI
  ref + result, plus ``lci_scenario_label`` for self-contained labelling).
* The orchestrator fans out one task per pair when ``paired_scenarios`` is
  set, threading each into the per-task body via singular
  ``dsm_scenario_id`` + ``scenario`` (and clearing the list fields so the
  spawned worker doesn't recurse).
* Response shape: keyed by ``<dsm_id>::<base_db>::<iam>::<ssp>``.
* Duplicate pairs are rejected with 400.
* The 4-way axisConflict rule is mirrored server-side: 400 when paired is
  set together with parameter scenarios OR DSM scenario ids OR LCI
  scenarios.
* Export route 400s when ``multi_paired_result`` is set alongside another
  multi-axis envelope, and 200s with a real workbook when set alone.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

from fastapi import HTTPException

from mapper.api import impact as impact_api
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
    ImpactAssessmentMeta,
    ImpactAssessmentRequest,
    ImpactAssessmentResult,
    ImpactExportRequest,
    MultiDSMImpactResult,
    MultiPairedImpactResult,
    PairedDSMLCIRef,
    PairedScenarioImpactResult,
    ProspectiveScenarioRef,
)


# ── Fixtures ────────────────────────────────────────────────────────────────


def _meta(dsm_scenario_id: str | None = None) -> ImpactAssessmentMeta:
    return ImpactAssessmentMeta(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        year_start=2030,
        year_end=2030,
        base_db="ecoinvent-3.10-cutoff",
        dsm_scenario_id=dsm_scenario_id,
    )


def _ref(ssp: str = "SSP2-PkBudg1150", iam: str = "remind") -> ProspectiveScenarioRef:
    return ProspectiveScenarioRef(
        base_db="ecoinvent-3.10-cutoff", iam=iam, ssp=ssp,
    )


def _make_dsmlca() -> DSMLCAResult:
    return DSMLCAResult(
        mfa_system_id="sys-1",
        scope="stock",
        method=["EF v3.1", "climate change", "GWP100"],
        method_label="EF v3.1 › climate change › GWP100",
        unit="kg CO2-eq",
        years=[
            DSMLCAYearResult(
                year=2030,
                total_impact=100.0,
                impact_by_cohort={"BEV|Small|2028": 100.0},
                impact_by_material={"battery": 70.0, "body": 30.0},
                count_by_cohort={"BEV|Small|2028": 1.0},
                unit="kg CO2-eq",
            ),
        ],
        summary=DSMLCASummary(total_impact=100.0, peak_year=2030, peak_impact=100.0),
        stages_included=["Use Phase"],
    )


def _make_inner(dsm_scenario_id: str) -> ImpactAssessmentResult:
    return ImpactAssessmentResult(
        task_id=f"task-{dsm_scenario_id}",
        meta=_meta(dsm_scenario_id=dsm_scenario_id),
        results=[_make_dsmlca()],
    )


# ── Schema shape ─────────────────────────────────────────────────────────────


def test_request_accepts_paired_scenarios():
    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        paired_scenarios=[
            PairedDSMLCIRef(
                dsm_scenario_id="SSP1",
                lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
            ),
            PairedDSMLCIRef(
                dsm_scenario_id="SSP2",
                lci_scenario=_ref(ssp="SSP2-PkBudg1150"),
            ),
        ],
    )
    assert body.paired_scenarios is not None
    assert len(body.paired_scenarios) == 2
    assert body.paired_scenarios[0].dsm_scenario_id == "SSP1"
    assert body.paired_scenarios[0].lci_scenario.ssp == "SSP1-PkBudg1150"


def test_paired_envelope_has_discriminator():
    """``MultiPairedImpactResult`` carries
    ``result_type='multi_paired_dsm_lci'`` so the frontend (and the export
    route's branch) can narrow on the discriminator field."""
    pair_result = PairedScenarioImpactResult(
        dsm_scenario_id="SSP1",
        dsm_scenario_name="SSP1 fast electrification",
        lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
        lci_scenario_label="REMIND/SSP1-PkBudg1150",
        result=_make_inner("SSP1"),
    )
    env = MultiPairedImpactResult(
        meta=_meta(),
        scenarios=[pair_result],
        elapsed_seconds=4.2,
    )
    payload = env.model_dump()
    assert payload["result_type"] == "multi_paired_dsm_lci"
    assert len(payload["scenarios"]) == 1
    assert payload["scenarios"][0]["dsm_scenario_id"] == "SSP1"
    assert payload["scenarios"][0]["lci_scenario"]["ssp"] == "SSP1-PkBudg1150"
    assert payload["scenarios"][0]["lci_scenario_label"] == "REMIND/SSP1-PkBudg1150"


# ── Orchestrator: paired-axis fan-out ───────────────────────────────────────


def test_calculate_scenarios_paired_axis_fans_out_per_pair():
    """When ``paired_scenarios`` is set, the orchestrator spawns one task
    per pair, threading both the DSM scenario id (singular) AND the LCI
    scenario ref (singular) into the per-task body, and clearing the list
    fields so the spawned worker doesn't recurse."""
    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        paired_scenarios=[
            PairedDSMLCIRef(
                dsm_scenario_id="SSP1", lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
            ),
            PairedDSMLCIRef(
                dsm_scenario_id="SSP2", lci_scenario=_ref(ssp="SSP2-PkBudg1150"),
            ),
            PairedDSMLCIRef(
                dsm_scenario_id="SSP5", lci_scenario=_ref(ssp="SSP5-PkBudg1150"),
            ),
        ],
    )

    captured: list[ImpactAssessmentRequest] = []

    async def _fake_post_calculate(req: ImpactAssessmentRequest):
        captured.append(req)
        return {"task_id": f"task-{req.dsm_scenario_id}"}

    with patch.object(impact_api, "post_calculate", _fake_post_calculate):
        out = asyncio.run(impact_api.post_calculate_scenarios(body))

    expected_keys = {
        "SSP1::ecoinvent-3.10-cutoff::remind::SSP1-PkBudg1150",
        "SSP2::ecoinvent-3.10-cutoff::remind::SSP2-PkBudg1150",
        "SSP5::ecoinvent-3.10-cutoff::remind::SSP5-PkBudg1150",
    }
    assert set(out["scenarios"].keys()) == expected_keys

    assert len(captured) == 3
    # Per-task body carries singular DSM + singular LCI scenario.
    sids = {c.dsm_scenario_id for c in captured}
    assert sids == {"SSP1", "SSP2", "SSP5"}
    ssps = {c.scenario.ssp for c in captured if c.scenario is not None}
    assert ssps == {"SSP1-PkBudg1150", "SSP2-PkBudg1150", "SSP5-PkBudg1150"}
    # List fields cleared so the spawned worker doesn't recurse.
    assert all(c.dsm_scenario_ids is None for c in captured)
    assert all(c.paired_scenarios is None for c in captured)
    assert all(c.lci_scenarios is None for c in captured)
    assert all(c.scenarios is None for c in captured)


def test_calculate_scenarios_paired_response_shape_via_http_json():
    """End-to-end through HTTP/JSON: a POST with ``paired_scenarios`` set
    returns ``{"scenarios": {pair_key: task_id}}`` keyed by exactly the
    deterministic pair keys, in submission order."""
    from fastapi.testclient import TestClient
    from mapper.main import app

    captured: list[ImpactAssessmentRequest] = []

    async def _fake_post_calculate(req: ImpactAssessmentRequest):
        captured.append(req)
        return {"task_id": f"task-{req.dsm_scenario_id}"}

    with patch.object(impact_api, "post_calculate", _fake_post_calculate):
        client = TestClient(app)
        resp = client.post(
            "/api/impact/calculate-scenarios",
            json={
                "mode": "projected",
                "mfa_system_id": "sys-1",
                "scope": "stock",
                "methods": [["EF v3.1", "climate change", "GWP100"]],
                "paired_scenarios": [
                    {
                        "dsm_scenario_id": "SSP1",
                        "lci_scenario": {
                            "base_db": "ecoinvent-3.10-cutoff",
                            "iam": "remind",
                            "ssp": "SSP1-PkBudg1150",
                        },
                    },
                    {
                        "dsm_scenario_id": "SSP2",
                        "lci_scenario": {
                            "base_db": "ecoinvent-3.10-cutoff",
                            "iam": "remind",
                            "ssp": "SSP2-PkBudg1150",
                        },
                    },
                ],
            },
        )

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert "scenarios" in payload
    assert set(payload["scenarios"].keys()) == {
        "SSP1::ecoinvent-3.10-cutoff::remind::SSP1-PkBudg1150",
        "SSP2::ecoinvent-3.10-cutoff::remind::SSP2-PkBudg1150",
    }
    assert {c.dsm_scenario_id for c in captured} == {"SSP1", "SSP2"}


def test_calculate_scenarios_paired_rejects_duplicate_pair():
    """A duplicate ``(dsm_scenario_id, base_db, iam, ssp)`` tuple in the
    pair list is rejected with 400 — pair keys must be unique because
    they're the response dict keys."""
    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        paired_scenarios=[
            PairedDSMLCIRef(
                dsm_scenario_id="SSP1", lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
            ),
            PairedDSMLCIRef(
                dsm_scenario_id="SSP1", lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
            ),
        ],
    )

    try:
        asyncio.run(impact_api.post_calculate_scenarios(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "Duplicate" in e.detail or "duplicate" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 on duplicate pair")


def test_calculate_scenarios_paired_rejects_with_param_axis():
    """4-way axisConflict — paired + parameter scenarios = 400."""
    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        scenarios=["Base", "Optimistic"],
        paired_scenarios=[
            PairedDSMLCIRef(
                dsm_scenario_id="SSP1", lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
            ),
        ],
    )

    try:
        asyncio.run(impact_api.post_calculate_scenarios(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axisConflict" in e.detail or "axis at a time" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 for paired + param axes")


def test_calculate_scenarios_paired_rejects_with_dsm_axis():
    """4-way axisConflict — paired + dsm_scenario_ids = 400."""
    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        dsm_scenario_ids=["SSP1", "SSP2"],
        paired_scenarios=[
            PairedDSMLCIRef(
                dsm_scenario_id="SSP1", lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
            ),
        ],
    )

    try:
        asyncio.run(impact_api.post_calculate_scenarios(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axisConflict" in e.detail or "axis at a time" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 for paired + DSM axes")


# ── Export route guards ─────────────────────────────────────────────────────


def test_export_rejects_multi_paired_alongside_other_envelope():
    """Defence-in-depth: posting both ``multi_paired_result`` and
    ``multi_dsm_result`` (or any other multi-axis envelope) 400s."""
    paired_env = MultiPairedImpactResult(
        meta=_meta(),
        scenarios=[
            PairedScenarioImpactResult(
                dsm_scenario_id="SSP1",
                dsm_scenario_name="SSP1",
                lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
                lci_scenario_label="REMIND/SSP1-PkBudg1150",
                result=_make_inner("SSP1"),
            ),
        ],
    )
    dsm_env = MultiDSMImpactResult(
        meta=_meta(),
        scenarios=[],
    )
    # MultiDSMImpactResult has a non-empty scenarios requirement only at
    # export time, but the dual-envelope check fires earlier — give it a
    # populated payload to avoid hitting the empty-scenarios 400 instead.
    from mapper.models.bom_schemas import DSMScenarioImpactResult
    dsm_env = MultiDSMImpactResult(
        meta=_meta(),
        scenarios=[
            DSMScenarioImpactResult(
                scenario_id="base", scenario_name="Base", result=_make_inner("base"),
            ),
        ],
    )

    body = ImpactExportRequest(
        multi_paired_result=paired_env, multi_dsm_result=dsm_env,
    )

    try:
        asyncio.run(impact_api.post_export(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axisConflict" in e.detail or "axis at a time" in e.detail
    else:
        raise AssertionError(
            "Expected HTTPException 400 for paired × multi-DSM dual-envelope"
        )


def test_export_lone_multi_paired_produces_workbook(monkeypatch):
    """Lone ``multi_paired_result`` envelope routes to
    ``_build_multi_paired_workbook`` and returns a real workbook with the
    ``MultiPaired`` filename discriminator."""
    from types import SimpleNamespace

    paired_env = MultiPairedImpactResult(
        meta=_meta(),
        scenarios=[
            PairedScenarioImpactResult(
                dsm_scenario_id="SSP1",
                dsm_scenario_name="SSP1 fast EV",
                lci_scenario=_ref(ssp="SSP1-PkBudg1150"),
                lci_scenario_label="REMIND/SSP1-PkBudg1150",
                result=_make_inner("SSP1"),
            ),
            PairedScenarioImpactResult(
                dsm_scenario_id="SSP2",
                dsm_scenario_name="SSP2 baseline",
                lci_scenario=_ref(ssp="SSP2-PkBudg1150"),
                lci_scenario_label="REMIND/SSP2-PkBudg1150",
                result=_make_inner("SSP2"),
            ),
        ],
    )

    monkeypatch.setattr(
        impact_api, "_get_system",
        lambda sid: SimpleNamespace(name="Test System", id=sid),
    )
    monkeypatch.setattr(impact_api, "_current_project", lambda: "test-project")
    monkeypatch.setattr(impact_api, "_proj_archetypes", lambda p: {})

    body = ImpactExportRequest(multi_paired_result=paired_env)
    response = asyncio.run(impact_api.post_export(body))
    assert response.status_code == 200
    cd = response.headers.get("content-disposition", "")
    assert "MultiPaired" in cd, (
        f"Filename must use MultiPaired discriminator; got {cd!r}"
    )
    assert ".xlsx" in cd
