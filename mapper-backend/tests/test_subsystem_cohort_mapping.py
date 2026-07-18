# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""CHANGE 2 — subsystem cohort mapping must be applied for manual (no-rule)
subsystems, not only rule-based ones. Regression + bug guard.
"""
from __future__ import annotations

from mapper.core.dsm_lca_engine import build_subsystem_cohort_mapping
from mapper.models.dsm_schemas import DimensionDef
from mapper.models.subsystem_schemas import (
    DependencyRule,
    Subsystem,
    SubsystemCohortMapping,
)


def _sub(rules=None, cohort_mappings=None, labels=("home", "public")):
    return Subsystem(
        id="sub1",
        name="Chargers",
        type="dependent",
        dimensions=[DimensionDef(name="charger", display_name="Charger", labels=list(labels))],
        depends_on="sys1",
        dependency_rules=rules or [],
        cohort_mappings=cohort_mappings or {},
    )


def test_manual_subsystem_mapping_is_applied_without_rules():
    """The bug (CASE 4): a subsystem whose cohorts come from manual flows (no
    dependency_rules) had its saved cohort mapping ignored — build_ returned
    an EMPTY mapping. Now every user-set entry is applied."""
    sub = _sub(
        rules=[],  # manual mode — no rules
        cohort_mappings={
            "home": SubsystemCohortMapping(archetype_id="bom_home", scaling_factor=2.0),
            "public": SubsystemCohortMapping(archetype_id="bom_public", scaling_factor=1.0),
        },
    )
    mapping, unmapped = build_subsystem_cohort_mapping(sub)
    assert mapping == {"home": ("bom_home", 2.0), "public": ("bom_public", 1.0)}
    assert unmapped == []  # no rule targets → nothing to warn about


def test_rule_based_subsystem_still_works_and_warns_unmapped():
    """Regression: rule-based mapping unchanged; a rule target lacking a mapping
    is reported in `unmapped`."""
    sub = _sub(
        rules=[
            DependencyRule(id="r1", dependent_archetype_id="home", expression="1"),
            DependencyRule(id="r2", dependent_archetype_id="public", expression="1"),
        ],
        cohort_mappings={"home": SubsystemCohortMapping(archetype_id="bom_home")},
    )
    mapping, unmapped = build_subsystem_cohort_mapping(sub)
    assert mapping == {"home": ("bom_home", 1.0)}
    assert unmapped == ["public"]  # rule target, no mapping


def test_blank_archetype_id_is_not_applied():
    sub = _sub(cohort_mappings={"home": SubsystemCohortMapping(archetype_id="")})
    mapping, _ = build_subsystem_cohort_mapping(sub)
    assert mapping == {}


def test_no_mappings_falls_back_to_identity():
    """Backward compat: no user mappings → identity (each rule target maps to a
    BOM archetype of the same id)."""
    sub = _sub(rules=[DependencyRule(id="r1", dependent_archetype_id="home", expression="1")])
    mapping, unmapped = build_subsystem_cohort_mapping(sub)
    assert mapping == {"home": ("home", 1.0)}
    assert unmapped == []
