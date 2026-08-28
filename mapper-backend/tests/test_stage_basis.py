# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Stage basis: declared, never derived.

``scope`` is WHEN THE FLEET COUNTS IT. ``basis`` is WHAT ONE ROW'S QUANTITY
MEANS. They are independent, and conflating them is the defect this file
guards: every Battery Circularity Use Phase carries ``scope="stock"`` while its
quantities are per kWh of service, so a scope-derived basis multiplies it by
the lifetime and leaves manufacturing at 1 -- an incoherent functional unit.

Every existing archetype migrates to UNDECLARED, which computes at x1. That is
the one multiplier both conventions already agree on, which is what makes it
safe for WP5 and Battery Circularity alike; any basis *guess* is right for one
and wrong for the other.
"""
from __future__ import annotations

from mapper.core.bom_engine import summarize_archetype
from mapper.models.bom_schemas import Archetype, BOMNode


def _arc(**basis) -> Archetype:
    return Archetype(
        id="arc-1", name="A",
        bom=[
            BOMNode(id="s-mfg", name="Manufacturing", node_type="component",
                    scope="inflows", is_annual=False, basis=basis.get("Manufacturing")),
            # scope=stock -> is_annual True. Basis is independent of that.
            BOMNode(id="s-use", name="Use Phase", node_type="component",
                    scope="stock", is_annual=True, basis=basis.get("Use Phase")),
        ],
    )


def test_an_existing_archetype_migrates_to_undeclared():
    """No `basis` in persisted JSON -> None. Nothing is inferred from scope."""
    arc = Archetype(id="a", name="A", bom=[
        BOMNode(id="s", name="Use Phase", node_type="component",
                scope="stock", is_annual=True),
    ])
    assert arc.bom[0].basis is None
    assert arc.bom[0].is_annual is True   # the suggestion survives, inert


def test_summary_exposes_declaration_suggestion_and_ids_separately():
    s = summarize_archetype(_arc(**{"Manufacturing": "per_unit", "Use Phase": "per_year"}))
    assert s["stage_basis"] == {"Manufacturing": "per_unit", "Use Phase": "per_year"}
    # The scope-derived hint is still published, but as a separate field so it
    # cannot be mistaken for the declaration.
    assert s["stage_annual"] == {"Manufacturing": False, "Use Phase": True}
    # Node ids so the UI can declare a basis without re-importing.
    assert s["stage_ids"] == {"Manufacturing": "s-mfg", "Use Phase": "s-use"}


def test_undeclared_is_distinguishable_from_per_unit():
    """The reason `basis` is three-state rather than a bool: absence must not
    read as a decision. A boolean's False is exactly how the silent
    scope-derived guess took hold."""
    s = summarize_archetype(_arc())
    assert s["stage_basis"] == {"Manufacturing": None, "Use Phase": None}


def test_basis_is_independent_of_scope():
    """A stock-scoped stage may legitimately be per_unit.

    Battery Circularity's Use Phase is exactly this: counted per simulation
    year by the fleet, but its quantity is already per kWh of service.
    """
    s = summarize_archetype(_arc(**{"Use Phase": "per_unit"}))
    assert s["stage_basis"]["Use Phase"] == "per_unit"
    assert s["stage_annual"]["Use Phase"] is True


def test_basis_round_trips_through_the_bom_workbook():
    """The Basis column is a second route, for people who do work in Excel."""
    from mapper.api.bom import _BOM_COLUMNS, _walk_for_export

    assert "Basis" in _BOM_COLUMNS
    rows: list[list] = []
    root = BOMNode(id="s", name="Use Phase", node_type="component",
                   scope="stock", is_annual=True, basis="per_year",
                   children=[BOMNode(id="m", name="Fuel", node_type="material",
                                     quantity=1.0, unit="kg")])
    _walk_for_export(root, root.name, "", rows, stage_scope="stock", stage_basis="per_year")
    header = {c: i for i, c in enumerate(_BOM_COLUMNS)}
    # Emitted on the stage root row, blank on children -- same rule as Scope.
    assert rows[0][header["Basis"]] == "per year"
    assert rows[1][header["Basis"]] == ""


def test_the_update_route_accepts_a_basis_and_can_clear_it():
    from mapper.models.bom_schemas import BOMNodeUpdate

    assert BOMNodeUpdate(basis="per_year").basis == "per_year"
    assert BOMNodeUpdate(basis="unset").basis == "unset"
    # PATCH semantics: absent means leave alone, which is why "unset" is a
    # distinct value rather than None.
    assert BOMNodeUpdate().basis is None
