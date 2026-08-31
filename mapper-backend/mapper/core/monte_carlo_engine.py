# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Monte Carlo uncertainty propagation for SINGLE-PRODUCT assessment.

What samples what
-----------------
``bw2calc.MonteCarloLCA`` resamples the technosphere, the biosphere AND the
characterisation factors each iteration, so the BACKGROUND comes free. It does
NOT touch the foreground, for a structural reason: MApper writes no foreground
database. An archetype becomes a demand vector over ecoinvent activities --
your BOM quantities are the right-hand side, not entries in A -- so there is
nothing in the matrices for bw2calc to perturb.

The foreground therefore enters by resampling the demand vector per iteration
(``mc.demand = ...; mc.build_demand_array(); next(mc)``), measured at ~1%
overhead. No foreground database, no matrix surgery.

ORDER OF OPERATIONS PER ITERATION -- the part that must not be got wrong
-----------------------------------------------------------------------
    1. draw each PARAMETER once
    2. re-resolve every expression against those draws
    3. apply per-row uncertainty to LITERAL rows only

Step 1 before step 2 is what keeps a shared driver correlated. ``d_annual``
appears in many WP5 expressions; if those rows were each drawn independently
the shared driver averages away and the reported spread NARROWS. Measured on
PHEV-NMC811 at the same marginal spread: 35 independent row draws gave
GSD^2 1.2793, one shared driver gave 1.4251 -- originally measured as 1.273
and 1.415 under the pre-2026-08-31 exp(1.96*sigma), restated at exp(2*sigma).
The originals stay visible because they are what that patch measured; the gap
they demonstrate is unchanged either way. Under-reporting uncertainty is the
one direction that cannot be defended in a paper.

Step 3's "literal rows only" is the same rule from the other side. An
expression row already inherits its uncertainty through step 2; letting it
also carry its own would draw the driver twice, and because the two draws
partly cancel the spread narrows again. That combination is REJECTED here
rather than resolved by precedence -- see ``UncertaintyConfigError`` and
``tests/test_monte_carlo_guards.py::test_expression_row_cannot_carry_its_own``.

Never DirectSolvingMonteCarloLCA
--------------------------------
``MonteCarloLCA`` uses a CGS iterative solve warm-started from the previous
iteration's answer. Consecutive iterations perturb A only slightly, so it
converges in a few steps: 0.066 s/iter against 1.76 s/iter for
``DirectSolvingMonteCarloLCA``, which refactorises every time -- 27x slower.

The results are the same, so the slow one buys nothing: same seed, 60
iterations, max relative difference 9.4e-8, with mean/sd/GSD^2 identical to
six figures. The direct solver LOOKS like the more rigorous choice to someone
who does not know the iterative one is warm-started here, which is exactly why
``test_monte_carlo_guards.py::test_uses_the_warm_started_iterative_solver``
exists.

Single-product only
-------------------
Fleet-level Monte Carlo is out of scope: 78x the cost (26 years x 3 scopes)
and the DSM contributes its own uncertainty axis, which is a modelling
question and not a sampling one. ``test_dsm_path_never_reaches_monte_carlo``
guards the boundary, in the same family as the parameter-resolution and
stage-basis guards.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Sequence

import numpy as np

from mapper.core.pedigree import DEFAULT_BASIC_VARIANCE, gsd2_from_sigma, total_sigma

#: Default iteration count. 1000 sits at 0.18% drift on the 2.5/50/97.5
#: percentiles against a 1200-iteration reference (500 was at 1.33%).
DEFAULT_ITERATIONS = 1000

#: Share of ecoinvent 3.10 non-production exchanges carrying an actual
#: distribution. The remaining ~12% are "undefined" and are sampled as FIXED,
#: so any spread this engine reports is a LOWER BOUND on background
#: uncertainty. Surfaced in the UI, not just here.
BACKGROUND_UNCERTAINTY_COVERAGE = 0.88


class UncertaintyConfigError(ValueError):
    """An uncertainty declaration that would mis-state the spread."""


# ── Drawing ───────────────────────────────────────────────────────────────────


def sigma_of(unc: Any) -> float:
    """Lognormal sigma for a RowUncertainty / ParamUncertainty.

    A directly-supplied ``gsd2`` wins over pedigree scores so the two cannot
    silently compound; ``gsd2 = exp(2 sigma)``, so ``sigma = ln(gsd2) / 2``.
    """
    if unc is None:
        return 0.0
    gsd2 = getattr(unc, "gsd2", None)
    if gsd2 is not None:
        if gsd2 <= 0:
            raise UncertaintyConfigError(f"gsd2 must be > 0, got {gsd2}")
        return math.log(gsd2) / 2.0
    return total_sigma(
        getattr(unc, "pedigree", None),
        getattr(unc, "basic_variance", DEFAULT_BASIC_VARIANCE),
    )


def lognormal_factor(rng: np.random.Generator, sigma: float) -> float:
    """A median-preserving multiplicative draw.

    ``exp(N(0, sigma))`` has median 1, so the deterministic value stays the
    median of the sampled distribution. That is what makes the
    deterministic-vs-median comparison in the UI a meaningful check rather
    than a comparison of two different quantities.
    """
    if sigma <= 0:
        return 1.0
    return float(np.exp(rng.normal(0.0, sigma)))


# ── Configuration collected once, before the loop ─────────────────────────────


@dataclass
class _RowDraw:
    """A literal row that carries uncertainty.

    Keyed by ``node_id``, not by ``(database, code)`` and not by NAME. Several
    rows can link the same ecoinvent activity -- a demand dict aggregates them
    -- so scaling an aggregated demand entry would apply one row's factor to
    every other row sharing its code. The factor is applied per material during
    demand construction instead.

    The node_id keying is ALSO what makes the material-name library a pure
    authoring convenience: two rows inheriting one name's score still get two
    independent draws, exactly as if the scores had been typed onto each row.
    """
    node_id: str
    name: str
    sigma: float
    #: True when the score came from the material library rather than the row.
    #: Display only -- the draw is identical either way.
    inherited: bool = False


@dataclass
class _ParamDraw:
    """A parameter that carries uncertainty."""
    name: str
    base_value: float
    sigma: float


@dataclass
class MonteCarloPlan:
    """Everything decided before the first iteration."""
    rows: list[_RowDraw] = field(default_factory=list)
    params: list[_ParamDraw] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def varies_foreground(self) -> bool:
        return bool(self.rows or self.params)

    @property
    def varies_parameters(self) -> bool:
        return bool(self.params)


def collect_row_draws(
    linked_materials: Iterable[Any],
    library: dict[str, Any] | None = None,
) -> list[_RowDraw]:
    """Literal rows carrying uncertainty, with the expression rule enforced.

    Resolution order per row:

    1. the row's OWN ``uncertainty`` (an Excel column or an in-app override)
    2. the material-name ``library``, if the name is scored there
    3. unscored -- no foreground variance, exactly as before

    An expression row is skipped at every level: it inherits its uncertainty
    from the parameters in its expression, so it takes no library score either.
    Carrying its own raises rather than picking a winner -- silently preferring
    either one mis-states the spread, and the failure would be invisible in the
    output.

    INHERITANCE SHARES THE SCORE, NEVER THE DRAW. Each returned ``_RowDraw``
    carries its own ``node_id`` and is drawn independently, so two rows
    inheriting one name's score behave exactly as if the scores had been typed
    onto each row separately. See ``MaterialPedigreeLibrary`` for why that is
    the right semantics here and why it differs from a shared PARAMETER.
    """
    lib = library or {}
    out: list[_RowDraw] = []
    for m in linked_materials:
        unc = getattr(m, "uncertainty", None)
        inherited = False
        if unc is None and not getattr(m, "quantity_expression", None):
            unc = lib.get(getattr(m, "name", None))
            inherited = unc is not None
        if unc is None:
            continue
        if getattr(m, "quantity_expression", None):
            raise UncertaintyConfigError(
                f"Row {m.name!r} has a quantity expression AND its own uncertainty. "
                "An expression row inherits uncertainty from the parameters in its "
                "expression; carrying its own as well would draw the shared driver "
                "twice and narrow the reported spread. Put the uncertainty on the "
                "parameters instead, or replace the expression with a literal."
            )
        if getattr(m, "ecoinvent_activity", None) is None:
            continue
        out.append(
            _RowDraw(
                node_id=m.node_id, name=m.name,
                sigma=sigma_of(unc), inherited=inherited,
            )
        )
    return out


def collect_param_draws(table: Any, referenced: set[str]) -> list[_ParamDraw]:
    """Parameters carrying uncertainty that are actually referenced by the BOM.

    Restricting to referenced names keeps the variance-contribution table
    honest: a project-wide table may carry uncertainty on parameters this
    archetype never touches, and listing those as zero-share contributors is
    noise.
    """
    out: list[_ParamDraw] = []
    for name, p in getattr(table, "parameters", {}).items():
        unc = getattr(p, "uncertainty", None)
        if unc is None or name not in referenced:
            continue
        out.append(
            _ParamDraw(name=name, base_value=float(p.base_value), sigma=sigma_of(unc))
        )
    return out


# ── Statistics ────────────────────────────────────────────────────────────────


def summarize(samples: Sequence[float]) -> dict[str, float]:
    """Percentile summary of one indicator's draws.

    TWO dispersion figures, because they are two different statistics and one
    name was being used for both:

    ``gsd2`` is the squared geometric standard deviation, ``exp(2*sigma)``.
    That constant is not a choice. It is ecoinvent's convention -- recoverable
    from the data, since ``scale**2 - scale_without_pedigree**2`` on a
    single-score exchange implies a sigma for which ``exp(2*sigma)`` reproduces
    the published pedigree factor and ``exp(1.96*sigma)`` does not -- and it is
    what ``pedigree.gsd2_from_sigma`` uses on the INPUT side. One definition
    across both halves of a run is the whole point; ``tests/
    test_gsd2_one_definition.py`` pins it.

    ``dispersion_95`` is the EMPIRICAL upper 95% multiplier, ``p97.5 / median``,
    read straight off the percentiles above. It assumes nothing about the
    shape. This is what the old ``exp(1.96*sigma)`` was reaching for and got
    wrong twice over: it was not GSD2 (its label), and it was not the
    dispersion either, because a sum of lognormals is not lognormal. Measured
    on B0 at 300 iterations it read 1.41736 against a true GSD2 of 1.42748 and
    an actual p97.5/median of 1.51082 -- 6.6% below the thing it approximated,
    which was already sitting two fields away.

    Both are computed in log space / from positive draws only. A non-positive
    draw is legitimate for an indicator with credits (an avoided-burden row can
    push a score negative), and ``log`` of it is not; reporting 0.0 there is
    honest, where a nan would propagate into the UI.
    """
    a = np.asarray(samples, dtype=float)
    q = np.percentile(a, [2.5, 25, 50, 75, 97.5])
    gsd2 = 0.0
    if a.size and np.all(a > 0):
        gsd2 = float(np.exp(2.0 * np.std(np.log(a))))
    median, p97_5 = float(q[2]), float(q[4])
    dispersion_95 = (p97_5 / median) if median > 0 else 0.0
    return {
        "p2_5": float(q[0]),
        "p25": float(q[1]),
        "median": median,
        "p75": float(q[3]),
        "p97_5": p97_5,
        "mean": float(a.mean()) if a.size else 0.0,
        "gsd2": gsd2,
        "dispersion_95": dispersion_95,
    }


def variance_shares(
    draws: dict[str, np.ndarray],
    output: Sequence[float],
) -> list[tuple[str, float]]:
    """Approximate share of output spread attributable to each input.

    Squared Spearman rank correlation, normalised to sum to 1. Rank-based
    because the relationship is multiplicative rather than linear, and
    normalised because the inputs are not orthogonal -- so these are an
    ATTRIBUTION of the spread, not an exact variance decomposition. The UI
    labels them approximate for that reason.
    """
    y = np.asarray(output, dtype=float)
    if y.size < 3 or not draws:
        return []

    def rank(v: np.ndarray) -> np.ndarray:
        order = v.argsort()
        r = np.empty_like(order, dtype=float)
        r[order] = np.arange(len(v), dtype=float)
        return r

    ry = rank(y)
    raw: list[tuple[str, float]] = []
    for name, x in draws.items():
        rx = rank(np.asarray(x, dtype=float))
        sx, sy = rx.std(), ry.std()
        if sx == 0 or sy == 0:
            raw.append((name, 0.0))
            continue
        rho = float(((rx - rx.mean()) * (ry - ry.mean())).mean() / (sx * sy))
        raw.append((name, rho * rho))
    total = sum(v for _, v in raw)
    if total <= 0:
        return [(n, 0.0) for n, _ in raw]
    return sorted(((n, v / total) for n, v in raw), key=lambda t: -t[1])


__all__ = [
    "BACKGROUND_UNCERTAINTY_COVERAGE",
    "DEFAULT_ITERATIONS",
    "MonteCarloPlan",
    "UncertaintyConfigError",
    "collect_param_draws",
    "collect_row_draws",
    "gsd2_from_sigma",
    "lognormal_factor",
    "sigma_of",
    "summarize",
    "variance_shares",
]
