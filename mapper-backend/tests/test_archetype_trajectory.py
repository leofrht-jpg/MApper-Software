# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Single-product continuous-horizon trajectory (Stage B.1).

`_trajectory_year_scores` steps ONE archetype's source-DB demand annually
across a prospective trajectory's premise anchors, reusing the 6A/6B primitives
(`resolve_bracket`, `resolve_database_for_year`, `blend_method_scores`). These
tests isolate the temporal logic from bw2 with a fake runner + fake translator:

- fake translate re-keys the source demand to the target anchor DB (no bw2).
- fake runner scores a demand as Σ amount × DB_FACTOR[db], so the background DB
  is the only thing that moves the score — and it counts calls so we can prove
  single- vs double-solve per year.

Covered: block vs interpolate (equal AT anchors via the shared blend, differ
strictly between); no-extrapolation clamp at span ends; the NO-DRIFT guard (the
continuous curve passes through the discrete single-DB value at each anchor);
the degenerate ≤1-anchor guard.
"""
from __future__ import annotations

import pytest

from mapper.api.lca import _trajectory_year_scores

METHOD = ("EF v3.1", "climate change", "GWP100")
METHOD2 = ("EF v3.1", "acidification", "AP")
# Decarbonizing background: 2025 high → 2050 low.
DB_FACTOR = {"db2025": 10.0, "db2030": 6.0, "db2035": 4.0, "db2050": 2.0}
DB_FACTOR2 = {"db2025": 1.0, "db2030": 0.8, "db2035": 0.6, "db2050": 0.4}
ANCHORS = [("db2025", 2025), ("db2030", 2030), ("db2035", 2035), ("db2050", 2050)]

# Source-DB demand (keys re-keyed to each anchor by the fake translator).
DEMAND = {("ei-3.10", "c1"): 2.0, ("ei-3.10", "c2"): 3.0}  # total amount = 5.0


def _fake_translate(demand, db):
    """Re-key the source demand to `db` (premise preserves codes). No warnings."""
    return {(db, code): amt for (_src, code), amt in demand.items()}, []


class _FakeRunner:
    """Scores a single-db demand as Σ amount × DB_FACTOR[db] per method; counts
    calls per db (so a year that double-solves is observable)."""

    def __init__(self):
        self.calls: list[str] = []

    def __call__(self, demand, method_tuples):
        if not demand:
            return {mt: (0.0, "u") for mt in method_tuples}
        db = next(iter(demand))[0]
        self.calls.append(db)
        total = sum(demand.values())
        out = {}
        for mt in method_tuples:
            table = DB_FACTOR if mt == METHOD else DB_FACTOR2
            out[mt] = (total * table[db], "kg" if mt == METHOD else "mol H+")
        return out


def _run(temporal_mode, anchors=ANCHORS, methods=(METHOD,), **kw):
    runner = _FakeRunner()
    per_year, warnings = _trajectory_year_scores(
        total_demand=DEMAND,
        method_tuples=list(methods),
        anchors=anchors,
        temporal_mode=temporal_mode,
        runner=runner,
        translate=_fake_translate,
        **kw,
    )
    return per_year, warnings, runner


def _score(per_year, year, method=METHOD):
    for y, scores in per_year:
        if y == year:
            return scores[method][0]
    raise AssertionError(f"year {year} not in result")


# ── span + stepping ──────────────────────────────────────────────────────────

def test_span_is_min_to_max_anchor_annual_step():
    per_year, _, _ = _run("interpolate")
    years = [y for y, _ in per_year]
    assert years == list(range(2025, 2051))  # 2025..2050 inclusive, annual


# ── block vs interpolate ─────────────────────────────────────────────────────

def test_block_holds_nearest_earlier_anchor():
    per_year, _, _ = _run("block")
    # 2027 → nearest-earlier anchor is db2025 (factor 10) → 5 × 10 = 50.
    assert _score(per_year, 2027) == pytest.approx(5.0 * 10.0)
    # 2031 → db2030 (factor 6) → 30.
    assert _score(per_year, 2031) == pytest.approx(5.0 * 6.0)


def test_interpolate_blends_between_anchors():
    per_year, _, _ = _run("interpolate")
    # 2027 brackets 2025↔2030, frac 0.4 → blend(50, 30) = 0.6·50 + 0.4·30 = 42.
    assert _score(per_year, 2027) == pytest.approx(0.6 * 50.0 + 0.4 * 30.0)


def test_block_and_interpolate_equal_at_anchor():
    # AT an anchor both paths do a single solve on the same db → identical.
    blk, _, _ = _run("block")
    itp, _, _ = _run("interpolate")
    for anchor_year in (2025, 2030, 2035, 2050):
        assert _score(blk, anchor_year) == pytest.approx(_score(itp, anchor_year))


def test_block_and_interpolate_differ_strictly_between():
    blk, _, _ = _run("block")
    itp, _, _ = _run("interpolate")
    assert _score(blk, 2027) != pytest.approx(_score(itp, 2027))


def test_interpolate_single_solves_at_anchor_double_between():
    # At an anchor: one runner call. Strictly between: two (db_a + db_b).
    _, _, r_anchor = _run("interpolate", year_start=2030, year_end=2030)
    assert len(r_anchor.calls) == 1
    _, _, r_between = _run("interpolate", year_start=2027, year_end=2027)
    assert len(r_between.calls) == 2


# ── no extrapolation / clamp ─────────────────────────────────────────────────

def test_year_start_before_span_clamps_to_first_anchor():
    per_year, _, _ = _run("interpolate", year_start=2010)
    assert per_year[0][0] == 2025  # clamped, not extrapolated to 2010


def test_year_end_after_span_clamps_to_last_anchor():
    per_year, _, _ = _run("interpolate", year_end=2099)
    assert per_year[-1][0] == 2050  # clamped, not extrapolated to 2099


def test_narrowing_within_span_is_honored():
    per_year, _, _ = _run("interpolate", year_start=2030, year_end=2035)
    assert [y for y, _ in per_year] == [2030, 2031, 2032, 2033, 2034, 2035]


# ── NO-DRIFT guard: curve passes through the discrete single-DB values ────────

def test_no_drift_at_anchor_equals_single_db_solve():
    # The continuous per-year total AT an anchor year must equal a direct
    # single-db solve on the translated demand (what calculate_archetype_lca
    # returns for compute_database=that anchor's db).
    per_year, _, _ = _run("interpolate")
    direct = _FakeRunner()
    for db, year in ANCHORS:
        translated, _ = _fake_translate(DEMAND, db)
        expected = direct(translated, [METHOD])[METHOD][0]
        assert _score(per_year, year) == pytest.approx(expected)


def test_no_drift_holds_for_block_too():
    per_year, _, _ = _run("block")
    direct = _FakeRunner()
    for db, year in ANCHORS:
        translated, _ = _fake_translate(DEMAND, db)
        expected = direct(translated, [METHOD])[METHOD][0]
        assert _score(per_year, year) == pytest.approx(expected)


# ── multi-method blend (lifted blend_method_scores covers every method) ───────

def test_blend_applies_per_method():
    per_year, _, _ = _run("interpolate", methods=(METHOD, METHOD2))
    # 2027 frac 0.4 between 2025/2030 for METHOD2: blend(5×1.0, 5×0.8) = 4.6.
    s2027 = _score(per_year, 2027, method=METHOD2)
    assert s2027 == pytest.approx(0.6 * 5.0 * 1.0 + 0.4 * 5.0 * 0.8)


# ── degenerate ≤1 anchor guard ───────────────────────────────────────────────

def test_zero_anchors_returns_empty_no_crash():
    per_year, warnings, runner = _run("interpolate", anchors=[])
    assert per_year == []
    assert warnings == []
    assert runner.calls == []


def test_single_anchor_returns_single_point():
    per_year, _, runner = _run("interpolate", anchors=[("db2030", 2030)])
    assert [y for y, _ in per_year] == [2030]
    assert _score(per_year, 2030) == pytest.approx(5.0 * 6.0)
    assert len(runner.calls) == 1  # one solve, no blend
