# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Authoring in a brand-new Brightway project.

``Bw2Backend._all_stats`` read ecoinvent's uncertainty per flow with a forced SQLite index
(``INDEXED BY exchangedataset_output``). bw2data builds that index only when a single write
carries 100 or more activities, so a new project with a small biosphere has none and authoring
failed with ``no such index: exchangedataset_output``. The hint is now used only where the
index exists. The query returns the same rows either way; the database is never altered.

Throwaway Brightway directories only; no real project, database or user data is touched.
"""
from __future__ import annotations

import gc
import shutil
import uuid

import bw2data
import pytest
from bw2data.backends.peewee import sqlite3_lci_db

from mapper.core import authored_engine as eng
from mapper.models.authored_schemas import ActivityInput, AuthoredDatabase, ExchangeInput

BIO = "biosphere3"
PED = {"reliability": 4, "completeness": 4, "temporal correlation": 4,
       "geographical correlation": 4, "further technological correlation": 4}
CODE = "ab" * 16


def _indexes() -> list[str]:
    rows = sqlite3_lci_db.execute_sql(
        "select name from sqlite_master where type='index' and tbl_name='exchangedataset'").fetchall()
    return sorted(r[0] for r in rows)


def _populate(n_processes: int = 12) -> None:
    """A small biosphere and a technosphere whose exchanges carry lognormal uncertainty, so the
    per-flow statistics are non-trivial: CO2 has ``n_processes`` lognormal exchanges."""
    bw2data.Database(BIO).write({
        (BIO, "co2"): {"name": "Carbon dioxide, fossil", "categories": ("air",), "unit": "kilogram", "type": "emission", "code": "co2"},
        (BIO, "nh3"): {"name": "Ammonia", "categories": ("air",), "unit": "kilogram", "type": "emission", "code": "nh3"},
    })
    data = {}
    for i in range(n_processes):
        key = ("tech", f"p{i}")
        data[key] = {"name": f"p{i}", "code": f"p{i}", "unit": "kilogram", "location": "GLO", "type": "process",
                     "reference product": "x", "exchanges": [
            {"input": key, "output": key, "amount": 1.0, "type": "production"},
            {"input": (BIO, "co2"), "output": key, "amount": 1.0, "type": "biosphere", "uncertainty type": 2,
             "loc": 0.0, "scale": 0.25 + 0.01 * i, "scale without pedigree": 0.02 + 0.001 * i},
        ]}
    bw2data.Database("tech").write(data)


def _fresh():
    """Reset the backend's per-process cache so a second project is measured, not remembered."""
    eng.Bw2Backend._stats_cache.clear()


@pytest.fixture()
def bw_project():
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-authidx-{uuid.uuid4().hex[:8]}")
        _fresh()
        yield projects
    finally:
        _fresh()
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture()
def statements(monkeypatch):
    """Every statement the stats pass sends to SQLite."""
    from bw2data.backends.peewee.schema import ExchangeDataset

    sql = ExchangeDataset._meta.database
    seen: list[str] = []
    real = sql.execute_sql

    def spy(query, *a, **k):
        seen.append(query)
        return real(query, *a, **k)

    monkeypatch.setattr(sql, "execute_sql", spy)
    return seen


def _activity_input() -> ActivityInput:
    return ActivityInput(
        name="NaNFM442 cathode, direct emissions", unit="kilogram", scope="partial", scope_note="direct emissions only",
        exchanges=[ExchangeInput(flow_code="co2", amount=0.8, pedigree=PED, floor_reason="continuous stack measurement"),
                   ExchangeInput(flow_code="nh3", amount=0.02, pedigree=PED, basic_variance=0.002,
                                 basic_variance_reason="no ecoinvent statistics for this flow in the fixture")])


# ── the reproduction, pinned ─────────────────────────────────────────────────


def test_a_brand_new_project_has_no_exchange_indexes_and_stats_still_work(bw_project, statements):
    _populate()
    assert _indexes() == []                                   # bw2data builds them only for a 100-activity write
    stats = eng.Bw2Backend().all_stats()                      # used to raise "no such index: exchangedataset_output"
    s = stats[(BIO, "co2")]
    assert s.n_lognormal == 12 and s.n_basic_variance == 12
    assert (BIO, "nh3") not in stats                          # no lognormal exchange: nothing to report, not an error
    sel = [q for q in statements if "from exchangedataset" in q]
    assert sel and not any("indexed by" in q.lower() for q in sel)
    assert _indexes() == []                                   # and nothing was created in the user's database


def test_where_the_index_exists_the_hint_is_still_used_and_nothing_changes(bw_project, statements):
    _populate()
    before = eng.Bw2Backend().all_stats()
    _fresh()
    statements.clear()
    sqlite3_lci_db.execute_sql('CREATE INDEX "exchangedataset_output" ON "exchangedataset" ("output_database", "output_code")')
    after = eng.Bw2Backend().all_stats()
    assert after == before                                    # same rows, same statistics, to the last float
    sel = [q for q in statements if "from exchangedataset" in q]
    assert sel and all("indexed by exchangedataset_output" in q.lower() for q in sel)


def test_the_index_is_never_created_twice_by_this_code(bw_project):
    _populate()
    sqlite3_lci_db.execute_sql('CREATE INDEX "exchangedataset_output" ON "exchangedataset" ("output_database", "output_code")')
    for _ in range(3):
        _fresh()
        eng.Bw2Backend().all_stats()
        eng.Bw2Backend().usage()
    assert _indexes() == ["exchangedataset_output"]           # one, the one we made; the code adds none


def test_a_project_bw2data_indexed_itself_works_unchanged(bw_project, statements):
    """The real shape of every project with ecoinvent: a write of 100+ activities builds the indexes."""
    _populate()
    bw2data.Database("big").write({("big", str(i)): {"name": str(i), "code": str(i), "unit": "kg", "location": "GLO", "type": "process",
        "exchanges": [{"input": ("big", str(i)), "output": ("big", str(i)), "amount": 1.0, "type": "production"}]} for i in range(100)})
    assert "exchangedataset_output" in _indexes()
    _fresh()
    stats = eng.Bw2Backend().all_stats()
    assert stats[(BIO, "co2")].n_lognormal == 12
    assert all("indexed by exchangedataset_output" in q.lower() for q in statements if "from exchangedataset" in q)


def test_has_output_index_reads_the_catalogue_only(bw_project):
    from bw2data.backends.peewee.schema import ExchangeDataset

    _populate()
    sql = ExchangeDataset._meta.database
    assert eng._has_output_index(sql) is False and _indexes() == []
    sqlite3_lci_db.execute_sql('CREATE INDEX "exchangedataset_output" ON "exchangedataset" ("output_database", "output_code")')
    assert eng._has_output_index(sql) is True


# ── authoring end to end ─────────────────────────────────────────────────────


def test_authoring_works_in_a_brand_new_project_and_gives_the_same_result_as_with_the_index(bw_project):
    _populate()
    assert _indexes() == []
    fresh = eng.build_activity(_activity_input(), eng.Bw2Backend(), CODE)         # used to fail
    db = AuthoredDatabase(name="mine", created_at="t", updated_at="t", activities=[fresh])
    eng.materialize(db, eng.Bw2Backend())
    assert "mine" in bw2data.databases
    written = bw2data.get_activity(("mine", CODE))
    assert {e["input"] for e in written.biosphere()} == {(BIO, "co2"), (BIO, "nh3")}
    # CO2: the variance came from the 12 ecoinvent-style exchanges in the fixture
    co2 = next(e for e in fresh.exchanges if e.flow.code == "co2")
    assert co2.basic_variance_source == "ecoinvent_median"
    assert _indexes() == []

    sqlite3_lci_db.execute_sql('CREATE INDEX "exchangedataset_output" ON "exchangedataset" ("output_database", "output_code")')
    _fresh()
    indexed = eng.build_activity(_activity_input(), eng.Bw2Backend(), CODE)
    assert indexed.model_dump() == fresh.model_dump()                             # identical, field for field
