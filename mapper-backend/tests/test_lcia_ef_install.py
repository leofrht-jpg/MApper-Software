# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""One-click EF v3.1 install from the factors shipped inside bw2io.

A project imported from ecoinvent has no LCIA methods (they come only from
``bw2setup()``, which MApper runs for the demo project). The installer takes the
one family out of bw2io's bundled data and links it to the project's biosphere3.

Two kinds of test: a small synthetic family (patched ``load_family``) for the
linking rules, and the real bundled data against a synthetic biosphere3 built
from its own flows for the facts about EF v3.1 itself. Everything runs in a
throwaway Brightway directory; the Method Library cache is redirected.
"""
from __future__ import annotations

import gc
import json
import shutil
import uuid

import bw2data
import pytest
from fastapi.testclient import TestClient

from mapper.core import lcia_ef_install as ef
from mapper.core import lcia_method_engine as lme
from mapper.core.lcia_method_engine import InstallError

BIO = "biosphere3"
FAMILY = "EF v3.1"

EF_25 = [
    ("acidification", "accumulated exceedance (AE)"),
    ("climate change", "global warming potential (GWP100)"),
    ("climate change: biogenic", "global warming potential (GWP100)"),
    ("climate change: fossil", "global warming potential (GWP100)"),
    ("climate change: land use and land use change", "global warming potential (GWP100)"),
    ("ecotoxicity: freshwater", "comparative toxic unit for ecosystems (CTUe)"),
    ("ecotoxicity: freshwater, inorganics", "comparative toxic unit for ecosystems (CTUe)"),
    ("ecotoxicity: freshwater, organics", "comparative toxic unit for ecosystems (CTUe)"),
    ("energy resources: non-renewable", "abiotic depletion potential (ADP): fossil fuels"),
    ("eutrophication: freshwater", "fraction of nutrients reaching freshwater end compartment (P)"),
    ("eutrophication: marine", "fraction of nutrients reaching marine end compartment (N)"),
    ("eutrophication: terrestrial", "accumulated exceedance (AE)"),
    ("human toxicity: carcinogenic", "comparative toxic unit for human (CTUh)"),
    ("human toxicity: carcinogenic, inorganics", "comparative toxic unit for human (CTUh)"),
    ("human toxicity: carcinogenic, organics", "comparative toxic unit for human (CTUh)"),
    ("human toxicity: non-carcinogenic", "comparative toxic unit for human (CTUh)"),
    ("human toxicity: non-carcinogenic, inorganics", "comparative toxic unit for human (CTUh)"),
    ("human toxicity: non-carcinogenic, organics", "comparative toxic unit for human (CTUh)"),
    ("ionising radiation: human health", "human exposure efficiency relative to u235"),
    ("land use", "soil quality index"),
    ("material resources: metals/minerals", "abiotic depletion potential (ADP): elements (ultimate reserves)"),
    ("ozone depletion", "ozone depletion potential (ODP)"),
    ("particulate matter formation", "impact on human health"),
    ("photochemical oxidant formation: human health", "tropospheric ozone concentration increase"),
    ("water use", "user deprivation potential (deprivation-weighted water consumption)"),
]


@pytest.fixture()
def project(monkeypatch, tmp_path):
    """Throwaway Brightway directory + redirected Method Library cache."""
    monkeypatch.setattr(lme, "CACHE_ROOT", tmp_path / "lcia_cache")
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-ef-{uuid.uuid4().hex[:8]}")
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


def _biosphere(flows: dict) -> None:
    """flows: code -> (name, categories)."""
    bw2data.Database(BIO).write({
        (BIO, code): {"name": n, "unit": "kilogram", "type": "emission", "categories": tuple(c)}
        for code, (n, c) in flows.items()
    })


def _rows(db_name):
    from bw2data.backends.peewee import ActivityDataset
    return {
        (r.database, r.code): (r.name, json.dumps(r.data, sort_keys=True, default=str))
        for r in ActivityDataset.select().where(ActivityDataset.database == db_name)
    }


# ── a small synthetic family: the linking rules ─────────────────────────────


def _cf(name, cats, amount, code):
    return {"name": name, "categories": cats, "amount": amount, "type": "biosphere", "input": ["biosphere3", code]}


@pytest.fixture()
def small_family(monkeypatch):
    """Two EF methods. Flows: co2 and ch4 (by code), nh3 (project renumbered it:
    only name+categories match), and four the project lacks."""
    methods = [
        {"name": [FAMILY, "climate change", "gwp"], "unit": "kg CO2-Eq", "description": "d", "filename": "f",
         "exchanges": [
             _cf("Carbon dioxide, fossil", ["air"], 1.0, "u-co2"),
             _cf("Methane, fossil", ["air", "urban air close to ground"], 29.8, "u-ch4"),
             _cf("Ammonia", ["air", "unspecified"], 0.1, "u-old-nh3"),
             _cf("Halon-1301", ["air", "lower stratosphere + upper troposphere"], 6290.0, "u-halon"),
             _cf("Halon-1301", ["air"], 6290.0, "u-halon2"),
         ]},
        {"name": [FAMILY, "acidification", "ae"], "unit": "mol H+-Eq", "description": "", "filename": "f",
         "exchanges": [
             _cf("Ammonia", ["air", "unspecified"], 3.02, "u-old-nh3"),
             _cf("Chloroform", ["air", "lower stratosphere + upper troposphere"], 1.0, "u-chcl3"),
             _cf("Chloroform", ["air", "lower stratosphere + upper troposphere"], 1.0, "u-chcl3-b"),
         ]},
    ]
    monkeypatch.setattr(ef, "load_families", lambda families: methods)
    monkeypatch.setattr(ef, "_CACHE", {})
    return methods


@pytest.fixture()
def small_project(project, small_family):
    _biosphere({
        "u-co2": ("Carbon dioxide, fossil", ("air",)),
        "u-ch4": ("Methane, fossil", ("air", "urban air close to ground")),
        "u-nh3-new": ("Ammonia", ("air",)),        # same name+categories as the CF's, other uuid
        "u-other": ("Something else", ("water",)),
    })
    return project


def _cfs(method):
    return {k: v for k, v in bw2data.Method(method).load()}


def test_factors_link_by_code_then_by_name(small_project):
    tuples, _, report = ef.install_family(FAMILY)

    assert sorted(tuples) == [(FAMILY, "acidification", "ae"), (FAMILY, "climate change", "gwp")]
    assert _cfs((FAMILY, "climate change", "gwp")) == {
        (BIO, "u-co2"): 1.0, (BIO, "u-ch4"): 29.8, (BIO, "u-nh3-new"): 0.1}
    assert _cfs((FAMILY, "acidification", "ae")) == {(BIO, "u-nh3-new"): 3.02}
    assert (report["cfs_found"], report["cfs_linked"], report["cfs_linked_by_code"], report["cfs_linked_by_name"]) \
        == (8, 4, 2, 2)


def test_counts_found_linked_and_skipped_are_exact(small_project):
    _, _, r = ef.install_family(FAMILY)
    # 8 factors: co2, ch4 by code; nh3 twice by name; 4 skipped (2 halon, 2 chloroform)
    assert r["cfs_found"] == 8
    assert r["cfs_linked_by_code"] == 2 and r["cfs_linked_by_name"] == 2 and r["cfs_linked"] == 4
    assert r["cfs_skipped"] == 4 == r["cfs_found"] - r["cfs_linked"]
    assert r["skipped_flows"] == 3
    assert r["methods_registered"] == 2 and r["methods_already_present"] == 0


def test_skipped_flows_are_listed_most_frequent_first_and_warned(small_project):
    _, warnings, r = ef.install_family(FAMILY)

    assert [t["name"] for t in r["top_skipped"]] == ["Chloroform", "Halon-1301", "Halon-1301"]
    assert r["top_skipped"][0] == {"name": "Chloroform", "categories": ["air", "lower stratosphere + upper troposphere"], "cfs": 2}
    assert warnings[0].startswith("4 of 8 characterisation factors (50.0%) were skipped")
    assert "most frequent skipped flows" in warnings[0]
    assert any("Chloroform [air / lower stratosphere + upper troposphere]: 2 factors" in w for w in warnings)


def test_the_warning_lists_at_most_ten_flows(project, monkeypatch):
    exchanges = [_cf(f"Flow {i}", ["air"], 1.0, f"u{i}") for i in range(15)] + [_cf("Known", ["air"], 1.0, "k")]
    monkeypatch.setattr(ef, "load_families", lambda f: [{"name": [FAMILY, "x", "y"], "unit": "u", "exchanges": exchanges}])
    monkeypatch.setattr(ef, "_CACHE", {})
    _biosphere({"k": ("Known", ("air",))})
    _, warnings, r = ef.install_family(FAMILY)
    assert r["cfs_skipped"] == 15 and r["skipped_flows"] == 15 and len(r["top_skipped"]) == 10
    # summary + the 10 flows, then the one method that lost nearly all its factors
    assert len(warnings) == 1 + 10 + 1 + 1 and "Indicators that lost at least" in warnings[11]


def test_biosphere3_is_unchanged(small_project):
    before = _rows(BIO)
    ef.install_family(FAMILY)
    assert _rows(BIO) == before and len(before) == 4


def test_nothing_is_installed_without_a_biosphere(project, small_family):
    with pytest.raises(ef.EFInstallError, match="no 'biosphere3'"):
        ef.install_family(FAMILY)
    assert not list(bw2data.methods)


def test_nothing_is_installed_when_no_factor_links(project, small_family):
    _biosphere({"z": ("Unrelated", ("water",))})
    with pytest.raises(ef.EFInstallError, match="None of the 8"):
        ef.install_family(FAMILY)
    assert not list(bw2data.methods)


def test_a_method_already_in_the_project_is_left_exactly_as_it_is(small_project):
    existing = (FAMILY, "acidification", "ae")
    bw2data.Method(existing).register(unit="mol H+-Eq", description="mine")
    bw2data.Method(existing).write([((BIO, "u-other"), 99.0)])

    tuples, warnings, r = ef.install_family(FAMILY)

    assert tuples == [(FAMILY, "climate change", "gwp")]
    assert _cfs(existing) == {(BIO, "u-other"): 99.0}
    assert bw2data.methods[existing]["description"] == "mine"
    assert r["methods_registered"] == 1 and r["methods_already_present"] == 1
    assert "1 of the 2 methods were already in this project" in warnings[0]


def test_a_failure_part_way_unregisters_what_it_registered(small_project, monkeypatch):
    real_write = bw2data.Method.write
    calls = {"n": 0}

    def flaky(self, data, process=True):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("disk full")
        return real_write(self, data, process=process)

    monkeypatch.setattr(bw2data.Method, "write", flaky)
    with pytest.raises(RuntimeError, match="disk full"):
        ef.install_family(FAMILY)
    assert not [t for t in bw2data.methods if t[0] == FAMILY]


def test_a_cancel_part_way_unregisters_what_it_registered(small_project):
    seen = []

    def cancel_on_second_method(stage, pct):
        seen.append(stage)
        if stage.startswith("writing") and len([s for s in seen if s.startswith("writing")]) == 2:
            raise KeyboardInterrupt("cancel")

    with pytest.raises(KeyboardInterrupt):
        ef.install_family(FAMILY, on_progress=cancel_on_second_method)
    assert not [t for t in bw2data.methods if t[0] == FAMILY]


# ── through the engine and the API ───────────────────────────────────────────


def test_install_twice_is_safe(small_project):
    first = lme.install_method("ef_v3_1")
    assert len(first.method_tuples) == 2 and first.report["cfs_linked"] == 4
    snapshot = {t: _cfs(t) for t in bw2data.methods}

    with pytest.raises(InstallError, match="already installed"):
        lme.install_method("ef_v3_1")
    assert {t: _cfs(t) for t in bw2data.methods} == snapshot


def test_library_entry_and_installed_state(small_project):
    row = next(m for m in lme.list_library() if m["id"] == "ef_v3_1")
    assert row["installed"] is False and row["offline"] is True and row["source"] == "downloadable"

    lme.install_method("ef_v3_1")
    rows = lme.list_library()
    row = next(m for m in rows if m["id"] == "ef_v3_1")
    assert row["installed"] is True and row["removable"] is True and row["category_count"] == 2
    assert not [m for m in rows if m["id"] == f"bundled::{FAMILY}"], "listed twice: downloadable and bundled"


def test_a_bw2setup_style_project_reads_installed_and_is_not_offered_a_reinstall(small_project):
    """The demo project's methods came from bw2setup: same tuples, no manifest."""
    for t in ef.family_tuples(FAMILY):
        bw2data.Method(t).register(unit="x")
        bw2data.Method(t).write([((BIO, "u-co2"), 1.0)])
    before = {t: _cfs(t) for t in bw2data.methods}

    row = next(m for m in lme.list_library() if m["id"] == "ef_v3_1")
    assert row["installed"] is True and row["removable"] is False
    with pytest.raises(InstallError, match="already installed"):
        lme.install_method("ef_v3_1")
    assert lme.uninstall("ef_v3_1") == 0, "uninstall removed methods this app did not install"
    assert {t: _cfs(t) for t in bw2data.methods} == before


def test_an_install_in_one_project_does_not_make_another_projects_methods_removable(small_project):
    """The manifest is per user, not per project: an install here must not let Uninstall
    delete the identical methods another project (the demo) got from bw2setup."""
    lme.install_method("ef_v3_1")
    assert next(m for m in lme.list_library() if m["id"] == "ef_v3_1")["removable"] is True

    other = f"pytest-ef-other-{uuid.uuid4().hex[:6]}"
    bw2data.projects.set_current(other)
    _biosphere({"u-co2": ("Carbon dioxide, fossil", ("air",))})
    for t in ef.family_tuples(FAMILY):
        bw2data.Method(t).register(unit="x")
        bw2data.Method(t).write([((BIO, "u-co2"), 1.0)])
    row = next(m for m in lme.list_library() if m["id"] == "ef_v3_1")
    assert row["installed"] is True and row["removable"] is False
    assert lme.uninstall("ef_v3_1") == 0
    assert len([t for t in bw2data.methods if t[0] == FAMILY]) == 2


def test_uninstall_removes_exactly_what_the_install_registered(small_project):
    bw2data.Method(("Other", "x", "y")).register(unit="u")
    bw2data.Method(("Other", "x", "y")).write([((BIO, "u-co2"), 1.0)])
    lme.install_method("ef_v3_1")
    assert lme.uninstall("ef_v3_1") == 2
    assert list(bw2data.methods) == [("Other", "x", "y")]


def test_uninstall_also_clears_the_stored_install_report_of_this_project_only(small_project):
    """The manifest keeps the install report (counts, skipped flows) per project. Uninstalling must
    drop it, or a stale "installed with warnings" report outlives the methods it describes."""
    lme.install_method("ef_v3_1")
    manifest = lme._read_manifest("ef_v3_1")
    here = str(bw2data.projects.current)
    assert manifest["projects"][here]["report"]["cfs_found"] > 0
    manifest["projects"]["another-project"] = {"method_tuples": [["Other", "x", "y"]], "report": {"cfs_found": 7}}
    lme._write_manifest("ef_v3_1", manifest)

    lme.uninstall("ef_v3_1")

    after = lme._read_manifest("ef_v3_1")
    assert here not in after["projects"], "the report of the uninstalled project is still stored"
    assert after["projects"]["another-project"]["report"] == {"cfs_found": 7}, "another project's report was touched"
    assert not lme.is_installed("ef_v3_1")


def _finished_frames(client, task_id):
    """Wait for the install thread, then read the frames a late subscriber gets.

    Only a FINISHED task is subscribed to: its handler replies and closes, so
    this cannot block. (A subscriber to a running task waits on the event loop.)
    """
    import time

    from starlette.websockets import WebSocketDisconnect

    from mapper.api import lcia_methods as api

    for _ in range(400):
        if api._TASKS[task_id].done:
            break
        time.sleep(0.05)
    assert api._TASKS[task_id].done, "the install did not finish"
    frames = []
    with client.websocket_connect(f"/api/impact/methods/ws/{task_id}") as ws:
        while True:
            try:
                frames.append(ws.receive_json())
            except WebSocketDisconnect:
                break
    return frames


def test_the_api_reports_the_counts_and_the_warning_in_the_done_frame(small_project):
    from mapper.main import app

    # `with`: keeps one event loop alive for the install thread to notify
    with TestClient(app) as client:
        lib = client.get("/api/impact/methods/library").json()
        assert any(m["id"] == "ef_v3_1" and m["offline"] for m in lib["methods"])

        task = client.post("/api/impact/methods/install", json={"method_id": "ef_v3_1"}).json()
        done = _finished_frames(client, task["task_id"])[-1]
        again = client.post("/api/impact/methods/install", json={"method_id": "ef_v3_1"})

    assert done["type"] == "done", done
    assert done["report"]["cfs_found"] == 8 and done["report"]["cfs_skipped"] == 4
    assert done["warnings"][0].startswith("4 of 8 characterisation factors")
    assert len(done["method_tuples"]) == 2
    assert again.status_code == 409 and "already installed" in again.json()["detail"]


def test_the_api_error_text_reaches_the_client(project, small_family):
    """No biosphere3: the clear message must be in the error frame, not only in a log."""
    from mapper.main import app

    with TestClient(app) as client:
        task = client.post("/api/impact/methods/install", json={"method_id": "ef_v3_1"}).json()
        last = _finished_frames(client, task["task_id"])[-1]

    assert last["type"] == "error"
    assert "no 'biosphere3'" in last["error"] and "Import an ecoinvent database" in last["error"]


# ── the real bundled data ────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def real_family():
    return ef.load_family(FAMILY)


def test_bw2io_bundles_exactly_the_25_ef_v31_methods(real_family):
    assert sorted(tuple(m["name"]) for m in real_family) == sorted((FAMILY, a, b) for a, b in EF_25)
    assert sum(len(m["exchanges"]) for m in real_family) == 11414
    assert len({e["input"][1] for m in real_family for e in m["exchanges"]}) == 3226
    # bw2setup writes the same tuples: it takes them from this very file
    assert ef.family_tuples(FAMILY) == [tuple(m["name"]) for m in real_family]


def _real_biosphere(real_family, drop=()):
    flows = {}
    for m in real_family:
        for e in m["exchanges"]:
            if e["input"][1] not in drop:
                flows[e["input"][1]] = (e["name"], e["categories"])
    _biosphere(flows)
    return flows


def test_real_ef_installs_alone_and_links_everything_against_its_own_flows(project, real_family):
    flows = _real_biosphere(real_family)
    before = _rows(BIO)
    assert not list(bw2data.methods)

    result = lme.install_method("ef_v3_1")

    assert sorted(result.method_tuples) == sorted((FAMILY, a, b) for a, b in EF_25)
    assert sorted(bw2data.methods) == sorted(result.method_tuples), "something besides EF v3.1 was installed"
    r = result.report
    assert (r["cfs_found"], r["cfs_linked"], r["cfs_skipped"]) == (11414, 11414, 0)
    assert result.warnings == []
    assert _rows(BIO) == before and len(flows) == 3226
    # a factor really points at its flow
    gwp = _cfs((FAMILY, "climate change", "global warming potential (GWP100)"))
    co2 = next(c for c, (n, cats) in flows.items() if n == "Carbon dioxide, fossil" and tuple(cats) == ("air",))
    assert gwp[(BIO, co2)] == 1.0


def test_real_ef_against_a_biosphere_missing_flows_counts_the_skipped(project, real_family):
    some = sorted({e["input"][1] for m in real_family for e in m["exchanges"]})[:40]
    _real_biosphere(real_family, drop=set(some))
    expected = sum(1 for m in real_family for e in m["exchanges"] if e["input"][1] in set(some))

    result = lme.install_method("ef_v3_1")

    r = result.report
    assert r["cfs_skipped"] == expected > 0
    assert r["cfs_linked"] == 11414 - expected
    assert r["skipped_flows"] == 40
    assert result.warnings and "were skipped" in result.warnings[0]
    stored = sum(len(_cfs(t)) for t in result.method_tuples)
    assert stored == r["cfs_linked"], "reported linked factors differ from what is stored"


def test_the_names_bw2setup_gives_are_the_names_mapper_expects(real_family):
    """AESA's exact-match mapping must find all 16 Sala boundaries among the 25 tuples."""
    from mapper.core import aesa_engine

    boundary_set = aesa_engine.load_boundary_sets()["Sala2020_EF"]
    mapping = aesa_engine.suggest_method_mapping([list(m["name"]) for m in real_family], boundary_set)
    mapped = [x for x in mapping if x.pb_id]
    assert len(mapped) == 16 and len({x.pb_id for x in mapped}) == 16
