# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 2D — Multi-parameter Excel export.

Acceptance tests for ``_build_multi_param_workbook`` (sibling to
``_build_multi_scenario_workbook``). Drives the builder directly with a
synthesised ``MultiParamImpactResult``; the orchestrator path
(``/impact/calculate-scenarios``) is covered by
``test_impact_multi_scenario.py``.

What we assert here:

* Sheet inventory matches the multi-LCI shape minus the LCI-specific index
  (Summary, Annual totals, By indicator, Parameter Scenarios).
* The discriminator column is ``"Sensitivity case"`` (matches the UI label,
  not "Parameter scenario") on every data sheet.
* The Parameter Scenarios index lists *only* parameters that vary across
  the selected scenarios — invariants are omitted.
* The export route 400s when both multi-param and multi-LCI envelopes are
  present (3-way axisConflict rule mirrored server-side).
"""
from __future__ import annotations

from unittest.mock import patch

from mapper.api import impact as impact_api
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCAYearResult,
    DSMLCASummary,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
    MultiParamImpactResult,
    ParamScenarioImpactResult,
)
from mapper.models.parameter_schemas import Parameter, ParameterTable


# ── Fixtures ────────────────────────────────────────────────────────────────


def _meta(mode: str = "static") -> ImpactAssessmentMeta:
    return ImpactAssessmentMeta(
        mode=mode,
        mfa_system_id="sys-1",
        scope="stock",
        year_start=2030,
        year_end=2031,
        base_db="ecoinvent-3.10-cutoff",
    )


def _make_year(year: int, total: float, method_unit: str = "kg CO2-eq") -> DSMLCAYearResult:
    return DSMLCAYearResult(
        year=year,
        total_impact=total,
        impact_by_cohort={"BEV|Small|2028": total},
        impact_by_material={"battery": total * 0.7, "body": total * 0.3},
        count_by_cohort={"BEV|Small|2028": 1.0},
        unit=method_unit,
    )


def _make_dsmlca(method: list[str], totals: dict[int, float]) -> DSMLCAResult:
    years = [_make_year(y, t) for y, t in sorted(totals.items())]
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


def _make_envelope(scenario_totals: dict[str, dict[int, float]]) -> MultiParamImpactResult:
    """Build a 3-scenario envelope. Same single method across all scenarios.

    ``scenario_totals = {scenario_name: {year: total_impact}}``.
    """
    method = ["EF v3.1", "climate change", "GWP100"]
    entries: list[ParamScenarioImpactResult] = []
    for scen, totals in scenario_totals.items():
        inner = ImpactAssessmentResult(
            task_id=f"task-{scen}",
            meta=_meta(),
            results=[_make_dsmlca(method, totals)],
        )
        entries.append(ParamScenarioImpactResult(scenario=scen, result=inner))
    return MultiParamImpactResult(
        meta=_meta(),
        scenarios=entries,
        elapsed_seconds=4.2,
    )


# ── Builder shape ───────────────────────────────────────────────────────────


def test_workbook_has_expected_sheets():
    env = _make_envelope({
        "Base":        {2030: 100.0, 2031: 110.0},
        "Optimistic":  {2030:  80.0, 2031:  85.0},
        "Conservative":{2030: 130.0, 2031: 145.0},
    })
    # No parameter table loaded → index falls back to stub. That's fine for
    # the shape test; varying-parameter behaviour is exercised separately.
    with patch.object(impact_api, "_resolve_varying_parameters", return_value=([], {s.scenario: {} for s in env.scenarios})):
        wb = impact_api._build_multi_param_workbook("Test System", env)
    assert wb.sheetnames == [
        "Summary",
        "Annual totals",
        "By indicator",
        "Parameter Scenarios",
    ]


def test_sensitivity_case_column_on_every_data_sheet():
    """The discriminator column must use the UI label ``"Sensitivity case"``
    (not "Parameter scenario") on Summary, Annual totals, By indicator, and
    the index sheet header. Naming drift between UI and exports is an
    unforced error."""
    env = _make_envelope({
        "Base":       {2030: 100.0, 2031: 110.0},
        "Optimistic": {2030:  80.0, 2031:  85.0},
        "Conservative":{2030: 130.0, 2031: 145.0},
    })
    with patch.object(impact_api, "_resolve_varying_parameters", return_value=([], {s.scenario: {} for s in env.scenarios})):
        wb = impact_api._build_multi_param_workbook("Test System", env)

    # Summary table header is the row immediately below the meta block.
    summary_headers = [c.value for r in wb["Summary"].iter_rows() for c in r if c.value == "Sensitivity case"]
    assert summary_headers, "Summary sheet must include a 'Sensitivity case' header"

    assert wb["Annual totals"].cell(row=1, column=2).value == "Sensitivity case"
    assert wb["By indicator"].cell(row=1, column=2).value == "Sensitivity case"
    assert wb["Parameter Scenarios"].cell(row=1, column=1).value == "Sensitivity case"


def test_data_rows_carry_scenario_name_per_row():
    """Every per-year row on Annual totals carries the scenario name, and
    rows are unfolded across scenarios (3 scenarios × 2 years = 6 data
    rows)."""
    env = _make_envelope({
        "Base":        {2030: 100.0, 2031: 110.0},
        "Optimistic":  {2030:  80.0, 2031:  85.0},
        "Conservative":{2030: 130.0, 2031: 145.0},
    })
    with patch.object(impact_api, "_resolve_varying_parameters", return_value=([], {s.scenario: {} for s in env.scenarios})):
        wb = impact_api._build_multi_param_workbook("Test System", env)
    ws = wb["Annual totals"]
    data_rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert len(data_rows) == 6
    scen_col = [r[1] for r in data_rows]
    assert set(scen_col) == {"Base", "Optimistic", "Conservative"}
    # Submission order preserved within scenario blocks (per-scenario then
    # per-year, not interleaved).
    assert scen_col == ["Base", "Base", "Optimistic", "Optimistic", "Conservative", "Conservative"]


# ── Parameter Scenarios index: varying-only filter ──────────────────────────


def test_index_lists_only_varying_parameters():
    """The index sheet must drop parameters whose values are identical
    across all selected scenarios. A constant parameter doesn't distinguish
    one scenario from another and would be visual noise."""
    env = _make_envelope({
        "Base":        {2030: 100.0},
        "Optimistic":  {2030:  80.0},
        "Conservative":{2030: 130.0},
    })

    # Synthesise a parameter table where battery_mass varies but density is
    # constant across the three selected scenarios.
    table = ParameterTable(
        parameters={
            "battery_mass": Parameter(
                name="battery_mass",
                base_value=250.0,
                scenario_overrides={"Optimistic": 200.0, "Conservative": 300.0},
            ),
            "density": Parameter(
                name="density",
                base_value=1.5,
                # No overrides → constant 1.5 in all scenarios → must be dropped.
            ),
            "lifespan": Parameter(
                name="lifespan",
                base_value=12.0,
                scenario_overrides={"Conservative": 18.0},
                # Base + Optimistic = 12, Conservative = 18 → varies → kept.
            ),
        },
        scenarios=["Optimistic", "Conservative"],
    )

    with patch("mapper.core.parameter_storage.load_parameter_table", return_value=table), \
         patch.object(impact_api, "_current_project", return_value="dummy_project"):
        wb = impact_api._build_multi_param_workbook("Test System", env)

    ws = wb["Parameter Scenarios"]
    header = [c.value for c in ws[1]]
    assert header[0] == "Sensitivity case"
    # battery_mass + lifespan vary; density does not. Order follows
    # ParameterTable.parameters insertion order.
    assert header[1:] == ["battery_mass", "lifespan"]

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert len(rows) == 3
    by_scen = {r[0]: r for r in rows}
    assert by_scen["Base"][1] == 250.0
    assert by_scen["Optimistic"][1] == 200.0
    assert by_scen["Conservative"][1] == 300.0
    assert by_scen["Base"][2] == 12.0
    assert by_scen["Optimistic"][2] == 12.0
    assert by_scen["Conservative"][2] == 18.0


def test_index_stub_when_no_parameters_vary():
    """When every parameter is constant across the selection (or no table is
    loaded), the index sheet still documents the selection and explains the
    invariance — it doesn't render an empty header."""
    env = _make_envelope({
        "Base":        {2030: 100.0},
        "Optimistic":  {2030: 100.0},
    })
    table = ParameterTable(
        parameters={
            "density": Parameter(name="density", base_value=1.5),
        },
        scenarios=["Optimistic"],
    )
    with patch("mapper.core.parameter_storage.load_parameter_table", return_value=table), \
         patch.object(impact_api, "_current_project", return_value="dummy_project"):
        wb = impact_api._build_multi_param_workbook("Test System", env)
    ws = wb["Parameter Scenarios"]
    header = [c.value for c in ws[1]]
    assert header == ["Sensitivity case"]
    rows = [c.value for r in ws.iter_rows(min_row=2) for c in r if c.value]
    assert "Base" in rows and "Optimistic" in rows
    # Stub note explaining invariance is included.
    assert any("No parameters vary" in (str(v) if v else "") for v in rows)


# ── Route-level guard: 3-way axisConflict mirrored server-side ──────────────


def test_export_rejects_both_multi_envelopes_simultaneously():
    """Defence-in-depth: the frontend's 3-way axisConflict rule prevents
    multi-LCI × multi-parameter from running, but the server still 400s if
    a misbehaving client tries to export both envelopes in one request."""
    import asyncio
    from fastapi import HTTPException
    from mapper.models.bom_schemas import (
        ImpactExportRequest,
        MultiScenarioProjectedImpactResult,
        ProspectiveScenarioRef,
        ScenarioProjectedResult,
    )

    sc = ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="remind", ssp="SSP2-PkBudg1150")
    lci_envelope = MultiScenarioProjectedImpactResult(
        task_id="abc",
        meta=_meta("projected"),
        scenarios=[ScenarioProjectedResult(
            scenario=sc,
            result=ImpactAssessmentResult(
                task_id="abc",
                meta=_meta("projected"),
                results=[_make_dsmlca(["EF v3.1", "climate change", "GWP100"], {2030: 100.0})],
            ),
        )],
    )
    param_envelope = _make_envelope({"Base": {2030: 100.0}})

    body = ImpactExportRequest(multi_result=lci_envelope, multi_param_result=param_envelope)

    try:
        asyncio.run(impact_api.post_export(body))
    except HTTPException as e:
        assert e.status_code == 400
        assert "axisConflict" in e.detail or "axis at a time" in e.detail
    else:
        raise AssertionError("Expected HTTPException 400 for dual-envelope export")
