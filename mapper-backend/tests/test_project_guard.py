"""Patch X1+++ — client-server project state guard.

Bug class: backend's ``bw2data.projects.current`` and the frontend's
displayed project drift after a backend restart (bw2 resets to
``default``; frontend may still show "MAp-test" from cached state).
A ``POST /api/dsm/systems`` from that mismatched state silently wrote
the new system into ``default/`` instead of ``MAp-test/`` — the
user's "lost" WP5 in the original bug.

Fix: ``X-Mapper-Project`` header on every request validated by the
``verify_project_state`` FastAPI dependency. Mismatch → 409 with a
structured ``project_state_mismatch`` error. Header absent → check
skipped (backward compat).

These tests directly exercise ``verify_project_state`` (the pure
dependency) against patched ``get_current_project()``. Endpoint-
level integration is exercised by the cross-cutting axisConflict /
axisConflict-style smoke tests already in the suite.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from unittest.mock import patch

from mapper.api.project_guard import verify_project_state


@patch("mapper.api.project_guard.get_current_project")
def test_header_matches_current_project_returns_current(mock_get):
    mock_get.return_value = "MAp-test"
    result = verify_project_state(x_mapper_project="MAp-test")
    assert result == "MAp-test"


@patch("mapper.api.project_guard.get_current_project")
def test_header_absent_skips_validation(mock_get):
    """Backward compat: requests without the header (curl, tests,
    non-browser clients) get a free pass.
    """
    mock_get.return_value = "default"
    result = verify_project_state(x_mapper_project=None)
    assert result == "default"


@patch("mapper.api.project_guard.get_current_project")
def test_header_empty_string_skips_validation(mock_get):
    """Defensive: empty-string headers (some HTTP libs strip whitespace
    to '') are treated the same as missing.
    """
    mock_get.return_value = "default"
    result = verify_project_state(x_mapper_project="")
    assert result == "default"


@patch("mapper.api.project_guard.get_current_project")
def test_mismatch_raises_409_with_structured_detail(mock_get):
    """The exact scenario that lost the user's WP5: frontend on
    "MAp-test", backend on "default". The guard must 409 with both
    project names in the detail so the client can re-sync and the
    user sees a clear error.
    """
    mock_get.return_value = "default"
    with pytest.raises(HTTPException) as exc_info:
        verify_project_state(x_mapper_project="MAp-test")
    assert exc_info.value.status_code == 409
    detail = exc_info.value.detail
    # Structured detail: error code + readable message + both names
    # so the frontend can offer the user a "switch to MAp-test"
    # action without re-parsing the message.
    assert isinstance(detail, dict)
    assert detail["error"] == "project_state_mismatch"
    assert "MAp-test" in detail["message"]
    assert "default" in detail["message"]
    assert detail["expected_project"] == "MAp-test"
    assert detail["current_project"] == "default"


@patch("mapper.api.project_guard.get_current_project")
def test_case_sensitive_mismatch(mock_get):
    """Project names are case-sensitive; 'map-test' != 'MAp-test'."""
    mock_get.return_value = "MAp-test"
    with pytest.raises(HTTPException) as exc_info:
        verify_project_state(x_mapper_project="map-test")
    assert exc_info.value.status_code == 409
