# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Per-project persistence for AESA saved sessions (Patch 4R).

Sessions are computed AESA *results* with their input configuration
snapshotted at save time. They're distinct from configurations
(``aesa_storage.py``), which are reusable templates. A session is a
historical record of one compute event: configuration that was used +
result that came out + the upstream Impact Assessment task_id (if
available, for traceability).

Layout: ``STORAGE_DIR/{project}/sessions/{session_id}.json``.
Each file is the JSON serialization of an ``AESASession``. Mirrors
the on-disk pattern of ``aesa_storage.py`` for consistency — same
``platformdirs`` user-data dir, same per-project sandboxing, same
filename-sanitisation rules.

Sessions are append-only from the user's perspective: there's no
"recompute saved session" affordance. The saved data is what you see
when you load it; live recompute returns to the cascade view via the
"Return to live view" button.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import platformdirs


STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / "aesa"

_UNSAFE_PROJECT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_project(project: str) -> str:
    cleaned = _UNSAFE_PROJECT.sub("_", (project or "").strip())
    return cleaned or "default"


def _sessions_dir(project: str) -> Path:
    return STORAGE_DIR / _safe_project(project) / "sessions"


def _session_path(project: str, session_id: str) -> Path:
    # Reuse the same filename sanitisation as aesa_storage to
    # guarantee filesystem-safe ids.
    safe_id = _UNSAFE_PROJECT.sub("_", session_id)
    return _sessions_dir(project) / f"{safe_id}.json"


def load_all(project: str) -> list[dict]:
    d = _sessions_dir(project)
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    # Newest first (created_at ISO timestamps sort lexicographically).
    out.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return out


def load(project: str, session_id: str) -> dict | None:
    path = _session_path(project, session_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save(project: str, session: dict) -> None:
    if not session.get("id"):
        raise ValueError("session.id is required for persistence")
    path = _session_path(project, session["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(session, indent=2), encoding="utf-8")
    tmp.replace(path)


def delete(project: str, session_id: str) -> bool:
    path = _session_path(project, session_id)
    if not path.exists():
        return False
    path.unlink()
    return True
