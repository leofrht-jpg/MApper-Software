# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Pedigree-matrix uncertainty factors for MApper's FOREGROUND.

Why this table exists at all
----------------------------
Brightway ships no pedigree table. Grepping the installed stack, the word
"pedigree" appears in exactly two source files -- ``bw2io``'s ecospold2
extractor and its ecospold2 strategy -- and neither computes anything: the
extractor reads ``varianceWithPedigreeUncertainty`` straight out of the
ecospold file and keeps the five scores as *metadata*. Ecoinvent applied the
matrix upstream, at dataset-generation time; brightway never re-derives it.

So a MApper foreground pedigree has nothing to reuse and must ship its own
constants -- and those constants have to be the ones ecoinvent actually
applied, or the foreground and the background would be scored on two
different tables inside one Monte Carlo run.

Which table ecoinvent 3.10 actually applied
-------------------------------------------
Recovered empirically rather than cited. 88% of non-production exchanges in
``ecoinvent-3.10-cutoff`` carry BOTH ``scale`` (with pedigree) and ``scale
without pedigree`` (basic only), so the pedigree contribution is observable:

    var_pedigree = scale^2 - scale_without_pedigree^2

Least-squares over 35,844 such exchanges, one free coefficient per
(indicator, score) pair, recovered the table below with R^2 = 0.987 and a
maximum deviation of 0.02 from the classic Weidema/Frischknecht factors. The
only two misses are geographical correlation at scores 2 and 3, whose
variance contributions are 5e-6 and 2e-5 -- below the fit's noise floor and
therefore indistinguishable from zero, not a disagreement.

That rules OUT the Ciroth et al. (2016) empirically-revised factors for
ecoinvent 3.10: they are a different table, and the data does not fit them.
If a future ecoinvent release adopts the revision, this module is where that
migration happens -- and the recovery above is the check that decides it.

The /2, which is the thing that gets got wrong
-----------------------------------------------
A published pedigree "uncertainty factor" is a **95% range**, not a
one-sigma multiplier. The variance contribution is therefore

    sigma_i^2 = [ln(f_i) / 2]^2         # NOTE THE /2

    sigma_total^2 = sigma_basic^2 + SUM_i sigma_i^2

Dropping the /2 inflates every factor by roughly 30% and the error is
invisible -- the numbers stay plausible and the ordering stays right. The
recovery pass above was run once WITHOUT the /2 and reported the whole table
as a mismatch against the published values before the convention was
spotted. ``test_pedigree.py::test_the_half_is_load_bearing`` pins it.
"""

from __future__ import annotations

import math
from typing import Final

#: The five pedigree indicators, in the order ecoinvent lists them. These
#: strings are also the keys ``bw2io`` writes into an exchange's ``pedigree``
#: dict, so a foreground score dict and a background one are directly
#: comparable.
INDICATORS: Final[tuple[str, ...]] = (
    "reliability",
    "completeness",
    "temporal correlation",
    "geographical correlation",
    "further technological correlation",
)

#: Classic Weidema/Frischknecht uncertainty factors, indexed by score 1..5.
#: Score 1 is "no additional uncertainty" and contributes exactly zero.
#: Every value here was independently reproduced from the shipped ecoinvent
#: 3.10 data by the least-squares recovery described in the module docstring.
UNCERTAINTY_FACTORS: Final[dict[str, tuple[float, float, float, float, float]]] = {
    "reliability":                       (1.00, 1.05, 1.10, 1.20, 1.50),
    "completeness":                      (1.00, 1.02, 1.05, 1.10, 1.20),
    "temporal correlation":              (1.00, 1.03, 1.10, 1.20, 1.50),
    "geographical correlation":          (1.00, 1.01, 1.02, 1.05, 1.10),
    "further technological correlation": (1.00, 1.05, 1.20, 1.50, 2.00),
}

#: Default basic uncertainty (sigma^2 of the underlying lognormal, before any
#: pedigree contribution). Ecoinvent assigns this per flow class; MApper has
#: no flow taxonomy for author-supplied rows, so it is an explicit input with
#: a conservative default rather than a silent guess.
DEFAULT_BASIC_VARIANCE: Final[float] = 0.0006


class PedigreeError(ValueError):
    """A pedigree score outside 1..5, or an unknown indicator name."""


def variance_contribution(indicator: str, score: int) -> float:
    """Log-variance a single (indicator, score) pair contributes.

    ``[ln(f) / 2]^2`` -- see the module docstring for why the 2 is there.
    """
    try:
        factors = UNCERTAINTY_FACTORS[indicator]
    except KeyError:
        raise PedigreeError(
            f"Unknown pedigree indicator {indicator!r}. "
            f"Expected one of: {', '.join(INDICATORS)}"
        ) from None
    if not isinstance(score, int) or not 1 <= score <= 5:
        raise PedigreeError(
            f"Pedigree score for {indicator!r} must be an integer 1-5, got {score!r}"
        )
    return (math.log(factors[score - 1]) / 2.0) ** 2


def pedigree_variance(scores: dict[str, int]) -> float:
    """Summed log-variance contribution of a full or partial score set.

    Indicators absent from ``scores`` contribute nothing, which is the same
    as scoring them 1. Unknown indicator names raise rather than being
    ignored -- a typo'd key would otherwise silently drop that indicator's
    uncertainty and narrow the reported spread.
    """
    return sum(variance_contribution(k, v) for k, v in scores.items())


def total_sigma(
    scores: dict[str, int] | None,
    basic_variance: float = DEFAULT_BASIC_VARIANCE,
) -> float:
    """Lognormal ``sigma`` (in log space) for a row or parameter.

    ``sigma_total^2 = sigma_basic^2 + SUM_i sigma_i^2`` -- ecoinvent's own
    composition rule, applied to foreground data so the two halves of a
    Monte Carlo run are scored consistently.
    """
    if basic_variance < 0:
        raise PedigreeError(f"basic_variance must be >= 0, got {basic_variance}")
    return math.sqrt(basic_variance + pedigree_variance(scores or {}))


def gsd2_from_sigma(sigma: float) -> float:
    """Squared geometric standard deviation -- the 95% range multiplier.

    The number an LCA practitioner actually reads: a GSD^2 of 1.5 means the
    95% interval spans roughly the median divided by and multiplied by 1.5.
    """
    return math.exp(2.0 * sigma)
