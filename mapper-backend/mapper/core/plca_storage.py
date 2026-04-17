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
