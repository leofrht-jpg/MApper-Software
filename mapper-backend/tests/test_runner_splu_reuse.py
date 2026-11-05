# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""``PersistentLCARunner`` without UMFPACK: one SuperLU factorisation, reused.

The Windows build has no UMFPACK, so ``_factorize_umfpack`` returns False and
every ``redo_lci`` used to run bw2calc's ``spsolve`` -- a full factorisation per
solve, ~71 of them for one 70-process product. The fallback now factorises once
with ``scipy.sparse.linalg.splu`` and solves with that factor.

A factor is valid for exactly one matrix, and bw2calc will not stop a caller from
changing the matrix underneath it (its own ``decompose_technosphere`` documents
that a stale factorisation "silently" gives wrong answers). So half of these tests
are about the guard: after ``rebuild_technosphere_matrix`` (what every bw2calc
Monte Carlo class calls per iteration), after an in-place edit of the matrix
values, and after the runner is pointed at a different database, the scores must
be those of the CURRENT matrix.

The fallback is forced with a monkeypatch of ``_UMFPACK_OK`` so the same tests run
on macOS (where UMFPACK exists) and on Windows CI (where it does not). Everything
runs in a throwaway Brightway directory.
"""
from __future__ import annotations

import gc
import shutil
import uuid

import bw2calc
import bw2data
import numpy as np
import pytest
import scipy.sparse as sp
from scipy.sparse.linalg import spsolve as scipy_spsolve

from mapper.core import bw2_wrapper as w

BIO = "pytest-splu-bio"
DB = "pytest-splu-tech"
DB2 = "pytest-splu-tech-b"
METHOD = ("pytest-splu", "climate", "gwp")
N_ACT = 14


def _tech_db(name: str, scale: float = 1.0) -> dict:
    """A chain with a feedback loop (a13 consumes a0), so the matrix is not triangular."""
    data = {}
    for i in range(N_ACT):
        exch = [{"input": (name, f"a{i}"), "amount": 1.0, "type": "production"}]
        for j in (i + 1, i + 2, i + 5):
            if j < N_ACT:
                exch.append({"input": (name, f"a{j}"), "amount": 0.07 * (1 + (i + j) % 4) * scale,
                             "type": "technosphere"})
        if i == N_ACT - 1:
            exch.append({"input": (name, "a0"), "amount": 0.04 * scale, "type": "technosphere"})
        exch.append({"input": (BIO, "co2"), "amount": 0.5 * (i + 1) * scale, "type": "biosphere"})
        exch.append({"input": (BIO, "ch4"), "amount": 0.01 * (i + 3), "type": "biosphere"})
        data[(name, f"a{i}")] = {"name": f"act {i}", "unit": "kg", "location": "GLO",
                                 "reference product": f"p{i}", "exchanges": exch}
    return data


@pytest.fixture()
def tech_project():
    projects = bw2data.projects
    original = projects.current
    project = f"pytest-splu-{uuid.uuid4().hex[:8]}"
    temp_dir = projects._use_temp_directory()  # throwaway base dir, never the real one
    try:
        projects.set_current(project)
        bw2data.Database(BIO).write({
            (BIO, "co2"): {"name": "Carbon dioxide, fossil", "unit": "kilogram",
                           "type": "emission", "categories": ("air",)},
            (BIO, "ch4"): {"name": "Methane, fossil", "unit": "kilogram",
                           "type": "emission", "categories": ("air",)},
        })
        bw2data.Method(METHOD).register(unit="kg CO2-eq")
        bw2data.Method(METHOD).write([((BIO, "co2"), 1.0), ((BIO, "ch4"), 29.8)])
        bw2data.Database(DB).write(_tech_db(DB))
        bw2data.Database(DB2).write(_tech_db(DB2, scale=1.6))
        yield project
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


class _Counters:
    def __init__(self):
        self.splu = 0
        self.spsolve = 0


@pytest.fixture()
def fallback(monkeypatch, tech_project):
    """Force the no-UMFPACK path and count every SuperLU factorisation/solve."""
    c = _Counters()
    real_splu, real_spsolve = w.splu, w.spsolve

    def counting_splu(*a, **k):
        c.splu += 1
        return real_splu(*a, **k)

    def counting_spsolve(*a, **k):
        c.spsolve += 1
        # SuperLU even on a machine that has scikit-umfpack: the Windows behaviour.
        k.setdefault("use_umfpack", False)
        return real_spsolve(*a, **k)

    monkeypatch.setattr(w, "_UMFPACK_OK", False)
    monkeypatch.setattr(w, "splu", counting_splu)
    monkeypatch.setattr(w, "spsolve", counting_spsolve)
    monkeypatch.setattr(bw2calc.lca, "spsolve", counting_spsolve)
    return c


def _demand(db: str = DB, i: int = 0, amount: float = 1.0) -> dict:
    return {(db, f"a{i}"): amount}


def _reference_score(demand: dict) -> float:
    """What plain bw2calc gives (its own spsolve), no runner."""
    lca = bw2calc.LCA({bw2data.get_activity(k): v for k, v in demand.items()}, METHOD)
    lca.lci()
    lca.lcia()
    return float(lca.score)


def _score_by_hand(lca) -> float:
    """characterisation * biosphere * supply, from the matrices as they are NOW."""
    x = scipy_spsolve(sp.csc_matrix(lca.technosphere_matrix), lca.demand_array, use_umfpack=False)
    return float((lca.characterization_matrix @ (lca.biosphere_matrix @ x)).sum())


def _run(runner, demand):
    return runner(demand, [METHOD])[METHOD][0]


# ── one factorisation per run ─────────────────────────────────────────────


def test_fallback_factorises_exactly_once_per_run(fallback):
    """The route's shape: one aggregate call, then one call per activity."""
    runner = w.PersistentLCARunner()
    _run(runner, {(DB, f"a{i}"): 1.0 for i in range(N_ACT)})
    for i in range(N_ACT):
        _run(runner, _demand(i=i))

    assert fallback.splu == 1
    assert runner.factorizations == 1
    assert runner.stale_refactorizations == 0
    assert fallback.spsolve == 0, "a per-call spsolve means the reuse is lost"


def test_two_methods_per_call_still_one_factorisation(fallback):
    runner = w.PersistentLCARunner()
    m2 = ("pytest-splu", "climate", "gwp-b")
    bw2data.Method(m2).register(unit="kg")
    bw2data.Method(m2).write([((BIO, "co2"), 2.0)])
    for i in range(N_ACT):
        runner(_demand(i=i), [METHOD, m2])
    assert fallback.splu == 1 and fallback.spsolve == 0


# ── numerical agreement with the spsolve path ─────────────────────────────


def test_scores_match_the_spsolve_path(fallback):
    runner = w.PersistentLCARunner()
    worst = 0.0
    for i in range(N_ACT):
        got = _run(runner, _demand(i=i, amount=1.0 + 0.1 * i))
        want = _reference_score(_demand(i=i, amount=1.0 + 0.1 * i))
        worst = max(worst, abs(got - want) / abs(want))
    assert worst < 1e-12, f"splu vs spsolve max relative difference {worst:.3e}"


# ── staleness: the matrix changes under the runner ────────────────────────


def test_rebuilt_technosphere_matrix_is_not_served_a_stale_factor(fallback):
    """What a bw2calc Monte Carlo iteration does to ``runner._lca``."""
    runner = w.PersistentLCARunner()
    before = _run(runner, _demand())
    assert fallback.splu == 1

    for step, factor in enumerate((1.3, 0.8, 1.7), start=1):
        def vector(lca, f=factor):
            v = lca.tech_params["amount"].copy()
            v[np.arange(v.size) % 3 == 0] *= f
            return v

        runner._lca.rebuild_technosphere_matrix(vector(runner._lca))
        got = _run(runner, _demand())
        want = _score_by_hand(runner._lca)
        assert got == pytest.approx(want, rel=1e-10), f"stale factor at step {step}"
        assert got != pytest.approx(before, rel=1e-6), "the score did not move: the test changed nothing"
        assert runner.stale_refactorizations == step
        assert fallback.splu == 1 + step


def test_in_place_edit_of_the_matrix_values_is_not_served_a_stale_factor(fallback):
    """Same object, different numbers: identity checks cannot see this."""
    runner = w.PersistentLCARunner()
    before = _run(runner, _demand())

    A = runner._lca.technosphere_matrix
    A.data[A.data < 0] *= 0.5  # halve every technosphere input, in place

    got = _run(runner, _demand())
    want = _score_by_hand(runner._lca)
    assert got == pytest.approx(want, rel=1e-10)
    assert got != pytest.approx(before, rel=1e-6)
    assert runner.stale_refactorizations == 1 and fallback.splu == 2


def test_unchanged_matrix_is_never_refactorised(fallback):
    runner = w.PersistentLCARunner()
    for i in range(N_ACT):
        _run(runner, _demand(i=i))
    for i in range(N_ACT):
        _run(runner, _demand(i=i))
    assert runner.stale_refactorizations == 0 and fallback.splu == 1


def test_a_different_database_gets_its_own_factorisation(fallback):
    """Demand outside the cached product_dict rebuilds the LCA; scores must be DB2's."""
    runner = w.PersistentLCARunner()
    a = _run(runner, _demand(DB))
    b = _run(runner, _demand(DB2))
    # Counted BEFORE the reference runs, which use bw2calc's own spsolve.
    assert fallback.splu == 2 and fallback.spsolve == 0
    assert a == pytest.approx(_reference_score(_demand(DB)), rel=1e-10)
    assert b == pytest.approx(_reference_score(_demand(DB2)), rel=1e-10)
    assert a != pytest.approx(b, rel=1e-3)


def test_multi_db_runner_factorises_each_database_once(fallback):
    runner = w.MultiDBPersistentRunner()
    for _ in range(3):
        for db in (DB, DB2):
            for i in range(4):
                runner(_demand(db, i), [METHOD])
    assert fallback.splu == 2
    assert runner.factorizations == 2


# ── failure keeps the old behaviour ───────────────────────────────────────


def test_a_failed_factorisation_falls_back_to_spsolve(fallback, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Factor is exactly singular")

    monkeypatch.setattr(w, "splu", boom)
    runner = w.PersistentLCARunner()
    for i in range(3):
        got = _run(runner, _demand(i=i))
        assert got == pytest.approx(_reference_score(_demand(i=i)), rel=1e-10)
    assert runner._splu_disabled is True
    assert fallback.spsolve > 0


# ── the UMFPACK path is untouched ─────────────────────────────────────────


@pytest.mark.skipif(not w._UMFPACK_OK, reason="no UMFPACK on this machine (the Windows build)")
def test_umfpack_path_is_unchanged(monkeypatch, tech_project):
    calls = {"splu": 0}
    real_splu = w.splu

    def counting_splu(*a, **k):
        calls["splu"] += 1
        return real_splu(*a, **k)

    monkeypatch.setattr(w, "splu", counting_splu)
    runner = w.PersistentLCARunner()
    got = [_run(runner, _demand(i=i)) for i in range(N_ACT)]

    assert calls["splu"] == 0, "the UMFPACK path must not touch SuperLU"
    assert runner._umf_solver is not None
    assert runner._lca.solver is not runner._solve_splu
    assert runner.factorizations == 1 and runner.stale_refactorizations == 0

    # Cross-check against SuperLU. UMFPACK and SuperLU are different LU codes.
    monkeypatch.setattr(w, "_UMFPACK_OK", False)
    other = w.PersistentLCARunner()
    for i, g in enumerate(got):
        assert _run(other, _demand(i=i)) == pytest.approx(g, rel=1e-9)


# ── the fingerprint ───────────────────────────────────────────────────────


def _mat(seed=0, n=40):
    rng = np.random.default_rng(seed)
    M = sp.random(n, n, density=0.1, random_state=rng, format="csr") + sp.eye(n, format="csr")
    return M.tocsr()


def test_fingerprint_equal_for_equal_content_and_format():
    A = _mat()
    assert w._matrix_fingerprint(A) == w._matrix_fingerprint(A.copy())


def test_fingerprint_sees_a_value_change_in_place():
    A = _mat()
    fp = w._matrix_fingerprint(A)
    A.data[3] *= 1.0000001
    assert w._matrix_fingerprint(A) != fp


def test_fingerprint_sees_a_structure_change():
    A = _mat()
    B = A.copy()
    B[0, 39] = 1e-3 if B[0, 39] == 0 else 0.0
    B.eliminate_zeros()
    assert B.nnz != A.nnz or (B != A).nnz
    assert w._matrix_fingerprint(B) != w._matrix_fingerprint(A)


def test_fingerprint_never_matches_a_matrix_it_cannot_hash():
    coo = _mat().tocoo()
    assert w._matrix_fingerprint(coo) != w._matrix_fingerprint(coo)
