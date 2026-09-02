"""The Monte Carlo export records WHEN it was computed.

It was not among the ten builders the run-provenance patch fixed, so it
carried a seed -- reproducible -- but no date, and could not be placed in
time. A reproducibility record that cannot say when it was produced is half a
record, and the omission was invisible precisely because the sheet already
looked thorough.

Found by clicking through a frozen build, not by a test. Hence this one.
"""
from __future__ import annotations

import datetime

from mapper.core.run_provenance import NOT_RECORDED


def _summary_rows(wb):
    return {
        str(r[0]).strip(): r[1]
        for r in wb["Summary"].iter_rows(values_only=True)
        if r and r[0]
    }


def _single(**kw):
    from mapper.models.schemas import (
        ArchetypeLCAMethodDistribution, MonteCarloResult,
    )
    d = ArchetypeLCAMethodDistribution(
        method=["m"], method_label="m", unit="kg", deterministic=1.0,
        n_iterations=10, seed=7, mean=1.0, median=1.0, std=0.1, gsd2=1.2,
        p2_5=0.9, p25=0.95, p75=1.05, p97_5=1.1, dispersion_95=1.2,
    )
    base = dict(scope="all", n_iterations=10, seed=7, archetype_id="a",
                archetype_name="A", distributions=[d])
    base.update(kw)
    return MonteCarloResult(**base)


def test_the_export_records_the_compute_time():
    from mapper.api.monte_carlo import _build_monte_carlo_workbook

    r = _single(computed_at="2026-09-01T17:18:31.100420+00:00",
                mapper_version="0.2.0")
    rows = _summary_rows(_build_monte_carlo_workbook(r, None))
    assert rows["Calculated"] == "2026-09-01 17:18 UTC"
    assert rows["MApper version"] == "0.2.0"


def test_an_unstamped_result_says_not_recorded_never_today():
    """Same rule as the other ten: the fallback to now() IS the bug."""
    from mapper.api.monte_carlo import _build_monte_carlo_workbook

    rows = _summary_rows(_build_monte_carlo_workbook(_single(), None))
    assert rows["Calculated"] == NOT_RECORDED
    today = datetime.date.today().strftime("%Y-%m-%d")
    assert today not in str(rows["Calculated"])


def test_the_seed_is_still_there():
    """The date is ADDITIVE -- the seed is the other half of reproducing a
    run, and it must not be displaced."""
    from mapper.api.monte_carlo import _build_monte_carlo_workbook

    rows = _summary_rows(_build_monte_carlo_workbook(_single(), None))
    assert rows["Seed"] == 7
