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
    guard. (Tests, curl, non-browser scripts.) The actual create may
    still 4xx for other reasons — we only assert it's NOT a 409.
    """
    mock_get.return_value = "default"
    body = {
        "id": "",
        "name": "GuardlessProbe",
        "time_horizon": {"start_year": 2025, "end_year": 2050},
        "dimensions": [
            {"name": "s", "display_name": "Size",
             "labels": ["x"], "is_age": False},
        ],
    }
    res = client.post("/api/dsm/systems", json=body)
    assert res.status_code != 409


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
