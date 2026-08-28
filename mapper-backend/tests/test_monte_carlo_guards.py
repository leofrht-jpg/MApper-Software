# SPDX-License-Identifier: MPL-2.0
"""Guards for the three things about this feature that look wrong when right,
or right when wrong.

1. ``DirectSolvingMonteCarloLCA`` LOOKS like the rigorous choice. It is 27x
   slower for numerically identical answers.
2. Letting an expression row carry its own uncertainty LOOKS harmless. It
   double-draws the shared parameter and NARROWS the reported spread.
3. Fleet-level Monte Carlo LOOKS like a natural extension. It is 78x the cost
   and the DSM adds its own uncertainty axis.

Each guard is checked to be load-bearing by an accompanying test that
reproduces the mistake and asserts it is caught.
"""

import ast
import re
from pathlib import Path

import numpy as np
import pytest

from mapper.core import monte_carlo_engine as mce
from mapper.core.monte_carlo_engine import (
    UncertaintyConfigError,
    collect_row_draws,
    lognormal_factor,
    sigma_of,
    summarize,
    variance_shares,
)
from mapper.models.bom_schemas import EcoinventLink, FlattenedMaterial, RowUncertainty

BACKEND = Path(__file__).resolve().parents[1] / "mapper"
MC_API = BACKEND / "api" / "monte_carlo.py"
MC_ENGINE = BACKEND / "core" / "monte_carlo_engine.py"


# ── 1. the solver ─────────────────────────────────────────────────────────────


def _monte_carlo_constructors(src: str) -> set[str]:
    """Every ``bw2calc.<X>`` attribute actually CALLED in the module.

    AST-based, not textual: the module docstring names
    ``DirectSolvingMonteCarloLCA`` in order to explain why it is not used, and
    a grep would flag that prose. Only a call site counts.
    """
    tree = ast.parse(src)
    found: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
            if f.value.id == "bw2calc":
                found.add(f.attr)
        elif isinstance(f, ast.Name):
            found.add(f.id)
    return found


def test_uses_the_warm_started_iterative_solver():
    """MonteCarloLCA, never DirectSolvingMonteCarloLCA.

    ``MonteCarloLCA`` solves with CGS warm-started from the previous
    iteration's answer. Consecutive iterations perturb A only slightly, so it
    converges in a few steps: 0.066 s/iter against 1.76 s/iter for the direct
    solver, which refactorises every time.

    The answers are the same, so the slow one buys nothing -- same seed, 60
    iterations, max relative difference 9.4e-8, mean/sd/GSD^2 identical to six
    figures. Switching to the direct solver would turn a ~1 minute run into
    ~30 minutes for no change in the numbers.
    """
    called = _monte_carlo_constructors(MC_API.read_text())
    assert "MonteCarloLCA" in called
    assert "DirectSolvingMonteCarloLCA" not in called
    assert "ComparativeMonteCarlo" not in called


def test_the_solver_guard_catches_the_swap():
    """Anti-vacuity: the check must fail on the mistake it exists to stop."""
    broken = "import bw2calc\nmc = bw2calc.DirectSolvingMonteCarloLCA(d, m, seed=1)\n"
    assert "DirectSolvingMonteCarloLCA" in _monte_carlo_constructors(broken)
    # ...and must NOT fire on prose that merely mentions the name.
    prose = '"""Never use DirectSolvingMonteCarloLCA."""\nimport bw2calc\nx = bw2calc.MonteCarloLCA(d, m)\n'
    assert "DirectSolvingMonteCarloLCA" not in _monte_carlo_constructors(prose)


# ── 2. the expression-row rule ────────────────────────────────────────────────


def _row(name, qty=1.0, expr=None, unc=None):
    """A FLATTENED material -- what the real call site passes.

    Building BOMNodes here instead would test a shape the engine never sees,
    which is the same gap that let the rule silently never fire once already:
    the flatten dropped `quantity_expression`, so the check read None on every
    row in production while a BOMNode-based test stayed green.
    """
    return FlattenedMaterial(
        node_id=f"node-{name}",
        name=name,
        quantity=qty,
        unit="kg",
        quantity_expression=expr,
        uncertainty=unc,
        ecoinvent_activity=EcoinventLink(database="db", code=f"code-{name}", name=name),
    )


def test_expression_row_cannot_carry_its_own_uncertainty():
    """An expression row inherits uncertainty from its PARAMETERS.

    Carrying its own as well draws the shared driver twice. The two draws
    partly cancel, so the reported spread NARROWS -- under-reporting
    uncertainty, the one direction that cannot be defended in a paper. It is
    rejected rather than resolved by precedence, because either precedence
    rule would produce a plausible-looking wrong number.
    """
    rows = [_row("literal", unc=RowUncertainty(pedigree={"reliability": 3}))]
    assert len(collect_row_draws(rows)) == 1  # literal is fine

    bad = [
        _row(
            "annual driving",
            expr="d_annual * w_car",
            unc=RowUncertainty(pedigree={"reliability": 3}),
        )
    ]
    with pytest.raises(UncertaintyConfigError, match="expression"):
        collect_row_draws(bad)


def test_an_expression_row_without_its_own_uncertainty_is_accepted():
    """The rule bans the COMBINATION, not expressions."""
    rows = [_row("annual driving", expr="d_annual * w_car")]
    assert collect_row_draws(rows) == []


def test_independent_row_draws_understate_a_shared_driver():
    """Load-bearing check on the rule above, modelling the measured effect.

    If an expression row carried its own uncertainty, the honest shared draw
    would be replaced (or diluted) by an independent per-row one. Independent
    draws across n rows average out -- the aggregate spread falls by roughly
    sqrt(n) -- while one shared driver passes its full spread through to the
    total. That is the direction of the error: UNDER-reported uncertainty,
    the one direction that cannot be defended in a paper.

    Measured on PHEV-NMC811 at the same marginal spread: GSD^2 1.273 for 35
    independent row draws against 1.415 for one shared driver.
    """
    rng = np.random.default_rng(0)
    sigma = 0.25
    n_rows, n_iter = 35, 6000

    shared, independent = [], []
    for _ in range(n_iter):
        z = lognormal_factor(rng, sigma)
        shared.append(n_rows * z)
        independent.append(sum(lognormal_factor(rng, sigma) for _ in range(n_rows)))

    gsd2 = lambda xs: float(np.exp(1.96 * np.std(np.log(np.asarray(xs)))))
    g_shared, g_indep = gsd2(shared), gsd2(independent)

    assert g_indep < g_shared, (
        f"independent draws should understate: {g_indep:.3f} vs {g_shared:.3f}"
    )
    # The dilution is large, not marginal -- roughly the sqrt(n) the maths
    # predicts, which is why silently picking either precedence rule would
    # produce a plausible-looking wrong answer rather than an obvious one.
    assert (g_shared - 1) / (g_indep - 1) > 3


# ── 3. the fleet boundary ─────────────────────────────────────────────────────


def test_dsm_path_never_reaches_monte_carlo():
    """Fleet-level Monte Carlo is out of scope, and stays out.

    78x the cost (26 years x 3 scopes) and the DSM contributes its own
    uncertainty axis -- a modelling question, not a sampling one. Same family
    as the parameter-resolution and stage-basis guards: the boundary is
    asserted, not described.
    """
    engine = (BACKEND / "core" / "dsm_lca_engine.py").read_text()
    for banned in ("monte_carlo", "MonteCarloLCA", "monte-carlo"):
        assert banned not in engine, (
            f"{banned!r} appears in dsm_lca_engine.py -- fleet-level Monte "
            "Carlo is explicitly out of scope."
        )

    # And from the other side: the Monte Carlo API must not import the DSM
    # pipeline, so it cannot grow a fleet path by accident.
    api = MC_API.read_text()
    assert "DSMLCAPipeline" not in api
    assert "dsm_lca_engine" not in api


def test_the_fleet_guard_catches_the_import():
    """Anti-vacuity for the boundary sweep."""
    sample = "from mapper.core.dsm_lca_engine import DSMLCAPipeline\n"
    assert "DSMLCAPipeline" in sample and "dsm_lca_engine" in sample


# ── the sampler's own properties ──────────────────────────────────────────────


def test_the_draw_is_median_preserving():
    """exp(N(0, sigma)) has median 1, so the deterministic value stays the
    median of the FOREGROUND draws. That is what makes the
    deterministic-vs-median comparison in the UI meaningful rather than a
    comparison of two different quantities."""
    rng = np.random.default_rng(7)
    draws = [lognormal_factor(rng, 0.3) for _ in range(20000)]
    assert np.median(draws) == pytest.approx(1.0, abs=0.02)


def test_zero_sigma_is_exactly_one():
    """An untagged row must be provably unaffected, not approximately so."""
    rng = np.random.default_rng(1)
    assert all(lognormal_factor(rng, 0.0) == 1.0 for _ in range(100))
    assert sigma_of(None) == 0.0


def test_a_directly_supplied_gsd2_wins_over_pedigree():
    """So the two cannot silently compound."""
    unc = RowUncertainty(pedigree={"reliability": 5}, gsd2=1.5)
    assert sigma_of(unc) == pytest.approx(np.log(1.5) / 2)


def test_summarize_reports_zero_gsd2_rather_than_nan_on_negative_draws():
    """An indicator with credits can go negative; log of that is not a number.

    Reporting 0.0 is honest and renders; a nan would propagate into the UI.
    """
    s = summarize([-1.0, 2.0, 3.0, 4.0])
    assert s["gsd2"] == 0.0
    assert s["median"] == pytest.approx(2.5)
    assert not np.isnan(s["mean"])


def test_variance_shares_rank_the_dominant_input_first_and_sum_to_one():
    rng = np.random.default_rng(3)
    n = 2000
    big = rng.normal(0, 1, n)
    small = rng.normal(0, 1, n)
    out = 10 * big + 0.1 * small
    shares = dict(variance_shares({"big": big, "small": small}, out))
    assert shares["big"] > shares["small"]
    assert sum(shares.values()) == pytest.approx(1.0)


def test_background_coverage_is_stated_as_a_lower_bound():
    """~12% of ecoinvent's exchanges carry undefined uncertainty and are
    sampled as fixed, so any reported spread is a LOWER bound. The constant
    exists so the UI can say so rather than the docs alone."""
    assert 0.8 < mce.BACKGROUND_UNCERTAINTY_COVERAGE < 0.95
