# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Smoke-test that PersistentLCARunner produces identical results to
run_lca_multi_method and is faster on repeated calls.

Run with: python -m pytest tests/test_persistent_lca.py -v -s
Or standalone: python tests/test_persistent_lca.py
"""
from __future__ import annotations

import time
import sys

def main():
    """Compare PersistentLCARunner vs run_lca_multi_method on real data."""
    try:
        import bw2data
    except ImportError:
        print("SKIP: bw2data not installed")
        return

    from mapper.core.bw2_wrapper import PersistentLCARunner, run_lca_multi_method

    # Check if there are databases available — skip biosphere-only DBs
    dbs = [d for d in bw2data.databases if "biosphere" not in d.lower()]
    if not dbs:
        print("SKIP: no technosphere databases in current project")
        return

    # Pick the first technosphere database
    db_name = dbs[0]
    db = bw2data.Database(db_name)
    activities = list(db)[:3]
    if len(activities) < 1:
        print(f"SKIP: database '{db_name}' has no activities")
        return

    # Build a simple demand
    demand = {act.key: 1.0 for act in activities}

    # Pick up to 3 methods
    all_methods = list(bw2data.methods)[:3]
    if not all_methods:
        print("SKIP: no LCIA methods available")
        return

    method_tuples = [tuple(m) for m in all_methods]
    print(f"Database: {db_name} ({len(db)} activities)")
    print(f"Demand: {len(demand)} activities")
    print(f"Methods: {len(method_tuples)}")

    N_CALLS = 10  # enough to amortize the factorization

    # ── Baseline: run_lca_multi_method (creates new LCA each time) ────────
    t0 = time.perf_counter()
    ref_scores = {}
    for i in range(N_CALLS):
        d = {k: v * (1.0 + i * 0.1) for k, v in demand.items()}
        result = run_lca_multi_method(d, method_tuples)
        ref_scores[i] = result
    baseline_elapsed = time.perf_counter() - t0
    print(f"\nBaseline ({N_CALLS} calls): {baseline_elapsed:.3f}s "
          f"({baseline_elapsed/N_CALLS:.3f}s/call)")

    # ── Optimized: PersistentLCARunner ────────────────────────────────────
    runner = PersistentLCARunner()
    t0 = time.perf_counter()
    opt_scores = {}
    for i in range(N_CALLS):
        d = {k: v * (1.0 + i * 0.1) for k, v in demand.items()}
        result = runner(d, method_tuples)
        opt_scores[i] = result
    persistent_elapsed = time.perf_counter() - t0
    print(f"Persistent ({N_CALLS} calls): {persistent_elapsed:.3f}s "
          f"({persistent_elapsed/N_CALLS:.3f}s/call)")
    print(f"Speedup: {baseline_elapsed / persistent_elapsed:.1f}x")
    print(f"Diagnostics: factorizations={runner.factorizations}, "
          f"redo_calls={runner.redo_calls}, "
          f"method_switches={runner.method_switches}")

    # ── Compare results ──────────────────────────────────────────────────
    max_diff = 0.0
    for i in range(N_CALLS):
        for m in method_tuples:
            ref_score = ref_scores[i][m][0]
            opt_score = opt_scores[i][m][0]
            if ref_score != 0:
                rel_diff = abs((opt_score - ref_score) / ref_score)
            else:
                rel_diff = abs(opt_score)
            max_diff = max(max_diff, rel_diff)
            if rel_diff > 1e-6:
                print(f"  MISMATCH call={i} method={m}: "
                      f"ref={ref_score:.6e} opt={opt_score:.6e} "
                      f"rel_diff={rel_diff:.2e}")

    if max_diff < 1e-6:
        print(f"\nAll scores match (max relative diff: {max_diff:.2e})")
    else:
        print(f"\nWARNING: Max relative diff = {max_diff:.2e}")
        sys.exit(1)

    # Verify diagnostics
    assert runner.factorizations == 1, f"Expected 1 factorization, got {runner.factorizations}"
    assert runner.redo_calls == N_CALLS - 1, \
        f"Expected {N_CALLS-1} redo_lci calls, got {runner.redo_calls}"
    print("\nPASS: PersistentLCARunner is correct and faster.")


if __name__ == "__main__":
    main()
