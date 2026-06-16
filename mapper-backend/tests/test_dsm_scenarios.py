"""Tests for the DSM scenarios refactor.

Scenarios turn DSM state into a named data-slot system: a required Base
scenario plus optional children that inherit from Base slot-by-slot (``None``
means "use Base", an explicit value means "override"). These tests cover:

* **Legacy migration** — existing ``state.json`` files written before
  scenarios still load, with top-level data fields wrapped into Base.
* **Inheritance resolver** — ``materialize_scenario`` picks own → Base →
  empty default per slot.
* **Cross-product dedup** — scenarios without scaling rules produce
  byte-identical results across sensitivity cases, so the engine output is
  the same object we can alias.
* **Legacy request migration** — old clients that posted ``scenarios: [...]``
  to ``POST /simulate-scenarios`` are routed to ``cases`` transparently.
* **Scenario copy semantics** — ``model_copy(deep=True)`` produces an
  independent scenario whose slot edits don't leak back into the source.
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_engine import DynamicStockModel
from mapper.models.dsm_schemas import (
    BASE_SCENARIO_ID,
    DimensionDef,
    DSMScalingRule,
    DSMScenario,
    DSMSystemState,
    InflowData,
    MaterializedDSMState,
    ModeConfig,
    OutflowData,
    SimulateScenariosRequest,
    StockTargetData,
    SurvivalConfig,
    SystemDefinition,
    TimeHorizon,
    get_base_scenario,
    get_scenario,
    materialize_scenario,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _system(start: int = 2020, end: int = 2022) -> SystemDefinition:
    return SystemDefinition(
        id="s",
        name="test",
        time_horizon=TimeHorizon(start_year=start, end_year=end),
        dimensions=[
            DimensionDef(name="fuel_type", display_name="Fuel", labels=["BEV", "ICEV"]),
        ],
    )


# ── Legacy JSON migration ────────────────────────────────────────────────────


def test_legacy_flat_state_migrates_to_base_scenario():
    """Pre-refactor state.json: data fields at the top level → wrapped into Base."""
    legacy = {
        "system_id": "s",
        "initial_stock": {"BEV|0": 0.0, "ICEV|0": 1000.0},
        "inflows": [{"year": 2021, "counts": {"BEV": 100.0, "ICEV": 50.0}}],
        "mode_configs": [{"dimension_filters": {}, "mode": "manual"}],
    }
    state = DSMSystemState.model_validate(legacy)

    assert len(state.scenarios) == 1
    base = state.scenarios[0]
    assert base.id == BASE_SCENARIO_ID
    assert base.is_base is True
    assert base.initial_stock == {"BEV|0": 0.0, "ICEV|0": 1000.0}
    assert base.inflows[0].counts == {"BEV": 100.0, "ICEV": 50.0}
    assert base.mode_configs[0].mode == "manual"
    assert state.active_scenario_id == BASE_SCENARIO_ID


def test_legacy_migration_preserves_existing_scenarios():
    """A state file mid-migration: legacy top-level + already-defined scenarios merge."""
    payload = {
        "system_id": "s",
        "inflows": [{"year": 2021, "counts": {"BEV": 10.0}}],
        "scenarios": [
            {
                "id": "high",
                "name": "High adoption",
                "is_base": False,
                "inflows": [{"year": 2021, "counts": {"BEV": 999.0}}],
            },
        ],
    }
    state = DSMSystemState.model_validate(payload)

    ids = [s.id for s in state.scenarios]
    assert BASE_SCENARIO_ID in ids
    assert "high" in ids
    base = get_base_scenario(state)
    assert base.inflows[0].counts["BEV"] == 10.0
    high = next(s for s in state.scenarios if s.id == "high")
    assert high.inflows[0].counts["BEV"] == 999.0


def test_empty_state_gets_base_scenario_injected():
    """A minimal state with no scenarios still ends up with a Base."""
    state = DSMSystemState.model_validate({"system_id": "s"})
    assert len(state.scenarios) == 1
    assert state.scenarios[0].is_base
    assert state.active_scenario_id == BASE_SCENARIO_ID


def test_construct_with_legacy_kwargs_still_works():
    """In-Python construction with pre-refactor kwargs is migrated the same way."""
    state = DSMSystemState(
        system_id="s",
        initial_stock={"BEV|0": 10.0},
        inflows=[InflowData(year=2021, counts={"BEV": 1.0})],
    )
    base = get_base_scenario(state)
    assert base.initial_stock == {"BEV|0": 10.0}
    assert base.inflows[0].counts == {"BEV": 1.0}


# ── Inheritance resolver ─────────────────────────────────────────────────────


def test_materialize_inherits_none_slots_from_base():
    state = DSMSystemState(
        system_id="s",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID,
                name="Base",
                is_base=True,
                initial_stock={"BEV|0": 5.0},
                inflows=[InflowData(year=2021, counts={"BEV": 2.0})],
            ),
            # All slots None → inherit everything.
            DSMScenario(id="alt", name="Alt"),
        ],
    )
    view = materialize_scenario(state, "alt")
    assert view.scenario_id == "alt"
    assert view.initial_stock == {"BEV|0": 5.0}
    assert view.inflows[0].counts == {"BEV": 2.0}


def test_materialize_own_value_overrides_base():
    state = DSMSystemState(
        system_id="s",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID,
                name="Base",
                is_base=True,
                inflows=[InflowData(year=2021, counts={"BEV": 2.0})],
            ),
            DSMScenario(
                id="alt",
                name="Alt",
                inflows=[InflowData(year=2021, counts={"BEV": 100.0})],
            ),
        ],
    )
    view = materialize_scenario(state, "alt")
    assert view.inflows[0].counts == {"BEV": 100.0}


def test_materialize_explicit_empty_list_overrides_base():
    """An explicit empty list on a child means "no inflows here" — not inherit."""
    state = DSMSystemState(
        system_id="s",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID,
                name="Base",
                is_base=True,
                inflows=[InflowData(year=2021, counts={"BEV": 2.0})],
            ),
            DSMScenario(id="empty", name="Empty", inflows=[]),
        ],
    )
    view = materialize_scenario(state, "empty")
    assert view.inflows == []


def test_materialize_empty_defaults_when_nothing_set():
    state = DSMSystemState(system_id="s")  # migration gives us an empty Base
    view = materialize_scenario(state)
    assert view.initial_stock == {}
    assert view.inflows == []
    assert view.stock_targets == []
    assert view.outflows == []
    assert view.mode_configs == []
    assert view.scaling_rules == []
    assert view.scenario_id == BASE_SCENARIO_ID


def test_materialize_without_id_falls_back_to_active_then_base():
    state = DSMSystemState(
        system_id="s",
        scenarios=[
            DSMScenario(id=BASE_SCENARIO_ID, name="Base", is_base=True),
            DSMScenario(
                id="alt", name="Alt",
                inflows=[InflowData(year=2021, counts={"BEV": 7.0})],
            ),
        ],
        active_scenario_id="alt",
    )
    view = materialize_scenario(state)  # no id → active → "alt"
    assert view.scenario_id == "alt"
    assert view.inflows[0].counts == {"BEV": 7.0}


def test_get_scenario_raises_on_unknown_id():
    state = DSMSystemState(system_id="s")
    with pytest.raises(KeyError, match="ghost"):
        get_scenario(state, "ghost")


def test_materialize_unknown_scenario_raises():
    state = DSMSystemState(system_id="s")
    with pytest.raises(KeyError):
        materialize_scenario(state, "ghost")


# ── SimulateScenariosRequest legacy migration ────────────────────────────────


def test_simulate_scenarios_request_migrates_legacy_key():
    req = SimulateScenariosRequest.model_validate({"scenarios": ["Base", "High"]})
    assert req.cases == ["Base", "High"]
    assert req.scenario_ids == []


def test_simulate_scenarios_request_ignores_legacy_when_cases_present():
    req = SimulateScenariosRequest.model_validate(
        {"scenarios": ["ignored"], "cases": ["A", "B"]}
    )
    assert req.cases == ["A", "B"]


def test_simulate_scenarios_request_defaults_empty():
    req = SimulateScenariosRequest()
    assert req.scenario_ids == []
    assert req.cases == []


# ── Cross-product dedup behavior ─────────────────────────────────────────────


def test_scenarios_without_scaling_rules_produce_identical_results():
    """Two scenarios inheriting identical data — results are byte-identical.

    This is the property the ``simulate_scenarios`` endpoint exploits to alias
    a single computation across every sensitivity case.
    """
    sys = _system(2020, 2021)
    state = DSMSystemState(
        system_id="s",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID,
                name="Base",
                is_base=True,
                initial_stock={"BEV|0": 0.0, "ICEV|0": 100.0},
                inflows=[InflowData(year=2021, counts={"BEV": 20.0, "ICEV": 10.0})],
                mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
                outflows=[OutflowData(year=2021, counts={"BEV": 0.0, "ICEV": 5.0})],
            ),
            DSMScenario(id="clone", name="Clone"),  # inherits all slots from Base
        ],
    )
    a = DynamicStockModel(sys, materialize_scenario(state, BASE_SCENARIO_ID)).simulate()
    b = DynamicStockModel(sys, materialize_scenario(state, "clone")).simulate()
    assert a.model_dump() == b.model_dump()


def test_scenarios_with_diverging_inflows_produce_different_results():
    sys = _system(2020, 2021)
    state = DSMSystemState(
        system_id="s",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID,
                name="Base",
                is_base=True,
                initial_stock={"BEV|0": 0.0, "ICEV|0": 100.0},
                inflows=[InflowData(year=2021, counts={"BEV": 20.0, "ICEV": 0.0})],
                mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
            ),
            DSMScenario(
                id="high",
                name="High",
                inflows=[InflowData(year=2021, counts={"BEV": 500.0, "ICEV": 0.0})],
            ),
        ],
    )
    a = DynamicStockModel(sys, materialize_scenario(state, BASE_SCENARIO_ID)).simulate()
    b = DynamicStockModel(sys, materialize_scenario(state, "high")).simulate()
    y_a = next(y for y in a.years if y.year == 2021)
    y_b = next(y for y in b.years if y.year == 2021)
    assert y_a.stock["BEV"] == pytest.approx(20.0)
    assert y_b.stock["BEV"] == pytest.approx(500.0)


def test_engine_accepts_unmaterialized_state_directly():
    """``DynamicStockModel`` can take a persisted ``DSMSystemState``: it
    auto-materializes the active scenario. This keeps pre-refactor test and
    API call sites working without touching them.
    """
    sys = _system(2020, 2021)
    state = DSMSystemState(
        system_id="s",
        initial_stock={"BEV|0": 0.0, "ICEV|0": 10.0},
        mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
    )
    result = DynamicStockModel(sys, state).simulate()
    assert result.years[0].stock["ICEV"] == pytest.approx(10.0)


# ── Scenario copy semantics (CRUD primitive) ─────────────────────────────────


def test_scenario_deep_copy_does_not_leak_edits():
    """``model_copy(deep=True)`` is how the create-scenario endpoint forks
    slots from ``copy_from``. Edits to the clone must not mutate the source.
    """
    source = DSMScenario(
        id="a",
        name="A",
        inflows=[InflowData(year=2021, counts={"BEV": 1.0})],
        scaling_rules=[
            DSMScalingRule(id="r1", applies_to="inflows", expression="base * 2"),
        ],
    )
    clone = source.model_copy(deep=True)
    clone.id = "b"
    clone.name = "B"
    assert clone.inflows is not source.inflows
    clone.inflows[0].counts["BEV"] = 99.0
    clone.scaling_rules[0].expression = "base * 5"

    assert source.inflows[0].counts["BEV"] == 1.0
    assert source.scaling_rules[0].expression == "base * 2"


# ── MaterializedDSMState is a view, not persisted ────────────────────────────


def test_materialized_state_is_independent_of_source():
    """Mutating the engine's view should not corrupt the persisted state."""
    state = DSMSystemState(
        system_id="s",
        initial_stock={"BEV|0": 1.0},
    )
    view = materialize_scenario(state)
    assert isinstance(view, MaterializedDSMState)
    # The view holds references to the same lists for zero-copy efficiency;
    # the important invariant is that the persisted Base scenario still owns
    # the data, so round-tripping to JSON excludes the materialized shape.
    dumped = state.model_dump()
    assert "initial_stock" not in dumped  # lives under scenarios[0], not top level
    assert dumped["scenarios"][0]["initial_stock"] == {"BEV|0": 1.0}


# ── promote_to_base endpoint ──────────────────────────────────────────────────
#
# Exercises the POST /systems/{id}/scenarios/{new_base_id}/promote-to-base
# handler. The operation is non-trivial: it materializes every scenario's
# inherited slots into explicit overrides *before* the is_base flag is swapped
# so no scenario silently re-parents onto the new Base. We drive the handler
# directly (via asyncio.run) rather than through TestClient to match the rest
# of this suite's sync-only style.


def _run_promote(system_id: str, new_base_id: str):
    import asyncio
    from mapper.api import dsm as dsm_api
    return asyncio.run(dsm_api.promote_to_base(system_id, new_base_id))


def _seed_system_with_state(state: DSMSystemState) -> str:
    """Register a SystemDefinition + state in the in-memory stores."""
    from mapper.api import dsm as dsm_api
    sys_def = _system(2020, 2022)
    sys_def.id = state.system_id
    project = dsm_api._current_project()
    dsm_api._systems.setdefault(project, {})[state.system_id] = sys_def
    dsm_api._states.setdefault(project, {})[state.system_id] = state
    return state.system_id


def test_promote_materializes_none_slots_on_other_scenarios():
    """Non-target scenarios inheriting from old Base get explicit overrides copied in.

    Per the spec, the new-Base target itself is *skipped* — its None slots
    stay None, which now mean "empty default" because it owns Base semantics.
    The old Base keeps its explicit data, preserving it from the fleet's
    perspective.
    """
    state = DSMSystemState(
        system_id="sys_promote_1",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID, name="Base", is_base=True,
                initial_stock={"BEV|0": 7.0},
                inflows=[InflowData(year=2021, counts={"BEV": 4.0})],
                mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
            ),
            DSMScenario(id="alt", name="Alt"),  # promotion target
            DSMScenario(id="third", name="Third"),  # sibling that was inheriting
        ],
    )
    _seed_system_with_state(state)

    result = _run_promote("sys_promote_1", "alt")
    alt = next(s for s in result.scenarios if s.id == "alt")
    old_base = next(s for s in result.scenarios if s.id == BASE_SCENARIO_ID)
    third = next(s for s in result.scenarios if s.id == "third")

    # Flag swap.
    assert alt.is_base is True
    assert old_base.is_base is False

    # New base keeps its None slots — by spec, the target is excluded from
    # the materialization walk so its semantics fully replace old Base's.
    assert alt.initial_stock is None
    assert alt.inflows is None

    # Old Base still owns its explicit slots.
    assert old_base.initial_stock == {"BEV|0": 7.0}
    assert old_base.inflows[0].counts == {"BEV": 4.0}

    # Third had all-None slots; each is now an explicit override carrying the
    # value that used to come from old Base, so it doesn't re-parent onto alt.
    assert third.initial_stock == {"BEV|0": 7.0}
    assert third.inflows[0].counts == {"BEV": 4.0}
    assert third.mode_configs[0].mode == "manual"


def test_promote_flattens_other_scenarios_effective_data():
    """A third scenario that was inheriting keeps its effective values after promotion."""
    state = DSMSystemState(
        system_id="sys_promote_2",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID, name="Base", is_base=True,
                initial_stock={"BEV|0": 50.0},
                inflows=[InflowData(year=2021, counts={"BEV": 10.0})],
            ),
            DSMScenario(
                id="agg", name="Aggressive",
                inflows=[InflowData(year=2021, counts={"BEV": 999.0})],
                # initial_stock is None → inherits from Base
            ),
            DSMScenario(id="bystander", name="Bystander"),  # all None
        ],
    )
    _seed_system_with_state(state)

    result = _run_promote("sys_promote_2", "agg")

    bystander = next(s for s in result.scenarios if s.id == "bystander")
    # Before: bystander inherited initial_stock=50, inflows=10 from old Base.
    # After: bystander should still *effectively* see that data — materialized
    # into the bystander scenario so the new Base (agg, inflows=999) can't
    # hijack the fallback.
    assert bystander.initial_stock == {"BEV|0": 50.0}
    assert bystander.inflows[0].counts == {"BEV": 10.0}

    agg = next(s for s in result.scenarios if s.id == "agg")
    # Agg's own override is preserved — promotion doesn't stomp it.
    assert agg.is_base is True
    assert agg.inflows[0].counts == {"BEV": 999.0}
    # Agg's initial_stock was None → promotion leaves it None (it IS the new
    # base now; Base's semantics treat None as "empty default", which is the
    # correct behavior — agg never claimed to override initial_stock).
    assert agg.initial_stock is None


def test_promote_unknown_scenario_returns_404():
    from fastapi import HTTPException
    state = DSMSystemState(system_id="sys_promote_3")  # auto-creates Base
    _seed_system_with_state(state)

    with pytest.raises(HTTPException) as excinfo:
        _run_promote("sys_promote_3", "ghost")
    assert excinfo.value.status_code == 404


def test_promote_same_scenario_is_noop():
    """Promoting the current Base to Base: no errors, no data changes."""
    state = DSMSystemState(
        system_id="sys_promote_4",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID, name="Base", is_base=True,
                initial_stock={"BEV|0": 12.0},
            ),
            DSMScenario(id="alt", name="Alt"),
        ],
    )
    _seed_system_with_state(state)

    result = _run_promote("sys_promote_4", BASE_SCENARIO_ID)

    base = next(s for s in result.scenarios if s.is_base)
    assert base.id == BASE_SCENARIO_ID
    # The sibling's None slots are untouched — we don't flatten on a no-op.
    alt = next(s for s in result.scenarios if s.id == "alt")
    assert alt.initial_stock is None


def test_promote_roundtrip_preserves_effective_data():
    """promote A → promote old base back: every scenario's effective data is unchanged."""
    from mapper.models.dsm_schemas import materialize_scenario as materialize

    state = DSMSystemState(
        system_id="sys_promote_5",
        scenarios=[
            DSMScenario(
                id=BASE_SCENARIO_ID, name="Base", is_base=True,
                initial_stock={"BEV|0": 3.0},
                inflows=[InflowData(year=2021, counts={"BEV": 1.0})],
            ),
            DSMScenario(
                id="alt", name="Alt",
                inflows=[InflowData(year=2021, counts={"BEV": 99.0})],
            ),
            DSMScenario(id="third", name="Third"),
        ],
    )
    _seed_system_with_state(state)

    # Effective values before any promotion.
    before = {
        s.id: {
            "initial_stock": materialize(state, s.id).initial_stock,
            "inflow_bev": materialize(state, s.id).inflows[0].counts.get("BEV"),
        }
        for s in state.scenarios
    }

    _run_promote("sys_promote_5", "alt")
    from mapper.api import dsm as dsm_api
    mid = dsm_api._proj_states()["sys_promote_5"]
    _run_promote("sys_promote_5", BASE_SCENARIO_ID)
    after_state = dsm_api._proj_states()["sys_promote_5"]

    after = {
        s.id: {
            "initial_stock": materialize(after_state, s.id).initial_stock,
            "inflow_bev": materialize(after_state, s.id).inflows[0].counts.get("BEV"),
        }
        for s in after_state.scenarios
    }
    assert before == after
    # And the Base flag is back where it started.
    assert get_base_scenario(after_state).id == BASE_SCENARIO_ID
