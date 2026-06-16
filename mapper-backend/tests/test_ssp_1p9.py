"""Patch X2 — SSP1-1.9 trajectory + net-negative budget arithmetic.

Closes Patch X1 audit finding A4 (missing canonical AR6 marker
scenario). SSP1-1.9 is the 1.5°C-aligned trajectory; pairing it with
the 1.5°C budgets makes coherent 1.5°C-pathway analysis possible
(rather than the mitigation-gap framing of SSP2-4.5 × 1.5°C budget).

Methodologically interesting wrinkle: SSP1-1.9 carries **net-negative
emissions** in the late century (CDR + afforestation per IMAGE 3.0.1
CD-LINKS marker). The depletion arithmetic must handle this — net
negatives REPLENISH the budget post-peak. This file tests:

  * SSP1-1.9 loads + interpolates cleanly (9 anchors → 76 annual values)
  * The five AR6 marker scenarios are all present + in expected order
  * Net-negative budget math: 2°C × SSP1-1.9 NEVER depletes within horizon
  * 1.5°C × SSP1-1.9 DOES deplete (peak cumulative ~380 Gt > 300 Gt
    1.5°C/50% budget) — pairing matters
  * `provisional: true` flag preserved
  * IAM attribution per AR6 marker convention
"""
from __future__ import annotations

from mapper.core.aesa_engine import (
    build_carbon_budget,
    load_ssp_trajectories,
)


def test_ssp_1p9_loads_and_interpolates():
    scenarios = {s["id"]: s for s in load_ssp_trajectories()}
    assert "SSP1-1.9" in scenarios
    ssp = scenarios["SSP1-1.9"]
    # 9 anchors → 76 annual values spanning 2025-2100 (inclusive).
    assert len(ssp["projected_emissions"]) == 76
    # Anchors preserved exactly.
    assert ssp["projected_emissions"][2025] == 30.0
    assert ssp["projected_emissions"][2050] == 3.0
    assert ssp["projected_emissions"][2100] == -8.0
    # Linear interpolation midpoint between 2025 (30) and 2030 (22)
    # is 26.0 at year 2027.5 → 2027 gets 30 + 0.4*(22-30) = 26.8.
    assert abs(ssp["projected_emissions"][2027] - 26.8) < 1e-6


def test_ssp_1p9_includes_negative_emissions():
    scenarios = {s["id"]: s for s in load_ssp_trajectories()}
    ssp = scenarios["SSP1-1.9"]
    # Late century net-negative is the defining feature.
    assert ssp["projected_emissions"][2060] < 0
    assert ssp["projected_emissions"][2080] < 0
    assert ssp["projected_emissions"][2100] < 0


def test_ssp_1p9_iam_attribution():
    scenarios = {s["id"]: s for s in load_ssp_trajectories()}
    ssp = scenarios["SSP1-1.9"]
    assert "IMAGE" in ssp["model"], "AR6 marker IAM for SSP1-1.9"
    assert "CD-LINKS" in ssp["model"], "specifically the CD-LINKS marker run"
    assert ssp["provisional"] is True


def test_ar6_marker_quintet_now_complete():
    """The canonical five — Patch X2 closes audit finding A4."""
    ids = {s["id"] for s in load_ssp_trajectories()}
    assert ids == {
        "SSP1-1.9", "SSP1-2.6", "SSP2-4.5", "SSP3-7.0", "SSP5-8.5",
    }


def test_ssp_1p9_x_2c_50_does_not_deplete_within_horizon():
    """The methodologically interesting case: net-negative SSP1-1.9
    paired with the larger 2°C/50% (1150 Gt) budget peaks at ~380 Gt
    cumulative and then DECLINES (negatives replenish) — never crosses
    the budget cap within 2025-2100.
    """
    cfg = build_carbon_budget(
        budget_option_id="IPCC_AR6_2C_50",
        ssp_id="SSP1-1.9",
    )
    # Budget remains positive throughout the entire horizon.
    for year in range(2025, 2101):
        assert cfg.remaining_budget(year) > 0, (
            f"unexpected depletion at year {year}"
        )
    # And by 2100 the budget has actually GROWN past initial (because
    # cumulative ends ~121 Gt; remaining = 1150 - 121 = 1029).
    assert cfg.remaining_budget(2100) > 1000


def test_ssp_1p9_x_1p5c_50_depletes_then_replenishes():
    """Even SSP1-1.9 isn't aggressive enough on its early-decade
    trajectory to keep the 1.5°C/50% (300 Gt) budget alive; peak
    cumulative reaches ~380 Gt before late-century negatives reverse
    it, so the budget DOES deplete around 2040.

    Then the **replenishment behavior** matters: late-century net-
    negatives subtract from cumulative, so once Σ E_y drops back below
    the initial budget cap, ``remaining_budget = max(0, B - Σ)``
    returns a positive number again. By 2100 the budget shows ~171 Gt
    remaining despite having hit 0 mid-century.

    Whether to surface this in the UI as "depleted ~2040 (replenished
    by 2100)" or as a single yes/no is a UX question separate from
    the math. The chart's "depleted ~YYYY" annotation pins on the
    FIRST crossing (the depletion event), which is the methodologically
    important moment — overshooting the 1.5°C budget commits to
    temperature exceedance even if later removed.
    """
    cfg = build_carbon_budget(
        budget_option_id="IPCC_AR6_1p5C_50",
        ssp_id="SSP1-1.9",
    )
    # Budget alive at start.
    assert cfg.remaining_budget(2025) == 300.0
    # Depleted around 2040-2041 (peak cumulative).
    assert cfg.remaining_budget(2041) == 0.0
    # Stays at zero through mid-century while emissions are still
    # positive (peak emissions year ~2057).
    assert cfg.remaining_budget(2055) == 0.0
    # By 2100 the net-negative emissions have brought cumulative back
    # below 300 Gt, so the formula reports a "replenished" budget.
    # This is mathematically correct per the formula but should be
    # interpreted with care methodologically — the temperature
    # overshoot has already happened.
    final = cfg.remaining_budget(2100)
    assert final > 100, (
        f"expected replenishment > 100 Gt by 2100, got {final}"
    )


def test_ssp_1p9_total_cumulative_is_small_positive():
    """End-of-horizon cumulative under SSP1-1.9 is ~121 Gt — the early
    positives outweigh the late-century negatives but only modestly.
    This is the "Total global emissions over horizon" number that
    appears in the chart footer.
    """
    scenarios = {s["id"]: s for s in load_ssp_trajectories()}
    ssp = scenarios["SSP1-1.9"]
    total = sum(ssp["projected_emissions"].values())
    # Sanity-bounded range — refine if anchor values are updated.
    assert 100 < total < 140, f"unexpected cumulative {total}"
