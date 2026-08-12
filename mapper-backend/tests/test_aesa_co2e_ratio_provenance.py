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
    CO2E_FIT_1P5C,
    CO2E_FIT_2C,
    TILSTED_BJORN_2023_PUBLISHED,
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
    m, b = CO2E_FIT_2C.slope, CO2E_FIT_2C.intercept
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
    assert str(CO2E_FIT_2C.offset_2020_2024_gt) in readme
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
    # The 1.5 C citation gap is CLOSED (Tilsted & Bjorn 2023), so it is no
    # longer part of this invariant — see
    # test_the_1p5c_affine_cites_tilsted_bjorn_with_a_doi. What must not happen
    # is the budget data being upgraded along with it.


# ── the 1.5 °C citation ─────────────────────────────────────────────────────


def test_the_1p5c_affine_cites_tilsted_bjorn_with_a_doi():
    """The affine's source, asserted where it is used.

    Supersedes a test that recorded the ABSENCE of a DOI. That test's premise is
    gone, and it was worse than a gap: the repository attributed the 1.5 C affine
    to "Bjorn et al. 2023, 'Standardised carbon-budget-based ...', Environ. Sci.
    Technol." — a paper that does not exist. The coefficients were always
    Tilsted & Bjorn's; only the attribution was invented. A phantom citation in
    shipped provenance is the failure mode this asserts against.
    """
    DOI = "10.1007/s10584-023-03583-4"
    engine = (Path(__file__).resolve().parents[1]
              / "mapper" / "core" / "aesa_engine.py").read_text(encoding="utf-8")
    readme = README.read_text(encoding="utf-8")

    for name, src in (("aesa_engine.py", engine), ("README.md", readme)):
        assert DOI in src, f"{name} must carry the DOI"
        assert "Tilsted" in src, f"{name} must name the first author"
        assert "Climatic Change" in src, f"{name} must name the journal"

    # The phantom must not survive as an ATTRIBUTION. The code carries no trace
    # of it; the README quotes it exactly once, inside the correction note, so a
    # future reader learns what was wrong rather than finding it silently gone.
    assert "Standardised carbon-budget-based" not in engine
    assert "Environ. Sci. Technol" not in engine

    # Strip blockquote markers before flattening: the correction note is a
    # markdown quote, so "> " lands mid-sentence when lines are joined.
    flat = " ".join(readme.replace("\n>", "\n").split())
    assert flat.count("Standardised carbon-budget-based") <= 1, (
        "the phantom title should appear at most once, in the correction note"
    )
    if "Standardised carbon-budget-based" in flat:
        assert "Corrected attribution" in flat and "no such paper exists" in flat, (
            "if the phantom title is quoted, it must be marked as corrected"
        )

    # The coefficients the citation belongs to are unchanged.
    assert TILSTED_BJORN_2023_PUBLISHED == (1.1614, 157.27)


def test_the_1p5c_domain_is_recorded_wherever_the_leg_is_described():
    """[223, 427] is the reason the C3+C4 refit exists, so it must be stated.

    It excludes both 2 C budgets (x20 = 1150 and 1350) outright. Previously
    mis-stated as [223, 440].
    """
    engine = (Path(__file__).resolve().parents[1]
              / "mapper" / "core" / "aesa_engine.py").read_text(encoding="utf-8")
    readme = README.read_text(encoding="utf-8")
    for name, src in (("aesa_engine.py", engine), ("README.md", readme)):
        assert "427" in src, f"{name} must record the 427 GtCO2 domain bound"
    # The published R and scenario count belong with it.
    assert "0.80" in readme and "80" in readme
    assert "IAMC" in readme and "Huppmann" in readme
    assert "Meinshausen" in readme


def test_the_persisted_source_label_names_the_right_authors():
    """The label is written into every config and every exported workbook.

    A wrong label there propagates into user data and into files attached to
    papers, which is why it is asserted rather than left to the comment.
    """
    from mapper.core.aesa_engine import co2e_conversion_for_budget

    conv = co2e_conversion_for_budget(
        {"id": "IPCC_AR6_1p5C_50", "original_gt_from_2020": 500,
         "remaining_gt_from_2025": 300})
    assert "Tilsted" in conv.source
    assert "Bjorn et al. 2023" not in conv.source


# ── both legs are treated alike ─────────────────────────────────────────────
#
# The 1.5 C leg used to pair Tilsted & Bjorn's sub-1.5 C affine with an offset
# whose median was taken over C3+C4 — a 2 C ensemble. It is now refitted over
# AR6 C1+C2 so affine and offset come from the same scenarios, as the 2 C leg
# already did. These tests hold the symmetry.

ALL_FITS = (CO2E_FIT_1P5C, CO2E_FIT_2C)


def _rows(name: str) -> list[dict]:
    with (DATA / name).open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


@pytest.mark.parametrize("fit", ALL_FITS, ids=lambda f: f.ensemble)
def test_no_target_mixes_ensembles(fit):
    """A fit's affine and offset must come from the SAME category set.

    Checked against the DATA, not the label: both of a fit's files must contain
    only the categories it declares. Adding a third target without supplying a
    matching pair — or pointing one file at the wrong ensemble — fails here.
    """
    for attr in ("pairs_file", "offset_file"):
        rows = _rows(getattr(fit, attr))
        cats = {r["category"] for r in rows}
        assert cats <= set(fit.categories), (
            f"{fit.ensemble}: {attr} contains {cats - set(fit.categories)}, which "
            f"is outside the declared ensemble {fit.categories}"
        )
        assert cats == set(fit.categories), (
            f"{fit.ensemble}: {attr} is missing {set(fit.categories) - cats}"
        )


def test_the_two_fits_use_disjoint_ensembles():
    assert set(CO2E_FIT_1P5C.categories).isdisjoint(CO2E_FIT_2C.categories)
    assert CO2E_FIT_1P5C.offset_2020_2024_gt != CO2E_FIT_2C.offset_2020_2024_gt, (
        "a shared offset is exactly the mismatch this refit removed"
    )


@pytest.mark.parametrize("fit", ALL_FITS, ids=lambda f: f.ensemble)
def test_each_fit_refits_from_its_own_shipped_rows(fit):
    """Both legs independently reproducible — the reviewer's first move."""
    rows = _rows(fit.pairs_file)
    xs = [float(r["cum_co2_gt"]) for r in rows]
    ys = [float(r["cum_co2e_gt"]) for r in rows]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    m = sxy / sxx
    b = my - m * mx
    # Compare at each fit's OWN published precision: the 2C intercept is
    # published to 2 dp (218.41, historical and frozen), the C1+C2 one to 4 dp.
    def dp(v: float) -> int:
        txt = repr(float(v))
        return len(txt.split(".")[1]) if "." in txt else 0

    assert round(m, dp(fit.slope)) == fit.slope, f"{fit.ensemble} refit slope {m}"
    assert round(b, dp(fit.intercept)) == fit.intercept, (
        f"{fit.ensemble} refit intercept {b} != published {fit.intercept}"
    )
    assert (round(min(xs), 1), round(max(xs), 1)) == fit.domain_gt


@pytest.mark.parametrize("fit", ALL_FITS, ids=lambda f: f.ensemble)
def test_each_offset_is_the_median_of_its_own_shipped_rows(fit):
    vals = sorted(float(r["cum_co2e_2020_2024_gt"]) for r in _rows(fit.offset_file))
    n = len(vals)
    median = vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2
    assert round(median, 1) == round(fit.offset_2020_2024_gt, 1)


@pytest.mark.parametrize("fit", ALL_FITS, ids=lambda f: f.ensemble)
def test_offset_set_is_a_superset_of_the_regression_set(fit):
    reg = {(r["model"], r["scenario"]) for r in _rows(fit.pairs_file)}
    off = {(r["model"], r["scenario"]) for r in _rows(fit.offset_file)}
    assert reg < off
    blank = {(r["model"], r["scenario"]) for r in _rows(fit.offset_file)
             if not r["netzero_co2_year"].strip()}
    assert blank.isdisjoint(reg)


@pytest.mark.parametrize("fit", ALL_FITS, ids=lambda f: f.ensemble)
def test_both_legs_share_the_same_columns(fit):
    """Mirrored files: a reader learns one shape, not two."""
    assert list(_rows(fit.pairs_file)[0]) == [
        "model", "scenario", "category", "netzero_co2_year",
        "cum_co2_gt", "cum_co2e_gt", "ratio"]
    assert list(_rows(fit.offset_file)[0]) == [
        "model", "scenario", "category", "netzero_co2_year",
        "cum_co2_2020_2024_gt", "cum_co2e_2020_2024_gt", "ratio_2020_2024"]


# ── the 2 C leg is the regression gate ──────────────────────────────────────


def test_the_2c_leg_did_not_move():
    """Byte-identical: the refit touches the 1.5 C target only."""
    from mapper.core.aesa_engine import co2e_factor_for_budget

    assert (CO2E_FIT_2C.slope, CO2E_FIT_2C.intercept,
            CO2E_FIT_2C.offset_2020_2024_gt) == (1.2935, 218.41, 257.4)
    for bid, x20, x25, expected in (
        ("IPCC_AR6_2C_50", 1350, 1150, (1.2935 * 1350 + 218.41 - 257.4) / 1150),
        ("IPCC_AR6_2C_67", 1150, 950, (1.2935 * 1150 + 218.41 - 257.4) / 950),
    ):
        got = co2e_factor_for_budget(
            {"id": bid, "original_gt_from_2020": x20, "remaining_gt_from_2025": x25})
        assert got == expected, f"{bid} moved: {got} != {expected}"


def test_the_1p5c_budgets_are_inside_the_c1c2_domain():
    """The out-of-domain problem the refit removes, asserted rather than argued."""
    lo, hi = CO2E_FIT_1P5C.domain_gt
    for x in (500, 400, 300, 200):
        assert lo <= x <= hi, f"x={x} outside the C1+C2 fitted domain"
    # Tilsted & Bjorn's published domain excluded x20=500; recorded for contrast.
    assert not (223 <= 500 <= 427)


def test_the_persisted_source_names_the_right_ensemble_per_target():
    """Written into every config and every exported workbook."""
    from mapper.core.aesa_engine import co2e_conversion_for_budget

    c15 = co2e_conversion_for_budget(
        {"id": "IPCC_AR6_1p5C_50", "original_gt_from_2020": 500,
         "remaining_gt_from_2025": 300}).source
    c2 = co2e_conversion_for_budget(
        {"id": "IPCC_AR6_2C_50", "original_gt_from_2020": 1350,
         "remaining_gt_from_2025": 1150}).source
    assert "AR6 C1+C2" in c15 and "C3+C4" not in c15, (
        "a 1.5C budget must not claim the C3+C4 offset"
    )
    assert "AR6 C3+C4" in c2 and "C1+C2" not in c2
    for src in (c15, c2):
        assert "Tilsted & Bjorn" in src and "10.1007/s10584-023-03583-4" in src
