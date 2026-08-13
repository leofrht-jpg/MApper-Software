# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A saved configuration must follow the current defaults, not the ones that
happened to ship on the day it was created.

Configurations used to be written with a frozen copy of the built-in sharing
preset and of the auto-suggested method mapping. Neither is a user decision.
The consequence was that a methodology fix could not reach an existing
configuration: after ``acidification`` moved EpC -> AGR, and after the Patch 4W
exact-match mapping took the mapped-boundary count from 15 to 16, opening a
configuration saved before either still computed the old way — beside a fresh
one that computed the new way, with nothing on screen to explain the
disagreement.

Reproducibility is not lost by clearing them: ``AESASession.configuration_snapshot``
is the authoritative immutable record for compute, and it freezes at compute
time one level up.
"""
from __future__ import annotations

import json

import pytest

from mapper.core import aesa_storage
from mapper.core.aesa_engine import (
    build_default_sharing_preset,
    load_boundary_sets,
    resolve_sharing,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import AESAConfiguration, MultiDConfig, SharingPrincipleConfig


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(aesa_storage, "STORAGE_DIR", tmp_path)
    return tmp_path


def _stale_config() -> dict:
    """A configuration in the shape that shipped before the migration: a full
    sharing snapshot, the legacy multi_d block, and a short mapping."""
    stale = build_default_sharing_preset()
    # Pin acidification to the OLD principle, which is the drift that shipped.
    stale = stale.model_copy(update={"category_assignments": [
        a.model_copy(update={"principle_id": "EpC"}) if a.pb_id == "acidification" else a
        for a in stale.category_assignments]})
    return AESAConfiguration(
        id="cfg-1", name="PB-EF - 1,5C 50th - 250 Gt", mfa_system_id="sys",
        sharing=stale,
        multi_d=MultiDConfig(
            layer1={"acidification": SharingPrincipleConfig(
                principle="EpC", justification="legacy", system_value=1.0, global_value=2.0)},
            layer2_sector_share=0.15, layer2_source="legacy"),
        method_mapping=[],
        created_at="2025-01-01T00:00:00Z",
    ).model_dump() | {"derived_defaults_migrated": False}


def test_a_stale_config_follows_current_defaults_after_load(store):
    raw = _stale_config()
    # Fifteen of the sixteen boundaries, the pre-Patch-4W count.
    bset = load_boundary_sets()["Sala2020_EF"]
    ids = sorted(bset.boundaries)[:15]
    raw["method_mapping"] = [{"method_tuple": ["EF v3.1", i, "x"], "pb_id": i,
                              "conversion_factor": 1.0} for i in ids]
    aesa_storage.save("proj", raw)

    loaded = AESAConfiguration(**aesa_storage.load("proj", "cfg-1"))

    assert loaded.sharing is None, "the frozen sharing snapshot survived"
    assert loaded.multi_d is None, (
        "multi_d survived — resolve_sharing prefers migrating it over falling "
        "through to the defaults, so it would resurrect the old chain")
    assert loaded.method_mapping == []
    assert loaded.derived_defaults_migrated is True


def test_the_acceptance_case_acidification_and_full_coverage(store):
    """The user-visible assertion: AGR on acidification, 16 of 16 mapped, with
    no Re-suggest click and no re-seeding."""
    aesa_storage.save("proj", _stale_config())
    loaded = AESAConfiguration(**aesa_storage.load("proj", "cfg-1"))

    preset = resolve_sharing(loaded)
    acid = next(a.principle_id for a in preset.category_assignments
                if a.pb_id == "acidification")
    assert acid == "AGR"

    bset = load_boundary_sets()["Sala2020_EF"]
    methods = [["EF v3.1", b.ef_indicator, "x"]
               for b in bset.boundaries.values() if b.ef_indicator]
    mapping = loaded.method_mapping or suggest_method_mapping(methods, bset)
    assert len({m.pb_id for m in mapping}) == len(bset.boundaries) == 16


def test_a_choice_is_not_cleared_only_a_derivation(store):
    """The carbon budget is a methodological CHOICE (which target, which
    percentile). Silently moving someone's 1.5 C budget would be a worse bug
    than the one being fixed, so it is preserved verbatim."""
    raw = _stale_config()
    from mapper.core.aesa_engine import build_carbon_budget
    # The value that actually shipped in the user's config: the pre-X1+ 250 Gt
    # figure, superseded by 300. It must come back unchanged.
    budget = build_carbon_budget(budget_option_id="IPCC_AR6_1p5C_50").model_copy(
        update={"initial_budget_gt": 250.0})
    raw["carbon_budget"] = json.loads(budget.model_dump_json())
    aesa_storage.save("proj", raw)

    loaded = AESAConfiguration(**aesa_storage.load("proj", "cfg-1"))
    assert loaded.carbon_budget is not None
    assert loaded.carbon_budget.initial_budget_gt == 250.0
    assert loaded.carbon_budget.budget_source == budget.budget_source


def test_the_migration_runs_once_and_does_not_wipe_a_later_customisation(store):
    """Without the flag, a genuine edit saved after the migration would be
    cleared again on the very next load."""
    aesa_storage.save("proj", _stale_config())
    aesa_storage.load("proj", "cfg-1")                       # migrates

    custom = build_default_sharing_preset().model_copy(update={"name": "MY CHAIN"})
    after = AESAConfiguration(**aesa_storage.load("proj", "cfg-1")).model_copy(
        update={"sharing": custom, "method_mapping": []})
    aesa_storage.save("proj", json.loads(after.model_dump_json()))

    again = AESAConfiguration(**aesa_storage.load("proj", "cfg-1"))
    assert again.sharing is not None and again.sharing.name == "MY CHAIN"


def test_it_is_persisted_so_the_next_process_does_not_redo_it(store):
    aesa_storage.save("proj", _stale_config())
    aesa_storage.load("proj", "cfg-1")
    on_disk = json.loads((store / "proj" / "cfg-1.json").read_text(encoding="utf-8"))
    assert on_disk["derived_defaults_migrated"] is True
    assert on_disk["sharing"] is None


def test_load_all_migrates_too(store):
    aesa_storage.save("proj", _stale_config())
    [loaded] = aesa_storage.load_all("proj")
    assert loaded["sharing"] is None and loaded["derived_defaults_migrated"] is True


def test_a_fresh_config_is_saved_without_derived_copies():
    """The class fix: nothing eagerly persists a copy it never diverged from.
    The frontend gates this (AESAConfigDraft.sharingCustomized); the model just
    has to accept the absent shape."""
    cfg = AESAConfiguration(id="x", name="fresh", mfa_system_id="sys",
                            created_at="2025-01-01T00:00:00Z")
    assert cfg.sharing is None and cfg.method_mapping == []
    preset = resolve_sharing(cfg)
    assert preset.id == build_default_sharing_preset().id
