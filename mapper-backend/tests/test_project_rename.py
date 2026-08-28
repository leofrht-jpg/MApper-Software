# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Renaming a project must move the modelling and retire the old name.

Brightway has no rename -- ``bw2data.projects`` offers ``copy_project`` /
``delete_project`` / ``set_current`` and nothing else -- so a rename is
copy-then-delete, which makes it the composition of the two operations
``test_project_copy_roundtrip.py`` already covers. What is new, and what most
of this file is about, is the in-memory half:

``hydrate_from_disk()`` merges with ``.update()`` and never prunes. Every
earlier appearance of that in this codebase was benign because nothing had been
removed. A rename is the first operation that MOVES storage, so the old project
name keeps answering out of the registries until the app restarts -- a rename
that leaves the old project working is worse than one that fails outright.

The load-bearing assertion is therefore the negative one:
``test_hydrate_alone_does_not_retire_the_old_name`` pins that a rehydrate
CANNOT do this on its own, so the prune cannot be deleted as redundant.
"""
from __future__ import annotations

import json

import pytest

from mapper.core import project_storage as ps

OLD = "OldName"
NEW = "NewName"
SYS_ID = "sys-rename"
ARC_IDS = ["arc-r1", "arc-r2"]
CFG_ID = "cfg-rename"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """Five isolated roots, populated for OLD the way a real project is."""
    roots = {k: tmp_path / k for k in ("dsm", "aesa", "parameters", "plca", "mfa")}
    monkeypatch.setattr(ps, "storage_roots", lambda: dict(roots))

    from mapper.models.bom_schemas import Archetype, ValidationReport
    from mapper.models.dsm_schemas import (
        DimensionDef,
        DSMSystemState,
        SystemDefinition,
        TimeHorizon,
    )

    d = roots["dsm"] / OLD
    (d / SYS_ID).mkdir(parents=True)
    system = SystemDefinition(
        id=SYS_ID, name="Fleet",
        dimensions=[DimensionDef(name="fuel", display_name="Fuel", values=["BEV", "ICEV"])],
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
    )
    (d / SYS_ID / "system.json").write_text(system.model_dump_json())
    (d / SYS_ID / "state.json").write_text(DSMSystemState(system_id=SYS_ID).model_dump_json())
    (d / SYS_ID / "cohort_mappings.json").write_text(json.dumps({
        "mfa_system_id": SYS_ID,
        "mappings": [
            {"cohort_key": "BEV|Small", "archetype_id": ARC_IDS[0], "scaling_factor": 1.0},
            {"cohort_key": "ICEV|Small", "archetype_id": ARC_IDS[1], "scaling_factor": 1.3},
        ],
        "row_colors": {"BEV|Small": "#123456"},
    }))
    (d / "archetypes").mkdir()
    for a in ARC_IDS:
        arc = Archetype(id=a, name=f"Arch {a}", bom=[],
                        created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00")
        arc = arc.model_copy(update={"validation_report": ValidationReport(
            total_rows=1, valid_rows=1, error_rows=0, warning_rows=0, project_name=OLD)})
        (d / "archetypes" / f"{a}.json").write_text(arc.model_dump_json())

    (roots["aesa"] / OLD / "sessions").mkdir(parents=True)
    (roots["aesa"] / OLD / f"{CFG_ID}.json").write_text(
        json.dumps({"id": CFG_ID, "name": "cfg", "mfa_system_id": SYS_ID}))
    (roots["aesa"] / OLD / "sessions" / "sess-1.json").write_text(json.dumps({"id": "sess-1"}))
    (roots["parameters"] / OLD / "parameters").mkdir(parents=True)
    (roots["parameters"] / OLD / "parameters" / "table.json").write_text(
        json.dumps({"parameters": {"w_bp": {"name": "w_bp", "base_value": 1.0}}}))
    (roots["plca"] / OLD).mkdir(parents=True)
    (roots["plca"] / OLD / "databases.json").write_text(json.dumps([{"name": "ei-premise-2030"}]))
    (roots["mfa"] / OLD).mkdir(parents=True)
    (roots["mfa"] / OLD / "legacy.json").write_text(json.dumps({"legacy": True}))
    return roots


def _snapshot(roots, project):
    """Everything that must survive the move, by id."""
    d = roots["dsm"] / project
    cm = json.loads((d / SYS_ID / "cohort_mappings.json").read_text())
    return {
        "systems": sorted(p.name for p in d.iterdir() if p.is_dir() and p.name != "archetypes"),
        "archetypes": sorted(p.stem for p in (d / "archetypes").glob("*.json")),
        "cohort_rows": [(m["cohort_key"], m["archetype_id"], m["scaling_factor"])
                        for m in cm["mappings"]],
        "row_colors": cm["row_colors"],
        "aesa_configs": sorted(p.stem for p in (roots["aesa"] / project).glob("*.json")),
        "aesa_sessions": sorted(
            p.stem for p in (roots["aesa"] / project / "sessions").glob("*.json")),
        "params": json.loads(
            (roots["parameters"] / project / "parameters" / "table.json").read_text()),
        "plca": json.loads((roots["plca"] / project / "databases.json").read_text()),
        "mfa": json.loads((roots["mfa"] / project / "legacy.json").read_text()),
    }


def _rename_storage(old: str, new: str, survivors):
    """The storage half of a rename, in the order ``rename_project`` uses."""
    ps.copy_project_storage(old, new)
    ps.delete_project_storage(old, survivors)


# ── Storage moves ───────────────────────────────────────────────────────────

def test_rename_moves_every_root_by_id(store):
    before = _snapshot(store, OLD)

    _rename_storage(OLD, NEW, survivors=[NEW])

    after = _snapshot(store, NEW)
    for key in before:
        assert after[key] == before[key], f"{key} differs after rename"


def test_rename_leaves_nothing_behind_under_the_old_name(store):
    _rename_storage(OLD, NEW, survivors=[NEW])

    for label in ("dsm", "aesa", "parameters", "plca", "mfa"):
        assert not (store[label] / OLD).exists(), (
            f"{label} storage survived under the old name -- a later project "
            f"called {OLD!r} would silently adopt it")
        assert (store[label] / NEW).exists(), f"{label} storage missing under the new name"


def test_rename_keeps_the_cohort_mapping_resolvable(store):
    """Ids verbatim is the point: the mapping references archetype ids."""
    _rename_storage(OLD, NEW, survivors=[NEW])

    d = store["dsm"] / NEW
    cm = json.loads((d / SYS_ID / "cohort_mappings.json").read_text())
    present = {p.stem for p in (d / "archetypes").glob("*.json")}
    referenced = {m["archetype_id"] for m in cm["mappings"]}
    assert referenced == set(ARC_IDS), "archetype ids were re-minted by the rename"
    orphans = referenced - present
    assert not orphans, f"cohort mapping points at missing archetypes: {orphans}"


def test_rename_restamps_the_validation_report_project_name(store):
    _rename_storage(OLD, NEW, survivors=[NEW])

    for a in ARC_IDS:
        payload = json.loads((store["dsm"] / NEW / "archetypes" / f"{a}.json").read_text())
        assert payload["validation_report"]["project_name"] == NEW


# ── Colliding names fail loudly, before anything is written ─────────────────

def test_a_colliding_target_name_fails_before_writing(store):
    """``My/Project`` and ``My_Project`` share one storage directory.

    The copy must refuse rather than write the rename on top of an unrelated
    project's modelling -- and it must refuse having changed nothing.
    """
    before = _snapshot(store, OLD)

    with pytest.raises(ps.ProjectStorageCollision) as e:
        ps.copy_project_storage("My/Project", "My_Project")
    assert "storage directory" in str(e.value)

    assert _snapshot(store, OLD) == before, "a refused rename still touched storage"


def test_rename_refuses_when_the_new_name_already_exists(monkeypatch):
    """Guarded in ``rename_project`` itself, before any copy runs."""
    from mapper.core import bw2_wrapper

    class _P:
        def __init__(self, name): self.name = name

    monkeypatch.setattr(bw2_wrapper, "bw2data",
                        type("M", (), {"projects": [_P("A"), _P("B")]}))
    called = []
    monkeypatch.setattr(bw2_wrapper, "duplicate_project",
                        lambda *a: called.append(a) or "x")

    with pytest.raises(ValueError, match="already exists"):
        bw2_wrapper.rename_project("A", "B")
    with pytest.raises(ValueError, match="does not exist"):
        bw2_wrapper.rename_project("Nope", "C")
    with pytest.raises(ValueError, match="required"):
        bw2_wrapper.rename_project("A", "   ")
    assert not called, "rename copied before validating the target name"


def test_rename_to_the_same_name_is_a_no_op(monkeypatch):
    from mapper.core import bw2_wrapper

    class _P:
        def __init__(self, name): self.name = name

    monkeypatch.setattr(bw2_wrapper, "bw2data",
                        type("M", (), {"projects": [_P("A")]}))
    called = []
    monkeypatch.setattr(bw2_wrapper, "duplicate_project",
                        lambda *a: called.append(a) or "x")

    assert bw2_wrapper.rename_project("A", "A") == "A"
    assert not called, "renaming to the same name copied the project"


# ── The in-memory half: the old name must stop answering ────────────────────

@pytest.fixture()
def registries():
    """The nine project-keyed registries, with OLD and NEW absent."""
    from mapper.api import bom as _bom
    from mapper.api import dsm as _dsm
    from mapper.api import subsystems as _subs

    regs = {
        "bom._archetypes": _bom._archetypes,
        "bom._cohort_mappings": _bom._cohort_mappings,
        "bom._dsm_lca_results": _bom._dsm_lca_results,
        "dsm._systems": _dsm._systems,
        "dsm._states": _dsm._states,
        "dsm._results": _dsm._results,
        "dsm._multi_results": _dsm._multi_results,
        "subsystems._subsystems": _subs._subsystems,
        "subsystems._subsystem_results": _subs._subsystem_results,
    }
    for r in regs.values():
        r.pop(OLD, None)
        r.pop(NEW, None)
    yield regs
    for r in regs.values():
        r.pop(OLD, None)
        r.pop(NEW, None)


def _occupy(regs):
    """Put a marker for OLD in every registry, as a loaded project would."""
    for r in regs.values():
        r[OLD] = {"marker": "live"}


def test_the_old_name_is_gone_from_every_registry_without_a_restart(store, registries,
                                                                   monkeypatch):
    from mapper.api import databases as _db

    monkeypatch.setattr("mapper.core.dsm_storage.STORAGE_DIR", store["dsm"])
    _occupy(registries)
    _rename_storage(OLD, NEW, survivors=[NEW])

    _db._prune_registries(OLD)
    from mapper.api import dsm as _dsm
    _dsm.hydrate_from_disk()

    still = [name for name, r in registries.items() if OLD in r]
    assert not still, (
        f"the renamed-away project still answers out of {still} -- it keeps "
        f"working under its old name until the app restarts")
    assert registries["dsm._systems"].get(NEW), "the new name is not visible"
    assert SYS_ID in registries["dsm._systems"][NEW]
    assert set(ARC_IDS) <= set(registries["bom._archetypes"].get(NEW, {}))


def test_hydrate_alone_does_not_retire_the_old_name(store, registries, monkeypatch):
    """Load-bearing negative: this is why the prune exists.

    If ``hydrate_from_disk`` ever starts pruning, this test fails and the prune
    can be deleted. Until then, deleting it silently reintroduces the defect.
    """
    from mapper.api import dsm as _dsm

    monkeypatch.setattr("mapper.core.dsm_storage.STORAGE_DIR", store["dsm"])
    _occupy(registries)
    _rename_storage(OLD, NEW, survivors=[NEW])

    _dsm.hydrate_from_disk()

    assert OLD in registries["dsm._systems"], (
        "hydrate_from_disk now prunes; the explicit prune may be redundant")


def test_the_rename_route_prunes_and_rehydrates(monkeypatch):
    """Structural, so a later edit cannot quietly drop half of it."""
    import inspect

    from mapper.api import databases as _db

    src = inspect.getsource(_db.post_rename_project)
    assert "_prune_registries(" in src, "rename never retires the old registry key"
    assert "_rehydrate_after_storage_write()" in src, "rename never loads the new key"
    assert src.index("_prune_registries(") < src.index("_rehydrate_after_storage_write()"), (
        "prune must run before the rehydrate, or the rehydrate's merge just "
        "sits alongside the stale entries")

    # Delete has the same shape and the same reason.
    assert "_prune_registries(" in inspect.getsource(_db.delete_project_endpoint)


def test_the_rehydrate_also_reloads_parameter_tables(store, registries, monkeypatch):
    """``hydrate_from_disk`` does not cover ``parameters._tables``.

    ``_table_for`` does ``setdefault(project, ParameterTable())``: it does not
    read the file, it inserts an EMPTY table, and the next write persists that
    over the real one. A copied or renamed project therefore loses its
    parameters unless the rehydrate reloads them too. Asserted through the
    registry rather than by reading the source, because the source mentions
    ``install_parameters`` in prose as well as in code -- a source check passes
    on a version that has dropped the call.
    """
    from mapper.api import databases as _db
    from mapper.api import parameters as _params

    monkeypatch.setattr("mapper.core.dsm_storage.STORAGE_DIR", store["dsm"])
    monkeypatch.setattr("mapper.core.parameter_storage.STORAGE_DIR", store["parameters"])
    _params._tables.clear()
    _params._tables[OLD] = "stale"

    _rename_storage(OLD, NEW, survivors=[NEW])
    _db._rehydrate_after_storage_write()

    assert NEW in _params._tables, (
        "the renamed project's parameter table is invisible; the next "
        "parameter save will overwrite it with an empty table")
    assert OLD not in _params._tables, "the old name still holds a parameter table"


# ── The whole operation, end to end against a stubbed Brightway ─────────────

class _FakeProjects:
    """Enough of ``bw2data.projects`` for a rename. Real bw2 copying needs
    ``bw2setup()`` (~1 min, ~150 MB); what is under test is which files move."""

    def __init__(self, names, current):
        self._names = list(names)
        self.current = current

    def __iter__(self):
        return iter([type("P", (), {"name": n})() for n in self._names])

    def set_current(self, name):
        self.current = name

    def copy_project(self, new_name, switch=True):
        self._names.append(new_name)
        if switch:
            self.current = new_name

    def delete_project(self, name, delete_dir=False):
        self._names.remove(name)


def test_rename_project_moves_the_storage_and_leaves_the_new_name_current(store, monkeypatch):
    """Exercises ``rename_project`` itself, not a re-implementation of it.

    The storage tests above compose the two halves by hand, so they cannot
    catch a ``rename_project`` that copies and then forgets to clean up. This
    one can: it fails if the delete half is dropped.
    """
    from mapper.core import bw2_wrapper

    fake = _FakeProjects([OLD, "Other"], current=OLD)
    monkeypatch.setattr(bw2_wrapper, "bw2data", type("M", (), {"projects": fake}))

    assert bw2_wrapper.rename_project(OLD, NEW) == NEW

    assert sorted(fake._names) == sorted([NEW, "Other"]), "the bw2 project was not renamed"
    assert fake.current == NEW, "the renamed project is not the active one"
    for label in ("dsm", "aesa", "parameters", "plca", "mfa"):
        assert (store[label] / NEW).exists(), f"{label} did not move to the new name"
        assert not (store[label] / OLD).exists(), (
            f"{label} storage was left behind under {OLD!r} -- the rename copied "
            f"but never cleaned up, so the modelling is now duplicated on disk")


def test_a_failed_copy_leaves_the_original_untouched(store, monkeypatch):
    """Copy-before-delete is the reason the order is what it is."""
    from mapper.core import bw2_wrapper

    fake = _FakeProjects([OLD, "Other"], current=OLD)
    monkeypatch.setattr(bw2_wrapper, "bw2data", type("M", (), {"projects": fake}))

    def _boom(*_a):
        raise OSError("disk full")

    monkeypatch.setattr(bw2_wrapper.project_storage, "copy_project_storage", _boom)

    with pytest.raises(OSError):
        bw2_wrapper.rename_project(OLD, NEW)

    assert OLD in fake._names, "the original bw2 project was deleted despite a failed copy"
    assert (store["dsm"] / OLD).exists(), "the original storage was destroyed by a failed rename"
