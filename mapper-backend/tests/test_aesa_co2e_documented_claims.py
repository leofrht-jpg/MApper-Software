# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The quantified claims in `co2e_ratio/README.md` are RECOMPUTED, not prose.

That README is now the primary account of the conversion, and Phase B added
three quantitative arguments to it — the A1 alternative, the A2 pathway drift,
and the sanity band's reach. A number in a methodology document that no test
recomputes is a number that goes stale on the first data refresh, and the
codebase has already been bitten by exactly that (the 50 GtCO2 transcription
errors, the "1.45-1.80 band" flag left behind when the band moved to 2.20).

So each claim here is derived from the shipped data and asserted to appear in
the README.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

import pytest

from mapper.core.aesa_engine import (
    CO2E_FIT_1P5C,
    CO2E_FIT_2C,
    co2e_factor_for_budget,
    load_carbon_budget_options,
)

DATA = Path(__file__).resolve().parents[1] / "mapper" / "data" / "aesa" / "co2e_ratio"
README = (DATA / "README.md").read_text(encoding="utf-8")

#: The README with every run of whitespace collapsed to one space.
#:
#: Assert prose against THIS, not the raw text. A multi-token claim is split by
#: whatever line the paragraph happens to wrap on, so a purely cosmetic reflow
#: breaks the test and says nothing useful — and on a CRLF checkout every `\n`
#: in an assertion is a `\r\n` that matches nothing. Numbers and single tokens
#: can use either; the flat form is never wrong.
README_FLAT = " ".join(README.split())
#: Minus sign normalised too: the tables use U+2212, f-strings produce U+002D.
README_FLAT_ASCII_MINUS = README_FLAT.replace("\u2212", "-")

#: The band `test_factor_values_in_sanity_band` enforces.
BAND = (1.45, 2.20)
#: The observed 2020-2024 deduction the budgets use (GtCO2, GCB 2024).
OBSERVED_DEDUCTION_GT = 200.0


def _rows(name: str) -> list[dict]:
    with (DATA / name).open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _median(vals: list[float]) -> float:
    v = sorted(vals)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def _co2_companion(fit) -> float:
    return _median([float(r["cum_co2_2020_2024_gt"]) for r in _rows(fit.offset_file)])


def _fit_for(bid: str):
    return CO2E_FIT_1P5C if "1p5C" in bid else CO2E_FIT_2C


def _f(bid: str, opt: dict, *, slope=None, intercept=None, offset=None) -> float:
    fit = _fit_for(bid)
    m = fit.slope if slope is None else slope
    b = fit.intercept if intercept is None else intercept
    c = fit.offset_2020_2024_gt if offset is None else offset
    return (m * float(opt["original_gt_from_2020"]) + b - c) / float(opt["remaining_gt_from_2025"])


@pytest.fixture(scope="module")
def options() -> dict:
    return {o["id"]: o for o in load_carbon_budget_options()}


# ── the leg table ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fit", (CO2E_FIT_1P5C, CO2E_FIT_2C), ids=lambda f: f.ensemble)
def test_the_leg_table_numbers_are_the_data(fit):
    """N, IQR and the CO2 companion in the symmetric table are column stats."""
    pairs, offset = _rows(fit.pairs_file), _rows(fit.offset_file)
    assert f"**{len(pairs)}**" in README_FLAT, f"regression N={len(pairs)} not stated"
    assert f"**{len(offset)}**" in README_FLAT, f"offset N={len(offset)} not stated"
    # `offset N = regression N + no-net-zero` — the relation, stated per leg.
    assert f"**{len(offset) - len(pairs)}**" in README_FLAT

    ce = sorted(float(r["cum_co2e_2020_2024_gt"]) for r in offset)

    def q(p: float) -> float:
        i = (len(ce) - 1) * p
        lo = int(i)
        hi = min(lo + 1, len(ce) - 1)
        return ce[lo] + (ce[hi] - ce[lo]) * (i - lo)

    assert f"{q(0.25):.3f}" in README_FLAT, "IQR lower bound not stated"
    assert f"{q(0.75):.3f}" in README_FLAT, "IQR upper bound not stated"
    assert f"{_co2_companion(fit):.3f}" in README_FLAT, "CO2 companion not stated"


# ── A1 ───────────────────────────────────────────────────────────────────────


def test_a1_alternative_deltas_are_recomputed(options):
    """The README's A1 table: rescaling C by observed/modelled moves f by
    -0.53 % at 2 C/50 and -4.18 % at 1.5 C/67. Recomputed here."""
    seen = {}
    for bid, opt in options.items():
        fit = _fit_for(bid)
        c_obs = fit.offset_2020_2024_gt * (OBSERVED_DEDUCTION_GT / _co2_companion(fit))
        now, alt = _f(bid, opt), _f(bid, opt, offset=c_obs)
        seen[bid] = (now, alt, 100 * (alt - now) / now)
        assert f"{c_obs:.3f}" in README_FLAT, f"{bid}: C_obs {c_obs:.3f} not stated"
        assert f"{100 * (alt - now) / now:.2f} %" in README_FLAT_ASCII_MINUS, (
            f"{bid}: delta {100 * (alt - now) / now:.2f}% not stated"
        )
    # The alternative always LOWERS f (C_obs > C), so it RAISES the climate SR.
    assert all(alt < now for now, alt, _ in seen.values())
    # And the two figures the brief called out, to 2 dp.
    assert round(seen["IPCC_AR6_2C_50"][2], 2) == -0.53
    assert round(seen["IPCC_AR6_1p5C_67"][2], 2) == -4.18


def test_a1_states_that_no_option_is_pure(options):
    """The argument, not just the number: x20 is AR6-ASSESSED, so an
    all-modelled f is not available."""
    assert "No option is pure" in README_FLAT
    assert "AR6-ASSESSED" in README_FLAT
    # Both provenance kinds are named where the terms are tabulated.
    assert "MODELLED" in README_FLAT and "OBSERVED" in README_FLAT


# ── A2 ───────────────────────────────────────────────────────────────────────


def test_a2_invariance_holds_in_the_engine(options):
    """The README claims SR_e = SR_CO2 / f exactly and the depletion year is
    invariant. Both follow from with_basis_applied scaling BOTH terms."""
    from mapper.core.aesa_engine import build_carbon_budget

    for bid in options:
        co2 = build_carbon_budget(budget_option_id=bid)
        co2e = co2.model_copy(update={"budget_basis": "CO2e_GHG"}).with_basis_applied()
        f = co2e_factor_for_budget(options[bid])

        def depletion(cb):
            years = sorted(y for y in cb.projected_emissions
                           if cb.start_year <= y <= cb.end_year)
            return next((y for y in years if cb.remaining_budget(y) <= 0), None)

        assert depletion(co2e) == depletion(co2), f"{bid}: depletion year moved"
        for y in (2030, 2050, 2075):
            assert co2e.remaining_budget(y) == pytest.approx(
                f * co2.remaining_budget(y), rel=1e-12)
            assert co2e.annual_global_allocation(y) == pytest.approx(
                f * co2.annual_global_allocation(y), rel=1e-12)


def test_a2_pathway_drift_matches_the_shipped_ar6_series():
    """The drift table is computed from `ar6_remind_co2_kyoto_long.csv`."""
    rows = list(csv.DictReader((DATA / "ar6_remind_co2_kyoto_long.csv").open(encoding="utf-8")))
    series: dict[tuple[str, str], dict[int, float]] = {}
    for r in rows:
        series.setdefault((r["scenario"], r["variable"]), {})[int(float(r["year"]))] = float(r["value"])

    def interp(s: dict[int, float]) -> dict[int, float]:
        ys = sorted(s)
        out: dict[int, float] = {}
        for a, b in zip(ys, ys[1:]):
            for y in range(a, b):
                out[y] = s[a] + (s[b] - s[a]) * (y - a) / (b - a)
        out[ys[-1]] = s[ys[-1]]
        return out

    inst_2025, cum_2100 = [], []
    for scen in sorted({k[0] for k in series}):
        c = interp(series[(scen, "Emissions|CO2")])
        k = interp(series[(scen, "Emissions|Kyoto Gases")])
        inst_2025.append(k[2025] / c[2025])
        cum_2100.append(sum(k[y] for y in range(2025, 2101))
                        / sum(c[y] for y in range(2025, 2101)))

    # "~1.37 at 2025 (range 1.34-1.39)"
    assert f"{min(inst_2025):.2f}" == "1.34" and f"{max(inst_2025):.2f}" == "1.39"
    assert "1.34–1.39" in README_FLAT or "1.34-1.39" in README_FLAT
    # "1.74-5.53 cumulative-to-2100" over the scenarios whose cumulative CO2
    # stays positive; the ninth has a pole and is called out separately.
    pos = [v for v in cum_2100 if v > 0]
    assert f"{min(pos):.2f}" == "1.74" and f"{max(pos):.2f}" == "5.53"
    assert "1.74–5.53" in README_FLAT or "1.74-5.53" in README_FLAT
    # The pole is stated rather than dropped.
    assert len(pos) == len(cum_2100) - 1
    assert "pole" in README_FLAT


def test_a2_records_that_mechanism_c_is_deliberately_unimplemented():
    assert "deliberately unimplemented" in README_FLAT
    assert "anchors_gt_co2" in README_FLAT, "the reason must name the missing data"


# ── the sanity band's reach ──────────────────────────────────────────────────


def _in_band(vals: dict[str, float]) -> bool:
    return all(BAND[0] <= v <= BAND[1] for v in vals.values())


def test_the_band_does_not_catch_an_offset_swap(options):
    """The README's headline claim about the band. If this ever starts failing,
    the band DID become able to catch an ensemble mix-up and the README's
    'PASSES' rows must be re-measured."""
    swapped = {
        bid: _f(bid, opt,
                offset=(CO2E_FIT_2C if _fit_for(bid) is CO2E_FIT_1P5C
                        else CO2E_FIT_1P5C).offset_2020_2024_gt)
        for bid, opt in options.items()
    }
    assert _in_band(swapped), "the band now catches an offset swap — update the table"


def test_the_band_does_not_catch_the_actual_pre_refit_state(options):
    """The mismatch that SHIPPED: Tilsted & Bjorn's 1.5 C affine paired with the
    C3+C4 offset. Every factor lands inside the band."""
    m, b = (1.1614, 157.27)
    pre = {}
    for bid, opt in options.items():
        pre[bid] = (_f(bid, opt, slope=m, intercept=b,
                       offset=CO2E_FIT_2C.offset_2020_2024_gt)
                    if "1p5C" in bid else _f(bid, opt))
    assert _in_band(pre), "the band now catches the pre-refit state — update the table"
    # The README quotes these to 3 dp as the killer row.
    assert f"{pre['IPCC_AR6_1p5C_50']:.4f}" == "1.6019"
    assert f"{pre['IPCC_AR6_1p5C_67']:.4f}" == "1.8222"


def test_the_band_does_not_catch_the_a1_alternative(options):
    alt = {}
    for bid, opt in options.items():
        fit = _fit_for(bid)
        alt[bid] = _f(bid, opt, offset=fit.offset_2020_2024_gt
                      * (OBSERVED_DEDUCTION_GT / _co2_companion(fit)))
    assert _in_band(alt), "the band now resolves the A1 question — update the table"


@pytest.mark.parametrize("label,kwargs", [
    ("offset sign flipped", {}),          # handled specially below
    ("offset dropped", {"offset": 0.0}),
    ("intercept dropped", {"intercept": 0.0}),
])
def test_the_band_does_catch_gross_structural_errors(options, label, kwargs):
    """The other half of the claim: the band is not useless."""
    vals = {}
    for bid, opt in options.items():
        if label == "offset sign flipped":
            fit = _fit_for(bid)
            vals[bid] = _f(bid, opt, offset=-fit.offset_2020_2024_gt)
        else:
            vals[bid] = _f(bid, opt, **kwargs)
    assert not _in_band(vals), f"the band no longer catches: {label}"


def test_the_readme_names_the_guard_that_does_catch_mix_ups():
    assert "test_no_target_mixes_ensembles" in README_FLAT
    assert "0.001" in README_FLAT, "the 1.449-vs-1.45 margin must be stated"


def test_the_readme_no_longer_quotes_the_superseded_band():
    """A stale '~1.45-1.80 sanity band' flag survived the band moving to 2.20,
    contradicting the bullet immediately below it."""
    assert "1.45–1.80" not in README_FLAT and "1.45-1.80" not in README_FLAT
    assert f"[{BAND[0]:.2f}, {BAND[1]:.2f}]" in README_FLAT


# ── reverse-orphan sources (B8) ──────────────────────────────────────────────


def test_the_reverse_orphan_sources_are_documented_as_intentional():
    """`AR6_BUDGET_CALC` and `HAUSFATHER_2023_CLIMATE_BRINK` are referenced by no
    budget option. The guard checks options -> sources only; the README must say
    so, or the natural 'fix' is deleting the two most useful pointers."""
    import json

    budgets = json.loads(
        (DATA.parent / "carbon_budgets.json").read_text(encoding="utf-8"))
    referenced = {o["source_budget"] for o in budgets["options"]} | {
        o["source_deduction"] for o in budgets["options"]}
    orphans = [s["id"] for s in budgets["sources"] if s["id"] not in referenced]
    assert set(orphans) == {"AR6_BUDGET_CALC", "HAUSFATHER_2023_CLIMATE_BRINK"}, (
        f"the reverse-orphan set changed: {orphans} — update the README note"
    )
    assert "reverse" in README_FLAT.lower()
    for o in orphans:
        assert o in README_FLAT, f"{o} must be named as an intentional cross-check"
