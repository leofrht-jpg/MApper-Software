# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The Database Explorer pages through ``get_activities`` by offset.

Pages are slices of one sorted list, so the order must be the same on every
request, including for activities whose sort keys are equal ("market for steel" in
many locations). SQLite does not promise an iteration order without ORDER BY, so
these tests make the database iterate in a different random order on every call
(a worst case of what it is allowed to do) and check that paging still neither
repeats nor loses a row. Synthetic data in a throwaway Brightway directory.
"""
from __future__ import annotations

import gc
import random
import shutil
import uuid

import bw2data
import pytest

from mapper.core import bw2_wrapper

DB = "paging-fixture"
LIMIT = 25


@pytest.fixture()
def project():
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-paging-{uuid.uuid4().hex[:8]}")
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture()
def fixture_db(project):
    """130 activities, 3 distinct names, 4 locations, 2 units: nearly every sort key is shared."""
    rng = random.Random(7)
    codes = [f"code-{i:03d}" for i in range(130)]
    rng.shuffle(codes)  # insertion order is not code order
    data = {}
    for i, code in enumerate(codes):
        data[(DB, code)] = {
            "name": ["market for steel", "heat production", "electricity, high voltage"][i % 3],
            "location": ["DE", "FR", "GLO", "RoW"][i % 4],
            "unit": "kilogram" if i % 2 else "kilowatt hour",
            "reference product": "x",
            "type": "process",
        }
    bw2data.Database(DB).write(data)
    return set(codes)


@pytest.fixture()
def shuffled_iteration(monkeypatch, fixture_db):
    """A database that iterates in a new random order on every call."""
    rng = random.Random()
    real = bw2data.Database

    class Shuffling:
        def __init__(self, name):
            self._db = real(name)

        def __iter__(self):
            items = list(self._db)
            rng.shuffle(items)
            return iter(items)

    monkeypatch.setattr(bw2_wrapper.bw2data, "Database", Shuffling)


def _all_pages(sort_by, **filters):
    seen, total = [], None
    offset = 0
    while True:
        items, total = bw2_wrapper.get_activities(DB, offset=offset, limit=LIMIT, sort_by=sort_by, **filters)
        if not items:
            break
        seen.extend(i["code"] for i in items)
        offset += LIMIT
    return seen, total


@pytest.mark.parametrize("sort_by", ["name_asc", "name_desc", "location_asc", "unit_asc", "relevance"])
def test_paging_neither_repeats_nor_loses_a_row_when_sort_keys_tie(shuffled_iteration, fixture_db, sort_by):
    for _ in range(5):  # a different iteration order each time
        seen, total = _all_pages(sort_by)
        assert total == len(fixture_db) == 130
        assert len(seen) == len(set(seen)), "a row appeared on two pages"
        assert set(seen) == fixture_db, "a row appeared on no page"


@pytest.mark.parametrize("sort_by", ["name_asc", "name_desc", "location_asc", "unit_asc"])
def test_the_order_is_the_same_on_every_request(shuffled_iteration, sort_by):
    first, _ = _all_pages(sort_by)
    for _ in range(4):
        assert _all_pages(sort_by)[0] == first


def test_ties_are_broken_by_code_in_both_directions(shuffled_iteration):
    for sort_by in ("name_asc", "name_desc"):
        items, _ = bw2_wrapper.get_activities(DB, offset=0, limit=500, sort_by=sort_by)
        by_name: dict[str, list[str]] = {}
        for i in items:
            by_name.setdefault(i["name"], []).append(i["code"])
        for codes in by_name.values():
            assert codes == sorted(codes), f"{sort_by}: equal names are not in code order"


def test_a_search_pages_consistently_too(shuffled_iteration):
    expected = None
    for _ in range(4):
        seen, total = _all_pages("name_asc", search="steel")
        assert total == len(seen) == len(set(seen)) == 44  # i % 3 == 0 among 130
        expected = expected or seen
        assert seen == expected


def test_the_activity_key_is_unique_per_database_and_code(fixture_db):
    items, _ = bw2_wrapper.get_activities(DB, offset=0, limit=500)
    keys = [i["key"] for i in items]
    assert len(keys) == len(set(keys)) == 130
    assert all(DB in k for k in keys)
