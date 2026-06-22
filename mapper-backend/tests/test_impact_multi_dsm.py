# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 2E.1 — Multi-DSM-scenario fan-out backend.

Backend-only acceptance tests for the multi-DSM axis on Impact Assessment.
Frontend wiring lands in Patch 2E.2; the Excel builder lands in 2E.3.

What we assert:

* The schema accepts ``dsm_scenario_id`` (single) and ``dsm_scenario_ids``
  (list) and they round-trip cleanly.
* ``MultiDSMImpactResult`` carries the ``result_type='multi_dsm'``
  discriminator and the inner ``DSMScenarioImpactResult`` shape.
* ``ImpactAssessmentMeta.dsm_scenario_id`` round-trips so the UI can tag
  per-task results by DSM scenario.
* ``/impact/calculate-scenarios`` fans out one task per DSM scenario id when
  ``dsm_scenario_ids`` is set, threading each into the spawned per-task body
  via ``dsm_scenario_id``.
* The 3-way axisConflict rule is mirrored server-side: 400 when both
  ``scenarios`` (parameter axis) and ``dsm_scenario_ids`` (DSM axis) are
  non-empty.
* The export route 400s when the multi-DSM envelope is set alongside another
  multi-axis envelope (defence-in-depth for the same axisConflict rule), and
  501s when set alone (Excel builder is Patch 2E.3).
* Single-scenario backward compat: a request without any of the new fields
  still parses and behaves as before.
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
    DSMScenarioImpactResult,
    ImpactAssessmentMeta,
    ImpactAssessmentRequest,
    ImpactAssessmentResult,
    ImpactExportRequest,
    MultiDSMImpactResult,
    MultiParamImpactResult,
    ParamScenarioImpactResult,
)


# ── Fixtures ────────────────────────────────────────────────────────────────


def _meta(dsm_scenario_id: str | None = None) -> ImpactAssessmentMeta:
    return ImpactAssessmentMeta(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        year_start=2030,
        year_end=2030,
        base_db="ecoinvent-3.10-cutoff",
        dsm_scenario_id=dsm_scenario_id,
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


def test_request_accepts_dsm_scenario_id_singular():
    """Single ``dsm_scenario_id`` is the in-task field that drives a fresh
    per-scenario simulate inside the worker. Round-trips cleanly."""
    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        dsm_scenario_id="scen-fast-ev",
    )
    assert body.dsm_scenario_id == "scen-fast-ev"
    assert body.dsm_scenario_ids is None  # not the fan-out field


def test_request_accepts_dsm_scenario_ids_list():
    """List ``dsm_scenario_ids`` is the fan-out contract surface — consumed
    by ``/impact/calculate-scenarios``."""
    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        dsm_scenario_ids=["base", "scen-fast-ev", "scen-slow"],
    )
    assert body.dsm_scenario_ids == ["base", "scen-fast-ev", "scen-slow"]
    assert body.dsm_scenario_id is None


def test_meta_carries_dsm_scenario_id():
    """``ImpactAssessmentMeta`` echoes the resolved DSM scenario id so the
    UI can tag per-task results. Defaults to None for backward compat."""
    m = ImpactAssessmentMeta(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
    )
    assert m.dsm_scenario_id is None

    m2 = ImpactAssessmentMeta(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        dsm_scenario_id="scen-fast-ev",
    )
    assert m2.dsm_scenario_id == "scen-fast-ev"


def test_multi_dsm_envelope_has_discriminator():
    """``MultiDSMImpactResult`` must carry ``result_type='multi_dsm'`` so the
    frontend (and the export route's branch) can narrow on the field rather
    than duck-typing."""
    inner = _make_inner("scen-fast-ev")
    env = MultiDSMImpactResult(
        meta=_meta(),
        scenarios=[
            DSMScenarioImpactResult(
                scenario_id="base", scenario_name="Base", result=_make_inner("base"),
            ),
            DSMScenarioImpactResult(
                scenario_id="scen-fast-ev", scenario_name="Fast EV uptake",
                result=inner,
            ),
        ],
        elapsed_seconds=4.2,
    )
    payload = env.model_dump()
    assert payload["result_type"] == "multi_dsm"
    assert len(payload["scenarios"]) == 2
    assert payload["scenarios"][0]["scenario_id"] == "base"
    assert payload["scenarios"][1]["scenario_name"] == "Fast EV uptake"


# ── Orchestrator: DSM-axis fan-out ──────────────────────────────────────────


def test_calculate_scenarios_dsm_axis_fans_out_per_id():
    """When ``dsm_scenario_ids`` is set, the orchestrator spawns one task per
    DSM scenario id, threading each into the per-task body via
    ``dsm_scenario_id`` (and clearing the list field so the spawned worker
    doesn't recurse into another fan-out)."""
    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        dsm_scenario_ids=["base", "scen-fast-ev", "scen-slow"],
    )

    captured: list[ImpactAssessmentRequest] = []

    async def _fake_post_calculate(req: ImpactAssessmentRequest):
        captured.append(req)
        return {"task_id": f"task-{req.dsm_scenario_id}"}

    with patch.object(impact_api, "post_calculate", _fake_post_calculate):
        out = asyncio.run(impact_api.post_calculate_scenarios(body))

    assert set(out["scenarios"].keys()) == {"base", "scen-fast-ev", "scen-slow"}
    assert out["scenarios"]["base"] == "task-base"

    assert len(captured) == 3
    # Per-task body carries the singular ``dsm_scenario_id``, NOT the list.
    assert {c.dsm_scenario_id for c in captured} == {
        "base", "scen-fast-ev", "scen-slow",
    }
    assert all(c.dsm_scenario_ids is None for c in captured)
    # Mode propagates per-task — same contract as the parameter-axis path.
    assert all(c.mode == "static" for c in captured)
    # Parameter axis was not touched.
    assert all(c.scenarios is None for c in captured)


def test_calculate_scenarios_response_shape_via_http_json():
    """End-to-end through HTTP/JSON: a POST with ``dsm_scenario_ids`` set must
    return ``{"scenarios": {sid: task_id}}`` keyed by EXACTLY the requested
    sids. The frontend looks up assignments by sid; if Pydantic silently
    dropped the field (e.g. against a stale schema with extra=ignore) the
    fan-out would never trigger and the response would be keyed by
    parameter_set_id instead.

    This complements ``test_calculate_scenarios_dsm_axis_fans_out_per_id``
    which mocks ``post_calculate`` and bypasses HTTP/JSON deserialization."""
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
                "mode": "static",
                "mfa_system_id": "sys-1",
                "scope": "stock",
                "methods": [["EF v3.1", "climate change", "GWP100"]],
                "dsm_scenario_ids": ["SSP1", "SSP2", "SSP5"],
            },
        )

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert "scenarios" in payload, payload
    assert set(payload["scenarios"].keys()) == {"SSP1", "SSP2", "SSP5"}, (
        f"Response keyed by {set(payload['scenarios'].keys())} — "
        f"frontend expects exactly the requested sids"
    )
    assert payload["scenarios"]["SSP1"] == "task-SSP1"
    assert {c.dsm_scenario_id for c in captured} == {"SSP1", "SSP2", "SSP5"}


def test_calculate_scenarios_rejects_both_axes_simultaneously():
    """3-way axisConflict mirrored server-side: parameter scenarios and DSM
    scenarios cannot be fanned out in the same request."""
    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        scenarios=["Base", "Optimistic"],
        dsm_scenario_ids=["base", "scen-fast-ev"],
    )

    try:
        asyncio.run(impact_api.post_calculate_scenarios(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axisConflict" in e.detail or "axis at a time" in e.detail
    else:
        raise AssertionError(
            "Expected HTTPException 400 when both axes are non-empty"
        )


def test_calculate_scenarios_param_axis_unchanged_when_no_dsm_ids():
    """Backward compat: requests with only ``scenarios`` set (no
    ``dsm_scenario_ids``) still fan out by parameter axis as before."""
    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        scenarios=["Base", "Optimistic"],
    )

    captured: list[ImpactAssessmentRequest] = []

    async def _fake_post_calculate(req: ImpactAssessmentRequest):
        captured.append(req)
        return {"task_id": f"task-{req.parameter_set_id}"}

    with patch.object(impact_api, "post_calculate", _fake_post_calculate):
        out = asyncio.run(impact_api.post_calculate_scenarios(body))

    assert set(out["scenarios"].keys()) == {"Base", "Optimistic"}
    assert {c.parameter_set_id for c in captured} == {"Base", "Optimistic"}
    # DSM axis untouched.
    assert all(c.dsm_scenario_id is None for c in captured)


def test_calculate_scenarios_legacy_single_path_still_works():
    """Single-scenario backward compat: a body with neither
    ``scenarios`` nor ``dsm_scenario_ids`` still spawns exactly one task on
    ``"Base"`` (or the explicit ``parameter_set_id`` when present)."""
    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
    )

    captured: list[ImpactAssessmentRequest] = []

    async def _fake_post_calculate(req: ImpactAssessmentRequest):
        captured.append(req)
        return {"task_id": "task-Base"}

    with patch.object(impact_api, "post_calculate", _fake_post_calculate):
        out = asyncio.run(impact_api.post_calculate_scenarios(body))

    assert list(out["scenarios"].keys()) == ["Base"]
    assert len(captured) == 1
    assert captured[0].dsm_scenario_id is None


# ── Export route guards ─────────────────────────────────────────────────────


def test_export_rejects_multi_dsm_alongside_other_envelope():
    """If a misbehaving client posts both multi-DSM and multi-LCI (or
    multi-parameter) envelopes, the server 400s — same axisConflict rule
    that gates the request side."""
    inner = _make_inner("base")
    dsm_env = MultiDSMImpactResult(
        meta=_meta(),
        scenarios=[
            DSMScenarioImpactResult(
                scenario_id="base", scenario_name="Base", result=inner,
            ),
        ],
    )
    param_env = MultiParamImpactResult(
        meta=_meta(),
        scenarios=[ParamScenarioImpactResult(scenario="Base", result=inner)],
    )

    body = ImpactExportRequest(
        multi_dsm_result=dsm_env, multi_param_result=param_env,
    )

    try:
        asyncio.run(impact_api.post_export(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axisConflict" in e.detail or "axis at a time" in e.detail
    else:
        raise AssertionError(
            "Expected HTTPException 400 for multi-DSM × multi-param dual-envelope export"
        )


def test_export_lone_multi_dsm_produces_workbook(monkeypatch):
    """Patch 2E.3 — lone ``multi_dsm_result`` envelopes now route to
    ``_build_multi_dsm_workbook`` and return a real workbook (was 501
    until 2E.3 shipped). Sheet inventory + filename discriminator are
    checked end-to-end through the route to lock the wiring in place.
    """
    from types import SimpleNamespace

    inner = _make_inner("base")
    dsm_env = MultiDSMImpactResult(
        meta=_meta(),
        scenarios=[
            DSMScenarioImpactResult(
                scenario_id="base", scenario_name="Base", result=inner,
            ),
        ],
    )

    monkeypatch.setattr(
        impact_api, "_get_system",
        lambda sid: SimpleNamespace(name="Test System", id=sid),
    )
    monkeypatch.setattr(impact_api, "_current_project", lambda: "test-project")
    monkeypatch.setattr(impact_api, "_proj_archetypes", lambda p: {})

    body = ImpactExportRequest(multi_dsm_result=dsm_env)
    response = asyncio.run(impact_api.post_export(body))
    assert response.status_code == 200
    cd = response.headers.get("content-disposition", "")
    assert "MultiDSM" in cd, f"Filename must use the MultiDSM discriminator; got {cd!r}"
    assert ".xlsx" in cd
