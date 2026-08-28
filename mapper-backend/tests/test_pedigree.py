# SPDX-License-Identifier: MPL-2.0
"""The pedigree table, and the /2 that gets dropped.

The factors are not cited -- they were recovered from the shipped ecoinvent
3.10 data by least squares (R^2 = 0.987, max deviation 0.02 from the classic
Weidema/Frischknecht table). These tests pin the constants, the composition
rule, and the one convention that is easy to get wrong and impossible to spot
downstream.
"""

import math

import pytest

from mapper.core.pedigree import (
    INDICATORS,
    UNCERTAINTY_FACTORS,
    PedigreeError,
    gsd2_from_sigma,
    pedigree_variance,
    total_sigma,
    variance_contribution,
)

# The table as recovered from ecoinvent 3.10, and as published by
# Weidema/Frischknecht. Written out independently of the module so a typo in
# the source cannot agree with itself.
EXPECTED = {
    "reliability":                       (1.05, 1.10, 1.20, 1.50),
    "completeness":                      (1.02, 1.05, 1.10, 1.20),
    "temporal correlation":              (1.03, 1.10, 1.20, 1.50),
    "geographical correlation":          (1.01, 1.02, 1.05, 1.10),
    "further technological correlation": (1.05, 1.20, 1.50, 2.00),
}


def test_the_table_is_the_classic_weidema_frischknecht_one():
    assert set(UNCERTAINTY_FACTORS) == set(INDICATORS)
    for ind, factors in EXPECTED.items():
        assert UNCERTAINTY_FACTORS[ind][0] == 1.00, "score 1 must contribute nothing"
        assert UNCERTAINTY_FACTORS[ind][1:] == factors


def test_it_is_not_the_ciroth_2016_revision():
    """The recovery ruled the revision out for ecoinvent 3.10.

    Ciroth et al. (2016) published empirically-revised factors that differ
    substantially from these -- notably a much larger reliability spread. If
    someone swaps the table on the strength of the paper alone, the foreground
    would be scored on a different matrix from the background inside one run.
    Migrating is a real option, but it has to be driven by re-running the
    recovery against a release that actually adopted the revision.
    """
    # A revised table would not leave reliability's top score at exactly 1.50
    # AND further-technological at exactly 2.00 AND geographical at 1.10.
    assert UNCERTAINTY_FACTORS["reliability"][4] == 1.50
    assert UNCERTAINTY_FACTORS["further technological correlation"][4] == 2.00
    assert UNCERTAINTY_FACTORS["geographical correlation"][4] == 1.10


def test_the_half_is_load_bearing():
    """sigma^2 = [ln(f)/2]^2, because the factor is a 95% RANGE.

    Dropping the /2 inflates every factor by ~30% and the output stays
    plausible, which is why this is a test and not a comment. The numbers on
    the right are the ones the recovery measured out of ecoinvent's own
    scale / scale-without-pedigree pairs.
    """
    cases = {
        ("reliability", 5): 0.041100,
        ("further technological correlation", 5): 0.120113,
        ("temporal correlation", 3): 0.002271,
        ("completeness", 4): 0.002271,
    }
    for (ind, score), expected in cases.items():
        assert variance_contribution(ind, score) == pytest.approx(expected, rel=1e-4)

    # And the same numbers WITHOUT the /2, so the failure mode is visible here
    # rather than only in a downstream distribution.
    without_half = math.log(UNCERTAINTY_FACTORS["reliability"][4]) ** 2
    assert without_half == pytest.approx(0.164400, rel=1e-4)
    assert without_half / variance_contribution("reliability", 5) == pytest.approx(4.0)


def test_score_one_contributes_nothing():
    for ind in INDICATORS:
        assert variance_contribution(ind, 1) == 0.0
    assert pedigree_variance({ind: 1 for ind in INDICATORS}) == 0.0


def test_contributions_add_in_variance_not_in_sigma():
    """sigma_total^2 = sigma_basic^2 + SUM_i sigma_i^2 -- ecoinvent's own rule."""
    scores = {"reliability": 3, "temporal correlation": 4}
    basic = 0.0006
    expected = math.sqrt(
        basic
        + variance_contribution("reliability", 3)
        + variance_contribution("temporal correlation", 4)
    )
    assert total_sigma(scores, basic) == pytest.approx(expected)
    # Adding in sigma rather than variance would give a strictly larger number.
    naive = math.sqrt(basic) + math.sqrt(
        variance_contribution("reliability", 3)
    ) + math.sqrt(variance_contribution("temporal correlation", 4))
    assert naive > expected


def test_absent_indicators_are_treated_as_score_one():
    assert pedigree_variance({"reliability": 3}) == variance_contribution("reliability", 3)


def test_a_typo_in_an_indicator_name_raises_rather_than_being_ignored():
    """Silently dropping an unknown key would narrow the reported spread."""
    with pytest.raises(PedigreeError, match="Unknown pedigree indicator"):
        pedigree_variance({"realiability": 3})


@pytest.mark.parametrize("bad", [0, 6, -1, 2.5, "3"])
def test_out_of_range_scores_raise(bad):
    with pytest.raises(PedigreeError):
        variance_contribution("reliability", bad)


def test_gsd2_round_trips_with_sigma():
    """GSD^2 = exp(2 sigma) is the 95% range multiplier practitioners read."""
    for sigma in (0.0, 0.1, 0.35):
        assert math.log(gsd2_from_sigma(sigma)) / 2 == pytest.approx(sigma)
    # A worst-case row: every indicator at 5.
    worst = total_sigma({ind: 5 for ind in INDICATORS})
    assert 2.0 < gsd2_from_sigma(worst) < 3.0
