# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Unit tests for :mod:`mapper.core.lcia_method_engine`.

The network, pip, and bw2 import calls are all mocked. These tests verify:

  - Ecoinvent version auto-detection from registered database names
  - Registry loads the shipped ``lcia_methods.json`` and includes IW+/LC-IMPACT
  - ``install_bw2package`` downloads, imports, and records the new tuples
  - Variant selection honors both auto-detected and caller-provided versions
  - ``install_pip`` shells out to pip and invokes the entry function
  - Excel path enforces the strict ``≥ 5 % unmatched → fail`` policy
  - Uninstall removes the registered tuples and clears the manifest's list
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from mapper.core import lcia_method_engine as lme


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def tmp_cache_root(monkeypatch, tmp_path: Path) -> Path:
    """Redirect CACHE_ROOT into a pytest tmp dir so tests don't bleed state."""
    monkeypatch.setattr(lme, "CACHE_ROOT", tmp_path)
    return tmp_path


class _FakeMethods(dict):
    """dict-like stand-in for ``bw2data.methods``. Supports iteration + del."""

    def __iter__(self):
        return iter(list(self.keys()))


@pytest.fixture
def fake_bw(monkeypatch):
    """Swap out bw2data.databases + methods with in-memory stand-ins."""
    databases: dict[str, dict] = {}
    methods = _FakeMethods()
    monkeypatch.setattr(lme.bw2data, "databases", databases)
    monkeypatch.setattr(lme.bw2data, "methods", methods)
    return databases, methods


# ── Ecoinvent version detection ──────────────────────────────────────────────


@pytest.mark.parametrize("db_names,expected", [
    (["ecoinvent-3.10-cutoff"], "3.10"),
    (["ecoinvent_3_11_apos"], "3.11"),
    (["ecoinvent 3.12 cutoff", "biosphere3"], "3.12"),
    (["biosphere3"], None),                                    # no ecoinvent DB
    (["ecoinvent-3.10-cutoff", "ecoinvent-3.11-cutoff"], None),  # ambiguous
])
def test_detect_ei_version(fake_bw, db_names, expected):
    databases, _ = fake_bw
    for n in db_names:
        databases[n] = {}
    assert lme.detect_ecoinvent_version() == expected


def test_detect_ignores_premise_variants(fake_bw):
    databases, _ = fake_bw
    # Premise DB names embed the base ecoinvent name — they should not confuse
    # the detector into reporting ambiguity.
    databases["ecoinvent-3.10-cutoff"] = {}
    databases["ecoinvent-3.10-cutoff_premise_remind_ssp2_2030"] = {}
    assert lme.detect_ecoinvent_version() == "3.10"


# ── Registry shape ───────────────────────────────────────────────────────────


def test_registry_includes_iwplus_and_lcimpact():
    ids = {e["id"] for e in lme._load_registry()}
    assert "impact_world_plus_2_2_1" in ids
    assert "lc_impact" in ids


def test_iwplus_registry_entry_has_per_ei_variants():
    entry = lme._registry_entry("impact_world_plus_2_2_1")
    assert entry is not None
    variants = entry.get("variants") or {}
    assert {"3.10", "3.11", "3.12"}.issubset(variants.keys())
    for v in variants.values():
        assert v["url"].startswith("https://zenodo.org/")
        assert v["filename"].endswith(".bw2package")


def test_lcimpact_registry_has_pip_fields():
    entry = lme._registry_entry("lc_impact")
    assert entry is not None
    assert entry["installer"] == "pip"
    assert entry["pip_spec"]
    assert entry["pip_entry_module"] == "bw2_lcimpact"
    assert entry["pip_entry_function"] == "import_global_lcimpact"


# ── BW2Package installer ─────────────────────────────────────────────────────


def _register_new_methods(fake_methods: _FakeMethods, tuples: list[tuple]) -> None:
    for t in tuples:
        fake_methods[t] = {"unit": "kg CO2-eq"}


def test_bw2package_install_downloads_and_records_tuples(
    tmp_cache_root, fake_bw, monkeypatch,
):
    _, methods = fake_bw
    # Fake download: just touch the target file.
    def fake_download(url, dest, on_progress=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"fake bw2package contents")
    monkeypatch.setattr(lme, "_download_file", fake_download)

    # Fake BW2Package.import_file: register two new method tuples.
    fake_pkg = MagicMock()
    def fake_import_file(path):
        _register_new_methods(methods, [
            ("IMPACT World+ 2.2.1", "Climate change", "short-term"),
            ("IMPACT World+ 2.2.1", "Acidification", "midpoint"),
        ])
    fake_pkg.import_file = fake_import_file
    monkeypatch.setattr("bw2io.BW2Package", fake_pkg)

    entry = lme._registry_entry("impact_world_plus_2_2_1")
    progress_calls: list[tuple[str, float]] = []
    result = lme.install_bw2package(
        entry, ecoinvent_version="3.10",
        on_progress=lambda s, p: progress_calls.append((s, p)),
    )

    assert result.method_id == "impact_world_plus_2_2_1"
    assert len(result.method_tuples) == 2
    assert ("IMPACT World+ 2.2.1", "Climate change", "short-term") in result.method_tuples
    # Progress reached 100%.
    assert progress_calls[-1][1] == pytest.approx(1.0)
    # Manifest written.
    manifest_path = tmp_cache_root / "impact_world_plus_2_2_1" / "manifest.json"
    assert manifest_path.is_file()
    data = json.loads(manifest_path.read_text())
    assert data["installer"] == "bw2package"
    assert data["ecoinvent_version"] == "3.10"
    assert len(data["method_tuples"]) == 2


def test_bw2package_install_requires_known_ei_version(tmp_cache_root, fake_bw):
    entry = lme._registry_entry("impact_world_plus_2_2_1")
    with pytest.raises(lme.InstallError, match="ecoinvent"):
        lme.install_bw2package(entry, ecoinvent_version="9.99")


def test_bw2package_install_without_version_when_ambiguous(
    tmp_cache_root, fake_bw,
):
    databases, _ = fake_bw
    databases["ecoinvent-3.10-cutoff"] = {}
    databases["ecoinvent-3.11-cutoff"] = {}
    entry = lme._registry_entry("impact_world_plus_2_2_1")
    with pytest.raises(lme.InstallError, match="auto-detect"):
        lme.install_bw2package(entry)


def test_bw2package_install_reuses_cached_file(
    tmp_cache_root, fake_bw, monkeypatch,
):
    """Once downloaded, re-install must not hit the network again."""
    _, methods = fake_bw
    entry = lme._registry_entry("impact_world_plus_2_2_1")
    variant = entry["variants"]["3.10"]
    cached = tmp_cache_root / entry["id"] / variant["filename"]
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(b"already here")

    calls = {"download": 0}
    def fake_download(url, dest, on_progress=None):
        calls["download"] += 1
    monkeypatch.setattr(lme, "_download_file", fake_download)

    fake_pkg = MagicMock()
    def fake_import_file(path):
        _register_new_methods(methods, [("IW+", "cat", "ind")])
    fake_pkg.import_file = fake_import_file
    monkeypatch.setattr("bw2io.BW2Package", fake_pkg)

    lme.install_bw2package(entry, ecoinvent_version="3.10")
    assert calls["download"] == 0  # did not re-download


# ── pip installer ────────────────────────────────────────────────────────────


def test_pip_install_invokes_pip_then_entry_function(
    tmp_cache_root, fake_bw, monkeypatch,
):
    _, methods = fake_bw

    # Fake subprocess.run: success.
    proc = MagicMock(returncode=0, stdout="", stderr="")
    run_calls: list[list[str]] = []
    def fake_run(cmd, *a, **kw):
        run_calls.append(cmd)
        return proc
    monkeypatch.setattr(lme.subprocess, "run", fake_run)

    # Fake the lcimpact entry function: registers 3 tuples.
    fake_mod = MagicMock()
    def fake_import_global_lcimpact(biosphere):
        _register_new_methods(methods, [
            ("LC-IMPACT", "Climate change", "Short-term"),
            ("LC-IMPACT", "Land use", "Occupation"),
            ("LC-IMPACT", "Water", "Human Health"),
        ])
    fake_mod.import_global_lcimpact = fake_import_global_lcimpact
    monkeypatch.setattr(lme, "logger", MagicMock())
    import importlib as _il
    monkeypatch.setattr(_il, "import_module", lambda name: fake_mod)

    entry = lme._registry_entry("lc_impact")
    result = lme.install_pip(entry)
    assert len(result.method_tuples) == 3
    # pip command was dispatched with the right spec.
    assert run_calls and "bw2_lcimpact==0.4.2" in run_calls[0]


def test_pip_install_raises_on_pip_failure(tmp_cache_root, fake_bw, monkeypatch):
    proc = MagicMock(returncode=1, stdout="", stderr="No matching distribution")
    monkeypatch.setattr(lme.subprocess, "run", lambda *a, **kw: proc)
    entry = lme._registry_entry("lc_impact")
    with pytest.raises(lme.InstallError, match="pip install failed"):
        lme.install_pip(entry)


# ── Custom xlsx installer ────────────────────────────────────────────────────


class _FakeExcelImporter:
    """Controllable stand-in for ``bw2io.ExcelLCIAImporter``."""

    def __init__(self, filepath, name, description, unit):
        self.filepath = filepath
        self.name = name
        self.description = description
        self.unit = unit
        self.applied = False
        self.matched = False
        self.written = False
        # Overridable per test.
        self._stats = (1, 10, 0)    # num_ds, num_exchanges, num_unlinked
        self._write_tuples = [("MyLab", "climate", "gwp100")]

    def apply_strategies(self):
        self.applied = True

    def match_database(self, db, fields=None):
        self.matched = True

    def statistics(self, print_stats=False):
        return self._stats

    def write_methods(self):
        self.written = True


@pytest.fixture
def fake_importer_cls(monkeypatch):
    cls = MagicMock(wraps=_FakeExcelImporter)
    # Emulate the importlib chain used in install_excel — patching the
    # ``ExcelLCIAImporter`` attribute on the submodule.
    module = MagicMock()
    module.ExcelLCIAImporter = _FakeExcelImporter
    monkeypatch.setitem(
        __import__("sys").modules,
        "bw2io.importers.excel_lcia",
        module,
    )
    return _FakeExcelImporter


def test_excel_install_succeeds_with_zero_unmatched(
    tmp_path, tmp_cache_root, fake_bw, fake_importer_cls, monkeypatch,
):
    _, methods = fake_bw

    # Route write_methods() through a patched instance so we can register tuples.
    original_write = _FakeExcelImporter.write_methods
    def patched_write(self):
        _register_new_methods(methods, self._write_tuples)
        original_write(self)
    monkeypatch.setattr(_FakeExcelImporter, "write_methods", patched_write)

    xlsx = tmp_path / "method.xlsx"
    xlsx.write_bytes(b"fake")
    result = lme.install_excel(
        file_path=xlsx,
        method_name_tuple=("MyLab", "climate", "gwp100"),
        description="Custom test method",
        unit="kg CO2-eq",
    )
    assert result.method_tuples == [("MyLab", "climate", "gwp100")]
    assert result.warnings == []


def test_excel_install_refuses_above_5_percent_unmatched(
    tmp_path, tmp_cache_root, fake_bw, fake_importer_cls, monkeypatch,
):
    # 20 of 100 exchanges unmatched → > threshold.
    def bad_stats(self, print_stats=False):
        return (1, 100, 20)
    monkeypatch.setattr(_FakeExcelImporter, "statistics", bad_stats)

    xlsx = tmp_path / "bad.xlsx"
    xlsx.write_bytes(b"fake")
    with pytest.raises(lme.InstallError, match="20 of 100"):
        lme.install_excel(
            file_path=xlsx,
            method_name_tuple=("MyLab", "climate"),
            description="",
            unit="kg CO2-eq",
        )


def test_excel_install_warns_below_threshold(
    tmp_path, tmp_cache_root, fake_bw, fake_importer_cls, monkeypatch,
):
    def mild_stats(self, print_stats=False):
        return (1, 100, 2)
    monkeypatch.setattr(_FakeExcelImporter, "statistics", mild_stats)

    def patched_write(self):
        _register_new_methods(fake_bw[1], [("MyLab", "water")])
    monkeypatch.setattr(_FakeExcelImporter, "write_methods", patched_write)

    xlsx = tmp_path / "mild.xlsx"
    xlsx.write_bytes(b"fake")
    result = lme.install_excel(
        file_path=xlsx,
        method_name_tuple=("MyLab", "water"),
        description="",
        unit="m3",
    )
    assert result.method_tuples == [("MyLab", "water")]
    assert len(result.warnings) == 1
    assert "2 of 100" in result.warnings[0]


# ── Uninstall ────────────────────────────────────────────────────────────────


def test_uninstall_removes_registered_tuples(tmp_cache_root, fake_bw):
    _, methods = fake_bw
    _register_new_methods(methods, [
        ("IMPACT World+", "Climate", "short"),
        ("IMPACT World+", "Climate", "long"),
    ])
    # Simulate a prior install manifest.
    lme._write_manifest("impact_world_plus_2_2_1", {
        "method_id": "impact_world_plus_2_2_1",
        "installer": "bw2package",
        "method_tuples": [
            ["IMPACT World+", "Climate", "short"],
            ["IMPACT World+", "Climate", "long"],
        ],
    })
    assert lme.is_installed("impact_world_plus_2_2_1")

    removed = lme.uninstall("impact_world_plus_2_2_1")
    assert removed == 2
    assert not lme.is_installed("impact_world_plus_2_2_1")


# ── list_library ─────────────────────────────────────────────────────────────


def test_list_library_groups_bundled_separately(tmp_cache_root, fake_bw):
    _, methods = fake_bw
    # Three bundled tuples from an ecoinvent-installed method family.
    _register_new_methods(methods, [
        ("EF v3.1", "Climate change", "global warming potential (GWP100)"),
        ("EF v3.1", "Acidification", "accumulated exceedance"),
        ("ReCiPe 2016", "Climate change", "GWP100"),
    ])
    items = lme.list_library()
    # At minimum: two bundled families + the two downloadable entries.
    by_source: dict[str, list[str]] = {}
    for it in items:
        by_source.setdefault(it["source"], []).append(it["name"])
    assert "EF v3.1" in by_source.get("bundled", [])
    assert "ReCiPe 2016" in by_source.get("bundled", [])
    downloadable_names = set(by_source.get("downloadable", []))
    assert "IMPACT World+ 2.2.1" in downloadable_names
    assert "LC-IMPACT" in downloadable_names
