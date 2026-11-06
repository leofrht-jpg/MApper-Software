# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Contribution analysis resolves the BOM against the REQUESTED sensitivity case, the same
way the single-product compute path does.

Impact Assessment builds a supply chain tree for the case a result was calculated under, so
the contribution route must (a) accept ``parameter_scenario``, (b) resolve the BOM with it,
(c) agree with the compute path's demand for that case, and (d) refuse an unknown case
before doing any work. ``test_parameter_resolution_never_gated`` proves by AST that the
builder reaches a resolver; this proves, with values, that the scenario reaches it.

In-memory only: an archetype and a parameter table registered in the module stores, no
Brightway project and no LCA solve.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.parameter_schemas import Parameter, ParameterTable
from mapper.models.schemas import ContributionAnalysisRequest

METHOD = ["EF v3.1", "climate change", "global warming potential (GWP100)"]


@pytest.fixture()
def archetype_and_table():
    from mapper.api import bom as bom_api
    from mapper.api import parameters as param_api

    node = BOMNode(
        id="m1", name="cells", node_type="material", quantity=0.0, unit="kg",
        quantity_expression="p",
        ecoinvent_activity=EcoinventLink(database="base", code="c1", name="cell act"),
    )
    stage = BOMNode(id="s1", name="Manufacturing", node_type="component",
                    quantity=1.0, scope="inflows", children=[node])
    arc = Archetype(id="cs-arc", name="CS Battery", bom=[stage])

    proj = param_api._current_project()
    prev = param_api._tables.get(proj)
    bom_api._proj_archetypes()["cs-arc"] = arc
    param_api._tables[proj] = ParameterTable(
        parameters={"p": Parameter(name="p", base_value=2.0, scenario_overrides={"High": 5.0})},
        scenarios=["High"],
    )
    yield
    bom_api._proj_archetypes().pop("cs-arc", None)
    if prev is None:
        param_api._tables.pop(proj, None)
    else:
        param_api._tables[proj] = prev


def _contribution_total(scenario):
    from mapper.api.lca import _build_archetype_demand
    demand, _name, _stages, per_stage = _build_archetype_demand("cs-arc", "all", None, scenario)
    assert sum(sum(d.values()) for d in per_stage.values()) == pytest.approx(sum(demand.values()))
    return sum(demand.values())


def _compute_total(scenario):
    from mapper.api.lca import _build_archetype_source_demand
    b = _build_archetype_source_demand(
        archetype_id="cs-arc", scope="all", amount=1.0, stage_amounts={},
        methods=[METHOD], parameter_scenario=scenario,
    )
    return sum(b.total_demand.values())


def test_the_request_accepts_a_case_and_keeps_it():
    req = ContributionAnalysisRequest(
        target_type="archetype", archetype_id="cs-arc", method=METHOD, parameter_scenario="High",
    )
    assert req.parameter_scenario == "High"
    assert ContributionAnalysisRequest(target_type="archetype", method=METHOD).parameter_scenario is None


def test_the_demand_follows_the_requested_case(archetype_and_table):
    assert _contribution_total(None) == pytest.approx(2.0)
    assert _contribution_total("Base") == pytest.approx(2.0)
    assert _contribution_total("High") == pytest.approx(5.0)


@pytest.mark.parametrize("scenario", [None, "Base", "High"])
def test_contribution_and_compute_paths_agree_per_case(archetype_and_table, scenario):
    # The supply chain tree must describe the SAME numbers as the score it sits under.
    assert _contribution_total(scenario) == pytest.approx(_compute_total(scenario))


def test_an_unknown_case_is_refused_before_any_work(archetype_and_table):
    from mapper.api.lca import _calculate_contribution_analysis_sync

    body = ContributionAnalysisRequest(
        target_type="archetype", archetype_id="cs-arc", method=METHOD, parameter_scenario="Typo",
    )
    with pytest.raises(HTTPException) as exc:
        _calculate_contribution_analysis_sync(body)
    assert exc.value.status_code == 400
    assert "Typo" in str(exc.value.detail)
