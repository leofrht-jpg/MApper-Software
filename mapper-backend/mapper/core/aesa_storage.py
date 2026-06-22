# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Per-project persistence for AESA configurations.

Layout: ``STORAGE_DIR/{project}/{config_id}.json``. Each file is the JSON
serialization of an ``AESAConfiguration``.
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


def _project_dir(project: str) -> Path:
    return STORAGE_DIR / _safe_project(project)


def _config_path(project: str, config_id: str) -> Path:
    return _project_dir(project) / f"{config_id}.json"


def load_all(project: str) -> list[dict]:
    d = _project_dir(project)
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    return out


def load(project: str, config_id: str) -> dict | None:
    path = _config_path(project, config_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save(project: str, config: dict) -> None:
    if not config.get("id"):
        raise ValueError("config.id is required for persistence")
    path = _config_path(project, config["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(config, indent=2), encoding="utf-8")
    tmp.replace(path)


def delete(project: str, config_id: str) -> bool:
    path = _config_path(project, config_id)
    if not path.exists():
        return False
    path.unlink()
    return True
