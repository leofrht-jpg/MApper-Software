# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""B9 — the frontend's default-carbon-budget fixture still matches this engine.

`mapper-frontend/tests/fixtures/aesaDefaultCarbonBudget.json` is
`build_carbon_budget()` — the fresh-config default — plus the budget options,
their derived CO2->CO2e factors, and the data's own vintage.

Why a fixture at all. `tests/aesaConfigBudgetBasis.test.tsx` asserted
`initial_budget_gt === 1150` as a bare literal. 1150 is BACKEND DATA
(`carbon_budgets.json`), so a budget-data change broke a frontend test — one the
backend author does not run, in a file that gives no hint the number came from
their edit. This test is the tripwire the other two carbon-budget fixtures
(`carbonBudgetSparkline.json`, `carbonBudgetEngineSeries.json`) already have:
the BACKEND fails first, names the drift, and says what to regenerate.

To regenerate after an intentional data change::

    python - <<'EOF'
    import json
    from pathlib import Path
    from mapper.core.aesa_engine import (
        build_carbon_budget, carbon_budget_vintage, load_carbon_budget_options,
        co2e_conversion_for_budget, load_ssp_trajectories)
    fx = json.loads(Path(FIXTURE).read_text())      # keep the leading _keys
    cb, v = build_carbon_budget(), carbon_budget_vintage()
    fx["default_carbon_budget"] = {...}             # see the fixture's shape
    fx["vintage"] = {...}; fx["budget_options"] = [...]
    fx["ssp_ids"] = [s["id"] for s in load_ssp_trajectories()]
    Path(FIXTURE).write_text(json.dumps(fx, indent=2) + "\\n")
    EOF
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mapper.core.aesa_engine import (
    build_carbon_budget,
    carbon_budget_vintage,
    co2e_conversion_for_budget,
    load_carbon_budget_options,
    load_ssp_trajectories,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "mapper-frontend" / "tests" / "fixtures" / "aesaDefaultCarbonBudget.json"
)

STALE = " — regenerate mapper-frontend/tests/fixtures/aesaDefaultCarbonBudget.json"


def _fixture() -> dict:
    if not FIXTURE.exists():
        pytest.skip(f"frontend fixture not present at {FIXTURE}")
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_default_carbon_budget_matches_the_engine():
    fx = _fixture()["default_carbon_budget"]
    cb = build_carbon_budget()
    assert fx["initial_budget_gt"] == cb.initial_budget_gt, "initial budget" + STALE
    assert fx["budget_source"] == cb.budget_source, "budget source" + STALE
    assert fx["start_year"] == cb.start_year, "start year" + STALE
    assert fx["end_year"] == cb.end_year, "end year" + STALE
    assert fx["ssp_scenario"] == cb.ssp_scenario, "SSP" + STALE
    assert fx["provisional"] == cb.provisional, "provisional flag" + STALE
    assert cb.co2e_conversion is not None
    assert fx["co2e_conversion"]["factor"] == pytest.approx(
        cb.co2e_conversion.factor, rel=1e-15), "CO2e factor" + STALE
    assert fx["co2e_conversion"]["kind"] == cb.co2e_conversion.kind


def test_vintage_matches_the_data_file():
    fx = _fixture()["vintage"]
    v = carbon_budget_vintage()
    assert fx["reference_year"] == v.reference_year, "vintage" + STALE
    assert fx["deduction_end_year"] == v.deduction_end_year, "vintage" + STALE
    assert fx["base_year"] == v.base_year, "vintage" + STALE
    assert fx["consumed_gt"] == v.consumed_gt, "vintage" + STALE


def test_every_budget_option_and_factor_matches():
    fx = _fixture()["budget_options"]
    opts = {o["id"]: o for o in load_carbon_budget_options()}
    assert [f["id"] for f in fx] == list(opts), "option set changed" + STALE
    for f in fx:
        o = opts[f["id"]]
        assert f["name"] == o["name"], f["id"] + STALE
        assert f["remaining_gt_from_2025"] == o["remaining_gt_from_2025"], f["id"] + STALE
        assert f["original_gt_from_2020"] == o["original_gt_from_2020"], f["id"] + STALE
        assert f["co2e_factor"] == pytest.approx(
            co2e_conversion_for_budget(o).factor, rel=1e-15), f["id"] + STALE


def test_ssp_ids_match():
    fx = _fixture()["ssp_ids"]
    assert fx == [s["id"] for s in load_ssp_trajectories()], "SSP list" + STALE


def test_the_fixture_still_exercises_the_co2e_basis():
    """A factor of 1 would make every CO2-vs-CO2e frontend assertion vacuous."""
    for f in _fixture()["budget_options"]:
        assert f["co2e_factor"] > 1.0, f"{f['id']} factor is not a real conversion"
