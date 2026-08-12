# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The CO2→CO2e conversion's PROVENANCE docs match the data and the code.

`tests/test_aesa_co2e_factors.py` locks the arithmetic. This locks the paper
trail around it, because that is what a reader checks and what had drifted:

* the regression coefficients in the code equal the fitted artefact;
* the two scenario counts (343 regression / 427 offset) are stated with their
  DIFFERENT filters, and the shipped pairs file really does hold the 343;
* the README no longer claims the conversion is inert/unwired, which it had
  gone on saying after the factor was wired.

The counts are the trap. `427 = 343 + 84`: the regression integrates 2020 → the
net-zero-CO2 year, so a scenario that never crosses has no window and is
dropped; the offset C only needs a fixed 2020-2024 cumulative, so those 84 are
usable for it. Quoting one N for both would misstate the method in a paper.
"""

from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

import pytest

from mapper.core.aesa_engine import (
    AR6_C3C4_2C,
    BJORN_2023_1P5C,
    CO2E_2020_2024_GT,
)

DATA = Path(__file__).resolve().parents[1] / "mapper" / "data" / "aesa" / "co2e_ratio"
README = DATA / "README.md"
FIT = DATA / "ar6_2c_analog_fit.json"
PAIRS = DATA / "ar6_2c_analog_pairs.csv"
OFFSET = DATA / "ar6_c34_offset_2020_2024.csv"

REGRESSION_N = 343      # has both variables AND reaches net-zero CO2
OFFSET_N = 427          # has both variables; no net-zero requirement
NO_NETZERO = 84         # 427 - 343


@pytest.fixture(scope="module")
def fit() -> dict:
    return json.loads(FIT.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def pairs() -> list[dict]:
    # csv.DictReader, not a naive split: one scenario name contains a comma
    # ("NGFS1_Immediate 2C with CDR (Orderly, Rep)") and a split-on-comma count
    # silently mis-bins it.
    with PAIRS.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


@pytest.fixture(scope="module")
def offset() -> list[dict]:
    with OFFSET.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


@pytest.fixture(scope="module")
def readme() -> str:
    return README.read_text(encoding="utf-8")


# ── the code matches the fitted artefact ────────────────────────────────────


def test_code_coefficients_equal_the_fitted_artefact(fit):
    m, b = AR6_C3C4_2C
    assert m == fit["slope"]
    assert b == fit["intercept"]


def test_fit_artefact_records_the_regression_n(fit):
    assert fit["N"] == REGRESSION_N


def test_readme_quotes_the_artefacts_R_not_a_rounded_one(fit, readme):
    # The README said 0.944 while the artefact says 0.9444. Harmless in itself,
    # but the README is what a reviewer reads, so it should quote the artefact.
    assert str(fit["R"]) in readme, (
        f"README should quote R={fit['R']} as recorded in ar6_2c_analog_fit.json"
    )


# ── the two scenario counts ─────────────────────────────────────────────────


def test_shipped_pairs_file_holds_exactly_the_regression_set(pairs, fit):
    assert len(pairs) == REGRESSION_N
    by_class = Counter(r["category"] for r in pairs)
    assert by_class == {"C3": 232, "C4": 111}
    assert set(by_class) == {"C3", "C4"}, "only the (likely) below-2C classes"


def test_every_regression_scenario_has_a_net_zero_year(pairs):
    """The filter that separates 343 from 427, asserted rather than described."""
    assert all(r["netzero_co2_year"].strip() for r in pairs)


def test_pairs_span_the_fitted_range_the_artefact_claims(pairs, fit):
    xs = [float(r["cum_co2_gt"]) for r in pairs]
    assert min(xs) == pytest.approx(fit["x_min_gt"], abs=0.05)
    assert max(xs) == pytest.approx(fit["x_max_gt"], abs=0.05)
    # And the 2C budgets this actually gets applied to are inside it.
    assert min(xs) < 1150 < max(xs)
    assert min(xs) < 1350 < max(xs)


def test_readme_states_both_counts_with_their_filters(readme):
    assert str(REGRESSION_N) in readme and str(OFFSET_N) in readme
    # The relation must be written down — it is the whole explanation.
    assert f"{OFFSET_N} = {REGRESSION_N} + {NO_NETZERO}" in readme, (
        "README should state 427 = 343 + 84 so the two Ns cannot be read as a "
        "contradiction"
    )
    assert "no net-zero requirement" in readme.lower()


def test_readme_no_longer_says_the_offset_set_is_unshipped(readme):
    # Superseded: the 427-row offset set now ships and C is a column median.
    assert "not reproducible from the bundled files" not in readme.lower()
    assert "both sets ship" in readme.lower()


def test_offset_constant_is_documented_with_its_n_and_its_file(readme):
    assert str(CO2E_2020_2024_GT) in readme
    assert f"{OFFSET_N} rows" in readme
    # It must name the file the median is taken over, not just the count —
    # that pointer is what makes the number checkable.
    assert OFFSET.name in readme


# ── the docs no longer describe the pre-wiring state ────────────────────────


def test_readme_does_not_claim_the_conversion_is_unwired(readme):
    """It kept saying `co2e_conversion` "stays None (inert)" after wiring."""
    stale = "Until resolved, `CarbonBudgetConfig.co2e_conversion` stays `None`"
    assert stale not in readme or "SUPERSEDED" in readme, (
        "the pre-wiring sentence must be struck through and marked superseded"
    )
    assert "SUPERSEDED" in readme


def test_flags_lifted_only_where_the_data_was_reproduced(readme):
    """Superseded blanket check.

    Both derivation sets are now verifiable from shipped CSVs, so a blanket
    "everything is PROVISIONAL" assertion is no longer the right invariant.
    What must still hold is the NARROWER one: the two things that were NOT
    re-examined stay flagged, so lifting the flags cannot quietly upgrade them.
    """
    low = readme.lower()
    assert "provisional" in low
    assert "carbon_budgets.json" in readme, "the budget data must stay named"
    assert "no doi" in low, "the citation gap must stay recorded"


# ── the citation, as it actually stands ─────────────────────────────────────


def test_the_1p5c_affine_has_no_doi_anywhere_in_the_repo():
    """Documents a KNOWN GAP so it is not mistaken for a sourced value.

    The 1.5C leg cites Bjorn et al. 2023 by a truncated title in a code comment,
    with no DOI, volume or pages. Until that is completed, the repo must not
    read as though the citation were complete. This test fails once a DOI is
    added — at which point delete it and cite properly.
    """
    root = Path(__file__).resolve().parents[1] / "mapper"
    hits = [
        p for p in root.rglob("*")
        if p.is_file() and p.suffix in {".py", ".md", ".json"}
        and "Bj" in p.read_text(encoding="utf-8", errors="ignore")
        and "10.1021" in p.read_text(encoding="utf-8", errors="ignore")
    ]
    assert hits == [], (
        "a DOI now appears alongside the Bjorn citation — good; replace this "
        "known-gap test with a real citation assertion"
    )
    # The coefficients are still the ones the comment attributes.
    assert BJORN_2023_1P5C == (1.1614, 157.27)


# ── the offset set, now shipped ─────────────────────────────────────────────


def test_offset_file_holds_the_427(offset):
    assert len(offset) == OFFSET_N
    assert Counter(r["category"] for r in offset) == {"C3": 279, "C4": 148}


def test_median_of_the_shipped_rows_reproduces_C(offset):
    """C is pinned to the data, not to a comment.

    Asserted to 1 d.p. rather than by equality: the shipped rows give 257.449,
    which is the stated 257.4 at the precision the constant is published to.
    Equality would fail on the third decimal for no methodological reason.
    """
    vals = sorted(float(r["cum_co2e_2020_2024_gt"]) for r in offset)
    n = len(vals)
    median = vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2
    assert round(median, 1) == round(CO2E_2020_2024_GT, 1), (
        f"median of the shipped offset rows is {median}, which does not round to "
        f"the constant {CO2E_2020_2024_GT} used by co2e_factor_for_budget"
    )


def test_co2_companion_median_agrees_with_the_budget_deduction(offset):
    """~193 GtCO2 vs the budgets' -200 Gt: the window/source consistency check."""
    vals = sorted(float(r["cum_co2_2020_2024_gt"]) for r in offset)
    n = len(vals)
    median = vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2
    assert 190.0 < median < 196.0
    assert abs(median - 200.0) < 10.0, "should agree with the -200 Gt deduction"


def test_offset_set_is_a_strict_superset_of_the_regression_set(offset, pairs):
    """One pull, two filters — the relation must be visible in the files."""
    off_ids = {(r["model"], r["scenario"]) for r in offset}
    reg_ids = {(r["model"], r["scenario"]) for r in pairs}
    assert reg_ids < off_ids
    assert len(off_ids - reg_ids) == NO_NETZERO


def test_the_84_extra_rows_are_exactly_those_without_a_net_zero(offset, pairs):
    reg_ids = {(r["model"], r["scenario"]) for r in pairs}
    blank = {(r["model"], r["scenario"]) for r in offset
             if not r["netzero_co2_year"].strip()}
    assert len(blank) == NO_NETZERO
    assert blank.isdisjoint(reg_ids), (
        "a scenario with no net-zero year must not appear in the regression set"
    )


def test_both_files_share_their_provenance_columns(offset, pairs):
    shared = ["model", "scenario", "category", "netzero_co2_year"]
    for col in shared:
        assert col in offset[0], f"offset file missing {col}"
        assert col in pairs[0], f"pairs file missing {col}"


# ── what a reviewer checks first ────────────────────────────────────────────


def test_shipped_pairs_regress_to_the_published_coefficients(pairs, fit):
    """The first thing anyone will do with the CSV: refit it.

    Guards the case where the file and the README describe different fits — the
    coefficients must be recoverable FROM the shipped data, not merely asserted
    next to it. Tolerances are the published precision (4 dp on m/R, 2 dp on b).
    """
    xs = [float(r["cum_co2_gt"]) for r in pairs]
    ys = [float(r["cum_co2e_gt"]) for r in pairs]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    m = sxy / sxx
    b = my - m * mx
    r = sxy / (sxx * syy) ** 0.5

    assert round(m, 4) == fit["slope"], f"refit slope {m}"
    assert round(b, 2) == fit["intercept"], f"refit intercept {b}"
    assert round(r, 4) == fit["R"], f"refit R {r}"
    # And the code uses exactly those.
    assert AR6_C3C4_2C == (fit["slope"], fit["intercept"])


def test_readme_states_both_pull_dates_and_does_not_imply_one_extraction(readme):
    assert "2026-06-19" in readme and "2026-08-12" in readme
    assert "TWO extractions, not one" in readme


def test_readme_records_the_identifier_identity_evidence(readme):
    # The vintage claim rests on this, since the June pull recorded no API
    # version. It must be stated as evidence, not asserted as fact.
    assert "identical name-for-name" in readme


def test_provisional_flags_lifted_only_for_what_was_reproduced(readme):
    assert "no longer flagged provisional" in readme
    # The budget data and the citation gap must NOT be silently upgraded.
    low = readme.lower()
    assert "carbon_budgets.json" in readme and "provisional" in low
    assert "no doi" in low
