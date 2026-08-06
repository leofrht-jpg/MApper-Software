# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The frontend's carbon-budget fixture still matches this engine.

`mapper-frontend/tests/fixtures/carbonBudgetEngineSeries.json` is the engine's
own remaining-budget series, consumed by
`tests/carbonBudgetReadsEngine.test.tsx` to assert that the timeline inset's
depletion year equals the year `remaining_budget` first hits zero.

That test is only as good as the fixture. If the bundled budget data or the SSP
trajectories change and the fixture is not regenerated, the frontend would keep
asserting against a stale "engine truth" — it would pass while disagreeing with
the running engine, which is the same failure shape the fixture exists to
prevent. This test is the tripwire.

To regenerate after an intentional data change::

    python - <<'PY'
    import json
    from mapper.core.aesa_engine import build_carbon_budget
    out = {}
    for opt, ssp in (("IPCC_AR6_1p5C_50", "SSP2-4.5"), ("IPCC_AR6_2C_50", "SSP1-2.6")):
        cb = build_carbon_budget(budget_option_id=opt, ssp_id=ssp)
        years = sorted(y for y in cb.projected_emissions
                       if cb.start_year <= y <= cb.end_year)
        rows = [{"year": y, "remaining_budget_gt": cb.remaining_budget(y)} for y in years]
        cum, old = 0.0, None
        for y in years:
            cum += cb.projected_emissions.get(y, 0.0)
            if old is None and cum >= cb.initial_budget_gt:
                old = y
        out[f"{opt}__{ssp}"] = {
            "budget_option_id": opt, "ssp_id": ssp,
            "initial_budget_gt": cb.initial_budget_gt,
            "start_year": cb.start_year, "end_year": cb.end_year, "rows": rows,
            "engine_depletion_year": next(
                (r["year"] for r in rows if r["remaining_budget_gt"] <= 0), None),
            "pre_fix_frontend_depletion_year": old,
        }
    ...  # write out with the two leading "_generated_by"/"_why" keys preserved
    PY
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mapper.core.aesa_engine import build_carbon_budget

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "mapper-frontend" / "tests" / "fixtures" / "carbonBudgetEngineSeries.json"
)


def _fixture() -> dict:
    if not FIXTURE.exists():
        pytest.skip(f"frontend fixture not present at {FIXTURE}")
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("key", ["IPCC_AR6_1p5C_50__SSP2-4.5", "IPCC_AR6_2C_50__SSP1-2.6"])
def test_fixture_matches_the_engine(key):
    fx = _fixture()[key]
    cb = build_carbon_budget(
        budget_option_id=fx["budget_option_id"], ssp_id=fx["ssp_id"],
    )
    assert cb.initial_budget_gt == fx["initial_budget_gt"]
    assert cb.start_year == fx["start_year"]
    assert cb.end_year == fx["end_year"]

    years = sorted(
        y for y in cb.projected_emissions if cb.start_year <= y <= cb.end_year
    )
    assert [r["year"] for r in fx["rows"]] == years
    for row in fx["rows"]:
        assert row["remaining_budget_gt"] == pytest.approx(
            cb.remaining_budget(row["year"]), rel=1e-12,
        ), f"{key} @ {row['year']} — regenerate the fixture"


def test_depleting_case_still_depletes_and_the_offset_is_still_one_year():
    """The fixture's whole point is a configuration where the two disagree.

    If the budget data ever changed such that 1.5°C/50 × SSP2-4.5 no longer
    depletes, the frontend gate would pass vacuously — both sides would report
    "never" and the one-year offset it exists to catch would go unmeasured.
    """
    fx = _fixture()["IPCC_AR6_1p5C_50__SSP2-4.5"]
    assert fx["engine_depletion_year"] is not None, (
        "the depleting fixture no longer depletes — the frontend gate is vacuous; "
        "pick another budget × SSP pairing that does"
    )
    # The pre-fix frontend copy accumulated inclusively, landing exactly one
    # year early. Recorded so the frontend can assert it is NOT that number.
    assert fx["engine_depletion_year"] - fx["pre_fix_frontend_depletion_year"] == 1


def test_engine_excludes_the_current_year_from_consumption():
    """The root cause, pinned on the backend side.

    ``remaining_budget(year)`` sums ``range(start_year, year)`` — the budget at
    the START of ``year``. The discarded frontend copy accumulated through the
    current year inclusively, which is why its curve was
    ``remaining_budget(year + 1)``.
    """
    cb = build_carbon_budget(budget_option_id="IPCC_AR6_2C_50", ssp_id="SSP1-2.6")
    first = cb.start_year
    assert cb.remaining_budget(first) == cb.initial_budget_gt
    consumed_first_year = cb.projected_emissions.get(first, 0.0)
    assert consumed_first_year > 0
    assert cb.remaining_budget(first + 1) == pytest.approx(
        cb.initial_budget_gt - consumed_first_year,
    )
