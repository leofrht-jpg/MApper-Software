# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch X1+++ — end-to-end project guard.

Wires the FastAPI router through TestClient to verify the
``X-Mapper-Project`` header is actually checked by the create
endpoints we attached the dependency to. Targets:

  - POST /api/dsm/systems (the proven-broken endpoint)
  - POST /api/aesa/configurations (audit coverage)

Catches regressions where someone removes ``Depends(verify_project_state)``
from a create endpoint while keeping the import.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Spin up a TestClient against the main app."""
    from mapper.main import app
    return TestClient(app)


@patch("mapper.api.project_guard.get_current_project")
def test_create_dsm_system_409s_on_project_mismatch(mock_get, client):
    """The original WP5 bug: client thinks it's on MAp-test, backend
    is on default. With the guard, the create returns 409 instead of
    silently writing into the wrong project.
    """
    mock_get.return_value = "default"
    body = {
        "id": "",
        "name": "Wind farm",
        "time_horizon": {"start_year": 2025, "end_year": 2050},
        "dimensions": [
            {"name": "s", "display_name": "Size",
             "labels": ["Small"], "is_age": False},
        ],
    }
    res = client.post(
        "/api/dsm/systems",
        json=body,
        headers={"X-Mapper-Project": "MAp-test"},
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["error"] == "project_state_mismatch"
    assert detail["expected_project"] == "MAp-test"
    assert detail["current_project"] == "default"


@patch("mapper.api.project_guard.get_current_project")
def test_create_dsm_system_without_header_is_unguarded(mock_get, client):
    """Backward compat: clients that don't send the header bypass the
    guard. (Tests, curl, non-browser scripts.)

    This used to POST a VALID system named ``GuardlessProbe``, which the
    handler then created for real -- in whichever bw2 project was current.
    Every run that escaped the storage redirect left one more in a real
    project (Battery Circularity, then EVS40). It now proves the same thing
    without creating anything: the body is well-formed but end_year <
    start_year, so the HANDLER rejects it with 400. A 400 from the handler
    means the guard dependency ran and let the request through; a 409 would
    mean it did not. Nothing is saved either way, and that is asserted.
    """
    from mapper.api import dsm as _dsm

    mock_get.return_value = "default"
    body = {
        "id": "",
        "name": "UnguardedProbe (never saved)",
        "time_horizon": {"start_year": 2050, "end_year": 2025},
        "dimensions": [
            {"name": "s", "display_name": "Size",
             "labels": ["x"], "is_age": False},
        ],
    }
    with patch("mapper.core.dsm_storage.save_system") as save_system, \
            patch("mapper.core.dsm_storage.save_state") as save_state:
        res = client.post("/api/dsm/systems", json=body)
    assert res.status_code == 400, res.text
    assert "end_year" in res.text
    save_system.assert_not_called()
    save_state.assert_not_called()
    for systems in _dsm._systems.values():
        assert not any(s.name.startswith("UnguardedProbe") for s in systems.values())


@patch("mapper.api.project_guard.get_current_project")
def test_the_invalid_probe_body_does_not_mask_the_guard(mock_get, client):
    """The same invalid body WITH a mismatched header is a 409, not a 400:
    the guard runs before the handler, so the 400 above really does mean
    "the guard let it through"."""
    mock_get.return_value = "default"
    body = {
        "id": "",
        "name": "UnguardedProbe (never saved)",
        "time_horizon": {"start_year": 2050, "end_year": 2025},
        "dimensions": [
            {"name": "s", "display_name": "Size", "labels": ["x"], "is_age": False},
        ],
    }
    res = client.post("/api/dsm/systems", json=body, headers={"X-Mapper-Project": "EVS40"})
    assert res.status_code == 409


@patch("mapper.api.project_guard.get_current_project")
def test_aesa_create_configuration_409s_on_project_mismatch(mock_get, client):
    """Audit coverage: AESA config creation must also 409. If the
    user is on MAp-test, mid-edit through AESA config in the UI, and
    backend bw2 resets to default, saving the config would otherwise
    silently land in default/.
    """
    mock_get.return_value = "default"
    body = {
        "mfa_system_id": "irrelevant-sys-id",
        "name": "test config",
    }
    res = client.post(
        "/api/aesa/configurations",
        json=body,
        headers={"X-Mapper-Project": "MAp-test"},
    )
    # 409 must fire BEFORE any system lookup (which would otherwise
    # 404). The dependency runs ahead of the handler body.
    assert res.status_code == 409
    assert res.json()["detail"]["error"] == "project_state_mismatch"
