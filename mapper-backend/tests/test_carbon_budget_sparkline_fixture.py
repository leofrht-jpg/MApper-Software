# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The sidebar sparkline's fixture still matches this engine.

`mapper-frontend/tests/fixtures/carbonBudgetSparkline.json` is the engine's own
remaining-budget series across all four AR6 budget options at SSP2-4.5.
`tests/carbonBudgetSparkline.test.tsx` asserts the frontend's re-implementation
in `utils/carbonBudget.ts` reproduces it exactly.

That re-implementation is unavoidable: the AESA sidebar's budget sparkline
renders BEFORE any compute — live, as the user changes the budget option and SSP
dropdowns — so there are no SR rows carrying `remaining_budget_gt` to read. (The
post-compute timeline inset does read them; it must not be migrated onto the
helper.)

Which makes this test the load-bearing one. If the bundled budget data or the
SSP trajectories change and the fixture is not regenerated, the frontend keeps
asserting against a stale "engine truth": green tests, silently disagreeing with
the running engine. That is precisely the failure the fixture exists to prevent,
so the fixture itself needs a tripwire.

To regenerate after an intentional data change::

    python - <<'PY'
    import json
    from mapper.core.aesa_engine import build_carbon_budget
    out = {"_generated_by": ..., "_why": ...}          # keep the leading keys
    for opt, ssp in PAIRINGS:
        cb = build_carbon_budget(budget_option_id=opt, ssp_id=ssp)
        years = sorted(y for y in cb.projected_emissions
                       if cb.start_year <= y <= cb.end_year)
        rows = [{"year": y, "remaining_gt": cb.remaining_budget(y)} for y in years]
        cum, old = 0.0, None
        for y in years:
            cum += cb.projected_emissions.get(y, 0.0)
            if old is None and cum >= cb.initial_budget_gt:
                old = y
        out[f"{opt}__{ssp}"] = {...}                    # see the fixture's shape
    PY
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mapper.core.aesa_engine import build_carbon_budget

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "mapper-frontend" / "tests" / "fixtures" / "carbonBudgetSparkline.json"
)

PAIRINGS = [
    "IPCC_AR6_1p5C_50__SSP2-4.5",
    "IPCC_AR6_1p5C_67__SSP2-4.5",
    "IPCC_AR6_2C_50__SSP2-4.5",
    "IPCC_AR6_2C_67__SSP2-4.5",
]


def _fixture() -> dict:
    if not FIXTURE.exists():
        pytest.skip(f"frontend fixture not present at {FIXTURE}")
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_fixture_covers_every_shipped_budget_option():
    """All four AR6 options, not just the one that was reported.

    The bug was found on 1.5 °C/67; it was present on all four. A fixture
    covering one pairing would have let the others regress unnoticed.
    """
    fx = _fixture()
    assert set(PAIRINGS) <= set(fx), "fixture is missing a shipped budget option"


@pytest.mark.parametrize("key", PAIRINGS)
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
        assert row["remaining_gt"] == pytest.approx(
            cb.remaining_budget(row["year"]), rel=1e-12,
        ), f"{key} @ {row['year']} — regenerate the fixture"

    # The emissions the frontend replays through its own implementation.
    for y in years:
        assert fx["projected_emissions"][str(y)] == pytest.approx(
            cb.projected_emissions[y], rel=1e-12,
        ), f"{key} @ {y} — regenerate the fixture"


@pytest.mark.parametrize("key", PAIRINGS)
def test_every_pairing_depletes_and_is_exactly_one_year_off_the_old_rule(key):
    """Each pairing must still exercise the thing under test.

    If a budget × SSP pairing stopped depleting within the horizon, the frontend
    gate would pass vacuously — both sides would report "never" and the
    off-by-one would go unmeasured.
    """
    fx = _fixture()[key]
    assert fx["engine_depletion_year"] is not None, (
        f"{key} no longer depletes — the frontend gate is vacuous for it; "
        "pick a pairing that does"
    )
    # The pre-fix sparkline accumulated inclusively, landing exactly one year
    # early. Recorded so the frontend can assert it is NOT that number.
    assert fx["engine_depletion_year"] - fx["pre_fix_sparkline_depletion_year"] == 1


def test_the_reported_case_is_pinned_by_its_literal_years():
    """1.5 °C/67 × SSP2-4.5 — the configuration in the bug report.

    Sidebar read "depleted ~2030"; the engine says 2031.
    """
    fx = _fixture()["IPCC_AR6_1p5C_67__SSP2-4.5"]
    assert fx["initial_budget_gt"] == 200.0
    assert fx["engine_depletion_year"] == 2031
    assert fx["pre_fix_sparkline_depletion_year"] == 2030
