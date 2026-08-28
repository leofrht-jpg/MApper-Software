# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Project-level use-phase basis.

A project convention, not an archetype property: Battery Circularity's
archetypes are uniformly whole-lifecycle, and the only stages that differ
between the two real projects are Use Phase and Maintenance. Manufacturing and
End of Life are per-unit in both.

The setting is SINGLE-PRODUCT ONLY. The fleet path gets annual semantics
structurally from ``scope``: ``scope="stock"`` means the Use Phase BOM is
applied once per simulation year for every unit alive, so a basis multiplier
there would double-count.
"""
from __future__ import annotations

import json

import pytest

from mapper.core import project_settings_storage as storage
from mapper.models.project_settings import (
    LEGACY_DEFAULT,
    NEW_PROJECT_DEFAULT,
    ProjectSettings,
)


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr("mapper.core.dsm_storage.STORAGE_DIR", tmp_path)
    return tmp_path


# ── Storage placement ───────────────────────────────────────────────────────

def test_settings_live_inside_the_existing_dsm_root(store):
    """Not a sixth storage root.

    All three carry paths are whole-tree copies of ``root/{project}``, so a FILE
    inside an existing root is carried by duplicate / rename / export / import
    and removed by delete with no change to project_storage.py. A new ROOT would
    need a `storage_roots()` entry and an archive label, and an archive from
    this build would be silently dropped by an older one.
    """
    storage.save_settings("Proj", ProjectSettings(use_phase_basis="life_cycle"))
    f = store / "Proj" / "project_settings.json"
    assert f.exists(), f"expected the file inside dsm/Proj, got {list(store.rglob('*'))}"
    assert json.loads(f.read_text())["use_phase_basis"] == "life_cycle"


def test_the_existing_dsm_loader_ignores_the_file(store):
    """`_load_project` skips non-directories, so this cannot break hydration."""
    from mapper.core import dsm_storage

    (store / "Proj").mkdir(parents=True)
    storage.save_settings("Proj", ProjectSettings(use_phase_basis="one_year"))
    systems, *_ = dsm_storage.load_all()
    assert systems == {} or "Proj" not in systems or systems["Proj"] == {}


def test_a_whole_tree_copy_carries_the_file(store):
    """The claim that duplicate/export/import need no change, exercised."""
    from mapper.core import project_storage as ps

    monkey = {"dsm": store}
    storage.save_settings("Src", ProjectSettings(use_phase_basis="life_cycle"))
    original = ps.storage_roots
    try:
        ps.storage_roots = lambda: dict(monkey)  # type: ignore[assignment]
        ps.copy_project_storage("Src", "Dst")
    finally:
        ps.storage_roots = original  # type: ignore[assignment]
    assert storage.load_settings("Dst").use_phase_basis == "life_cycle"


# ── Defaults ────────────────────────────────────────────────────────────────

def test_an_existing_project_defaults_to_one_year(store, monkeypatch):
    """No file = predates the feature = must compute exactly as it did."""
    from mapper.api import project_settings as api

    api.install_project_settings({})
    monkeypatch.setattr(api, "_current_project", lambda: "Legacy")
    assert api.resolve("Legacy").use_phase_basis == "one_year" == LEGACY_DEFAULT


def test_a_new_project_gets_life_cycle_written_explicitly(store):
    from mapper.api import project_settings as api

    api.install_project_settings({})
    s = api.initialise_for_new_project("Fresh")
    assert s.use_phase_basis == "life_cycle" == NEW_PROJECT_DEFAULT
    # Written, not inferred -- the difference between a new and a legacy project
    # is a stored fact.
    assert storage.load_settings("Fresh").use_phase_basis == "life_cycle"


# ── The registry follows the parameters._tables lesson ──────────────────────

def test_the_rehydrate_reloads_and_prunes_project_settings():
    """hydrate_from_disk merges and never prunes, so a per-project registry
    that is not reloaded leaves a duplicated or renamed project's setting
    invisible until restart. Sixth appearance of that class."""
    import inspect

    from mapper.api import databases as db

    assert "install_project_settings" in inspect.getsource(
        db._rehydrate_after_storage_write)
    assert "_project_settings._settings.pop" in inspect.getsource(db._prune_registries)


# ── The setting must NOT reach the fleet path ──────────────────────────────

def test_the_dsm_engine_never_reads_the_project_setting():
    """Same family as the resolution guard.

    The fleet already multiplies by years alive -- scope="stock" applies the
    Use Phase BOM once per simulation year for every unit alive -- so a basis
    multiplier there would double-count. Verified by name across the whole
    engine, not just one function.
    """
    import pathlib

    src = pathlib.Path(
        inspect_file := __import__("mapper.core.dsm_lca_engine", fromlist=["x"]).__file__
    ).read_text(encoding="utf-8")
    assert inspect_file  # silence the walrus lint
    for forbidden in (
        "use_phase_basis", "project_settings", "ProjectSettings",
        "basis_amounts", "life_cycle", "one_year",
    ):
        assert forbidden not in src, (
            f"dsm_lca_engine references {forbidden!r}. The fleet path gets "
            f"annual semantics from `scope`; a basis multiplier there would "
            f"double-count against the per-year cohort counting."
        )


def test_the_guard_would_catch_a_violation():
    """Anti-vacuity: the check is a substring sweep, so prove it can fail."""
    corpus = "amount = stage_amounts[root.name] * settings.use_phase_basis"
    assert "use_phase_basis" in corpus
