# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Licence-free demo project: DSM → MFA → LCA → AESA with no ecoinvent.

ecoinvent is separately licensed and is never bundled with MApper, so a new
user (or a reviewer) cannot compute anything on a fresh install. This module
builds a self-contained demo project that exercises the whole integrated
pipeline using only components that carry no licence restriction:

* ``biosphere3`` and ~760 LCIA methods, installed by ``bw2io.bw2setup()`` —
  these ship inside bw2io, which is already a dependency. Real elementary
  flows, real characterisation factors.
* A **synthetic technosphere** written here: a handful of invented activities
  whose emission exchanges point at real ``biosphere3`` flows. Because the
  flows and the characterisation factors are real, a real ``bw2calc`` solve
  produces a real number — the *inventory* is what is made up.

Nothing licence-restricted is shipped or reconstructible: this file contains
invented numbers only, and the ecoinvent-derived content a real assessment
needs is never present.

**The inventory numbers are fictional.** They are chosen to be plausible in
order of magnitude so the charts look sensible, and they are wrong. Every
activity name carries a ``DEMO`` prefix and a ``(FICTIONAL DATA)`` suffix so
the origin is visible everywhere a name is rendered — activity pickers, BOM
trees, contribution charts, Excel exports. Nothing produced from this project
is a valid environmental assessment.

Isolation: everything is written inside a dedicated Brightway2 project
(:data:`DEMO_PROJECT_NAME`). Real user projects are never touched, and the
whole demo is removed by deleting that one project.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("mapper.demo")

# Brightway2 project that holds the demo. The name is also the signal the UI
# uses to show its "synthetic data" banner — see is_demo_project().
DEMO_PROJECT_NAME = "MApper demo (synthetic data)"

# Technosphere database written into that project.
DEMO_DB_NAME = "demo-synthetic-technosphere"

# Marker embedded in every generated name. Also the string the frontend keys
# its per-activity warnings off, so keep the two in sync.
FICTIONAL_TAG = "(FICTIONAL DATA)"

DEMO_SYSTEM_NAME = f"DEMO passenger-vehicle fleet {FICTIONAL_TAG}"
DEMO_ARCHETYPE_BEV = f"DEMO battery-electric vehicle {FICTIONAL_TAG}"
DEMO_ARCHETYPE_ICEV = f"DEMO combustion vehicle {FICTIONAL_TAG}"

START_YEAR = 2020
END_YEAR = 2050


def is_demo_project(project_name: str | None) -> bool:
    """True when *project_name* is the synthetic demo project.

    Used by the API so the frontend can show a persistent banner. Matching on
    the exact name keeps this cheap and avoids a marker file that could be
    lost when a project is duplicated.
    """
    return (project_name or "").strip() == DEMO_PROJECT_NAME


@dataclass
class DemoBuildReport:
    """What the build actually did, so callers can report it honestly."""
    project: str = DEMO_PROJECT_NAME
    bw2setup_ran: bool = False
    biosphere_flows: int = 0
    lcia_methods: int = 0
    technosphere_activities: int = 0
    dsm_system_id: str = ""
    dsm_years: int = 0
    archetypes: list[str] = field(default_factory=list)
    simulated: bool = False
    total_inflow_units: float = 0.0
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "project": self.project,
            "bw2setup_ran": self.bw2setup_ran,
            "biosphere_flows": self.biosphere_flows,
            "lcia_methods": self.lcia_methods,
            "technosphere_activities": self.technosphere_activities,
            "dsm_system_id": self.dsm_system_id,
            "dsm_years": self.dsm_years,
            "archetypes": self.archetypes,
            "simulated": self.simulated,
            "total_inflow_units": self.total_inflow_units,
            "notes": self.notes,
        }


# ── Synthetic technosphere ───────────────────────────────────────────────────
#
# Invented inventories. Each entry is
#   key: (name, unit, {biosphere flow search term: kg emitted per unit},
#         {upstream demo activity key: amount})
#
# Magnitudes are loosely plausible (steel ~2 kg CO2/kg, aluminium ~8, grid
# electricity ~0.3 kg CO2/kWh) purely so the resulting charts have sensible
# proportions. They are not measurements and must not be cited.
_SYNTHETIC_ACTIVITIES: dict[str, dict[str, Any]] = {
    "demo_electricity": {
        "name": f"DEMO electricity, grid mix {FICTIONAL_TAG}",
        "unit": "kilowatt hour",
        "emissions": {"Carbon dioxide, fossil": 0.30},
        "inputs": {},
    },
    "demo_steel": {
        "name": f"DEMO steel {FICTIONAL_TAG}",
        "unit": "kilogram",
        "emissions": {"Carbon dioxide, fossil": 1.9},
        "inputs": {"demo_electricity": 0.5},
    },
    "demo_aluminium": {
        "name": f"DEMO aluminium {FICTIONAL_TAG}",
        "unit": "kilogram",
        "emissions": {"Carbon dioxide, fossil": 6.5},
        "inputs": {"demo_electricity": 4.0},
    },
    "demo_battery_cell": {
        "name": f"DEMO lithium-ion battery cell {FICTIONAL_TAG}",
        "unit": "kilogram",
        "emissions": {"Carbon dioxide, fossil": 4.0},
        "inputs": {"demo_electricity": 8.0, "demo_aluminium": 0.15},
    },
    "demo_petrol": {
        "name": f"DEMO petrol, burned in engine {FICTIONAL_TAG}",
        "unit": "kilogram",
        "emissions": {"Carbon dioxide, fossil": 3.1},
        "inputs": {},
    },
}

# BOM masses per vehicle (kg), and per-year use-phase demand. Invented.
_BEV_BOM = {
    "Manufacturing": {
        "demo_steel": ("DEMO steel body & chassis", 780.0, "kilogram"),
        "demo_aluminium": ("DEMO aluminium structure", 190.0, "kilogram"),
        "demo_battery_cell": ("DEMO traction battery", 340.0, "kilogram"),
    },
    "Use Phase": {
        "demo_electricity": ("DEMO charging electricity", 2600.0, "kilowatt hour"),
    },
}
_ICEV_BOM = {
    "Manufacturing": {
        "demo_steel": ("DEMO steel body & chassis", 950.0, "kilogram"),
        "demo_aluminium": ("DEMO aluminium structure", 130.0, "kilogram"),
    },
    "Use Phase": {
        "demo_petrol": ("DEMO petrol consumed", 900.0, "kilogram"),
    },
}


def _find_biosphere_flow(bd: Any, search: str) -> Any:
    """Resolve a real biosphere3 flow by name, preferring emissions to air.

    Looked up by name rather than hard-coded UUID so this keeps working across
    bw2io releases, which do re-key flows between versions.
    """
    bio = bd.Database("biosphere3")
    matches = [
        f for f in bio
        if f["name"].lower().startswith(search.lower())
        and (f.get("categories") or (None,))[0] == "air"
    ]
    if not matches:
        raise RuntimeError(
            f"No biosphere3 flow matching {search!r}. Was bw2setup() run?"
        )
    # Prefer the unspecified sub-compartment (the plain "air" one).
    exact = [f for f in matches if len(f.get("categories") or ()) == 1]
    return (exact or matches)[0]


def _write_synthetic_technosphere(bd: Any, report: DemoBuildReport) -> None:
    """Write DEMO_DB_NAME, linking emissions to real biosphere3 flows."""
    if DEMO_DB_NAME in bd.databases:
        del bd.databases[DEMO_DB_NAME]

    flow_cache: dict[str, Any] = {}
    data: dict[tuple[str, str], dict[str, Any]] = {}

    for code, spec in _SYNTHETIC_ACTIVITIES.items():
        exchanges: list[dict[str, Any]] = [{
            "input": (DEMO_DB_NAME, code),
            "amount": 1.0,
            "type": "production",
        }]
        for term, amount in spec["emissions"].items():
            if term not in flow_cache:
                flow_cache[term] = _find_biosphere_flow(bd, term)
            f = flow_cache[term]
            exchanges.append({
                "input": (f["database"], f["code"]),
                "amount": amount,
                "type": "biosphere",
            })
        for upstream, amount in spec["inputs"].items():
            exchanges.append({
                "input": (DEMO_DB_NAME, upstream),
                "amount": amount,
                "type": "technosphere",
            })

        data[(DEMO_DB_NAME, code)] = {
            "name": spec["name"],
            "unit": spec["unit"],
            "location": "GLO",
            "type": "process",
            "comment": (
                "SYNTHETIC DEMO DATA — invented inventory shipped with MApper so "
                "the pipeline can be exercised without an ecoinvent licence. "
                "Not a measurement; not valid for any assessment."
            ),
            "exchanges": exchanges,
        }

    bd.Database(DEMO_DB_NAME).write(data)
    report.technosphere_activities = len(data)
    logger.info("demo: wrote %d synthetic activities", len(data))


def _build_archetype(name: str, bom_spec: dict[str, dict], unit_label: str) -> Any:
    """Build an Archetype whose material leaves link to the synthetic db."""
    from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

    stages: list[BOMNode] = []
    for stage_name, materials in bom_spec.items():
        children: list[BOMNode] = []
        for code, (label, qty, unit) in materials.items():
            spec = _SYNTHETIC_ACTIVITIES[code]
            children.append(BOMNode(
                name=f"{label} {FICTIONAL_TAG}",
                node_type="material",
                quantity=qty,
                unit=unit,
                ecoinvent_activity=EcoinventLink(
                    database=DEMO_DB_NAME,
                    code=code,
                    name=spec["name"],
                    location="GLO",
                    unit=spec["unit"],
                    reference_product=spec["name"],
                ),
            ))
        stages.append(BOMNode(
            name=stage_name,
            node_type="component",
            quantity=1.0,
            unit=unit_label,
            scope="inflows" if stage_name == "Manufacturing" else "stock",
            is_annual=(stage_name == "Use Phase"),
            children=children,
        ))

    return Archetype(
        name=name,
        description=(
            "SYNTHETIC DEMO ARCHETYPE — invented bill of materials. Provided so "
            "MApper's DSM → MFA → LCA → AESA chain can be run without an "
            "ecoinvent licence. Not valid for any assessment."
        ),
        category="DEMO",
        bom=stages,
    )


def build_demo_project(*, rebuild: bool = False) -> DemoBuildReport:
    """Create (or refresh) the demo project and return what was built.

    Idempotent: calling it twice leaves one demo project. ``rebuild=True``
    forces the synthetic technosphere and DSM state to be rewritten.

    Only ever writes inside :data:`DEMO_PROJECT_NAME`. The caller's previously
    active project is restored before returning, so loading the demo from a
    running app does not silently move the user somewhere else.
    """
    import bw2data as bd
    import bw2io as bi

    from mapper.core import dsm_storage
    from mapper.core.dsm_engine import DynamicStockModel
    from mapper.models.bom_schemas import CohortMapping, CohortMappingEntry
    from mapper.models.dsm_schemas import (
        DimensionDef, DSMScenario, DSMSystemState, InflowData,
        SurvivalConfig, SystemDefinition, TimeHorizon,
    )

    report = DemoBuildReport()
    previous_project = bd.projects.current

    try:
        bd.projects.set_current(DEMO_PROJECT_NAME)

        # 1. biosphere3 + LCIA methods (free, ships inside bw2io)
        if "biosphere3" not in bd.databases or len(bd.methods) == 0:
            logger.info("demo: running bw2setup() (biosphere3 + LCIA methods)")
            bi.bw2setup()
            report.bw2setup_ran = True
        report.biosphere_flows = len(bd.Database("biosphere3"))
        report.lcia_methods = len(bd.methods)

        # 2. synthetic technosphere
        if rebuild or DEMO_DB_NAME not in bd.databases:
            _write_synthetic_technosphere(bd, report)
        else:
            report.technosphere_activities = len(bd.Database(DEMO_DB_NAME))

        # 3. DSM system — 2 powertrains, one age dimension is implicit
        system = SystemDefinition(
            name=DEMO_SYSTEM_NAME,
            description=(
                "SYNTHETIC DEMO SYSTEM — invented fleet numbers. Demonstrates "
                "MApper's integrated workflow without an ecoinvent licence."
            ),
            time_horizon=TimeHorizon(start_year=START_YEAR, end_year=END_YEAR),
            dimensions=[DimensionDef(
                name="powertrain", display_name="Powertrain",
                labels=["BEV", "ICEV"], is_age=False,
            )],
            unit_name="vehicles",
        )
        system.id = system.id or "demo-fleet"
        report.dsm_system_id = system.id
        dsm_storage.save_system(DEMO_PROJECT_NAME, system)

        # 4. inflows: BEV ramps up, ICEV declines — invented but shaped so the
        #    stock turnover is visible over the horizon.
        years = list(range(START_YEAR, END_YEAR + 1))
        report.dsm_years = len(years)
        inflows: list[InflowData] = []
        total = 0.0
        for y in years:
            t = (y - START_YEAR) / (END_YEAR - START_YEAR)
            bev = round(5_000 + 95_000 * t, 1)
            icev = round(95_000 * (1 - t) + 5_000 * (1 - t), 1)
            counts = {"BEV": bev, "ICEV": max(icev, 0.0)}
            total += sum(counts.values())
            inflows.append(InflowData(year=y, counts=counts))
        report.total_inflow_units = total

        scenario = DSMScenario(
            id="base", name="Base", is_base=True, inflows=inflows,
        )
        state = DSMSystemState(
            system_id=system.id,
            survival_configs=[SurvivalConfig(
                dimension_filters={}, method="weibull",
                weibull_shape=3.5, weibull_scale=15.0,
            )],
            integer_units=True,
            scenarios=[scenario],
            active_scenario_id="base",
        )
        dsm_storage.save_state(DEMO_PROJECT_NAME, system.id, state)

        # 5. simulate through the real engine (same DynamicStockModel the
        #    /simulate endpoint uses — the demo supplies inputs, not a
        #    different code path)
        model = DynamicStockModel(system, state)
        result = model.simulate()
        dsm_storage.save_results(DEMO_PROJECT_NAME, system.id, result)
        report.simulated = True

        # 6. archetypes + cohort mapping
        bev = _build_archetype(DEMO_ARCHETYPE_BEV, _BEV_BOM, "vehicle")
        icev = _build_archetype(DEMO_ARCHETYPE_ICEV, _ICEV_BOM, "vehicle")
        bev.id = "demo-bev"
        icev.id = "demo-icev"
        for arc in (bev, icev):
            dsm_storage.save_archetype(DEMO_PROJECT_NAME, arc)
            report.archetypes.append(arc.name)

        dsm_storage.save_cohort_mappings(
            DEMO_PROJECT_NAME, system.id,
            CohortMapping(
                mfa_system_id=system.id,
                mappings=[
                    CohortMappingEntry(cohort_key="BEV", archetype_id="demo-bev"),
                    CohortMappingEntry(cohort_key="ICEV", archetype_id="demo-icev"),
                ],
            ),
        )

        report.notes.append(
            "All inventory and fleet numbers are invented. Not a valid assessment."
        )
        report.notes.append(
            "Prospective (premise) analysis is NOT available in the demo: it "
            "requires both an ecoinvent licence and a premise key."
        )
        return report

    finally:
        # Never leave the caller pointed at the demo project by accident.
        try:
            if previous_project and previous_project != DEMO_PROJECT_NAME:
                bd.projects.set_current(previous_project)
        except Exception:  # pragma: no cover - best effort restore
            logger.warning("demo: could not restore project %s", previous_project)
