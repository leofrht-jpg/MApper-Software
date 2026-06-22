# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 4M — Multi-axis fan-out for Material Flows.

Backend acceptance tests for the new endpoint
``POST /api/dsm/systems/{id}/material-flows-multi`` and the schema
extension on ``MaterialFlowRequest``.

Notes:

- The legacy single-result endpoint ``POST .../material-flows`` keeps
  its single-result shape unchanged for backward compat. Tests here
  verify the schema accepts the new fields without forcing them.
- LCI scenarios are NOT an axis here — see CLAUDE.md "Material Flows
  axes". Only ``dsm_scenario_ids`` and ``parameter_scenarios`` are
  meaningful.
- Server-side fan-out is sync (MFA compute is sub-second), so there's
  no task registry / WebSocket like Impact Assessment's multi-DSM —
  the route returns the assembled envelope directly.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from mapper.api import bom as bom_api
from mapper.models.bom_schemas import (
    MaterialFlowMultiRequest,
    MaterialFlowRequest,
    MaterialFlowResult,
    MaterialFlowScenarioRun,
    MultiMaterialFlowResult,
)


# ── Schema shape ────────────────────────────────────────────────────────────


def _empty_result() -> MaterialFlowResult:
    """Minimal valid MaterialFlowResult — fixtures don't need actual
    materials data; we test routing and shape, not compute correctness."""
    return MaterialFlowResult(
        scope="stock",
        stages_included=["Use Phase"],
        year_start=2030,
        year_end=2030,
        group_by="material",
        materials=[],
        elapsed_seconds=0.01,
        unit_name="vehicles",
    )


def test_request_accepts_dsm_scenario_id_singular():
    """In-task ``dsm_scenario_id`` round-trips for the legacy endpoint."""
    body = MaterialFlowRequest(scope="stock", dsm_scenario_id="scen-fast-ev")
    assert body.dsm_scenario_id == "scen-fast-ev"
    # Defaults preserved for parameter axis.
    assert body.parameter_scenario is None


def test_request_accepts_parameter_scenario_singular():
    body = MaterialFlowRequest(scope="stock", parameter_scenario="Optimistic")
    assert body.parameter_scenario == "Optimistic"
    assert body.dsm_scenario_id is None


def test_request_backward_compat_no_scenario_fields():
    """Existing callers that omit the new fields still parse and behave
    as before. Both new fields default to ``None``."""
    body = MaterialFlowRequest(scope="stock")
    assert body.dsm_scenario_id is None
    assert body.parameter_scenario is None


def test_multi_request_accepts_dsm_axis_only():
    body = MaterialFlowMultiRequest(
        scope="stock", dsm_scenario_ids=["base", "scen-a"],
    )
    assert body.dsm_scenario_ids == ["base", "scen-a"]
    assert body.parameter_scenarios is None


def test_multi_request_accepts_parameter_axis_only():
    body = MaterialFlowMultiRequest(
        scope="stock", parameter_scenarios=["Optimistic", "Pessimistic"],
    )
    assert body.parameter_scenarios == ["Optimistic", "Pessimistic"]
    assert body.dsm_scenario_ids is None


def test_multi_envelope_carries_axis_discriminator():
    env = MultiMaterialFlowResult(
        axis="dsm",
        runs=[
            MaterialFlowScenarioRun(
                axis="dsm", scenario_id="base", scenario_label="Base",
                result=_empty_result(),
            ),
            MaterialFlowScenarioRun(
                axis="dsm", scenario_id="scen-a", scenario_label="Fast EV",
                result=_empty_result(),
            ),
        ],
        elapsed_seconds=0.05,
    )
    payload = env.model_dump()
    assert payload["axis"] == "dsm"
    assert len(payload["runs"]) == 2
    assert payload["runs"][0]["scenario_id"] == "base"
    assert payload["runs"][1]["scenario_label"] == "Fast EV"


# ── axisConflict (server-side defence) ──────────────────────────────────────


def test_multi_endpoint_400s_on_both_axes():
    """The frontend axisConflict guard prevents both axes being set
    simultaneously, but the route enforces it server-side as
    defence-in-depth."""
    body = MaterialFlowMultiRequest(
        scope="stock",
        dsm_scenario_ids=["base"],
        parameter_scenarios=["Optimistic"],
    )
    with pytest.raises(HTTPException) as ei:
        asyncio.run(bom_api.material_flows_multi("sys-1", body))
    assert ei.value.status_code == 400
    assert "axisConflict" in ei.value.detail


def test_multi_endpoint_400s_on_no_axis():
    """An empty request body is meaningless — the legacy single-result
    endpoint already covers that path. Force the user to pick an axis."""
    body = MaterialFlowMultiRequest(scope="stock")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(bom_api.material_flows_multi("sys-1", body))
    assert ei.value.status_code == 400


# ── Fan-out routing ─────────────────────────────────────────────────────────


def test_dsm_axis_fans_out_one_call_per_scenario_id():
    """Each id in ``dsm_scenario_ids`` produces one ``material_flows`` call
    with the matching ``dsm_scenario_id`` field set on the per-task body."""
    body = MaterialFlowMultiRequest(
        scope="stock",
        dsm_scenario_ids=["base", "scen-a", "scen-b"],
    )

    captured: list[MaterialFlowRequest] = []

    async def _fake_compute(system_id: str, sub_body: MaterialFlowRequest):
        captured.append(sub_body)
        return _empty_result()

    # Stub the DSM state lookup so label resolution doesn't need a real
    # scenario list. Each id maps to a synthetic display name.
    class _FakeScenario:
        def __init__(self, sid: str, name: str):
            self.id = sid
            self.name = name

    class _FakeState:
        scenarios = [
            _FakeScenario("base", "Base"),
            _FakeScenario("scen-a", "Scenario A"),
            _FakeScenario("scen-b", "Scenario B"),
        ]

    with patch.object(bom_api, "material_flows", AsyncMock(side_effect=_fake_compute)), \
         patch("mapper.api.dsm._get_or_create_state", return_value=_FakeState()):
        env = asyncio.run(bom_api.material_flows_multi("sys-1", body))

    assert env.axis == "dsm"
    assert len(env.runs) == 3
    # Per-task body has the right id threaded in.
    assert [b.dsm_scenario_id for b in captured] == ["base", "scen-a", "scen-b"]
    # Parameter axis is cleared on every per-task body so the spawned
    # call doesn't recurse into another fan-out.
    assert all(b.parameter_scenario is None for b in captured)
    # Labels resolved from the DSM state, not echoing the raw id.
    assert env.runs[0].scenario_label == "Base"
    assert env.runs[1].scenario_label == "Scenario A"


def test_dsm_axis_404s_on_unknown_scenario_id():
    body = MaterialFlowMultiRequest(scope="stock", dsm_scenario_ids=["bogus"])

    class _FakeState:
        scenarios = []

    with patch("mapper.api.dsm._get_or_create_state", return_value=_FakeState()):
        with pytest.raises(HTTPException) as ei:
            asyncio.run(bom_api.material_flows_multi("sys-1", body))
    assert ei.value.status_code == 404
    assert "bogus" in ei.value.detail


def test_parameter_axis_fans_out_one_call_per_scenario_name():
    body = MaterialFlowMultiRequest(
        scope="stock",
        parameter_scenarios=["Optimistic", "Pessimistic"],
    )

    captured: list[MaterialFlowRequest] = []

    async def _fake_compute(system_id: str, sub_body: MaterialFlowRequest):
        captured.append(sub_body)
        return _empty_result()

    with patch.object(bom_api, "material_flows", AsyncMock(side_effect=_fake_compute)):
        env = asyncio.run(bom_api.material_flows_multi("sys-1", body))

    assert env.axis == "parameter"
    assert len(env.runs) == 2
    assert [b.parameter_scenario for b in captured] == ["Optimistic", "Pessimistic"]
    assert all(b.dsm_scenario_id is None for b in captured)
    # Parameter axis: scenario_label == scenario name (no separate
    # display-name lookup needed).
    assert env.runs[0].scenario_label == "Optimistic"
    assert env.runs[1].scenario_label == "Pessimistic"
