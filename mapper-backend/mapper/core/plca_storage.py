# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Registry of prospective LCI databases generated via premise.

Persisted to ``STORAGE_DIR/{project_name}/plca/databases.json``. Each entry
records the base database, IAM, SSP, year, and creation timestamp so the
frontend can group them by scenario.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import platformdirs


STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / "plca"

_UNSAFE_PROJECT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_project(project: str) -> str:
    cleaned = _UNSAFE_PROJECT.sub("_", (project or "").strip())
    return cleaned or "default"


def _registry_path(project: str) -> Path:
    return STORAGE_DIR / _safe_project(project) / "databases.json"


def load_registry(project: str) -> list[dict]:
    path = _registry_path(project)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return []


def _write_registry(project: str, entries: list[dict]) -> None:
    path = _registry_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    tmp.replace(path)


def register(project: str, entry: dict) -> None:
    """Add or overwrite a registry entry (matched by ``name``)."""
    entries = load_registry(project)
    entries = [e for e in entries if e.get("name") != entry.get("name")]
    entry = {**entry, "created_at": entry.get("created_at") or datetime.now(timezone.utc).isoformat()}
    entries.append(entry)
    _write_registry(project, entries)


def unregister(project: str, name: str) -> None:
    entries = [e for e in load_registry(project) if e.get("name") != name]
    _write_registry(project, entries)


def is_prospective(project: str, db_name: str) -> bool:
    return any(e.get("name") == db_name for e in load_registry(project))


def get_metadata(project: str, db_name: str) -> dict | None:
    for e in load_registry(project):
        if e.get("name") == db_name:
            return e
    return None


def resolve_prospective_dbs(
    project: str, base_db: str, iam: str, ssp: str
) -> list[tuple[str, int]]:
    """Return ``[(db_name, year), ...]`` (sorted by year) for every registered
    prospective DB matching the ``(base_db, iam, ssp)`` triple AND present in
    ``bw2data.databases``. Shared by Impact Assessment (system-level projected)
    and the single-product continuous-horizon path — one source of truth for
    trajectory → anchor resolution."""
    import logging
    import bw2data

    log = logging.getLogger(__name__)
    registry = load_registry(project)
    iam_l = (iam or "").lower()
    existing = set(bw2data.databases)

    out: list[tuple[str, int]] = []
    rejected: list[tuple[str, str]] = []
    for entry in registry:
        name = entry.get("name") or "?"
        if entry.get("base_db") != base_db:
            rejected.append((name, f"base_db={entry.get('base_db')!r} != {base_db!r}"))
            continue
        if (entry.get("iam") or "").lower() != iam_l:
            rejected.append((name, f"iam={entry.get('iam')!r} != {iam!r}"))
            continue
        if entry.get("ssp") != ssp:
            rejected.append((name, f"ssp={entry.get('ssp')!r} != {ssp!r}"))
            continue
        if not name or name not in existing:
            rejected.append((name, "name not in bw2data.databases (was DB deleted?)"))
            continue
        try:
            out.append((name, int(entry.get("year"))))
        except (TypeError, ValueError):
            rejected.append((name, f"bad year={entry.get('year')!r}"))
            continue
    out.sort(key=lambda p: p[1])
    log.info("resolve_prospective_dbs: project=%s triple=(%r,%r,%r) → matched %d: %s",
             project, base_db, iam, ssp, len(out), out)
    if rejected:
        log.info("resolve_prospective_dbs: rejected %d: %s", len(rejected), rejected)
    return out
