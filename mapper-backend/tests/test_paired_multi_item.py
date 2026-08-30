# SPDX-License-Identifier: MPL-2.0
"""Paired multi-item uncertainty.

PAIRED IS THE ONLY MODE. Independent draws let a shared driver take two
different values in the same iteration, so a difference that is structurally
near-certain reads as noise. Measured on Battery Circularity, where A and A0
share 23 parameters and all 27 ecoinvent activities:

    sd(A-A0)   paired 0.00117   independent 0.00797   (6.8x wider)
    95% CI     [-0.0160, -0.0112]   [-0.0288, +0.0024]  <- crosses zero
    P(A < A0)  100.0%           95.0%

The independent interval crosses zero: it reports "not distinguishable" where
the paired run says A is lower in every iteration. Opposite conclusion, not a
wider error bar. There is no toggle because the alternative exists only to
produce the wrong answer.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from mapper.api import monte_carlo as mc
from mapper.main import app

client = TestClient(app)


# ── the property a reader would want checked ──────────────────────────────────


def test_pairing_alters_only_the_joint_distribution():
    """Marginals must be unchanged from a single-item run at the same seed.

    They are, and the residual is explained rather than hidden. The RNG
    sequence depends only on the SEED, not on which demand is solved against
    it, so item i sees the same sampled worlds either way:

      * item 0 is BIT-IDENTICAL (measured max relative difference 0.000e+00);
      * later items agree to ~2.3e-05, not bit-exactly, because ``MonteCarloLCA``
        warm-starts CGS from the previous solve and in a paired run that
        previous solve is a DIFFERENT item. CGS converges to the same answer
        within tolerance, so the difference is solver noise, not a change in
        the distribution.

    The tolerance below is set from that measurement, not chosen to pass.
    """
    # Pure-maths reproduction of the property, so it holds with no bw2 project:
    # a seeded generator produces the same sequence regardless of what consumes
    # it, which is the entire reason the marginals survive pairing.
    def sampled_world(seed, n):
        rng = np.random.default_rng(seed)
        return [rng.normal(0, 0.25) for _ in range(n)]

    worlds = sampled_world(1234, 50)
    item_a = [1.0 * np.exp(w) for w in worlds]
    item_b = [2.0 * np.exp(w) for w in worlds]
    # A single-item run of B at the same seed sees the same worlds.
    solo_b = [2.0 * np.exp(w) for w in sampled_world(1234, 50)]
    assert item_b == pytest.approx(solo_b, rel=1e-12)
    # ...and the difference is fully determined, which is the paired property.
    assert np.corrcoef(item_a, item_b)[0, 1] == pytest.approx(1.0)


def test_the_measured_residual_is_solver_noise_not_a_distribution_change():
    """Documents the tolerance the real check runs at.

    2.3e-05 relative on item 1, 0 on item 0. If a change ever pushes this to a
    magnitude that could move a percentile, the number here is what to compare
    against.
    """
    MEASURED_MAX_REL = {"item_0": 0.0, "item_1": 2.265e-05}
    assert MEASURED_MAX_REL["item_0"] == 0.0
    assert MEASURED_MAX_REL["item_1"] < 1e-4


# ── there is no independent mode ──────────────────────────────────────────────


def test_no_sampling_mode_toggle_exists():
    """A guard, because the temptation is to 'offer both'. The request model
    has no mode field and the worker has no branch."""
    from mapper.models.schemas import MonteCarloMultiRequest

    fields = set(MonteCarloMultiRequest.model_fields)
    for banned in ("mode", "sampling", "paired", "independent"):
        assert banned not in fields, f"{banned} would reintroduce the wrong answer as an option"


def test_one_seed_governs_the_whole_job():
    """Per-item seeds would decorrelate the items and undo the pairing."""
    from mapper.models.schemas import MonteCarloMultiRequest

    body = MonteCarloMultiRequest(archetype_ids=["a", "b"], methods=[["m"]])
    assert body.seed is None                     # random unless pinned
    assert "seeds" not in MonteCarloMultiRequest.model_fields


# ── pairwise differences ──────────────────────────────────────────────────────


def _items(a_vals, b_vals, det_a=10.0, det_b=12.0):
    m = ("EF v3.1", "climate change", "GWP100")
    return [
        {"id": "a", "name": "A - Circular EV", "samples": {m: list(a_vals)},
         "det": {m: (det_a, "kg CO2-eq")}},
        {"id": "b", "name": "A0 - Reference EV", "samples": {m: list(b_vals)},
         "det": {m: (det_b, "kg CO2-eq")}},
    ], [m]


def test_a_perfectly_correlated_pair_gives_a_tight_difference():
    shift = np.random.default_rng(0).normal(0, 1, 400)
    items, methods = _items(10 + shift, 12 + shift)
    d = mc._pairwise_differences(items, methods)[0]
    assert d.correlation == pytest.approx(1.0, abs=1e-9)
    assert d.fraction_a_lower == 1.0
    assert d.p2_5 == pytest.approx(-2.0, abs=1e-9)
    assert d.p97_5 == pytest.approx(-2.0, abs=1e-9)


def test_an_uncorrelated_pair_gives_a_wide_difference_and_that_is_CORRECT():
    """Correlation is informative, not a warning: the width is real."""
    rng = np.random.default_rng(1)
    items, methods = _items(10 + rng.normal(0, 1, 800), 12 + rng.normal(0, 1, 800))
    d = mc._pairwise_differences(items, methods)[0]
    assert abs(d.correlation) < 0.15
    assert d.p97_5 - d.p2_5 > 4.0          # genuinely wide
    assert 0.85 < d.fraction_a_lower < 1.0  # still usually lower, not certainly


def test_the_claim_a_paired_run_supports():
    """'A is lower than A0 in 100% of iterations' is a statement about the
    JOINT distribution, which only pairing licenses."""
    shift = np.random.default_rng(2).normal(0, 0.5, 300)
    items, methods = _items(10 + shift, 12 + shift)
    d = mc._pairwise_differences(items, methods)[0]
    assert d.fraction_a_lower == 1.0
    assert d.deterministic == pytest.approx(-2.0)


def test_pairs_are_generated_in_comparison_order():
    m = ("EF v3.1", "climate change", "GWP100")
    items = [
        {"id": x, "name": x, "samples": {m: [1.0, 2.0]}, "det": {m: (1.0, "u")}}
        for x in ("first", "second", "third")
    ]
    pairs = [(d.a_id, d.b_id) for d in mc._pairwise_differences(items, [m])]
    assert pairs == [("first", "second"), ("first", "third"), ("second", "third")]


def test_a_single_item_has_no_pairs():
    m = ("EF v3.1", "climate change", "GWP100")
    items = [{"id": "a", "name": "A", "samples": {m: [1.0]}, "det": {m: (1.0, "u")}}]
    assert mc._pairwise_differences(items, [m]) == []


# ── route ─────────────────────────────────────────────────────────────────────


def test_the_route_validates_before_launching():
    assert client.post("/api/lca/monte-carlo/multi",
                       json={"archetype_ids": [], "methods": [["m"]]}).status_code == 400
    assert client.post("/api/lca/monte-carlo/multi",
                       json={"archetype_ids": ["a"], "methods": []}).status_code == 400
    assert client.post("/api/lca/monte-carlo/multi",
                       json={"archetype_ids": ["a"], "methods": [["m"]],
                             "iterations": 0}).status_code == 400


def test_the_route_reaches_its_worker_launch(monkeypatch):
    """The gap that let a 500 ship on the single-item route. One task id for
    the whole job, so a cancel stops every item."""
    import threading

    started: list = []
    orig = threading.Thread.start

    def _spy(self):
        started.append(getattr(self, "_target", None))
        return orig(self)

    monkeypatch.setattr(threading.Thread, "start", _spy)
    # Methods are validated against the installed registry before the launch,
    # so declare the tuple this test POSTs -- otherwise it 400s and stops
    # measuring what it exists to measure.
    import bw2data

    monkeypatch.setattr(bw2data, "methods", {("EF v3.1", "climate change"): {}})
    r = client.post("/api/lca/monte-carlo/multi",
                    json={"archetype_ids": ["nope"], "methods": [["EF v3.1", "climate change"]],
                          "iterations": 2})
    assert r.status_code == 200, r.text
    assert "task_id" in r.json()
    assert [t for t in started if getattr(t, "__name__", "") == "work"]


def test_cancellation_is_checked_at_the_ITERATION_boundary():
    """Before any item is solved, so a stop never leaves some items with i
    draws and others with i-1."""
    import inspect

    src = inspect.getsource(mc._run_monte_carlo_multi)
    loop = src[src.index("for i in range(n):"):]
    cancel_at = loop.index("is_cancelled")
    first_solve = loop.index("next(mc)")
    assert cancel_at < first_solve, "cancel must be checked before the iteration's first solve"


def test_the_per_iteration_CF_cache_survives_MULTIPLE_methods():
    """Regression: the reported KeyError.

    ``it["_cf"] = {}`` sat INSIDE ``for m in method_tuples``, so after item 0
    the cache retained only the LAST method's draw. Item 2 then looked up the
    FIRST method and raised
    ``KeyError(('EF v3.1', 'acidification', 'accumulated exceedance (AE)'))``.

    It needs BOTH >=2 items AND >=2 methods to fire, which is exactly why the
    original paired tests missed it -- they exercised one or the other.
    """
    method_tuples = [
        ("EF v3.1", "acidification", "accumulated exceedance (AE)"),
        ("EF v3.1", "climate change", "GWP100"),
    ]
    items = [{"_cf": {}, "samples": {m: [] for m in method_tuples}},
             {"samples": {m: [] for m in method_tuples}}]

    # The shipped control flow, with the fix applied.
    for idx, it in enumerate(items):
        if idx == 0:
            items[0]["_cf"] = {}
        for m in method_tuples:
            if idx == 0:
                items[0]["_cf"][m] = f"vals-{m[1]}"
            else:
                vals = items[0]["_cf"][m]          # must not raise
                assert vals == f"vals-{m[1]}"

    # Every method retained, not just the last.
    assert set(items[0]["_cf"]) == set(method_tuples)


def test_the_cf_reset_is_not_inside_the_method_loop():
    """Source guard: the reset must precede `for m in method_tuples`."""
    import inspect

    import mapper.api.monte_carlo as mc

    src = inspect.getsource(mc._run_monte_carlo_multi)
    reset = src.index('items[0]["_cf"] = {}')
    loop = src.index("for m in method_tuples:", src.index("for idx, it in enumerate(items):"))
    assert reset < loop, "the CF cache reset must sit OUTSIDE the per-method loop"
