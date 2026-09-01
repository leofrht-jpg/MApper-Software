"""The DSM simulate ROUTES must bind the sensitivity case, not just the engine.

``test_dsm_scaling.py::test_multi_scenario_produces_distinct_results`` proves
the ENGINE honours a case -- but it constructs ``ParameterEngine(table,
scenario=...)`` directly and never goes through a route. So the wiring one
level up was untested, and the wiring was wrong: ``simulate_for_scenario``
hard-coded ``_engine_for_scenario(None)``, and both of its callers knew the
user's selection and dropped it.

That is the same shape as the worker-launch coverage gap -- a test that
measures *that* the mechanism works, never *what it is invoked with*. These
tests go through the routes.

Scaling rules are the only channel from parameters into DSM output, so a
fixture here needs one. Neither live project has any (0 rules across both),
which is why this was latent rather than live -- but the binding is wrong
regardless of whether today's data exercises it.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api import bom as bom_api
from mapper.api import dsm as dsm_api
from mapper.api import impact as impact_api
from mapper.api import parameters as params_api
from mapper.models.dsm_schemas import (
    DimensionDef,
    DSMScalingRule,
    DSMSystemState,
    InflowData,
    ModeConfig,
    SystemDefinition,
    TimeHorizon,
    get_base_scenario,
)
from mapper.models.parameter_schemas import Parameter, ParameterTable

SYS_ID = "sys-case-binding"


@pytest.fixture()
def wired(monkeypatch):
    """A system whose inflows are scaled by a parameter that VARIES by case."""
    sys_def = SystemDefinition(
        id=SYS_ID,
        name="case binding",
        time_horizon=TimeHorizon(start_year=2026, end_year=2027),
        dimensions=[DimensionDef(name="fuel_type", display_name="Fuel", labels=["A"])],
    )
    state = DSMSystemState(
        system_id=SYS_ID,
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_inflow")],
        inflows=[InflowData(year=2026, counts={"A": 100.0})],
    )
    get_base_scenario(state).scaling_rules = [
        DSMScalingRule(id="r", expression="base * adoption", applies_to="inflows"),
    ]

    table = ParameterTable(
        parameters={
            "adoption": Parameter(
                name="adoption",
                base_value=1.0,
                scenario_overrides={"Aggressive": 1.5, "Cautious": 0.8},
            )
        },
        scenarios=["Aggressive", "Cautious"],
    )
    monkeypatch.setattr(params_api, "_table_for", lambda project=None: table)
    monkeypatch.setattr(dsm_api, "_get_system", lambda sid: sys_def)
    monkeypatch.setattr(dsm_api, "_get_or_create_state", lambda sid: state)
    return sys_def, state, table


def _inflow(result) -> float:
    return result.years[0].inflow["A"]


# ── the helper the fan-out calls ────────────────────────────────────────────

def test_simulate_for_scenario_binds_the_case(wired):
    """The bug: this hard-coded ``None`` and always computed Base."""
    base = dsm_api.simulate_for_scenario(SYS_ID, None, None)
    agg = dsm_api.simulate_for_scenario(SYS_ID, None, "Aggressive")
    cau = dsm_api.simulate_for_scenario(SYS_ID, None, "Cautious")

    assert _inflow(base) == pytest.approx(100.0)
    assert _inflow(agg) == pytest.approx(150.0), (
        "the case never reached the scaling rule -- simulate_for_scenario is "
        "still passing None to _engine_for_scenario"
    )
    assert _inflow(cau) == pytest.approx(80.0)


def test_omitting_the_case_is_base(wired):
    """Backward compat: every pre-existing caller passes nothing."""
    assert _inflow(dsm_api.simulate_for_scenario(SYS_ID, None)) == pytest.approx(100.0)


# ── the route ───────────────────────────────────────────────────────────────

def test_simulate_route_binds_the_case(wired, monkeypatch):
    monkeypatch.setattr(dsm_api, "_proj_results", lambda p=None: {})
    monkeypatch.setattr(dsm_api, "_proj_multi_results", lambda p=None: {})
    monkeypatch.setattr(dsm_api.dsm_storage, "save_results", lambda *a, **k: None)

    base = asyncio.run(dsm_api.simulate(SYS_ID, None, None))
    agg = asyncio.run(dsm_api.simulate(SYS_ID, None, "Aggressive"))

    assert _inflow(base) == pytest.approx(100.0)
    assert _inflow(agg) == pytest.approx(150.0)


def test_simulate_route_refuses_an_unknown_case(wired):
    """The case is validated at this boundary like every other (PR #72)."""
    with pytest.raises(HTTPException) as e:
        asyncio.run(dsm_api.simulate(SYS_ID, None, "Aggresive"))  # typo
    assert e.value.status_code == 400
    assert "Aggresive" in e.value.detail


# ── the two callers that knew the case and dropped it ───────────────────────

def test_impact_calculate_passes_its_case_to_the_dsm_sim(wired, monkeypatch):
    """``post_calculate`` had ``body.parameter_set_id`` in hand and did not
    forward it, so the LCA ran under the case and the fleet under Base."""
    seen: list[tuple] = []

    def _spy(system_id, scenario_id, case=None):
        seen.append((system_id, scenario_id, case))
        return dsm_api.simulate_for_scenario(system_id, scenario_id, case)

    monkeypatch.setattr(impact_api, "simulate_for_scenario", _spy)
    import inspect
    src = inspect.getsource(impact_api.post_calculate)
    assert "body.parameter_set_id" in src.split("simulate_for_scenario")[1][:200], (
        "post_calculate calls simulate_for_scenario without forwarding "
        "body.parameter_set_id -- the case is dropped on the DSM half"
    )


def test_material_flows_passes_its_case_to_the_dsm_sim(wired):
    import inspect
    src = inspect.getsource(bom_api.material_flows)
    tail = src.split("simulate_for_scenario(")[1][:200]
    assert "body.parameter_scenario" in tail, (
        "material_flows calls simulate_for_scenario without forwarding "
        "body.parameter_scenario -- the case is dropped on the DSM half"
    )


# ── the gap this file exists to close ───────────────────────────────────────

def test_the_engine_level_test_does_not_cover_the_routes():
    """Anti-vacuity, and a note for the next person.

    ``test_dsm_scaling.py`` constructs the engine directly. That is why the
    route-level binding could be wrong for as long as it was: the mechanism
    was tested, the invocation was not.
    """
    import pathlib

    src = pathlib.Path(__file__).with_name("test_dsm_scaling.py").read_text(
        encoding="utf-8"
    )
    assert "ParameterEngine(table, scenario=" in src
    assert "simulate_for_scenario" not in src, (
        "test_dsm_scaling now goes through the route helper -- if it covers "
        "the binding, say so there and drop this note"
    )
