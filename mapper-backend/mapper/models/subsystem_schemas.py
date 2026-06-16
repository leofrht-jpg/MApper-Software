"""Pydantic schemas for coupled product populations (Subsystems).

A *system* (as defined by ``SystemDefinition``) owns one implicit *primary*
subsystem whose dimensions + state + simulation come from the existing DSM
data. It may additionally own zero or more *dependent* subsystems whose stock
is derived from the primary's stock via user-defined ``DependencyRule``s.

Dependent subsystems have their own dimensions (e.g. ``infrastructure_type``)
and no inflows/Weibull of their own — stock is demand-driven.

Primary subsystem records are synthesized on the fly from ``SystemDefinition``
and are not persisted. Only dependent subsystems are stored (see
``subsystem_storage``). The "list subsystems" API prepends the synthesized
primary so the client sees one uniform list.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from mapper.models.dsm_schemas import DimensionDef


class DependencyRule(BaseModel):
    """Derives a dependent archetype's stock from filtered primary stock.

    The primary subsystem's stock for the current year is filtered by
    ``driver_filter`` (a dimension → allowed-values map) and summed into a
    scalar ``filtered_stock`` that is exposed to ``expression`` along with
    ``total_primary_stock``, ``year``, and all user parameters.

    Multiple rules may target the same ``dependent_archetype_id``; their
    contributions sum.
    """

    id: str                                        # uuid, set by server
    dependent_archetype_id: str                    # archetype inside the dependent subsystem
    driver_filter: dict[str, list[str]] = Field(default_factory=dict)
    expression: str
    description: str | None = None


class Subsystem(BaseModel):
    """A product group inside a system.

    ``type == "primary"`` records are synthesized from ``SystemDefinition`` at
    read time — callers should not persist them. ``type == "dependent"`` is
    the only form that is stored.
    """

    id: str                                        # uuid (for dependents) / system_id (synthesized primary)
    name: str
    type: Literal["primary", "dependent"]
    dimensions: list[DimensionDef] = Field(default_factory=list)

    # Populated only when type == "dependent".
    depends_on: str | None = None                  # subsystem id of the primary (== system_id)
    dependency_rules: list[DependencyRule] = Field(default_factory=list)
    # Optional base-year stock keyed by dependent cohort key (archetype id for
    # single-dim subsystems, pipe-joined for multi-dim). Provides a floor for
    # the first simulated year; rules drive all subsequent years.
    initial_stock: dict[str, float] = Field(default_factory=dict)
    # Optional cohort → BOM-archetype mapping. Each dependent cohort key (the
    # rule's ``dependent_archetype_id``) is mapped to an archetype in the BOM
    # library plus a scaling factor. Unmapped cohorts are skipped by the
    # Impact Assessment pipeline (a warning is surfaced in the task meta).
    cohort_mappings: dict[str, "SubsystemCohortMapping"] = Field(default_factory=dict)

    # Human label for one countable product in this subsystem (e.g. "chargers",
    # "kg"). Mirrors ``SystemDefinition.unit_name`` — subsystems can carry a
    # different unit from their parent (vehicles → integer, battery mass → kg).
    unit_name: str = "units"
    # When true, subsystem stock/flow counts are rounded to integers via
    # largest-remainder allocation. For discrete products (chargers, buildings);
    # disable for continuous quantities (mass, energy).
    integer_units: bool = False


class SubsystemCohortMapping(BaseModel):
    archetype_id: str
    scaling_factor: float = 1.0


Subsystem.model_rebuild()


class SubsystemSummary(BaseModel):
    id: str
    name: str
    type: Literal["primary", "dependent"]
    dimension_count: int
    archetype_count: int                            # # cohorts in this subsystem
    rule_count: int                                 # 0 for primary
    depends_on: str | None = None


class SubsystemList(BaseModel):
    subsystems: list[Subsystem]
