# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Global persistence for AESA sharing presets.

Layout: ``STORAGE_DIR/{preset_id}.json``. Each file is the JSON serialization
of a ``SharingPreset``. Presets are global (not per-project) so they can be
reused across case studies.

The built-in read-only preset (``ferhati_2026_multi_d``) is injected at read
time and never persisted to disk. It cannot be updated or deleted — users
must duplicate it to customize.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import platformdirs


STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / "aesa_presets"

_UNSAFE_ID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

BUILTIN_PRESET_IDS: frozenset[str] = frozenset({"ferhati_2026_multi_d"})


def _safe_id(preset_id: str) -> str:
    cleaned = _UNSAFE_ID.sub("_", (preset_id or "").strip())
    if not cleaned:
        raise ValueError("preset_id must be non-empty")
    return cleaned


def _path(preset_id: str) -> Path:
    return STORAGE_DIR / f"{_safe_id(preset_id)}.json"


def is_built_in(preset_id: str) -> bool:
    return preset_id in BUILTIN_PRESET_IDS


def _load_builtins() -> list[dict]:
    """Return built-in presets as dicts, fresh each call."""
    # Imported here to avoid a circular import at module load.
    from mapper.core.aesa_engine import build_default_sharing_preset
    return [build_default_sharing_preset().model_dump()]


def load_all() -> list[dict]:
    """List every preset — built-ins first, then user presets (most recent first)."""
    presets = _load_builtins()
    if STORAGE_DIR.exists():
        user: list[dict] = []
        for p in STORAGE_DIR.glob("*.json"):
            try:
                user.append(json.loads(p.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                continue
        user.sort(key=lambda d: d.get("updated_at") or d.get("created_at") or "", reverse=True)
        presets.extend(user)
    return presets


def load(preset_id: str) -> dict | None:
    if preset_id in BUILTIN_PRESET_IDS:
        for p in _load_builtins():
            if p["id"] == preset_id:
                return p
        return None
    path = _path(preset_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save(preset: dict) -> None:
    pid = preset.get("id")
    if not pid:
        raise ValueError("preset.id is required")
    if pid in BUILTIN_PRESET_IDS:
        raise ValueError(f"Cannot modify built-in preset '{pid}' — duplicate it first.")
    path = _path(pid)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(preset, indent=2), encoding="utf-8")
    tmp.replace(path)


def delete(preset_id: str) -> bool:
    if preset_id in BUILTIN_PRESET_IDS:
        raise ValueError(f"Cannot delete built-in preset '{preset_id}'.")
    path = _path(preset_id)
    if not path.exists():
        return False
    path.unlink()
    return True
