"""Tests for the parameter-table + scenarios refactor.

Covers:

* ``ParameterTable.resolve`` / ``resolve_all`` — Base vs override semantics,
  unknown-scenario fallback, missing-parameter error.
* ``ParameterEngine`` scenario-aware construction.
* ``parameter_storage._merge_sets_to_table`` — legacy ``ParameterSet`` list →
  single ``ParameterTable`` with diff-based overrides.
* ``parameter_storage.load_all`` round-trip including on-disk migration of
  legacy ``{set_id}.json`` files into ``table.json`` + archived ``legacy/``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mapper.core import parameter_storage
from mapper.core.parameter_engine import ParameterEngine, ParameterError
from mapper.models.parameter_schemas import (
    Parameter,
    ParameterSet,
    ParameterTable,
)


# ── Schema behaviour ────────────────────────────────────────────────────────


def test_resolve_base_and_override():
    p = Parameter(name="x", base_value=10.0, scenario_overrides={"A": 12.0})
    t = ParameterTable(parameters={"x": p}, scenarios=["A", "B"])

    assert t.resolve("x") == 10.0
    assert t.resolve("x", "Base") == 10.0
    assert t.resolve("x", "A") == 12.0
    # "B" has no override entry => inherit Base.
    assert t.resolve("x", "B") == 10.0


def test_resolve_unknown_scenario_falls_back_to_base():
    p = Parameter(name="x", base_value=1.0, scenario_overrides={"A": 9.0})
    t = ParameterTable(parameters={"x": p}, scenarios=["A"])
    assert t.resolve("x", "Nonexistent") == 1.0


def test_resolve_all_returns_scenario_map():
    t = ParameterTable(
        parameters={
            "a": Parameter(name="a", base_value=1.0, scenario_overrides={"S": 2.0}),
            "b": Parameter(name="b", base_value=10.0),  # no overrides
        },
        scenarios=["S"],
    )
    assert t.resolve_all() == {"a": 1.0, "b": 10.0}
    assert t.resolve_all("S") == {"a": 2.0, "b": 10.0}


def test_resolve_unknown_parameter_raises():
    t = ParameterTable()
    with pytest.raises(KeyError):
        t.resolve("missing")


def test_list_scenarios_puts_base_first():
    t = ParameterTable(scenarios=["High", "Low"])
    assert t.list_scenarios() == ["Base", "High", "Low"]


def test_legacy_value_alias():
    """Old ``Parameter(name=..., value=...)`` construction still works and
    ``p.value`` reads back the base_value for legacy consumers."""
    p = Parameter(name="x", value=7.5)
    assert p.base_value == 7.5
    assert p.value == 7.5


# ── Engine integration ─────────────────────────────────────────────────────


def test_engine_accepts_parameter_table_with_scenario():
    t = ParameterTable(
        parameters={"k": Parameter(name="k", base_value=2.0, scenario_overrides={"S": 3.0})},
        scenarios=["S"],
    )
    assert ParameterEngine(t).resolve("k * 10") == 20.0
    assert ParameterEngine(t, scenario="S").resolve("k * 10") == 30.0
    # Unknown scenario => base.
    assert ParameterEngine(t, scenario="Nope").resolve("k * 10") == 20.0


def test_engine_legacy_list_constructor_still_works():
    engine = ParameterEngine([Parameter(name="a", value=5.0)])
    assert engine.resolve("a + 1") == 6.0


def test_engine_undefined_param_reports_error():
    engine = ParameterEngine(ParameterTable(), scenario=None)
    with pytest.raises(ParameterError):
        engine.resolve("not_a_param * 2")


# ── Migration ───────────────────────────────────────────────────────────────


def _mk_set(name: str, params: dict, updated: str) -> ParameterSet:
    return ParameterSet(
        id=name,
        name=name,
        parameters=[Parameter(name=k, value=v) for k, v in params.items()],
        created_at=updated,
        updated_at=updated,
    )


def test_merge_single_set_produces_table_with_no_scenarios():
    sets = [_mk_set("Base", {"x": 1.0, "y": 2.0}, "2026-01-01")]
    t = parameter_storage._merge_sets_to_table(sets)
    assert t.scenarios == []
    assert t.resolve("x") == 1.0
    assert t.resolve("y") == 2.0


def test_merge_multiple_sets_most_recent_is_base_and_diffs_become_overrides():
    older = _mk_set("Optimistic", {"x": 100.0, "y": 2.0}, "2025-01-01")
    newer = _mk_set("Baseline",   {"x": 50.0,  "y": 2.0}, "2026-02-01")
    t = parameter_storage._merge_sets_to_table([older, newer])

    # Newer set → Base.
    assert t.resolve("x") == 50.0
    assert t.resolve("y") == 2.0
    # Only the differing parameter (``x``) should carry an override.
    assert t.scenarios == ["Optimistic"]
    assert t.resolve("x", "Optimistic") == 100.0
    # ``y`` matches Base → no override stored (empty cell inheritance).
    assert "Optimistic" not in t.parameters["y"].scenario_overrides


def test_merge_parameter_only_in_non_base_set_is_added_without_override():
    older = _mk_set("Old",  {"only_old": 42.0}, "2025-01-01")
    newer = _mk_set("New",  {"x": 1.0},          "2026-02-01")
    t = parameter_storage._merge_sets_to_table([older, newer])

    assert t.resolve("x") == 1.0
    assert "only_old" in t.parameters
    # No override for "Old" — the value itself became the base for that row.
    assert t.parameters["only_old"].scenario_overrides == {}


# ── Disk round-trip ─────────────────────────────────────────────────────────


def test_load_all_migrates_legacy_json_files(tmp_path: Path, monkeypatch):
    """Place two legacy {set_id}.json files under a project directory and
    confirm ``load_all`` rewrites them into table.json and archives the old
    ones under legacy/."""
    monkeypatch.setattr(parameter_storage, "STORAGE_DIR", tmp_path)

    proj = tmp_path / "my_project" / "parameters"
    proj.mkdir(parents=True)

    (proj / "s1.json").write_text(json.dumps({
        "id": "s1",
        "name": "Baseline",
        "parameters": [{"name": "x", "value": 10.0}],
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-02-01T00:00:00",
    }))
    (proj / "s2.json").write_text(json.dumps({
        "id": "s2",
        "name": "Optimistic",
        "parameters": [{"name": "x", "value": 20.0}],
        "created_at": "2025-01-01T00:00:00",
        "updated_at": "2025-06-01T00:00:00",
    }))

    result = parameter_storage.load_all()
    assert "my_project" in result
    t = result["my_project"]

    # Baseline (more recent) became Base; Optimistic became a scenario column.
    assert t.resolve("x") == 10.0
    assert "Optimistic" in t.scenarios
    assert t.resolve("x", "Optimistic") == 20.0

    # table.json written, legacy files archived.
    assert (proj / "table.json").exists()
    assert not (proj / "s1.json").exists()
    assert not (proj / "s2.json").exists()
    assert (proj / "legacy" / "s1.json").exists()
    assert (proj / "legacy" / "s2.json").exists()

    # Re-loading is idempotent and returns the same effective values.
    again = parameter_storage.load_all()["my_project"]
    assert again.resolve("x") == 10.0
    assert again.resolve("x", "Optimistic") == 20.0


def test_save_and_load_parameter_table(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(parameter_storage, "STORAGE_DIR", tmp_path)
    t = ParameterTable(
        parameters={"k": Parameter(name="k", base_value=3.14, scenario_overrides={"S": 2.71})},
        scenarios=["S"],
    )
    parameter_storage.save_parameter_table("proj", t)
    loaded = parameter_storage.load_parameter_table("proj")
    assert loaded is not None
    assert loaded.resolve("k") == 3.14
    assert loaded.resolve("k", "S") == 2.71
