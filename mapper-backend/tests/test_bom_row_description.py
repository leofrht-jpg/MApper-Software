# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""`BOMNode.description` — free-text provenance that survives a re-import.

A modelling assumption is worth recording only if it travels with the row it
justifies. Two live examples: MAp-test's Hydrogen Station assumes its 8 kg of
R134a is recovered rather than vented (EU F-gas Regulation), and its 400 kg
carbon fibre wrap is sent to inert waste because ecoinvent 3.10 has exactly
one CFRP activity -- the production market -- and no waste route at all.
Neither assumption is visible in a number; both change one materially.

So the field round-trips through the workbook's `Description` column. A note
that dies on the next export/re-import is worse than no note, because it reads
as documented when it is not -- and re-import is the routine path for this
project.

Nothing computes from it. That is asserted, not assumed.
"""
from __future__ import annotations

from mapper.api.bom import _BOM_COLUMNS, _walk_for_export
from mapper.core.bom_engine import flatten_roots
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

NOTE = "Recovered per EU F-gas Regulation; real-world recovery 50-90%."


def _mat(name: str, qty: float, description: str | None = None) -> BOMNode:
    return BOMNode(
        id=f"n-{name}", name=name, node_type="material", quantity=qty, unit="kg",
        ecoinvent_activity=EcoinventLink(
            database="ecoinvent-3.10-cutoff", code="a" * 32, name=name, unit="kg"),
        description=description,
    )


def _arc(*mats: BOMNode) -> Archetype:
    return Archetype(id="a", name="A", bom=[BOMNode(
        id="s", name="End of Life", node_type="component", scope="outflows",
        children=list(mats))])


def test_the_workbook_has_a_description_column():
    assert "Description" in _BOM_COLUMNS


def test_a_description_is_written_to_the_export_row():
    rows: list = []
    _walk_for_export(_arc(_mat("Refrigerant", 8.0, NOTE)).bom[0], "End of Life", "", rows, {}, {})
    idx = _BOM_COLUMNS.index("Description")
    written = [r[idx] for r in rows if r[_BOM_COLUMNS.index("Name")] == "Refrigerant"]
    assert written == [NOTE]


def test_a_row_without_one_exports_a_blank_not_the_string_None():
    """`None` would import back as the literal text 'None'."""
    rows: list = []
    _walk_for_export(_arc(_mat("Steel", 1.0)).bom[0], "End of Life", "", rows, {}, {})
    idx = _BOM_COLUMNS.index("Description")
    assert all(r[idx] == "" for r in rows)


def test_it_defaults_to_None_so_legacy_BOMs_deserialise():
    """Every persisted archetype predates the field."""
    n = BOMNode(name="x", node_type="material", quantity=1.0)
    assert n.description is None
    # and a stored dict with no such key round-trips
    assert BOMNode(**{"name": "x", "node_type": "material"}).description is None


def test_nothing_computes_from_it():
    """Mutating every description must not move a single quantity.

    The field is provenance. If it ever reaches the engine, this fails.
    """
    plain = _arc(_mat("Steel", 2.0), _mat("Copper", 3.0))
    noted = _arc(_mat("Steel", 2.0, "a note"), _mat("Copper", 3.0, "another note"))
    a = [(m.name, m.quantity) for m in flatten_roots(plain.bom)]
    b = [(m.name, m.quantity) for m in flatten_roots(noted.bom)]
    assert a == b


def test_the_update_schema_can_clear_it():
    """"unset" clears; None means leave alone -- the `basis`/`uncertainty`
    PATCH convention, so a caller that omits the field never wipes a note."""
    from mapper.models.bom_schemas import BOMNodeUpdate
    assert BOMNodeUpdate().description is None
    assert BOMNodeUpdate(description="unset").description == "unset"
    assert BOMNodeUpdate(description=NOTE).description == NOTE
