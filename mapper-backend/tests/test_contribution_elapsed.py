# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The time shown with a contribution analysis is the wall time of the run that produced it.

The endpoint keeps finished analyses in ``_contribution_cache``. A repeat of the same request is
served from there in a few milliseconds, and ``elapsed_seconds`` used to be the time of THAT call, so
the panel header printed "0.00s" for a result that took seconds to compute. The cache entry now
carries the original time and the response says ``cached``.

Everything runs in a throwaway Brightway directory with a synthetic database; no real project is
opened.
"""
from __future__ import annotations

import gc
import shutil
import time
import uuid

import bw2data
import pytest

from mapper.api import lca as lca_api
from mapper.core import bw2_wrapper as w
from mapper.models.schemas import ContributionAnalysisRequest

BIO = "pytest-elapsed-bio"
DB = "pytest-elapsed-tech"
METHOD = ("pytest-elapsed", "climate", "gwp")
N_ACT = 14


def _tech_db(name: str) -> dict:
    data = {}
    for i in range(N_ACT):
        exch = [{"input": (name, f"a{i}"), "amount": 1.0, "type": "production"}]
        for j in (i + 1, i + 2, i + 5):
            if j < N_ACT:
                exch.append({"input": (name, f"a{j}"), "amount": 0.07 * (1 + (i + j) % 4), "type": "technosphere"})
        exch.append({"input": (BIO, "co2"), "amount": 0.5 * (i + 1), "type": "biosphere"})
        data[(name, f"a{i}")] = {"name": f"act {i}", "unit": "kg", "location": "GLO",
                                 "reference product": f"p{i}", "exchanges": exch}
    return data


@pytest.fixture()
def project():
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()  # throwaway base dir, never the real one
    try:
        projects.set_current(f"pytest-elapsed-{uuid.uuid4().hex[:8]}")
        bw2data.Database(BIO).write({
            (BIO, "co2"): {"name": "Carbon dioxide, fossil", "unit": "kilogram",
                           "type": "emission", "categories": ("air",)},
        })
        bw2data.Method(METHOD).register(unit="kg CO2-eq")
        bw2data.Method(METHOD).write([((BIO, "co2"), 1.0)])
        bw2data.Database(DB).write(_tech_db(DB))
        lca_api._contribution_cache.clear()
        yield
    finally:
        lca_api._contribution_cache.clear()
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


def _body(**kw) -> ContributionAnalysisRequest:
    return ContributionAnalysisRequest(
        target_type="activity", database=DB, code="a0", amount=1.0, method=list(METHOD), **kw,
    )


@pytest.fixture()
def timed_runner(monkeypatch):
    """Record every runner call (the matrix load, factorisation and solve) and its own duration."""
    calls: list[float] = []
    real = w.PersistentLCARunner.__call__

    def timed(self, *a, **k):
        t = time.perf_counter()
        try:
            return real(self, *a, **k)
        finally:
            calls.append(time.perf_counter() - t)

    monkeypatch.setattr(w.PersistentLCARunner, "__call__", timed)
    return calls


def test_first_run_reports_the_whole_run(project, timed_runner, monkeypatch):
    # Make the factorisation/solve measurably slow: the reported time must contain it.
    real = w.PersistentLCARunner.__call__

    def slow(self, *a, **k):
        time.sleep(0.2)
        return real(self, *a, **k)

    monkeypatch.setattr(w.PersistentLCARunner, "__call__", slow)
    res = lca_api._compute_contribution_analysis(_body())
    assert res.cached is False
    assert res.elapsed_seconds >= 0.2
    # and it contains the runner's own measured time (load + factorisation + solve)
    assert res.elapsed_seconds >= max(timed_runner)


def test_elapsed_includes_the_factorisation_of_a_direct_call(project, timed_runner):
    t = time.perf_counter()
    w.PersistentLCARunner()({(DB, "a0"): 1.0}, [METHOD])
    direct = time.perf_counter() - t
    res = lca_api._compute_contribution_analysis(_body())
    assert res.elapsed_seconds > 0
    assert res.elapsed_seconds >= timed_runner[-1]  # the analysis ran the same call, inside its timer
    assert direct > 0


def test_second_identical_call_returns_the_original_time_and_the_cached_flag(project, timed_runner):
    first = lca_api._compute_contribution_analysis(_body())
    runs_after_first = len(timed_runner)
    t = time.perf_counter()
    second = lca_api._compute_contribution_analysis(_body())
    lookup = time.perf_counter() - t

    assert first.cached is False
    assert second.cached is True
    assert len(timed_runner) == runs_after_first, "a cache hit must not run the solver again"
    assert second.elapsed_seconds == first.elapsed_seconds
    assert second.elapsed_seconds > 0
    assert second.elapsed_seconds > lookup, "the lookup is not the time shown"
    assert second.score == first.score


def test_a_deeper_request_recomputes_and_reports_its_own_time(project, timed_runner):
    first = lca_api._compute_contribution_analysis(_body(cutoff=0.05))
    n = len(timed_runner)
    deeper = lca_api._compute_contribution_analysis(_body(cutoff=0.001))
    assert deeper.cached is False
    assert len(timed_runner) > n
    assert deeper.elapsed_seconds > 0
    again = lca_api._compute_contribution_analysis(_body(cutoff=0.001))
    assert again.cached is True and again.elapsed_seconds == deeper.elapsed_seconds
    assert first.cached is False


def test_the_response_keeps_every_existing_field_and_adds_cached(project):
    res = lca_api._compute_contribution_analysis(_body())
    d = res.model_dump()
    assert {"elapsed_seconds", "computed_at", "score", "supply_chain_tree"} <= set(d)
    assert d["cached"] is False


def test_multi_year_all_cached_reports_the_sum_of_the_original_times(project):
    from mapper.models.schemas import MultiYearContributionRequest

    body = MultiYearContributionRequest(
        target_type="activity", database=DB, code="a0", years=[2030, 2040], method=list(METHOD),
    )

    def per_year():
        return {y: lca_api._compute_contribution_analysis(_body(year=y)) for y in body.years}

    first = per_year()
    fresh = lca_api._build_multi_year_result(body, first, 1.5)
    assert fresh.cached is False and fresh.elapsed_seconds == 1.5

    again = per_year()  # all served from the cache, in milliseconds
    assert all(r.cached for r in again.values())
    cached = lca_api._build_multi_year_result(body, again, 0.002)
    assert cached.cached is True
    assert cached.elapsed_seconds == round(sum(r.elapsed_seconds for r in first.values()), 3)
    assert cached.elapsed_seconds > 0.002
