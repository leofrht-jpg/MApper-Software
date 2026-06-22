# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 2A — Multi-LCI projected runs.

Schema-level acceptance tests for the multi-scenario projected response
contract. The full orchestrator path (premise DBs + DSMxLCA pipeline) is
covered by ``test_contribution_prospective.py``; here we focus on the
discriminator + envelope shape that frontends narrow against.

Cache disambiguation is intentionally **not** tested: ``/impact/calculate``
does not have a result cache (each POST allocates a fresh task_id under
``mapper.api.impact._TASKS``). Documented as such in CLAUDE.md.
"""
from __future__ import annotations

from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCAYearResult,
    DSMLCASummary,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
    MultiScenarioProjectedImpactResult,
    ProspectiveScenarioRef,
    ScenarioProjectedResult,
)


def _empty_dsmlca_result(method: list[str]) -> DSMLCAResult:
    return DSMLCAResult(
        mfa_system_id="sys-1",
        scope="stock",
        method=method,
        method_label=" › ".join(method),
        unit="kg CO2-eq",
        years=[
            DSMLCAYearResult(
                year=2030,
                total_impact=42.0,
                impact_by_cohort={"BEV|Small|2028": 42.0},
                impact_by_material={"battery": 30.0},
                count_by_cohort={"BEV|Small|2028": 1.0},
                unit="kg CO2-eq",
            ),
        ],
        summary=DSMLCASummary(total_impact=42.0, peak_year=2030, peak_impact=42.0),
        stages_included=["Use Phase"],
    )


def _meta() -> ImpactAssessmentMeta:
    return ImpactAssessmentMeta(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        year_start=2030,
        year_end=2030,
        base_db="ecoinvent-3.10-cutoff",
        scenario=None,
        parameter_set_id=None,
        year_to_database={},
    )


def test_single_scenario_result_has_no_multi_discriminator():
    """N=1 path returns ``ImpactAssessmentResult`` (no ``result_type`` field
    set, or implicit ``system_level``). Frontend type guard must NOT classify
    it as multi-scenario."""
    res = ImpactAssessmentResult(
        task_id="abc",
        meta=_meta(),
        results=[_empty_dsmlca_result(["EF v3.1", "climate change", "GWP100"])],
        elapsed_seconds=1.2,
    )
    payload = res.model_dump()
    # Either field is absent or, if explicit, equals "system_level".
    assert payload.get("result_type", "system_level") == "system_level"


def test_multi_scenario_envelope_has_discriminator():
    """N>1 path returns ``MultiScenarioProjectedImpactResult`` with
    ``result_type='multi_scenario_projected'``."""
    sc_a = ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="remind", ssp="SSP2-PkBudg1150")
    sc_b = ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="image", ssp="SSP2-RCP19")
    inner = ImpactAssessmentResult(
        task_id="abc",
        meta=_meta(),
        results=[_empty_dsmlca_result(["EF v3.1", "climate change", "GWP100"])],
    )
    multi = MultiScenarioProjectedImpactResult(
        task_id="abc",
        meta=_meta(),
        scenarios=[
            ScenarioProjectedResult(scenario=sc_a, result=inner),
            ScenarioProjectedResult(scenario=sc_b, result=inner),
        ],
        elapsed_seconds=2.5,
    )
    payload = multi.model_dump()
    assert payload["result_type"] == "multi_scenario_projected"
    assert len(payload["scenarios"]) == 2
    assert payload["scenarios"][0]["scenario"]["iam"] == "remind"
    assert payload["scenarios"][1]["scenario"]["ssp"] == "SSP2-RCP19"


def test_multi_scenario_each_inner_result_keeps_full_shape():
    """Each ``ScenarioProjectedResult.result`` must carry a complete inner
    ``ImpactAssessmentResult`` so per-scenario export / AESA pipelines can
    consume it without reconstructing meta from the outer envelope."""
    sc = ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="remind", ssp="SSP2-PkBudg1150")
    inner = ImpactAssessmentResult(
        task_id="abc",
        meta=_meta(),
        results=[_empty_dsmlca_result(["EF v3.1", "climate change", "GWP100"])],
    )
    multi = MultiScenarioProjectedImpactResult(
        task_id="abc",
        meta=_meta(),
        scenarios=[ScenarioProjectedResult(scenario=sc, result=inner)],
    )
    nested = multi.scenarios[0].result
    assert nested.task_id == "abc"
    assert nested.meta.mode == "projected"
    assert len(nested.results) == 1
    assert nested.results[0].method[-1] == "GWP100"


def test_assessment_request_accepts_lci_scenarios_list():
    """The new ``lci_scenarios`` field is the contract surface — frontend
    sends a list of (base_db, iam, ssp) triples and the backend resolves
    them sequentially under one task_id."""
    from mapper.models.bom_schemas import ImpactAssessmentRequest

    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        lci_scenarios=[
            ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="remind", ssp="SSP2-PkBudg1150"),
            ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff", iam="image", ssp="SSP2-RCP19"),
        ],
    )
    assert body.lci_scenarios is not None
    assert len(body.lci_scenarios) == 2
    # Legacy ``scenario`` is unchanged when ``lci_scenarios`` is set.
    assert body.scenario is None


def test_calculate_scenarios_static_mode_preserves_mode_per_task():
    """``/impact/calculate-scenarios`` is mode-agnostic: when the inbound body
    has ``mode='static'``, every per-scenario task spawned by the orchestrator
    must inherit ``mode='static'`` (not silently flip to projected). This is
    the contract the Static-LCI multi-parameter UI relies on.

    We mock ``post_calculate`` (the per-scenario worker entry point) to capture
    the bodies it would have received, then call ``post_calculate_scenarios``
    directly. No bw2 setup, no worker thread.
    """
    import asyncio
    from unittest.mock import patch

    from mapper.api import impact as impact_api
    from mapper.models.bom_schemas import ImpactAssessmentRequest

    body = ImpactAssessmentRequest(
        mode="static",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        scenarios=["Base", "Optimistic", "Conservative"],
    )

    captured: list[ImpactAssessmentRequest] = []

    async def _fake_post_calculate(req: ImpactAssessmentRequest):
        captured.append(req)
        return {"task_id": f"task-{req.parameter_set_id}"}

    with patch.object(impact_api, "post_calculate", _fake_post_calculate):
        out = asyncio.run(impact_api.post_calculate_scenarios(body))

    assert set(out["scenarios"].keys()) == {"Base", "Optimistic", "Conservative"}
    assert all(tid.startswith("task-") for tid in out["scenarios"].values())

    # Mode must propagate to every spawned per-scenario task.
    assert len(captured) == 3
    assert all(c.mode == "static" for c in captured), "static mode must propagate per-scenario"
    # Each per-scenario request carries exactly one parameter_set_id and no
    # leftover ``scenarios`` list (the orchestrator strips it).
    assert {c.parameter_set_id for c in captured} == {"Base", "Optimistic", "Conservative"}
    assert all(c.scenarios is None for c in captured)


def test_assessment_request_legacy_single_scenario_still_works():
    """Backward compat: passing only the legacy ``scenario`` (singular) still
    parses cleanly — the backend's normalisation block then collapses it to
    ``[body.scenario]`` and runs single-scenario path."""
    from mapper.models.bom_schemas import ImpactAssessmentRequest

    body = ImpactAssessmentRequest(
        mode="projected",
        mfa_system_id="sys-1",
        scope="stock",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        scenario=ProspectiveScenarioRef(
            base_db="ecoinvent-3.10-cutoff", iam="remind", ssp="SSP2-PkBudg1150"
        ),
    )
    assert body.scenario is not None
    assert body.lci_scenarios is None
