"""Patch 2E.3 — Multi-DSM Excel export.

Acceptance tests for ``_build_multi_dsm_workbook`` (sibling to
``_build_multi_param_workbook`` and ``_build_multi_scenario_workbook``).
Drives the builder directly with a synthesised ``MultiDSMImpactResult``;
the orchestrator path (``/impact/calculate-scenarios`` with
``dsm_scenario_ids``) is covered by ``test_impact_multi_dsm.py``.

What we assert here:

* Sheet inventory matches the multi-param shape, with the index renamed:
  Summary, Annual totals, By indicator, DSM Scenarios.
* The discriminator column is ``"DSM scenario"`` (matches the chip label
  in the UI) on every data sheet — Summary, Annual totals, By indicator,
  and the index sheet header.
* Per-row scenario unfolding: every per-year row carries the scenario
  name, and rows are unfolded across DSM scenarios.
* Index sheet exposes per-scenario simulation summary stats (DSM
  scenarios are structurally opaque — no flat parameter table to
  varying-filter), with first/last-year fleet counts and peak year/count
  derived from ``count_by_cohort``.
* Empty-result fallback: a synthesised envelope with no per-year data
  still produces a sheet with a stub note instead of crashing.
* Dual-envelope rejection: the export route 400s when multi_dsm_result
  is set together with multi_result or multi_param_result (axisConflict
  rule mirrored server-side).
"""
from __future__ import annotations

from mapper.api import impact as impact_api
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCAYearResult,
    DSMLCASummary,
    DSMScenarioImpactResult,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
    MultiDSMImpactResult,
    ParamScenarioImpactResult,
    MultiParamImpactResult,
)


# ── Fixtures ────────────────────────────────────────────────────────────────


def _meta(mode: str = "static", scope: str = "stock") -> ImpactAssessmentMeta:
    return ImpactAssessmentMeta(
        mode=mode,
        mfa_system_id="sys-1",
        scope=scope,
        year_start=2030,
        year_end=2031,
        base_db="ecoinvent-3.10-cutoff",
    )


def _make_year(
    year: int,
    total: float,
    counts: dict[str, float] | None = None,
) -> DSMLCAYearResult:
    return DSMLCAYearResult(
        year=year,
        total_impact=total,
        impact_by_cohort={"BEV|Small|2028": total},
        impact_by_material={"battery": total * 0.7, "body": total * 0.3},
        count_by_cohort=counts if counts is not None else {"BEV|Small|2028": 1.0},
        unit="kg CO2-eq",
    )


def _make_dsmlca(
    method: list[str],
    totals_and_counts: dict[int, tuple[float, dict[str, float]]],
) -> DSMLCAResult:
    """``totals_and_counts = {year: (total_impact, count_by_cohort_dict)}``."""
    years = [
        _make_year(y, t, counts) for y, (t, counts) in sorted(totals_and_counts.items())
    ]
    totals = {y: t for y, (t, _) in totals_and_counts.items()}
    peak_year = max(totals, key=totals.get)
    return DSMLCAResult(
        mfa_system_id="sys-1",
        scope="stock",
        method=method,
        method_label=" › ".join(method),
        unit="kg CO2-eq",
        years=years,
        summary=DSMLCASummary(
            total_impact=sum(totals.values()),
            peak_year=peak_year,
            peak_impact=totals[peak_year],
        ),
        stages_included=["Use Phase"],
    )


def _make_envelope(
    scenarios: dict[str, dict[int, tuple[float, dict[str, float]]]],
    *,
    scenario_ids: dict[str, str] | None = None,
) -> MultiDSMImpactResult:
    """Build a multi-DSM envelope.

    ``scenarios = {scenario_name: {year: (total_impact, count_by_cohort)}}``.
    """
    method = ["EF v3.1", "climate change", "GWP100"]
    entries: list[DSMScenarioImpactResult] = []
    ids = scenario_ids or {}
    for name, totals in scenarios.items():
        sid = ids.get(name, name.lower().replace(" ", "_"))
        meta = ImpactAssessmentMeta(
            mode="static",
            mfa_system_id="sys-1",
            scope="stock",
            year_start=2030,
            year_end=2031,
            base_db="ecoinvent-3.10-cutoff",
            dsm_scenario_id=sid,
        )
        inner = ImpactAssessmentResult(
            task_id=f"task-{sid}",
            meta=meta,
            results=[_make_dsmlca(method, totals)],
        )
        entries.append(DSMScenarioImpactResult(
            scenario_id=sid,
            scenario_name=name,
            result=inner,
        ))
    return MultiDSMImpactResult(
        meta=_meta(),
        scenarios=entries,
        elapsed_seconds=4.2,
    )


# ── Builder shape ───────────────────────────────────────────────────────────


def test_workbook_has_expected_sheets():
    env = _make_envelope({
        "Base":         {2030: (100.0, {"BEV|S|2028": 10.0}), 2031: (110.0, {"BEV|S|2028": 12.0})},
        "Slow uptake":  {2030: ( 80.0, {"BEV|S|2028":  8.0}), 2031: ( 85.0, {"BEV|S|2028":  9.0})},
        "Fast uptake":  {2030: (130.0, {"BEV|S|2028": 14.0}), 2031: (145.0, {"BEV|S|2028": 18.0})},
    })
    wb = impact_api._build_multi_dsm_workbook("Test System", env)
    assert wb.sheetnames == [
        "Summary",
        "Annual totals",
        "By indicator",
        "DSM Scenarios",
    ]


def test_dsm_scenario_column_on_every_data_sheet():
    """The discriminator column must use ``"DSM scenario"`` (matches the
    UI chip label) on Summary, Annual totals, By indicator, and the index
    sheet header. Naming drift between UI and exports is an unforced error.
    """
    env = _make_envelope({
        "Base":         {2030: (100.0, {"BEV|S|2028": 10.0}), 2031: (110.0, {"BEV|S|2028": 12.0})},
        "Slow uptake":  {2030: ( 80.0, {"BEV|S|2028":  8.0}), 2031: ( 85.0, {"BEV|S|2028":  9.0})},
        "Fast uptake":  {2030: (130.0, {"BEV|S|2028": 14.0}), 2031: (145.0, {"BEV|S|2028": 18.0})},
    })
    wb = impact_api._build_multi_dsm_workbook("Test System", env)

    summary_headers = [
        c.value for r in wb["Summary"].iter_rows() for c in r if c.value == "DSM scenario"
    ]
    assert summary_headers, "Summary sheet must include a 'DSM scenario' header"

    assert wb["Annual totals"].cell(row=1, column=2).value == "DSM scenario"
    assert wb["By indicator"].cell(row=1, column=2).value == "DSM scenario"
    assert wb["DSM Scenarios"].cell(row=1, column=1).value == "DSM scenario"


def test_data_rows_carry_scenario_name_per_row():
    """Every per-year row on Annual totals carries the scenario name, and
    rows are unfolded across scenarios (3 scenarios × 2 years = 6 rows)."""
    env = _make_envelope({
        "Base":         {2030: (100.0, {"BEV|S|2028": 10.0}), 2031: (110.0, {"BEV|S|2028": 12.0})},
        "Slow uptake":  {2030: ( 80.0, {"BEV|S|2028":  8.0}), 2031: ( 85.0, {"BEV|S|2028":  9.0})},
        "Fast uptake":  {2030: (130.0, {"BEV|S|2028": 14.0}), 2031: (145.0, {"BEV|S|2028": 18.0})},
    })
    wb = impact_api._build_multi_dsm_workbook("Test System", env)
    ws = wb["Annual totals"]
    data_rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert len(data_rows) == 6
    scen_col = [r[1] for r in data_rows]
    assert set(scen_col) == {"Base", "Slow uptake", "Fast uptake"}
    # Submission order preserved within scenario blocks.
    assert scen_col == [
        "Base", "Base",
        "Slow uptake", "Slow uptake",
        "Fast uptake", "Fast uptake",
    ]


# ── Index sheet: per-scenario summary stats from impact result ──────────────


def test_index_sheet_shows_simulation_summary_stats():
    """DSM scenarios are structurally opaque — the index sheet doesn't try
    to flatten nested data slots. Instead it shows per-scenario simulation
    summary stats derived from ``count_by_cohort``: first/last-year fleet,
    peak year + count, distinct cohort count.
    """
    env = _make_envelope(
        {
            "Slow uptake": {
                2030: (80.0, {"BEV|S|2028": 5.0, "BEV|M|2028": 3.0}),
                2031: (85.0, {"BEV|S|2028": 7.0, "BEV|M|2028": 4.0}),
            },
            "Fast uptake": {
                2030: (130.0, {"BEV|S|2028": 12.0, "BEV|M|2028": 8.0, "BEV|L|2028": 5.0}),
                2031: (145.0, {"BEV|S|2028": 18.0, "BEV|M|2028": 10.0, "BEV|L|2028": 7.0}),
            },
        },
        scenario_ids={"Slow uptake": "slow", "Fast uptake": "fast"},
    )
    wb = impact_api._build_multi_dsm_workbook("Test System", env)
    ws = wb["DSM Scenarios"]

    header = [c.value for c in ws[1]]
    assert header == [
        "DSM scenario", "Scenario ID",
        "First year", "Fleet at first year",
        "Last year", "Fleet at last year",
        "Peak year", "Peak fleet count",
        "Cohorts active",
    ]

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    by_name = {r[0]: r for r in rows}

    slow = by_name["Slow uptake"]
    assert slow[1] == "slow"
    assert slow[2] == 2030
    assert slow[3] == 8.0   # 5+3 at 2030
    assert slow[4] == 2031
    assert slow[5] == 11.0  # 7+4 at 2031
    assert slow[6] == 2031  # peak year (11 > 8)
    assert slow[7] == 11.0  # peak fleet count
    assert slow[8] == 2     # cohorts active: BEV|S|2028, BEV|M|2028

    fast = by_name["Fast uptake"]
    assert fast[1] == "fast"
    assert fast[3] == 25.0  # 12+8+5 at 2030
    assert fast[5] == 35.0  # 18+10+7 at 2031
    assert fast[6] == 2031
    assert fast[7] == 35.0
    assert fast[8] == 3


def test_index_sheet_stub_when_results_are_empty():
    """If every scenario produced empty results, the index sheet still
    emits a stub note explaining no simulation data is available rather
    than crashing or rendering a misleading-looking empty header.
    """
    method = ["EF v3.1", "climate change", "GWP100"]
    empty_inner = ImpactAssessmentResult(
        task_id="task-empty",
        meta=_meta(),
        results=[
            DSMLCAResult(
                mfa_system_id="sys-1",
                scope="stock",
                method=method,
                method_label=" › ".join(method),
                unit="kg CO2-eq",
                years=[],
                summary=DSMLCASummary(total_impact=0.0, peak_year=0, peak_impact=0.0),
                stages_included=[],
            )
        ],
    )
    env = MultiDSMImpactResult(
        meta=_meta(),
        scenarios=[
            DSMScenarioImpactResult(scenario_id="empty", scenario_name="Empty", result=empty_inner),
        ],
    )
    wb = impact_api._build_multi_dsm_workbook("Test System", env)
    ws = wb["DSM Scenarios"]
    rows_with_text = [
        c.value for r in ws.iter_rows(min_row=2) for c in r
        if isinstance(c.value, str) and c.value
    ]
    assert any("No simulation data" in v for v in rows_with_text)


def test_summary_stats_helper_handles_empty_result():
    """Direct unit test for the stats helper — empty results return Nones,
    not a crash on indexing into ``years[0]``."""
    method = ["EF v3.1", "climate change", "GWP100"]
    empty = ImpactAssessmentResult(
        task_id="task-x",
        meta=_meta(),
        results=[
            DSMLCAResult(
                mfa_system_id="sys-1",
                scope="stock",
                method=method,
                method_label=" › ".join(method),
                unit="kg CO2-eq",
                years=[],
                summary=DSMLCASummary(total_impact=0.0, peak_year=0, peak_impact=0.0),
                stages_included=[],
            )
        ],
    )
    stats = impact_api._dsm_scenario_summary_stats(empty)
    assert stats["first_year"] is None
    assert stats["count_first"] is None
    assert stats["peak_year"] is None
    assert stats["cohorts"] == 0


# ── Route-level guard: 3-way axisConflict mirrored server-side ──────────────


def test_export_rejects_multi_dsm_with_multi_param():
    """Defence-in-depth: the frontend's 3-way axisConflict rule prevents
    multi-DSM × multi-parameter from running, but the server still 400s if
    a misbehaving client tries to export both envelopes in one request."""
    import asyncio
    from fastapi import HTTPException
    from mapper.models.bom_schemas import ImpactExportRequest

    dsm_envelope = _make_envelope({
        "Base": {2030: (100.0, {"BEV|S|2028": 1.0})},
    })
    method = ["EF v3.1", "climate change", "GWP100"]
    param_inner = ImpactAssessmentResult(
        task_id="task-p",
        meta=_meta(),
        results=[_make_dsmlca(method, {2030: (100.0, {"BEV|S|2028": 1.0})})],
    )
    param_envelope = MultiParamImpactResult(
        meta=_meta(),
        scenarios=[ParamScenarioImpactResult(scenario="Base", result=param_inner)],
    )

    body = ImpactExportRequest(
        multi_dsm_result=dsm_envelope,
        multi_param_result=param_envelope,
    )
    try:
        asyncio.run(impact_api.post_export(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axis at a time" in e.detail or "axisConflict" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 for dual-envelope export")


def test_export_rejects_multi_dsm_with_multi_lci():
    """Same defence-in-depth rule for multi-DSM × multi-LCI."""
    import asyncio
    from fastapi import HTTPException
    from mapper.models.bom_schemas import (
        ImpactExportRequest,
        MultiScenarioProjectedImpactResult,
        ProspectiveScenarioRef,
        ScenarioProjectedResult,
    )

    dsm_envelope = _make_envelope({
        "Base": {2030: (100.0, {"BEV|S|2028": 1.0})},
    })
    sc = ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="remind", ssp="SSP2-PkBudg1150")
    method = ["EF v3.1", "climate change", "GWP100"]
    lci_inner = ImpactAssessmentResult(
        task_id="abc",
        meta=_meta("projected"),
        results=[_make_dsmlca(method, {2030: (100.0, {"BEV|S|2028": 1.0})})],
    )
    lci_envelope = MultiScenarioProjectedImpactResult(
        task_id="abc",
        meta=_meta("projected"),
        scenarios=[ScenarioProjectedResult(scenario=sc, result=lci_inner)],
    )

    body = ImpactExportRequest(
        multi_dsm_result=dsm_envelope,
        multi_result=lci_envelope,
    )
    try:
        asyncio.run(impact_api.post_export(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axis at a time" in e.detail or "axisConflict" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 for dual-envelope export")


def test_export_rejects_empty_multi_dsm_envelope():
    """``multi_dsm_result`` with zero scenarios is a 400, not a silently
    empty workbook — the frontend should never send this, but we guard
    anyway."""
    import asyncio
    from fastapi import HTTPException
    from mapper.models.bom_schemas import ImpactExportRequest

    empty = MultiDSMImpactResult(meta=_meta(), scenarios=[])
    body = ImpactExportRequest(multi_dsm_result=empty)
    try:
        asyncio.run(impact_api.post_export(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "at least one scenario" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 for empty multi_dsm_result")
