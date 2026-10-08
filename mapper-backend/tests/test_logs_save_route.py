# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Saving the log file from a webview that cannot download.

The desktop webview is navigated to ``http://localhost:8765`` and has no
download delegate, so the UI's ``<a download>`` on a ``blob:`` URL did nothing
at all there -- no file, no error, no event. The backend already owns the log
and already runs as the user, so it writes the file and reports the path. No
Tauri plugin, and no IPC grant to an http origin.
"""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from mapper.main import app

    return TestClient(app)


def test_it_writes_the_file_and_says_where(tmp_path, monkeypatch):
    from mapper.api import system as sys_api

    log = tmp_path / "mapper.log"
    log.write_text("hello log\n", encoding="utf-8")
    monkeypatch.setattr(sys_api, "LOG_FILE", log)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / "Downloads").mkdir()

    r = _client().post("/api/system/logs/save")
    assert r.status_code == 200, r.text
    body = r.json()
    written = Path(body["path"])
    assert written.parent == tmp_path / "Downloads", "should land somewhere the user can open"
    assert written.read_text(encoding="utf-8") == "hello log\n"
    assert body["bytes"] == len("hello log\n")


def test_without_a_downloads_folder_it_falls_back_beside_the_log(tmp_path, monkeypatch):
    from mapper.api import system as sys_api

    log = tmp_path / "logs" / "mapper.log"
    log.parent.mkdir()
    log.write_text("x", encoding="utf-8")
    monkeypatch.setattr(sys_api, "LOG_FILE", log)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))  # no Downloads

    r = _client().post("/api/system/logs/save")
    assert r.status_code == 200
    assert Path(r.json()["path"]).parent == log.parent


def test_a_missing_log_is_404_not_an_empty_file(tmp_path, monkeypatch):
    from mapper.api import system as sys_api

    monkeypatch.setattr(sys_api, "LOG_FILE", tmp_path / "nope.log")
    assert _client().post("/api/system/logs/save").status_code == 404


def test_an_unwritable_target_is_reported_not_swallowed(tmp_path, monkeypatch):
    """The whole point of this change is that failures stop being invisible."""
    from mapper.api import system as sys_api

    log = tmp_path / "mapper.log"
    log.write_text("x", encoding="utf-8")
    monkeypatch.setattr(sys_api, "LOG_FILE", log)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / "Downloads").mkdir()

    def boom(self, *_a, **_k):
        raise OSError("read-only file system")

    monkeypatch.setattr(Path, "write_bytes", boom)
    r = _client().post("/api/system/logs/save")
    assert r.status_code == 500
    assert "read-only file system" in r.json()["detail"]
