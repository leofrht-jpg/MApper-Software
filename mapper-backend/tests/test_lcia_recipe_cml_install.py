# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""ReCiPe 2016 (midpoint, endpoint) and CML v4.8 2016 (with and without long-term
emissions) as one-click installs, on the installer #203 built for EF v3.1.

Each entry names the bw2io families it installs. The tests check that an entry
installs only its own methods, that a family installed through one entry never
becomes removable through another, and that the factor-source sentence in the
Library is true for every entry. A small synthetic data set (patched
``load_families``) covers the rules; the real bundled data, against a
biosphere3 built from its own flows, covers the facts about the families.
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
MID = ["ReCiPe 2016 v1.03, midpoint (H)", "ReCiPe 2016 v1.03, midpoint (I)", "ReCiPe 2016 v1.03, midpoint (E)"]
END = ["ReCiPe 2016 v1.03, endpoint (H)", "ReCiPe 2016 v1.03, endpoint (I)", "ReCiPe 2016 v1.03, endpoint (E)"]
CML, CML_NOLT = "CML v4.8 2016", "CML v4.8 2016 no LT"
#: entry id -> (families, methods, characterisation factors) as the registry states them
ENTRIES = {
    "recipe_2016_midpoint": (MID, 54, 22986),
    "recipe_2016_endpoint": (END, 74, 35579),
    "cml_v4_8_2016": ([CML], 11, 4022),
    "cml_v4_8_2016_no_lt": ([CML_NOLT], 11, 3455),
}


@pytest.fixture()
def project(monkeypatch, tmp_path):
    monkeypatch.setattr(lme, "CACHE_ROOT", tmp_path / "lcia_cache")
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-rc-{uuid.uuid4().hex[:8]}")
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


def _biosphere(flows: dict) -> None:
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


def _cfs(method):
    return {k: v for k, v in bw2data.Method(method).load()}


def _cf(name, cats, amount, code):
    return {"name": name, "categories": cats, "amount": amount, "type": "biosphere", "input": [BIO, code]}


def _synthetic_data():
    """Every family the four entries name, plus two it must leave alone (EF, TRACI).
    Per method: co2 (by code), nh3 (the project renumbered it: name+categories
    only) and one flow the project lacks. The CML methods lose more: 2 of 3."""
    data = []
    fams = MID + END + [CML, CML_NOLT, "EF v3.1", "TRACI v2.1"]
    for fam in fams:
        for ind in ("climate change", "acidification"):
            ex = [
                _cf("Carbon dioxide, fossil", ["air"], 1.0, "u-co2"),
                _cf("Ammonia", ["air", "unspecified"], 0.1, "u-old-nh3"),
                _cf("Halon-1301", ["air", "lower stratosphere + upper troposphere"], 6290.0, "u-halon"),
            ]
            if fam.startswith("CML") and ind == "acidification":
                ex = [ex[0], _cf("Copper ore", ["natural resource", "in ground"], 2.0, "u-ore"),
                      _cf("Zinc ore", ["natural resource", "in ground"], 3.0, "u-zn")]
            data.append({"name": [fam, ind, "x"], "unit": "u", "description": "", "filename": "f", "exchanges": ex})
    return data


@pytest.fixture()
def synthetic(monkeypatch):
    data = _synthetic_data()

    def load(families):
        names = [families] if isinstance(families, str) else list(families)
        out = []
        for n in names:
            found = [m for m in data if m["name"][0] == n]
            if not found:
                raise ef.EFInstallError(f"no '{n}' methods")
            out.extend(found)
        return out

    monkeypatch.setattr(ef, "load_families", load)
    monkeypatch.setattr(ef, "_CACHE", {})
    return data


@pytest.fixture()
def sproject(project, synthetic):
    _biosphere({
        "u-co2": ("Carbon dioxide, fossil", ("air",)),
        "u-nh3-new": ("Ammonia", ("air",)),
        "u-other": ("Something else", ("water",)),
    })
    return project


def _entry_tuples(entry_id):
    fams = ENTRIES[entry_id][0]
    return sorted(t for f in fams for t in [(f, i, "x") for i in ("climate change", "acidification")])


# ── each entry installs only its own methods ────────────────────────────────


@pytest.mark.parametrize("entry_id", list(ENTRIES))
def test_each_entry_installs_only_its_own_methods(sproject, entry_id):
    result = lme.install_method(entry_id)
    assert sorted(result.method_tuples) == _entry_tuples(entry_id)
    assert sorted(bw2data.methods) == _entry_tuples(entry_id), "something besides this entry was installed"


@pytest.mark.parametrize("entry_id", list(ENTRIES))
def test_factors_link_by_code_then_name_and_biosphere3_is_unchanged(sproject, entry_id):
    before = _rows(BIO)
    result = lme.install_method(entry_id)
    fam = ENTRIES[entry_id][0][0]
    # co2 by code, ammonia by name+categories -> the uuid this project has for it
    gwp = _cfs((fam, "climate change", "x"))
    assert gwp == {(BIO, "u-co2"): 1.0, (BIO, "u-nh3-new"): 0.1}
    assert _rows(BIO) == before and len(before) == 3
    r = result.report
    assert r["cfs_linked_by_code"] > 0 and r["cfs_linked_by_name"] > 0
    assert r["cfs_found"] == r["cfs_linked"] + r["cfs_skipped"]


def test_skipped_factors_are_counted_listed_and_warned(sproject):
    result = lme.install_method("recipe_2016_midpoint")
    r = result.report
    # 3 families x 2 methods x 3 factors; per method 1 skipped (the halon)
    assert (r["cfs_found"], r["cfs_linked"], r["cfs_skipped"], r["skipped_flows"]) == (18, 12, 6, 1)
    assert r["methods_registered"] == 6 and r["families"] == MID
    assert r["top_skipped"] == [{"name": "Halon-1301", "categories": ["air", "lower stratosphere + upper troposphere"], "cfs": 6}]
    assert result.warnings[0].startswith("6 of 18 characterisation factors (33.3%) were skipped")
    assert "Halon-1301 [air / lower stratosphere + upper troposphere]: 6 factors" in result.warnings


def test_the_indicators_that_lost_most_of_their_factors_are_named(sproject):
    """Overall CML loses 3 of 6; one indicator (acidification) lost 2 of 3 and must be called out,
    the indicator that lost 1 of 3 (33%) too, at the 25% threshold."""
    result = lme.install_method("cml_v4_8_2016")
    r = result.report
    assert r["cfs_skipped"] == 3
    worst = {tuple(m["name"]): (m["cfs_skipped"], m["cfs_found"]) for m in r["worst_methods"]}
    assert worst[(CML, "acidification", "x")] == (2, 3)
    assert r["worst_methods"][0]["name"] == [CML, "acidification", "x"], "worst indicator is not first"
    assert any("acidification" in w and "2 of 3 factors skipped" in w for w in result.warnings)


def test_no_worst_indicator_block_when_nothing_is_badly_hit(project, synthetic):
    _biosphere({"u-co2": ("Carbon dioxide, fossil", ("air",)), "u-nh3-new": ("Ammonia", ("air",)),
                "u-halon-new": ("Halon-1301", ("air", "lower stratosphere + upper troposphere")),
                "u-old-nh3": ("Ammonia", ("air", "x"))})
    result = lme.install_method("recipe_2016_midpoint")
    assert result.report["cfs_skipped"] == 0 and result.report["worst_methods"] == []
    assert result.warnings == []


# ── CML with and without long-term emissions are two different sets ─────────


def test_cml_and_cml_no_lt_are_installed_side_by_side_without_touching_each_other(sproject):
    lme.install_method("cml_v4_8_2016")
    first = {t: _cfs(t) for t in bw2data.methods}
    lme.install_method("cml_v4_8_2016_no_lt")
    assert {t for t in bw2data.methods if t[0] == CML} == {t for t in first}
    assert {t: _cfs(t) for t in first} == first
    assert len([t for t in bw2data.methods if t[0] == CML_NOLT]) == 2
    assert lme.uninstall("cml_v4_8_2016_no_lt") == 2
    assert {t: _cfs(t) for t in bw2data.methods} == first


# ── twice, uninstall, the demo project ───────────────────────────────────────


@pytest.mark.parametrize("entry_id", list(ENTRIES))
def test_installing_twice_is_safe(sproject, entry_id):
    lme.install_method(entry_id)
    snapshot = {t: _cfs(t) for t in bw2data.methods}
    with pytest.raises(InstallError, match="already installed"):
        lme.install_method(entry_id)
    assert {t: _cfs(t) for t in bw2data.methods} == snapshot


def test_uninstalling_one_entry_never_touches_another(sproject):
    for entry_id in ENTRIES:
        lme.install_method(entry_id)
    everything = {t: _cfs(t) for t in bw2data.methods}
    assert len(everything) == 6 + 6 + 2 + 2

    assert lme.uninstall("recipe_2016_midpoint") == 6
    left = {t: _cfs(t) for t in bw2data.methods}
    assert left == {t: v for t, v in everything.items() if not (t[0] in MID)}
    assert next(m for m in lme.list_library() if m["id"] == "recipe_2016_endpoint")["installed"] is True
    assert next(m for m in lme.list_library() if m["id"] == "recipe_2016_midpoint")["installed"] is False


def _bw2setup_style(families):
    """What the demo project has: the tuples, written by bw2setup, no manifest."""
    for fam in families:
        for ind in ("climate change", "acidification"):
            bw2data.Method((fam, ind, "x")).register(unit="u")
            bw2data.Method((fam, ind, "x")).write([((BIO, "u-co2"), 1.0)])


def test_a_bw2setup_project_reads_installed_everywhere_and_nothing_is_removable_or_reinstalled(sproject):
    _bw2setup_style(MID + END + [CML, CML_NOLT, "EF v3.1", "TRACI v2.1"])
    before = {t: _cfs(t) for t in bw2data.methods}
    rows = {m["id"]: m for m in lme.list_library()}
    for entry_id in ENTRIES:
        assert rows[entry_id]["installed"] is True and rows[entry_id]["removable"] is False, entry_id
        with pytest.raises(InstallError, match="already installed"):
            lme.install_method(entry_id)
        assert lme.uninstall(entry_id) == 0
    assert {t: _cfs(t) for t in bw2data.methods} == before, "the demo project's methods changed"


def test_a_partly_present_family_gets_only_the_missing_methods_and_uninstall_leaves_the_rest(sproject):
    _bw2setup_style([MID[0]])                      # only the hierarchist midpoint came from bw2setup
    mine = {t: _cfs(t) for t in bw2data.methods}
    result = lme.install_method("recipe_2016_midpoint")

    assert result.report["methods_already_present"] == 2 and result.report["methods_registered"] == 4
    assert {t: _cfs(t) for t in mine} == mine, "an existing method was overwritten"
    assert next(m for m in lme.list_library() if m["id"] == "recipe_2016_midpoint")["removable"] is True

    assert lme.uninstall("recipe_2016_midpoint") == 4
    assert {t: _cfs(t) for t in bw2data.methods} == mine, "uninstall removed a method the app did not install"


def test_an_install_in_one_project_does_not_make_another_projects_cml_removable(sproject):
    lme.install_method("cml_v4_8_2016")
    other = f"pytest-rc-other-{uuid.uuid4().hex[:6]}"
    bw2data.projects.set_current(other)
    _biosphere({"u-co2": ("Carbon dioxide, fossil", ("air",))})
    _bw2setup_style([CML])
    row = next(m for m in lme.list_library() if m["id"] == "cml_v4_8_2016")
    assert row["installed"] is True and row["removable"] is False
    assert lme.uninstall("cml_v4_8_2016") == 0
    assert len([t for t in bw2data.methods if t[0] == CML]) == 2


def test_a_failure_part_way_unregisters_the_whole_entry(sproject, monkeypatch):
    real_write = bw2data.Method.write
    calls = {"n": 0}

    def flaky(self, data, process=True):
        calls["n"] += 1
        if calls["n"] == 4:
            raise RuntimeError("disk full")
        return real_write(self, data, process=process)

    monkeypatch.setattr(bw2data.Method, "write", flaky)
    with pytest.raises(RuntimeError, match="disk full"):
        lme.install_method("recipe_2016_midpoint")
    assert not list(bw2data.methods)
    assert not lme._method_tuples_for("recipe_2016_midpoint")


def test_without_a_biosphere_the_wizard_gets_the_clear_message(project, synthetic):
    from mapper.main import app
    from mapper.api import lcia_methods as api
    import time
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app) as client:
        task = client.post("/api/impact/methods/install", json={"method_id": "cml_v4_8_2016"}).json()
        for _ in range(400):
            if api._TASKS[task["task_id"]].done:
                break
            time.sleep(0.05)
        frames = []
        with client.websocket_connect(f"/api/impact/methods/ws/{task['task_id']}") as ws:
            while True:
                try:
                    frames.append(ws.receive_json())
                except WebSocketDisconnect:
                    break
    assert frames[-1]["type"] == "error"
    assert "no 'biosphere3'" in frames[-1]["error"] and "Import an ecoinvent database" in frames[-1]["error"]


# ── the factor-source sentence in the Library ────────────────────────────────


def test_every_library_entry_states_where_its_factors_come_from(sproject):
    rows = lme.list_library()
    registry = [m for m in rows if m["source"] == "downloadable"]
    assert {m["id"] for m in registry} >= {"ef_v3_1", *ENTRIES, "impact_world_plus_2_2_1", "lc_impact"}
    for m in registry:
        assert m["factor_source"], f"{m['id']} has no factor source"


def test_the_ecoinvent_39_sentence_is_only_on_entries_whose_data_it_is_true_for(sproject):
    for m in lme.list_library():
        if m["source"] != "downloadable":
            continue
        text = m["factor_source"]
        bundled = m["installer"] == "bundled_ef"
        assert ("ecoinvent 3.9 LCIA implementation bundled with the installed software" in text) is bundled, m["id"]
        if bundled:
            for needle in ("flows that ecoinvent added after 3.9 have no factors", "linked and skipped for this project"):
                assert needle in text
    by_id = {m["id"]: m for m in lme.list_library()}
    assert "Zenodo" in by_id["impact_world_plus_2_2_1"]["factor_source"]
    assert "bw2_lcimpact" in by_id["lc_impact"]["factor_source"]


def test_rows_for_methods_already_in_the_project_and_custom_methods_have_their_own_source(sproject):
    _bw2setup_style(["TRACI v2.1"])
    row = next(m for m in lme.list_library() if m["id"] == "bundled::TRACI v2.1")
    assert "not installed by this app" in row["factor_source"]


def test_the_api_serves_factor_source_and_the_worst_indicators(sproject):
    from mapper.main import app
    from mapper.api import lcia_methods as api
    import time
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app) as client:
        lib = client.get("/api/impact/methods/library").json()["methods"]
        assert all(m["factor_source"] for m in lib if m["source"] == "downloadable")
        task = client.post("/api/impact/methods/install", json={"method_id": "cml_v4_8_2016"}).json()
        for _ in range(400):
            if api._TASKS[task["task_id"]].done:
                break
            time.sleep(0.05)
        frames = []
        with client.websocket_connect(f"/api/impact/methods/ws/{task['task_id']}") as ws:
            while True:
                try:
                    frames.append(ws.receive_json())
                except WebSocketDisconnect:
                    break
    done = frames[-1]
    assert done["type"] == "done", done
    assert done["report"]["families"] == [CML] and done["report"]["worst_methods"][0]["cfs_skipped"] == 2


# ── the real bundled data ────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def real():
    return {eid: ef.load_families(fams) for eid, (fams, _, _) in ENTRIES.items()}


@pytest.mark.parametrize("entry_id", list(ENTRIES))
def test_the_registry_states_what_bw2io_really_holds(real, entry_id):
    fams, n_methods, n_cfs = ENTRIES[entry_id]
    methods = real[entry_id]
    assert len(methods) == n_methods
    assert sum(len(m["exchanges"]) for m in methods) == n_cfs
    entry = lme._registry_entry(entry_id)
    assert entry["bundled_families"] == fams and entry["installer"] == "bundled_ef"
    assert f"Installs {n_methods} methods ({n_cfs:,} characterisation factors)" in entry["long_description"]
    # the tuples are the ones bw2setup writes: they come from this same file
    assert ef.family_tuples(fams) == [tuple(m["name"]) for m in methods]


def test_the_perspectives_are_distinct_sets_and_the_no_lt_variant_is_not_a_copy(real):
    by_family = {}
    for m in real["recipe_2016_midpoint"] + real["recipe_2016_endpoint"] + real["cml_v4_8_2016"] + real["cml_v4_8_2016_no_lt"]:
        by_family.setdefault(m["name"][0], []).append(m)
    counts = {f: sum(len(m["exchanges"]) for m in ms) for f, ms in by_family.items()}
    assert len(set(counts.values())) == len(counts), "two families have identical factor counts"
    assert counts[CML] > counts[CML_NOLT]


def test_the_names_mapper_expects_are_installed_by_these_entries():
    for family in lme.BUNDLED_FAMILY_HINTS:
        if family.startswith(("ReCiPe", "CML")):
            assert any(family in (e.get("bundled_families") or []) for e in lme._load_registry()), family


@pytest.mark.parametrize("entry_id", list(ENTRIES))
def test_real_entry_installs_alone_and_links_everything_against_its_own_flows(project, real, entry_id):
    flows = {e["input"][1]: (e["name"], e["categories"]) for m in real[entry_id] for e in m["exchanges"]}
    _biosphere(flows)
    before = _rows(BIO)

    result = lme.install_method(entry_id)

    _, n_methods, n_cfs = ENTRIES[entry_id]
    assert sorted(bw2data.methods) == sorted(result.method_tuples), "something besides this entry was installed"
    assert len(result.method_tuples) == n_methods
    r = result.report
    assert (r["cfs_found"], r["cfs_linked"], r["cfs_skipped"]) == (n_cfs, n_cfs, 0)
    assert r["worst_methods"] == [] and result.warnings == []
    assert _rows(BIO) == before
    stored = sum(len(_cfs(t)) for t in result.method_tuples)
    assert stored <= n_cfs and stored >= n_cfs - 50, "stored factor count is far from the reported one"


def test_real_cml_against_a_biosphere_missing_flows_counts_what_is_skipped(project, real):
    methods = real["cml_v4_8_2016"]
    some = sorted({e["input"][1] for m in methods for e in m["exchanges"]})[:30]
    flows = {e["input"][1]: (e["name"], e["categories"]) for m in methods for e in m["exchanges"] if e["input"][1] not in some}
    _biosphere(flows)
    expected = sum(1 for m in methods for e in m["exchanges"] if e["input"][1] in set(some))

    result = lme.install_method("cml_v4_8_2016")
    assert result.report["cfs_skipped"] == expected > 0
    assert result.report["skipped_flows"] == 30
    assert result.warnings and "were skipped" in result.warnings[0]
