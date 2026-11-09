# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
"""Fail unless scikit-umfpack loads and solves like SciPy's SuperLU, through MApper's own code.

Before 0.4.1 the Windows installer fell back to SuperLU (one factorisation about 150 s on a
real laptop). This check is the build gate for the fast solver. It proves, in the
BUILD environment (not the frozen app):

  1. ``mapper.core.bw2_wrapper._UMFPACK_OK`` is True (the same flag main.py logs);
  2. a synthetic sparse system solved with scikits.umfpack equals SciPy's SuperLU
     solution to 1e-9;
  3. ``PersistentLCARunner`` on a synthetic Brightway project (throwaway directory)
     really uses UMFPACK (one factorisation, then back-substitution) and its scores
     equal plain bw2calc with SuperLU to 1e-9.

Nothing of a user's is read or written: Brightway and the log go to a temporary
directory set before anything is imported.

    python scripts/verify_umfpack.py        # from the repository root
"""
from __future__ import annotations

import importlib.metadata as md
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="mapper-verify-umfpack-")
os.environ["BRIGHTWAY2_DIR"] = os.path.join(_TMP, "bw")
os.environ["MAPPER_LOG_DIR"] = os.path.join(_TMP, "logs")
os.makedirs(os.environ["BRIGHTWAY2_DIR"], exist_ok=True)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mapper-backend"))

import bw2calc  # noqa: E402
import bw2data  # noqa: E402
import numpy as np  # noqa: E402
import scipy.sparse as sp  # noqa: E402
from scipy.sparse.linalg import spsolve  # noqa: E402

from mapper.core import bw2_wrapper as w  # noqa: E402

TOL = 1e-9
failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failures.append(what)


def _version(name: str) -> str:
    try:
        return md.version(name)
    except md.PackageNotFoundError:
        return "not installed"


def low_level() -> None:
    from scikits.umfpack import UMFPACK_A, UmfpackContext

    rng = np.random.default_rng(7)
    n = 400
    A = (sp.random(n, n, density=0.01, random_state=7, format="csc") * 0.3 + sp.identity(n, format="csc")).tocsc()
    b = rng.random(n)
    ctx = UmfpackContext("di")
    ctx.numeric(A)
    x_umf = ctx.solve(UMFPACK_A, A, b, autoTranspose=True)
    x_ref = spsolve(A, b, use_umfpack=False)
    rel = float(np.max(np.abs(x_umf - x_ref)) / np.max(np.abs(x_ref)))
    check(rel < TOL, f"UMFPACK solve equals SuperLU on a synthetic 400x400 system (max rel diff {rel:.2e})")


N_ACT = 14
BIO, DB, METHOD = "verify-bio", "verify-tech", ("verify", "climate", "gwp")


def _tech_db() -> dict:
    # A chain with a feedback loop, so the matrix is not triangular (as in tests/test_runner_splu_reuse.py).
    data = {}
    for i in range(N_ACT):
        exch = [{"input": (DB, f"a{i}"), "amount": 1.0, "type": "production"}]
        for j in (i + 1, i + 2, i + 5):
            if j < N_ACT:
                exch.append({"input": (DB, f"a{j}"), "amount": 0.07 * (1 + (i + j) % 4), "type": "technosphere"})
        if i == N_ACT - 1:
            exch.append({"input": (DB, "a0"), "amount": 0.04, "type": "technosphere"})
        exch.append({"input": (BIO, "co2"), "amount": 0.5 * (i + 1), "type": "biosphere"})
        exch.append({"input": (BIO, "ch4"), "amount": 0.01 * (i + 3), "type": "biosphere"})
        data[(DB, f"a{i}")] = {"name": f"act {i}", "unit": "kg", "location": "GLO",
                               "reference product": f"p{i}", "exchanges": exch}
    return data


def through_the_runner() -> None:
    bw2data.projects.set_current("verify-umfpack")
    bw2data.Database(BIO).write({
        (BIO, "co2"): {"name": "Carbon dioxide, fossil", "unit": "kilogram", "type": "emission", "categories": ("air",)},
        (BIO, "ch4"): {"name": "Methane, fossil", "unit": "kilogram", "type": "emission", "categories": ("air",)},
    })
    bw2data.Method(METHOD).register(unit="kg CO2-eq")
    bw2data.Method(METHOD).write([((BIO, "co2"), 1.0), ((BIO, "ch4"), 29.8)])
    bw2data.Database(DB).write(_tech_db())

    runner = w.PersistentLCARunner()
    scores = [runner({(DB, f"a{i}"): 1.0 + i}, [METHOD])[METHOD][0] for i in (0, 3, 7)]
    check(runner._umf_solver is not None, "PersistentLCARunner holds an UMFPACK factorisation")
    check(runner.factorizations == 1, f"3 solves, {runner.factorizations} factorisation(s) (expected 1)")

    # Reference: plain bw2calc with SuperLU only (use_umfpack False), the behaviour when UMFPACK is unavailable.
    real = bw2calc.lca.spsolve
    bw2calc.lca.spsolve = lambda *a, **k: real(*a, **{**k, "use_umfpack": False})
    try:
        for i, got in zip((0, 3, 7), scores):
            lca = bw2calc.LCA({bw2data.get_activity((DB, f"a{i}")): 1.0 + i}, METHOD)
            lca.lci()
            lca.lcia()
            ref = float(lca.score)
            rel = abs(got - ref) / abs(ref)
            check(rel < TOL, f"runner score a{i} equals SuperLU ({got:.12g} vs {ref:.12g}, rel {rel:.2e})")
    finally:
        bw2calc.lca.spsolve = real


def main() -> int:
    print(f"numpy {_version('numpy')}  scipy {_version('scipy')}  scikit-umfpack {_version('scikit-umfpack')}  "
          f"bw2calc {_version('bw2calc')}  python {sys.version.split()[0]}")
    check(bool(w._UMFPACK_OK), "mapper.core.bw2_wrapper._UMFPACK_OK is True")
    if not w._UMFPACK_OK:
        print("\nUMFPACK is not usable: the build would fall back to the slow solver.")
        return 1
    low_level()
    through_the_runner()
    if failures:
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("\nUMFPACK loads and agrees with SuperLU")
    return 0


if __name__ == "__main__":
    sys.exit(main())
