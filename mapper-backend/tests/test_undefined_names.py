# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Three names that were called without ever being defined, and the guard.

Each shipped, each raised NameError only on the path that reached it, and each
sat behind a route that no test drove to that line:

* ``lca._translate_demand_to_database`` called ``_current_project()`` (#97,
  v0.2.1+). Only reached when the prospective database IS installed, so the
  unit tests (early returns) and CI (no premise database) never got there --
  and every real single-product Prospective compute raised.
* the five DSM template routes called ``build_template_filename`` (#103,
  v0.2.2), defined in ``bom`` but never imported into ``dsm``. Every
  "Download template" link on the DSM Dashboard returned 500.
* ``dsm.simulate_scenarios`` used ``table`` (since v0.1.0), never assigned.
  Reached only for a scenario WITH scaling rules; no live project has one.

The class guard is pyflakes' undefined-name check over the whole package. Its
exemption list is empty on purpose.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]


def test_translation_reaches_the_base_db_rule_when_the_target_is_installed(monkeypatch):
    import bw2data

    from mapper.api import lca

    class _DBs(dict):
        pass

    monkeypatch.setattr(bw2data, "databases", _DBs({"ei": {}, "ei_premise_2030": {}}))
    monkeypatch.setattr(bw2data, "get_activity", lambda key: object())
    out, warnings = lca._translate_demand_to_database({("ei", "abc"): 2.0}, "ei_premise_2030")
    assert out == {("ei_premise_2030", "abc"): 2.0}
    assert warnings == []


def _seed(scaling_rules=()):
    from mapper.api import dsm as dsm_api
    from mapper.models.dsm_schemas import (
        BASE_SCENARIO_ID, DimensionDef, DSMScenario, DSMSystemState, InflowData,
        ModeConfig, OutflowData, SystemDefinition, TimeHorizon,
    )

    sys_def = SystemDefinition(
        id="s", name="Fleet (EU)", time_horizon=TimeHorizon(start_year=2020, end_year=2021),
        dimensions=[DimensionDef(name="fuel_type", display_name="Fuel", labels=["BEV", "ICEV"])],
    )
    state = DSMSystemState(system_id="s", scenarios=[DSMScenario(
        id=BASE_SCENARIO_ID, name="Base", is_base=True,
        initial_stock={"BEV|1": 0.0, "ICEV|1": 100.0},
        inflows=[InflowData(year=2021, counts={"BEV": 20.0, "ICEV": 10.0})],
        mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
        outflows=[OutflowData(year=2021, counts={"BEV": 0.0, "ICEV": 5.0})],
        scaling_rules=list(scaling_rules),
    )])
    project = dsm_api._current_project()
    monkeypatch_systems = dsm_api._systems.setdefault(project, {})
    monkeypatch_systems["s"] = sys_def
    dsm_api._states.setdefault(project, {})["s"] = state
    return project


@pytest.fixture()
def client():
    from mapper.api import dsm as dsm_api
    from mapper.main import app

    project = dsm_api._current_project()
    yield TestClient(app)
    dsm_api._systems.get(project, {}).pop("s", None)
    dsm_api._states.get(project, {}).pop("s", None)


@pytest.mark.parametrize("artifact", ["stock", "inflows", "stock-targets", "outflows", "stock-aggregate"])
def test_every_dsm_template_route_downloads(client, artifact):
    _seed()
    r = client.post(f"/api/dsm/systems/s/templates/{artifact}")
    assert r.status_code == 200, r.text[:300]
    assert "Fleet_(EU)" in r.headers["content-disposition"]


def test_simulate_scenarios_with_a_scaling_rule(client):
    from mapper.models.dsm_schemas import DSMScalingRule

    from mapper.api import parameters
    from mapper.models.parameter_schemas import Parameter, ParameterTable

    project = _seed([DSMScalingRule(id="r", expression="base * k", applies_to="inflows")])
    # Real rules reference parameters; with no table at all a rule is a
    # documented no-op in /simulate too, which is not what this test is about.
    parameters._tables[project] = ParameterTable(parameters={"k": Parameter(name="k", base_value=2.0)})
    r = client.post("/api/dsm/systems/s/simulate-scenarios", json={"cases": ["Base"]})
    assert r.status_code == 200, r.text[:500]
    # The rule doubled the 2021 inflows: 30 -> 60 new units that year.
    (result,) = r.json()["scenarios"].values()
    year_2021 = next(y for y in result["years"] if y["year"] == 2021)
    assert sum(year_2021["inflow"].values()) == pytest.approx(60.0)


# ── The class guard ─────────────────────────────────────────────────────────

def test_no_undefined_names_in_the_package():
    """pyflakes' undefined-name check, whole package, no exemptions.

    Skipped only OFF CI: CI installs pyflakes, and a guard that skips where it
    gates merges is not a guard, so there a missing pyflakes fails.
    """
    try:
        import pyflakes  # noqa: F401
    except ImportError:
        if os.environ.get("CI"):
            pytest.fail("pyflakes must be installed in CI -- this guard would otherwise not run")
        pytest.skip("pyflakes not installed locally (pip install pyflakes)")
    r = subprocess.run([sys.executable, "-m", "pyflakes", str(BACKEND / "mapper")],
                       capture_output=True, text=True, timeout=300)
    undefined = [ln for ln in r.stdout.splitlines() if "undefined name" in ln]
    assert undefined == [], "names used but never defined:\n" + "\n".join(undefined)
