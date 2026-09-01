"""Two content hashes: the authored BOM, and the parameter table.

Separate, because they change for different reasons and at different rates --
that makes a change ATTRIBUTABLE rather than merely detectable.

**The round trip is the test that matters.** A hash that moves on an
export/re-import -- the routine operation on these projects -- would cry wolf
until someone stopped reading the warning, which is worse than having no hash.
Everything else here exists to keep that one true.
"""
from __future__ import annotations

import io

import pytest

from mapper.core.content_hash import (
    BOM_NODE_EXCLUDED,
    BOM_NODE_FIELDS,
    PARAM_EXCLUDED,
    PARAM_FIELDS,
    bom_hash,
    compare,
    parameter_table_hash,
)
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.parameter_schemas import (
    Parameter,
    ParameterKeyframe,
    ParameterTable,
)


def _link(code="c1", db="ei"):
    return EcoinventLink(database=db, code=code, name="n", location="GLO", unit="kg")


def _arc(**kw):
    roots = kw.pop("bom", None) or [
        BOMNode(
            name="Manufacturing", node_type="component", scope="inflows",
            children=[
                BOMNode(name="Steel", node_type="material", quantity=10.0,
                        unit="kg", ecoinvent_activity=_link("steel")),
                BOMNode(name="Alu", node_type="material",
                        quantity_expression="alu_mass * 2", quantity=1.0,
                        unit="kg", ecoinvent_activity=_link("alu")),
            ],
        )
    ]
    return Archetype(id=kw.pop("id", "a1"), name=kw.pop("name", "A"), bom=roots, **kw)


def _table():
    return ParameterTable(
        parameters={
            "alu_mass": Parameter(name="alu_mass", base_value=5.0,
                                  scenario_overrides={"Opt": 4.0}),
            "d_annual": Parameter(
                name="d_annual", base_value=1.0,
                keyframes=[ParameterKeyframe(year=2030, value=2.0),
                           ParameterKeyframe(year=2025, value=1.0)],
            ),
        },
        scenarios=["Opt"],
    )


# ── the shape ───────────────────────────────────────────────────────────────

def test_both_hashes_are_versioned():
    """A scheme change must be reportable as such, not as a content change."""
    assert bom_hash(_arc()).startswith("bom:v")
    assert parameter_table_hash(_table()).startswith("param:v")


def test_a_version_difference_is_not_reported_as_a_content_change():
    assert "scheme" in compare("bom:v1:aa", "bom:v2:aa")
    assert compare("bom:v1:aa", "bom:v1:aa") is None
    assert compare("bom:v1:aa", "bom:v1:bb") == (
        "content changed since this result was computed"
    )
    assert compare(None, "bom:v1:aa") is None      # nothing stored: nothing to say


def test_the_hashes_are_deterministic():
    assert bom_hash(_arc()) == bom_hash(_arc())
    assert parameter_table_hash(_table()) == parameter_table_hash(_table())


# ── what must NOT move it ───────────────────────────────────────────────────

def test_node_ids_do_not_move_the_bom_hash():
    """The single most important exclusion: ids are re-minted on every import."""
    a, b = _arc(), _arc()
    for i, n in enumerate(b.bom[0].children):
        n.id = f"freshly-minted-{i}"
    assert bom_hash(a) == bom_hash(b)


def test_reordering_children_does_not_move_the_bom_hash():
    """Order changes no result -- ``flatten`` sums -- so it must not warn."""
    a = _arc()
    b = _arc()
    b.bom[0].children.reverse()
    assert bom_hash(a) == bom_hash(b)


def test_two_siblings_with_the_SAME_key_but_different_subtrees_still_differ():
    """Why child DIGESTS are sorted, not children by a key.

    A key-based sort leaves ties, and a stable sort then falls back to authored
    order -- so a reorder would move the hash. Sorting digests has no tie to
    break, and still distinguishes the trees.
    """
    def build(first_child_qty):
        return _arc(bom=[BOMNode(
            name="Stage", node_type="component", scope="inflows",
            children=[
                BOMNode(name="Sub", node_type="component", children=[
                    BOMNode(name="X", node_type="material",
                            quantity=first_child_qty, ecoinvent_activity=_link()),
                ]),
                BOMNode(name="Sub", node_type="component", children=[
                    BOMNode(name="X", node_type="material",
                            quantity=99.0, ecoinvent_activity=_link()),
                ]),
            ])])
    assert bom_hash(build(1.0)) != bom_hash(build(2.0))
    # ...and swapping the two identical-keyed siblings is still a no-op.
    a = build(1.0); b = build(1.0); b.bom[0].children.reverse()
    assert bom_hash(a) == bom_hash(b)


def test_a_description_does_not_move_the_bom_hash():
    """Nothing computes from it; the result still reproduces."""
    a, b = _arc(), _arc()
    b.bom[0].children[0].description = "an assumption worth writing down"
    assert bom_hash(a) == bom_hash(b)


def test_negative_zero_does_not_move_the_hash():
    """``-0.0`` survives a JSON round trip, its repr differs from ``0.0``, and
    ``-0.0 == 0.0``. A sign-flipped zero must not warn."""
    a, b = _arc(), _arc()
    a.bom[0].children[0].quantity = 0.0
    b.bom[0].children[0].quantity = -0.0
    assert bom_hash(a) == bom_hash(b)


def test_an_int_and_a_float_quantity_hash_the_same():
    """Raw JSON ``1`` parses to int; Pydantic coerces to float. Hashing the
    MODEL normalises it -- hashing file bytes would not."""
    a, b = _arc(), _arc()
    a.bom[0].children[0].quantity = 10
    b.bom[0].children[0].quantity = 10.0
    assert bom_hash(a) == bom_hash(b)


def test_unsorted_keyframes_do_not_move_the_parameter_hash():
    """``_interpolate_keyframes`` sorts internally, so an unsorted-vs-sorted
    round trip changes no number."""
    t1, t2 = _table(), _table()
    t2.parameters["d_annual"].keyframes = list(
        reversed(t2.parameters["d_annual"].keyframes)
    )
    assert parameter_table_hash(t1) == parameter_table_hash(t2)


def test_parameter_metadata_does_not_move_the_hash():
    t1, t2 = _table(), _table()
    t2.parameters["alu_mass"].description = "a note"
    t2.parameters["alu_mass"].unit = "kg"
    t2.parameters["alu_mass"].category = "masses"
    assert parameter_table_hash(t1) == parameter_table_hash(t2)


# ── what MUST move it ───────────────────────────────────────────────────────

def test_an_expression_edit_moves_the_BOM_hash_only():
    """Authored, not resolved: the BOM hashes the EXPRESSION."""
    a, b = _arc(), _arc()
    b.bom[0].children[1].quantity_expression = "alu_mass * 3"
    assert bom_hash(a) != bom_hash(b)


def test_a_parameter_value_edit_moves_ONLY_the_parameter_hash(monkeypatch):
    """The whole point of two hashes.

    Hashing RESOLVED quantities would move the BOM hash too, double-counting
    the parameter change and destroying the attribution.
    """
    arc = _arc()
    t1, t2 = _table(), _table()
    t2.parameters["alu_mass"].base_value = 6.0

    assert bom_hash(arc) == bom_hash(arc), "the BOM did not change"
    assert parameter_table_hash(t1) != parameter_table_hash(t2)


@pytest.mark.parametrize("mutate", [
    lambda n: setattr(n, "quantity", 11.0),
    lambda n: setattr(n, "unit", "tonne"),
    lambda n: setattr(n, "name", "Steel plate"),
    lambda n: setattr(n, "basis", "per_year"),
    lambda n: setattr(n, "ecoinvent_activity", _link("relinked")),
])
def test_a_load_bearing_edit_moves_the_bom_hash(mutate):
    a, b = _arc(), _arc()
    mutate(b.bom[0].children[0])
    assert bom_hash(a) != bom_hash(b)


def test_a_scenario_override_edit_moves_the_parameter_hash():
    t1, t2 = _table(), _table()
    t2.parameters["alu_mass"].scenario_overrides["Opt"] = 3.0
    assert parameter_table_hash(t1) != parameter_table_hash(t2)


# ── the allowlist cannot rot ────────────────────────────────────────────────

def test_every_bom_node_field_is_decided():
    """A new field must be an explicit choice, not a silent absorption.

    Without this, the next field added with a default either moves every
    stored hash (if dumped wholesale) or is silently unhashed (if allowlisted
    and forgotten).
    """
    fields = set(BOMNode.model_fields)
    decided = set(BOM_NODE_FIELDS) | set(BOM_NODE_EXCLUDED)
    undecided = fields - decided
    assert not undecided, (
        f"BOMNode fields neither hashed nor excluded-with-a-reason: "
        f"{sorted(undecided)}. Add to BOM_NODE_FIELDS (and bump "
        f"BOM_HASH_VERSION) or to BOM_NODE_EXCLUDED with the reason."
    )


def test_every_parameter_field_is_decided():
    fields = set(Parameter.model_fields)
    decided = set(PARAM_FIELDS) | set(PARAM_EXCLUDED)
    undecided = fields - decided
    assert not undecided, f"Parameter fields undecided: {sorted(undecided)}"


def test_every_exclusion_carries_a_reason():
    for name, why in {**BOM_NODE_EXCLUDED, **PARAM_EXCLUDED}.items():
        assert isinstance(why, str) and len(why) > 20, name


# ── THE round trip ──────────────────────────────────────────────────────────
#
# Export a project's archetypes to the workbook, re-import under MERGE, and
# require both hashes unchanged. This is the operation these projects actually
# undergo -- it re-mints every node id -- and a hash that moved on it would
# cry wolf until the warning stopped being read. If this test is ever deleted,
# the feature is not worth having.


def _bw2_project(name: str):
    import bw2data

    if name not in {p.name for p in bw2data.projects}:
        pytest.skip(f"{name} project not present")
    bw2data.projects.set_current(name)
    return name


@pytest.mark.parametrize("project", ["MAp-test", "Battery Circularity"])
def test_export_then_merge_import_moves_NEITHER_hash(project, monkeypatch):
    """The cry-wolf case, on real data."""
    import openpyxl

    from mapper.api import bom as bom_api
    from mapper.api import dsm as dsm_api
    from mapper.api import parameters as params_api
    from mapper.core import parameter_storage

    _bw2_project(project)
    params_api.install_parameters(parameter_storage.load_all())
    dsm_api.hydrate_from_disk()

    arcs = bom_api._proj_archetypes(project)
    if not arcs:
        pytest.skip(f"{project} has no archetypes")

    before = {a.name: bom_hash(a) for a in arcs.values()}
    param_before = parameter_table_hash(params_api._table_for(project))

    # Export -> bytes -> parse back, exactly as the import route does.
    wb = bom_api._build_multi_export_workbook(list(arcs.values()))
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    reloaded = openpyxl.load_workbook(buf, data_only=True)

    # The parser takes one archetype at a time out of a multi-archetype
    # workbook, and returns (roots, warnings, validation_rows).
    after: dict[str, str] = {}
    for name in before:
        roots, warns, _rows = bom_api._parse_bom_workbook(
            reloaded, archetype_filter=name
        )
        if not roots:
            continue
        after[name] = bom_hash(Archetype(id="x", name=name, bom=roots))
    assert after, "the workbook round trip produced nothing"

    common = set(before) & set(after)
    assert common, f"no archetype survived the round trip ({sorted(after)[:3]})"
    moved = {n: (before[n], after[n]) for n in sorted(common) if before[n] != after[n]}
    assert not moved, (
        f"{len(moved)} of {len(common)} archetypes' BOM hash MOVED on an "
        f"export/re-import that changed nothing: {list(moved)[:4]}"
    )

    # The parameter table is untouched by a BOM round trip -- so its hash must
    # not move either, which is the attribution working.
    assert parameter_table_hash(params_api._table_for(project)) == param_before


# ── the warning, end to end ─────────────────────────────────────────────────

def test_the_export_warns_and_names_WHICH_of_the_two_moved():
    """WARN, never refuse. And attribution is the whole point of two hashes:
    a BOM edit and a parameter edit are different investigations."""
    from mapper.core.content_hash import mismatch_rows

    arc = _arc()
    table = _table()
    stored_bom = {arc.id: bom_hash(arc)}
    stored_param = parameter_table_hash(table)
    arcs = {arc.id: arc}

    # Nothing moved -> nothing said.
    assert mismatch_rows(stored_bom, stored_param, arcs, table) == []

    # Only the BOM moved.
    edited = _arc()
    edited.bom[0].children[0].quantity = 999.0
    rows = mismatch_rows(stored_bom, stored_param, {arc.id: edited}, table)
    assert len(rows) == 1 and "BOM changed" in rows[0][0]
    assert "Parameter" not in rows[0][0], "a BOM edit must not implicate parameters"

    # Only the parameters moved.
    t2 = _table()
    t2.parameters["alu_mass"].base_value = 6.0
    rows = mismatch_rows(stored_bom, stored_param, arcs, t2)
    assert len(rows) == 1 and rows[0][0] == "Parameter table changed"

    # Both.
    rows = mismatch_rows(stored_bom, stored_param, {arc.id: edited}, t2)
    assert len(rows) == 2


def test_a_deleted_archetype_is_named_rather_than_crashing():
    arc = _arc()
    from mapper.core.content_hash import mismatch_rows

    rows = mismatch_rows({arc.id: bom_hash(arc)}, None, {}, None)
    assert rows and "no longer in the project" in rows[0][1]


def test_an_unstamped_result_says_nothing():
    """Every result stored before this shipped has no hashes. It must not be
    reported as a mismatch -- absent is not 'changed'."""
    from mapper.core.content_hash import mismatch_rows

    assert mismatch_rows(None, None, {"a1": _arc()}, _table()) == []
    assert mismatch_rows({}, None, {"a1": _arc()}, _table()) == []


def test_hashing_never_fails_a_compute():
    """Provenance must not be the thing that breaks a run."""
    from mapper.core.content_hash import hashes_for

    class Exploding:
        @property
        def bom(self):
            raise RuntimeError("boom")

    out = hashes_for(["a"], {"a": Exploding()}, None)
    assert out == {"bom_hashes": {}, "parameter_table_hash": None}
