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


def _migrate_derived_defaults(project: str, raw: dict) -> dict:
    """One-time: drop the DERIVED copies so the config follows current defaults.

    A configuration used to be written with a full snapshot of the built-in
    sharing preset and of the auto-suggested method mapping. Neither is a user
    decision -- both are derived from the shipped defaults -- but freezing them
    meant a later methodology fix could not reach an existing configuration.
    Opening one saved before ``acidification`` moved from EpC to AGR still
    computed EpC, beside a fresh configuration that computed AGR, with nothing
    on screen to say why the two disagreed.

    Cleared here rather than refreshed, because "absent" already means "resolve
    from the current defaults" everywhere downstream:

    * ``sharing`` -> ``resolve_sharing`` falls through to
      ``build_default_sharing_preset()``;
    * ``multi_d`` -> cleared TOO. It is the legacy 2-layer shape, and
      ``resolve_sharing`` prefers migrating it over falling through to the
      defaults, so leaving it would resurrect the old chain instead;
    * ``method_mapping`` -> ``AESAEngine.compute`` auto-suggests when it is
      empty, and the sidebar's auto-suggest effect fires on an empty mapping,
      so the table fills in with no Re-suggest click.

    NOT cleared: ``carbon_budget``. A budget option is a methodological CHOICE
    (which temperature target, which percentile), not a derived default, and
    silently moving someone's 1.5 C budget would be a different and worse bug
    than the one being fixed. A configuration carrying a superseded budget
    value keeps it, visibly.

    Runs once per configuration and records that it ran. Without the flag a
    later genuine customisation would be wiped on the next load.
    """
    if raw.get("derived_defaults_migrated"):
        return raw
    raw["sharing"] = None
    raw["multi_d"] = None
    raw["method_mapping"] = []
    raw["derived_defaults_migrated"] = True
    try:
        save(project, raw)
    except (OSError, ValueError):
        # A read-only or half-written store must not break loading. The flag
        # is in the returned dict either way, so this session behaves
        # correctly; the migration simply retries next time.
        pass
    return raw


def load_all(project: str) -> list[dict]:
    d = _project_dir(project)
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append(_migrate_derived_defaults(
                project, json.loads(p.read_text(encoding="utf-8"))))
        except (json.JSONDecodeError, OSError):
            continue
    return out


def load(project: str, config_id: str) -> dict | None:
    path = _config_path(project, config_id)
    if not path.exists():
        return None
    try:
        return _migrate_derived_defaults(
            project, json.loads(path.read_text(encoding="utf-8")))
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
