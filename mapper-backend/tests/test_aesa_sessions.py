"""Patch 4R — AESA saved sessions backend.

Round-trip tests for the per-project session storage and CRUD
endpoints. Sessions are immutable historical records of one compute
event (configuration snapshot + result), distinct from
``AESAConfiguration`` which is a reusable input template.

What we assert:

* Storage layer: save/load/load_all/delete round-trip cleanly with
  per-project sandboxing. Newest-first sort on list.
* Endpoints: POST creates with server-assigned id + timestamps;
  GET list returns newest-first; GET by id 404s on missing;
  PATCH renames + bumps modified_at without disturbing snapshot/result;
  DELETE 404s on missing.
* Configuration snapshot is immutable through the rename path —
  PATCH only touches name + modified_at.
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from mapper.api import aesa as aesa_api
from mapper.core import aesa_session_storage
from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESASession,
    AESASessionCreate,
    AESASessionRename,
    DownscalingChain,
    DownscalingLayer,
    PrincipleDefinition,
    SharingPreset,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────


def _sharing_preset() -> SharingPreset:
    return SharingPreset(
        id="preset-1",
        name="Test preset",
        description="",
        principles=[PrincipleDefinition(id="EpC", name="Equal per capita")],
        category_assignments=[],
        chain=DownscalingChain(layers=[
            DownscalingLayer(
                layer_number=1,
                name="Single fixed layer",
                principle_mode="fixed",
                fixed_principle="EpC",
            ),
        ]),
    )


def _config(name: str = "Test config") -> AESAConfiguration:
    return AESAConfiguration(
        id="cfg-1", name=name, mfa_system_id="sys-1",
        impact_mode="static", boundary_set_id="Sala2020_EF",
        sharing=_sharing_preset(),
        method_mapping=[],
        created_at="2026-05-01T00:00:00+00:00",
    )


def _result() -> AESAComputeResult:
    return AESAComputeResult(
        config_id="cfg-1",
        results=[],
        summary_by_year=[],
        missing_categories=[],
    )


@pytest.fixture
def tmp_storage(monkeypatch):
    """Redirect storage to an isolated temp dir so tests don't pollute
    the user's real ``~/Library/Application Support/mapper/aesa`` (or
    platform equivalent)."""
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(aesa_session_storage, "STORAGE_DIR", Path(d))
        yield Path(d)


# ─── Storage layer ───────────────────────────────────────────────────────────


def test_storage_save_then_load_round_trips(tmp_storage):
    session = {
        "id": "ses-1",
        "name": "My session",
        "project": "p1",
        "created_at": "2026-05-08T12:00:00+00:00",
        "modified_at": "2026-05-08T12:00:00+00:00",
        "configuration_snapshot": _config().model_dump(),
        "result": _result().model_dump(),
        "upstream_ia_task_id": "task-abc",
    }
    aesa_session_storage.save("p1", session)
    loaded = aesa_session_storage.load("p1", "ses-1")
    assert loaded is not None
    assert loaded["name"] == "My session"
    assert loaded["upstream_ia_task_id"] == "task-abc"
    assert loaded["configuration_snapshot"]["name"] == "Test config"


def test_storage_load_all_returns_newest_first(tmp_storage):
    base = {
        "configuration_snapshot": _config().model_dump(),
        "result": _result().model_dump(),
        "project": "p1",
        "upstream_ia_task_id": None,
    }
    aesa_session_storage.save("p1", {
        **base, "id": "old", "name": "Old",
        "created_at": "2026-05-01T00:00:00+00:00",
        "modified_at": "2026-05-01T00:00:00+00:00",
    })
    aesa_session_storage.save("p1", {
        **base, "id": "new", "name": "New",
        "created_at": "2026-05-08T00:00:00+00:00",
        "modified_at": "2026-05-08T00:00:00+00:00",
    })
    aesa_session_storage.save("p1", {
        **base, "id": "mid", "name": "Mid",
        "created_at": "2026-05-04T00:00:00+00:00",
        "modified_at": "2026-05-04T00:00:00+00:00",
    })
    sessions = aesa_session_storage.load_all("p1")
    assert [s["id"] for s in sessions] == ["new", "mid", "old"]


def test_storage_per_project_sandboxing(tmp_storage):
    base = {
        "configuration_snapshot": _config().model_dump(),
        "result": _result().model_dump(),
        "upstream_ia_task_id": None,
    }
    aesa_session_storage.save("alpha", {
        **base, "id": "ses-1", "name": "alpha",
        "project": "alpha",
        "created_at": "2026-05-08T00:00:00+00:00",
        "modified_at": "2026-05-08T00:00:00+00:00",
    })
    aesa_session_storage.save("beta", {
        **base, "id": "ses-1", "name": "beta",
        "project": "beta",
        "created_at": "2026-05-08T00:00:00+00:00",
        "modified_at": "2026-05-08T00:00:00+00:00",
    })
    # Same id under different projects → both retained, no collision.
    assert aesa_session_storage.load("alpha", "ses-1")["name"] == "alpha"
    assert aesa_session_storage.load("beta", "ses-1")["name"] == "beta"


def test_storage_delete_returns_false_on_missing(tmp_storage):
    assert aesa_session_storage.delete("p1", "nope") is False


def test_storage_save_requires_id(tmp_storage):
    with pytest.raises(ValueError):
        aesa_session_storage.save("p1", {"name": "no id"})


# ─── HTTP routes ─────────────────────────────────────────────────────────────


def test_post_session_assigns_id_and_timestamps(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    body = AESASessionCreate(
        name="Initial save",
        configuration_snapshot=_config(),
        result=_result(),
        upstream_ia_task_id="task-xyz",
    )
    session = asyncio.run(aesa_api.create_session(body))
    assert session.name == "Initial save"
    assert session.id  # server-assigned uuid hex, non-empty
    assert session.created_at == session.modified_at  # fresh save: same ts
    assert session.upstream_ia_task_id == "task-xyz"
    # Persisted to disk under the active project.
    on_disk = aesa_session_storage.load("p1", session.id)
    assert on_disk is not None
    assert on_disk["name"] == "Initial save"


def test_get_session_404s_on_missing(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(aesa_api.get_session("does-not-exist"))
    assert ei.value.status_code == 404


def test_list_sessions_returns_newest_first(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    s1 = asyncio.run(aesa_api.create_session(AESASessionCreate(
        name="First", configuration_snapshot=_config(), result=_result(),
    )))
    # Force a distinct created_at by patching datetime via the storage
    # write — easier to seed two files with known timestamps directly.
    raw = aesa_session_storage.load("p1", s1.id)
    raw["created_at"] = "2026-05-01T00:00:00+00:00"
    aesa_session_storage.save("p1", raw)

    s2 = asyncio.run(aesa_api.create_session(AESASessionCreate(
        name="Second", configuration_snapshot=_config(), result=_result(),
    )))  # natural created_at == now > 2026-05-01

    listed = asyncio.run(aesa_api.list_sessions())
    assert [s.id for s in listed] == [s2.id, s1.id]


def test_patch_session_renames_without_touching_snapshot(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    session = asyncio.run(aesa_api.create_session(AESASessionCreate(
        name="Original", configuration_snapshot=_config("Snap"), result=_result(),
    )))
    original_modified = session.modified_at
    original_snapshot_name = session.configuration_snapshot.name

    # Tiny sleep so modified_at changes detectably (ISO-8601 microsecond
    # precision means same-millisecond saves can stamp identical times).
    import time as _time
    _time.sleep(0.01)

    renamed = asyncio.run(aesa_api.rename_session(
        session.id, AESASessionRename(name="Renamed"),
    ))
    assert renamed.name == "Renamed"
    assert renamed.modified_at != original_modified
    # Snapshot is immutable through the rename path.
    assert renamed.configuration_snapshot.name == original_snapshot_name
    assert renamed.created_at == session.created_at  # never changes


def test_patch_session_404s_on_missing(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(aesa_api.rename_session(
            "does-not-exist", AESASessionRename(name="anything"),
        ))
    assert ei.value.status_code == 404


def test_delete_session_round_trips(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    session = asyncio.run(aesa_api.create_session(AESASessionCreate(
        name="To delete", configuration_snapshot=_config(), result=_result(),
    )))
    assert aesa_session_storage.load("p1", session.id) is not None
    asyncio.run(aesa_api.delete_session(session.id))
    assert aesa_session_storage.load("p1", session.id) is None


def test_delete_session_404s_on_missing(tmp_storage, monkeypatch):
    monkeypatch.setattr(aesa_api, "_current_project", lambda: "p1")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(aesa_api.delete_session("does-not-exist"))
    assert ei.value.status_code == 404
