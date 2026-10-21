# SPDX-License-Identifier: MPL-2.0
"""Settings › Logs "Reveal in Finder": the backend opens the folder of a file
it saved, and nothing else.

Through the real route with a real file in a real folder; only the OS call
(``open -R`` / ``explorer /select,``) is captured, because CI cannot open a
Finder window.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from mapper.api import system

    downloads = tmp_path / "Downloads"
    downloads.mkdir()
    monkeypatch.setattr(system.Path, "home", classmethod(lambda cls: tmp_path))
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda argv: calls.append(argv))
    from mapper.main import app

    return TestClient(app), downloads, calls


def _post(c, path):
    return c.post("/api/system/reveal", content=json.dumps({"path": str(path)}),
                  headers={"Content-Type": "application/json"})


def test_a_saved_file_is_revealed(env):
    c, downloads, calls = env
    f = downloads / "mapper_logs_2026-10-21.txt"
    f.write_text("log")
    r = _post(c, f)
    assert r.status_code == 200, r.text
    (argv,) = calls
    assert str(f.resolve()) in " ".join(argv)


def test_a_file_outside_the_save_folders_is_refused(env, tmp_path):
    c, _, calls = env
    other = tmp_path / "elsewhere.txt"
    other.write_text("x")
    assert _post(c, other).status_code == 400 and calls == []


def test_a_missing_file_says_so(env):
    c, downloads, calls = env
    assert _post(c, downloads / "gone.txt").status_code == 404 and calls == []
