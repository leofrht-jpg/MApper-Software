# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""An ecoinvent import must not silently lose biosphere exchanges.

The measured case: a project whose biosphere3 came from an older release
imported 3.11 against it. 5,514 of the release's flows were not in biosphere3,
and 41,915 of 541,321 biosphere exchanges (7.743%) were dropped with no warning.

These tests use a three-activity synthetic release (``ecoinvent_release_fixture``)
and a synthetic older biosphere3 in a throwaway Brightway directory. The release
has 5 flows and 7 biosphere exchanges; the old biosphere3 has 2 of the flows
(plus one the release no longer lists). Without the fix 3 exchanges are dropped:
two on Clopyralid and one on the soil-carbon flow.
"""
from __future__ import annotations

import gc
import json
import shutil
import uuid

import bw2data
import pytest

from mapper.api import ecoinvent as ei_api
from mapper.core.ecoinvent_biosphere import BiosphereAudit, BiosphereConflict
from mapper.core.tasks import Task

from ecoinvent_release_fixture import ACTIVITIES, TOTAL_BIOSPHERE_EXCHANGES, write_release

BIO = "biosphere3"
DB = "ecoinvent-fixture-cutoff"


def _old_biosphere() -> dict:
    """What a 3.10-era biosphere3 holds of the fixture release: two flows, with
    the extra fields a real one carries, and one flow the release dropped."""
    return {
        (BIO, "f1-co2"): {"name": "Carbon dioxide, fossil", "unit": "kilogram", "type": "emission",
                          "categories": ("air", "urban air close to ground"), "CAS number": "000124-38-9",
                          "synonyms": ["CO2"]},
        (BIO, "f2-ch4"): {"name": "Methane, fossil", "unit": "kilogram", "type": "emission",
                          "categories": ("air",), "CAS number": "000074-82-8", "synonyms": []},
        (BIO, "old-only"): {"name": "Retired flow", "unit": "kilogram", "type": "emission",
                            "categories": ("water",)},
    }


@pytest.fixture()
def bw_project():
    """A throwaway Brightway directory; yields a function that sets up biosphere3."""
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-biocov-{uuid.uuid4().hex[:8]}")
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture()
def old_project(bw_project):
    bw2data.Database(BIO).write(_old_biosphere())
    return bw_project


@pytest.fixture()
def release(tmp_path):
    return write_release(tmp_path / "release")


def _rows(db_name):
    from bw2data.backends.peewee import ActivityDataset
    return {
        (r.database, r.code): (r.name, r.type, json.dumps(r.data, sort_keys=True, default=str))
        for r in ActivityDataset.select().where(ActivityDataset.database == db_name)
    }


def _real_stored_biosphere_exchanges(db_name):
    """Independent of the audit: read the exchanges back through Brightway."""
    return sum(1 for a in bw2data.Database(db_name) for e in a.exchanges() if e["type"] == "biosphere")


def _run_local(release):
    task = Task(task_id="t")
    return ei_api._import_local_worker(task, DB, str(release)), task


def test_missing_flows_are_added_and_nothing_is_dropped(old_project, release):
    result, task = _run_local(release)

    assert result["flows_missing"] == 3          # Clopyralid, soil carbon, Pyrene_temp
    assert result["flows_added"] == 3
    assert result["exchanges_found"] == TOTAL_BIOSPHERE_EXCHANGES == 7
    assert result["dropped_by_design"] == 1      # the *_temp exchange, bw2io's own list
    assert result["exchanges_linked"] == 6
    assert result["exchanges_dropped"] == 0
    assert result["warning"] == ""
    assert {a["code"] for a in bw2data.Database(BIO)} == {
        "f1-co2", "f2-ch4", "old-only", "f3-pest", "f4-soilc", "f5-temp"}
    assert task.result is result                 # what the wizard fetches


def test_reported_counts_equal_the_real_counts(old_project, release):
    result, _ = _run_local(release)

    assert result["exchanges_stored"] == _real_stored_biosphere_exchanges(DB) == 6
    # every stored exchange points at a flow that exists, and per flow they match the files
    per_flow = {}
    for a in bw2data.Database(DB):
        for e in a.exchanges():
            if e["type"] == "biosphere":
                assert e.input["code"] in {x["code"] for x in bw2data.Database(BIO)}
                per_flow[e.input["code"]] = per_flow.get(e.input["code"], 0) + 1
    assert per_flow == {"f1-co2": 2, "f2-ch4": 1, "f3-pest": 2, "f4-soilc": 1}
    assert result["exchanges_found"] - result["dropped_by_design"] - result["exchanges_dropped"] \
        == result["exchanges_linked"] == result["exchanges_stored"]


def test_existing_flows_are_untouched(old_project, release):
    before = _rows(BIO)
    _run_local(release)
    after = _rows(BIO)

    assert set(before) < set(after)
    for key, value in before.items():
        assert after[key] == value, f"{key} was modified"
    assert ("biosphere3", "old-only") in after, "a flow the release does not list was removed"


def test_the_added_flows_are_shaped_like_a_fresh_import(old_project, release):
    _run_local(release)
    flow = bw2data.get_activity((BIO, "f4-soilc"))
    assert flow["name"].startswith("Carbon, organic, increase")
    assert flow["unit"] == "kilogram"                      # normalised, as the importer does
    assert tuple(flow["categories"]) == ("natural resource", "in ground")
    assert flow["type"] == "natural resource"
    assert tuple(bw2data.get_activity((BIO, "f3-pest"))["categories"]) == ("water", "surface water")


def test_a_conflicting_flow_stops_the_import_and_changes_nothing(bw_project, release):
    old = _old_biosphere()
    old[(BIO, "f1-co2")] = {**old[(BIO, "f1-co2")], "name": "Carbon dioxide, renamed in 3.10"}
    bw2data.Database(BIO).write(old)
    before = _rows(BIO)

    task = Task(task_id="t")
    with pytest.raises(BiosphereConflict) as exc:
        ei_api._import_local_worker(task, DB, str(release))

    msg = str(exc.value)
    assert "new project" in msg and "Carbon dioxide, renamed in 3.10" in msg
    assert "Carbon dioxide, fossil" in msg
    assert _rows(BIO) == before, "biosphere3 was changed by a refused import"
    assert DB not in bw2data.databases, "a database was written by a refused import"
    # the wizard shows the last progress message when the task fails
    assert task.message == msg


@pytest.mark.parametrize("field,value", [("unit", "megajoule"), ("categories", ("water",))])
def test_unit_and_categories_conflicts_stop_it_too(bw_project, release, field, value):
    old = _old_biosphere()
    old[(BIO, "f2-ch4")] = {**old[(BIO, "f2-ch4")], field: value}
    bw2data.Database(BIO).write(old)
    with pytest.raises(BiosphereConflict):
        ei_api._import_local_worker(Task(task_id="t"), DB, str(release))
    assert {a["code"] for a in bw2data.Database(BIO)} == {"f1-co2", "f2-ch4", "old-only"}


def test_a_fresh_project_behaves_as_before(bw_project, release):
    assert BIO not in bw2data.databases
    result, _ = _run_local(release)

    assert BIO in bw2data.databases
    assert len(bw2data.Database(BIO)) == 5          # exactly the release's own list
    assert result["flows_added"] == 0 and result["flows_missing"] == 0
    assert result["exchanges_found"] == 7
    assert result["dropped_by_design"] == 1
    assert result["exchanges_linked"] == result["exchanges_stored"] == 6
    assert result["exchanges_dropped"] == 0


def test_without_the_reconciliation_the_old_drop_is_reproduced(old_project, release):
    """The defect, kept as a measurement: the same import with the old biosphere3
    left alone loses exactly the exchanges on flows it lacks, and the audit sees it."""
    import bw2io

    audit = BiosphereAudit(BIO)                      # no reconcile()
    imp = bw2io.SingleOutputEcospold2Importer(dirpath=str(release), db_name=DB,
                                              biosphere_database_name=BIO, use_mp=False)
    audit.count_found(imp.data)
    imp.apply_strategies()
    audit.after_strategies(imp.data)
    imp.match_database(BIO, fields=["name", "unit", "categories"])
    audit.drop_unlinked(imp.data)
    imp.write_database()
    audit.after_write(DB)

    assert (audit.exchanges_found, audit.exchanges_linked, audit.exchanges_dropped) == (7, 3, 3)
    assert audit.exchanges_stored == _real_stored_biosphere_exchanges(DB) == 3
    assert "WARNING: 3 of 7" in audit.warning and "Clopyralid" in audit.warning


def test_no_xml_next_to_an_existing_biosphere_still_counts_and_warns(old_project, release, monkeypatch):
    (release.parent / "MasterData" / "ElementaryExchanges.xml").unlink()
    result, task = _run_local(release)

    assert result["coverage_checked"] is False and result["flows_added"] == 0
    assert result["exchanges_dropped"] == 3
    assert "WARNING: 3 of 7" in result["warning"]
    assert "not checked" in result["message"]
    assert "WARNING" in task.message                 # visible in the final progress message


def test_the_final_message_carries_the_counts(old_project, release):
    result, task = _run_local(release)
    assert "3 flows added to 'biosphere3'" in task.message
    assert "7 found, 1 dropped by design, 6 linked, 0 dropped" in task.message


# ── the credentials route shares the logic ───────────────────────────────────


class _FakeRelease:
    def __init__(self, settings):
        pass

    def login(self):
        pass

    def get_release(self, **kw):
        return _FakeRelease.path


@pytest.fixture()
def credentials_route(monkeypatch, release):
    _FakeRelease.path = release.parent
    monkeypatch.setattr(ei_api.ei, "Settings", lambda **kw: object())
    monkeypatch.setattr(ei_api.ei, "EcoinventRelease", _FakeRelease)


def test_credentials_route_adds_flows_and_reports(old_project, credentials_route):
    task = Task(task_id="t")
    result = ei_api._import_worker(task, "u", "p", "fixture", "cutoff")

    assert "ecoinvent-fixture-cutoff" in bw2data.databases
    assert result["flows_added"] == 3 and result["exchanges_dropped"] == 0
    assert result["exchanges_found"] == 7 and result["exchanges_linked"] == 6 == result["exchanges_stored"]
    assert "3 flows added" in task.message
    assert task.result is result


def test_credentials_route_stops_on_a_conflict(bw_project, credentials_route):
    old = _old_biosphere()
    old[(BIO, "f1-co2")] = {**old[(BIO, "f1-co2")], "unit": "gram"}
    bw2data.Database(BIO).write(old)
    with pytest.raises(BiosphereConflict):
        ei_api._import_worker(Task(task_id="t"), "u", "p", "fixture", "cutoff")
    assert "ecoinvent-fixture-cutoff" not in bw2data.databases


def test_credentials_route_on_a_fresh_project(bw_project, credentials_route):
    result = ei_api._import_worker(Task(task_id="t"), "u", "p", "fixture", "cutoff")
    assert result["flows_added"] == 0 and result["exchanges_dropped"] == 0
    assert result["exchanges_linked"] == result["exchanges_stored"] == 6


def test_both_routes_use_the_one_implementation():
    import inspect
    for fn in (ei_api._import_worker, ei_api._import_local_worker):
        src = inspect.getsource(fn)
        assert "BiosphereAudit(" in src and "_reconcile_biosphere(" in src and "_finish(" in src
        assert "link_biosphere" not in src and "reconcile(" not in src.replace("_reconcile_biosphere(", "")


# ── the summary route ────────────────────────────────────────────────────────


def test_summary_route_returns_the_result(old_project, release):
    from fastapi.testclient import TestClient

    from mapper.core import tasks as core_tasks
    from mapper.main import app

    task = core_tasks.create_task()
    result = ei_api._import_local_worker(task, DB, str(release))
    client = TestClient(app)
    r = client.get(f"/api/ecoinvent/import-summary/{task.task_id}")
    assert r.status_code == 200 and r.json() == result
    assert client.get("/api/ecoinvent/import-summary/nope").status_code == 404
    pending = core_tasks.create_task()
    assert client.get(f"/api/ecoinvent/import-summary/{pending.task_id}").status_code == 404


def test_the_fixture_release_matches_its_constants():
    assert sum(len(v) for v in ACTIVITIES.values()) == TOTAL_BIOSPHERE_EXCHANGES
