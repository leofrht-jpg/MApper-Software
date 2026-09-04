# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Archetype composition: an archetype references another as a BOM input.

Spliced stage-by-stage MATCHED ON SCOPE. A child spanning several stages
(Battery Pack carries Manufacturing AND End of Life) must contribute to each of
the parent's corresponding stages, not collapse into whichever stage the
reference sat in.

Splicing is EAGER -- at resolution time, upstream of `_flat_cache`,
`_flat_cache_year` and `_resolved_arc_cache` -- so the child is baked into the
parent's tree before any cache key is computed and no cache learns about refs.
"""
from __future__ import annotations

import pytest

from mapper.core.bom_engine import (
    ArchetypeCompositionError,
    flatten_root_with_amounts,
    flatten_roots,
    splice_includes,
)
from mapper.models.bom_schemas import (
    INCLUDE_KEY_SEP,
    MAX_INCLUDE_DEPTH,
    Archetype,
    ArchetypeInclude,
    BOMNode,
    EcoinventLink,
)


def _mat(name: str, code: str, qty: float) -> BOMNode:
    return BOMNode(
        id=f"n-{code}", name=name, node_type="material", quantity=qty, unit="kg",
        ecoinvent_activity=EcoinventLink(
            database="ecoinvent-3.10-cutoff", code=code, name=name, unit="kg"),
    )


def _stage(name, scope, children, basis=None, nid=None) -> BOMNode:
    return BOMNode(id=nid or f"s-{name}", name=name, node_type="component",
                   scope=scope, basis=basis, children=children)


def _reg(*arcs) -> dict[str, Archetype]:
    return {a.id: a for a in arcs}


# ── Three-level chain ────────────────────────────────────────────────────────

def test_a_three_level_chain_resolves_and_scales():
    """parent -> Battery Pack -> Cell, with quantities multiplying through."""
    cell = Archetype(id="cell", name="Cell", bom=[
        _stage("Manufacturing", "inflows", [_mat("Cathode", "c" * 32, 10.0)])])
    pack = Archetype(id="pack", name="Battery Pack",
                     bom=[_stage("Manufacturing", "inflows", [_mat("Casing", "k" * 32, 5.0)])],
                     includes=[ArchetypeInclude(archetype_id="cell", quantity=3.0)])
    ev = Archetype(id="ev", name="EV",
                   bom=[_stage("Manufacturing", "inflows", [_mat("Glider", "g" * 32, 900.0)])],
                   includes=[ArchetypeInclude(archetype_id="pack", quantity=2.0)])

    out = splice_includes(ev, _reg(cell, pack, ev))
    q = {m.name: m.quantity for m in flatten_roots(out.bom)}

    assert q["Glider"] == 900.0            # parent untouched
    assert q["Casing"] == 5.0 * 2          # pack x2
    assert q["Cathode"] == 10.0 * 3 * 2    # cell x3 inside pack x2
    assert out.includes == []              # consumed by the splice


def test_quantity_scaling_comes_from_the_existing_cascade():
    child = Archetype(id="c", name="C", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel", "a" * 32, 100.0)])])
    for qty, expected in ((1.0, 100.0), (2.0, 200.0), (0.5, 50.0)):
        parent = Archetype(id="p", name="P", bom=[
            _stage("Manufacturing", "inflows", [])],
            includes=[ArchetypeInclude(archetype_id="c", quantity=qty)])
        out = splice_includes(parent, _reg(child, parent))
        assert flatten_roots(out.bom)[0].quantity == expected


# ── Stage alignment by scope ─────────────────────────────────────────────────

def test_child_stages_land_in_the_parent_stage_of_the_SAME_scope():
    """The Battery Pack case: Manufacturing -> Manufacturing, EoL -> EoL."""
    pack = Archetype(id="pack", name="Battery Pack", bom=[
        _stage("Manufacturing", "inflows", [_mat("Cells", "a" * 32, 300.0)]),
        _stage("End of Life", "outflows", [_mat("Transport", "b" * 32, 30.0)]),
    ])
    ev = Archetype(id="ev", name="EV", bom=[
        _stage("Manufacturing", "inflows", [_mat("Glider", "g" * 32, 900.0)]),
        _stage("Use Phase", "stock", [_mat("Electricity", "e" * 32, 2000.0)]),
        _stage("End of Life", "outflows", [_mat("Dismantling", "d" * 32, 1.0)]),
    ], includes=[ArchetypeInclude(archetype_id="pack")])

    out = splice_includes(ev, _reg(pack, ev))
    where = {}
    for root in out.bom:
        for m in flatten_root_with_amounts(root, {}, None):
            where[m[0].name] = root.name

    assert where["Cells"] == "Manufacturing", "child manufacturing mis-staged"
    assert where["Transport"] == "End of Life", "child end-of-life mis-staged"
    assert where["Electricity"] == "Use Phase"
    # and nothing collapsed into a single stage
    assert where["Cells"] != where["Transport"]


def test_a_scope_absent_from_the_parent_gets_its_own_stage():
    """Rather than dropping the rows into an unrelated stage."""
    child = Archetype(id="c", name="C", bom=[
        _stage("End of Life", "outflows", [_mat("Shredding", "s" * 32, 1.0)])])
    parent = Archetype(id="p", name="P", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel", "a" * 32, 1.0)])],
        includes=[ArchetypeInclude(archetype_id="c")])
    out = splice_includes(parent, _reg(child, parent))
    scopes = {r.scope for r in out.bom}
    assert scopes == {"inflows", "outflows"}


# ── Cycles and depth ─────────────────────────────────────────────────────────

def test_a_cycle_is_caught_at_flatten_time_and_named():
    a = Archetype(id="A", name="A", bom=[], includes=[ArchetypeInclude(archetype_id="B")])
    b = Archetype(id="B", name="B", bom=[], includes=[ArchetypeInclude(archetype_id="A")])
    with pytest.raises(ArchetypeCompositionError) as e:
        splice_includes(a, _reg(a, b))
    msg = str(e.value)
    assert "cycle" in msg.lower()
    assert "A" in msg and "B" in msg, f"cycle not named: {msg}"


def test_a_self_reference_is_a_cycle():
    a = Archetype(id="A", name="A", bom=[], includes=[ArchetypeInclude(archetype_id="A")])
    with pytest.raises(ArchetypeCompositionError, match="cycle"):
        splice_includes(a, _reg(a))


def test_depth_five_fails_with_the_constant_in_the_message():
    arcs = []
    for i in range(6):
        arcs.append(Archetype(
            id=f"a{i}", name=f"a{i}",
            bom=[_stage("Manufacturing", "inflows", [_mat("m", "a" * 32, 1.0)])],
            includes=[ArchetypeInclude(archetype_id=f"a{i+1}")] if i < 5 else [],
        ))
    with pytest.raises(ArchetypeCompositionError) as e:
        splice_includes(arcs[0], _reg(*arcs))
    assert f"MAX_INCLUDE_DEPTH={MAX_INCLUDE_DEPTH}" in str(e.value)


def test_a_chain_at_the_limit_still_resolves():
    arcs = []
    for i in range(MAX_INCLUDE_DEPTH):
        arcs.append(Archetype(
            id=f"a{i}", name=f"a{i}",
            bom=[_stage("Manufacturing", "inflows", [_mat(f"m{i}", "a" * 32, 1.0)])],
            includes=[ArchetypeInclude(archetype_id=f"a{i+1}")] if i < MAX_INCLUDE_DEPTH - 1 else [],
        ))
    out = splice_includes(arcs[0], _reg(*arcs))
    assert len(flatten_roots(out.bom)) == MAX_INCLUDE_DEPTH


# ── Dangling references ──────────────────────────────────────────────────────

def test_a_dangling_reference_raises_rather_than_silently_dropping():
    parent = Archetype(id="p", name="P", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel", "a" * 32, 1.0)])],
        includes=[ArchetypeInclude(archetype_id="gone")])
    with pytest.raises(ArchetypeCompositionError) as e:
        splice_includes(parent, _reg(parent))
    assert "does not exist" in str(e.value)


def test_the_dsm_engine_raises_on_a_dangling_cohort_mapping():
    """The same condition the API raises 404 for. It used to ``continue``.

    Behavioural, not a source scan: drive the pipeline with a mapping pointing
    at an archetype that is not in the registry and require it to surface.
    """
    from mapper.core.dsm_lca_engine import DanglingArchetypeError, DSMLCAPipeline
    from mapper.models.dsm_schemas import (
        SimulationResult, SimulationSummary, YearResult,
    )

    arc = Archetype(id="present", name="Present", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel", "a" * 32, 1.0)])])
    sim = SimulationResult(
        system_id="s",
        years=[YearResult(year=2025, stock={"c1": 1.0}, stock_by_age={"c1": {1: 1.0}},
                          inflow={}, outflow={}, outflow_by_age={})],
        summary=SimulationSummary(total_stock_start=1.0, total_stock_end=1.0,
                                  total_inflows=0.0, total_outflows=0.0),
    )
    pipe = DSMLCAPipeline(
        simulation_result=sim,
        archetypes={arc.id: arc},
        cohort_mappings={"c1": ("vanished-id", 1.0)},   # dangling
        methods=[("m", "x", "y")],
        lca_runner=lambda demand, methods: {tuple(m): (0.0, "kg") for m in methods},
    )
    with pytest.raises(DanglingArchetypeError) as e:
        pipe.calculate("stock")
    assert "vanished-id" in str(e.value)
    assert "c1" in str(e.value)


# ── Basis on spliced stages ──────────────────────────────────────────────────

def test_a_per_year_child_keeps_its_basis_under_a_per_unit_parent_stage():
    """The child's basis must survive becoming a non-root node."""
    child = Archetype(id="c", name="C", bom=[
        _stage("Use Phase", "stock", [_mat("Fuel", "f" * 32, 100.0)], basis="per_year")])
    parent = Archetype(id="p", name="P", bom=[
        _stage("Use Phase", "stock", [_mat("Wear", "w" * 32, 10.0)], basis="per_unit")],
        includes=[ArchetypeInclude(archetype_id="c")])

    out = splice_includes(parent, _reg(child, parent))
    amounts = {m.name: a for m, a in flatten_root_with_amounts(
        out.bom[0], {"Use Phase": 1.0}, {"per_unit": 1.0, "per_year": 15.0})}

    assert amounts["Wear"] == 1.0, "parent per_unit stage should not scale"
    assert amounts["Fuel"] == 15.0, "child per_year stage lost its basis"


def test_without_basis_amounts_every_material_takes_the_root_amount():
    """Backward compat: absent basis_amounts is the pre-composition behaviour."""
    child = Archetype(id="c", name="C", bom=[
        _stage("Use Phase", "stock", [_mat("Fuel", "f" * 32, 1.0)], basis="per_year")])
    parent = Archetype(id="p", name="P", bom=[
        _stage("Use Phase", "stock", [_mat("Wear", "w" * 32, 1.0)], basis="per_unit")],
        includes=[ArchetypeInclude(archetype_id="c")])
    out = splice_includes(parent, _reg(child, parent))
    amounts = {m.name: a for m, a in flatten_root_with_amounts(
        out.bom[0], {"Use Phase": 7.0}, None)}
    assert set(amounts.values()) == {7.0}


# ── Contribution keys ────────────────────────────────────────────────────────

def test_same_named_materials_in_parent_and_child_stay_distinct():
    """DSM aggregation keys by material NAME, so the paths must differ.

    Uses the subsystem separator rather than a second scheme, so a reader can
    recover the source with ``key.split(INCLUDE_KEY_SEP)``.
    """
    child = Archetype(id="c", name="Battery Pack", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel frame", "a" * 32, 50.0)])])
    parent = Archetype(id="p", name="EV", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel frame", "a" * 32, 720.0)])],
        includes=[ArchetypeInclude(archetype_id="c")])

    out = splice_includes(parent, _reg(child, parent))
    flat = flatten_roots(out.bom)
    assert len(flat) == 2
    paths = {" / ".join(m.path) for m in flat}
    assert len(paths) == 2, f"parent and child rows collapsed: {paths}"
    assert any(f"Battery Pack{INCLUDE_KEY_SEP}Manufacturing" in p for p in paths)
    # and the source is recoverable
    spliced = [p for p in paths if INCLUDE_KEY_SEP in p][0]
    seg = [s for s in spliced.split(" / ") if INCLUDE_KEY_SEP in s][0]
    assert seg.split(INCLUDE_KEY_SEP)[0] == "Battery Pack"


# ── Save-time detection (not redundant with flatten-time) ───────────────────

def test_a_cycle_is_caught_at_SAVE_time_and_named(monkeypatch):
    """Save time is the only layer that can name the cycle while the user is
    still looking at it. Flatten time stays because archetype JSON is edited on
    disk, arrives by project import, and round-trips through Excel -- none of
    which passes through a save route."""
    from fastapi import HTTPException

    from mapper.api import bom as bom_mod

    a = Archetype(id="A", name="A", bom=[], includes=[ArchetypeInclude(archetype_id="B")])
    b = Archetype(id="B", name="B", bom=[], includes=[ArchetypeInclude(archetype_id="A")])
    monkeypatch.setattr(bom_mod, "_proj_archetypes", lambda *a_, **k: {"A": a, "B": b})

    with pytest.raises(HTTPException) as e:
        bom_mod._assert_includes_resolvable(a)
    assert e.value.status_code == 400
    assert "cycle" in str(e.value.detail).lower()
    assert "A" in str(e.value.detail) and "B" in str(e.value.detail)


def test_save_time_also_rejects_a_dangling_reference(monkeypatch):
    from fastapi import HTTPException

    from mapper.api import bom as bom_mod

    a = Archetype(id="A", name="A", bom=[], includes=[ArchetypeInclude(archetype_id="nope")])
    monkeypatch.setattr(bom_mod, "_proj_archetypes", lambda *a_, **k: {"A": a})
    with pytest.raises(HTTPException) as e:
        bom_mod._assert_includes_resolvable(a)
    assert e.value.status_code == 400


# ── Excel round trip ────────────────────────────────────────────────────────

def test_the_workbook_export_REJECTS_a_composed_archetype():
    """The BOM sheet has no reference row.

    Exporting anyway would write the child's spliced rows and re-import a
    flattened copy that no longer tracks the child -- silent loss of the
    composition in a file the user believes round-trips. So it fails loudly.
    """
    from fastapi import HTTPException

    from mapper.api.bom import _build_export_workbook, _build_multi_export_workbook

    arc = Archetype(id="p", name="P", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel", "a" * 32, 1.0)])],
        includes=[ArchetypeInclude(archetype_id="c")])

    for builder, arg in ((_build_export_workbook, arc), (_build_multi_export_workbook, [arc])):
        with pytest.raises(HTTPException) as e:
            builder(arg)
        assert e.value.status_code == 400
        assert "reference" in str(e.value.detail).lower()

    # An archetype WITHOUT references still exports normally.
    plain = Archetype(id="q", name="Q", bom=[
        _stage("Manufacturing", "inflows", [_mat("Steel", "a" * 32, 1.0)])])
    assert _build_export_workbook(plain) is not None
    assert _build_multi_export_workbook([plain]) is not None


# ── Acceptance: reproduce a real hand-duplicated archetype ──────────────────

@pytest.mark.parametrize("DIV", [1.0, 3.0, 89514.00808104257, 88358.09587762543, 1e-4])
def test_a_composed_twin_reproduces_the_copy_paste_original_exactly(DIV):
    """The acceptance shape, run against synthetic stand-ins for the real case.

    Battery Circularity hand-duplicates `Battery Pack` inside
    `B0 - Reference BESS`: B0's rows are the standalone archetype's expressions
    DIVIDED by the FU normaliser. Rebuilt as a reference carrying that divisor
    as its include quantity, the composed twin reproduces the original exactly
    -- verified against the live project at rel-diff 0.000e+00 on GWP100 and
    acidification. Reproduced here without bw2 so it runs in CI.

    Note what this exercises: the child spans Manufacturing AND End of Life,
    and each lands in the parent's stage of the same scope.

    `DIV` IS PARAMETRIZED BECAUSE ITS VALUE IS NOT WHAT THIS TEST CHECKS, and
    an earlier revision hid that. It was a lone
    ``DIV = 89514.00808104257  # b0_cumulative_ac_energy_delivered_kwh``, which
    reads like a pinned project value but appears on BOTH sides of the equality
    -- so it cancels, and substituting 12345.6789 left all 20 tests green. A
    constant that verifies nothing is worse than no constant: an audit read it
    against a doc that named the OTHER normaliser and reported a discrepancy in
    project data that did not exist (see *Two AC-energy normalisers* in
    CLAUDE.md -- B0 and B legitimately differ).

    What IS load-bearing here is that the include quantity is APPLIED and
    applied UNIFORMLY: were `splice_includes` to ignore it, the spliced rows
    would come back at PACK/EOL against the original's PACK/DIV and EOL/DIV and
    every case but DIV=1.0 would fail. The list spans five orders of magnitude
    for that reason, and includes both real Battery Circularity normalisers as
    data points -- neither is pinned, and **the live values are project data
    that must not be duplicated into this repo as an expectation.**
    """
    PACK, EOL = 428.57142857, 85.714285714

    pack = Archetype(id="pack", name="Battery Pack", bom=[
        _stage("Manufacturing", "inflows", [_mat("LFP production", "a" * 32, PACK)]),
        _stage("End of Life", "outflows", [_mat("Transport", "b" * 32, EOL)]),
    ])
    # The hand-duplicated original: same rows, pre-divided.
    original = Archetype(id="orig", name="B0", bom=[
        _stage("Manufacturing", "inflows", [
            _mat("LFP production", "a" * 32, PACK / DIV),
            _mat("Inverter", "c" * 32, 1.0 / DIV)]),
        _stage("Use Phase", "stock", [_mat("PV electricity", "d" * 32, 1.0)]),
        _stage("End of Life", "outflows", [_mat("Transport", "b" * 32, EOL / DIV)]),
    ])
    # The composed twin: the pack becomes a reference carrying the divisor.
    twin = Archetype(id="twin", name="B0 twin", bom=[
        _stage("Manufacturing", "inflows", [_mat("Inverter", "c" * 32, 1.0 / DIV)]),
        _stage("Use Phase", "stock", [_mat("PV electricity", "d" * 32, 1.0)]),
        _stage("End of Life", "outflows", []),
    ], includes=[ArchetypeInclude(archetype_id="pack", quantity=1.0 / DIV)])

    spliced = splice_includes(twin, _reg(pack, twin))

    def demand(a):
        out: dict[str, float] = {}
        for m in flatten_roots(a.bom):
            key = m.ecoinvent_activity.code
            out[key] = out.get(key, 0.0) + m.quantity
        return out

    o, t = demand(original), demand(spliced)
    assert set(o) == set(t), f"different activities: {set(o) ^ set(t)}"
    for k in o:
        assert t[k] == pytest.approx(o[k], rel=1e-12), (
            f"activity {k[:6]}: original {o[k]!r} vs composed {t[k]!r}")

    # and the child really did span two stages of the parent
    staged = {r.name: {m.name for m, _ in flatten_root_with_amounts(r, {}, None)}
              for r in spliced.bom}
    assert "LFP production" in staged["Manufacturing"]
    assert "Transport" in staged["End of Life"]


def test_material_key_qualifies_by_the_NEAREST_include():
    """Renaming the spliced stage is not enough: DSM aggregation keys by the
    LEAF name, so the leaf is what must be qualified. A grandchild reports the
    grandchild, not the child."""
    from mapper.core.bom_engine import material_key
    from mapper.models.bom_schemas import FlattenedMaterial

    plain = FlattenedMaterial(node_id="1", name="Steel frame", quantity=1.0,
                              unit="kg", path=["Manufacturing", "Body", "Steel frame"])
    child = FlattenedMaterial(node_id="2", name="Steel frame", quantity=1.0, unit="kg",
                              path=["Manufacturing", f"Battery Pack{INCLUDE_KEY_SEP}Manufacturing",
                                    "Steel frame"])
    grand = FlattenedMaterial(node_id="3", name="Cathode", quantity=1.0, unit="kg",
                              path=["Manufacturing", f"Battery Pack{INCLUDE_KEY_SEP}Manufacturing",
                                    f"Cell{INCLUDE_KEY_SEP}Manufacturing", "Cathode"])

    assert material_key(plain) == "Steel frame", "un-included rows must not change"
    assert material_key(child) == f"Battery Pack{INCLUDE_KEY_SEP}Steel frame"
    assert material_key(child) != material_key(plain)
    assert material_key(grand) == f"Cell{INCLUDE_KEY_SEP}Cathode", "nearest include should win"
    assert material_key(grand).split(INCLUDE_KEY_SEP)[0] == "Cell"


# ── Cache placement and import survival ─────────────────────────────────────

def test_splicing_happens_upstream_of_every_flatten_cache():
    """Eager splice means no cache key has to learn about references.

    Pinned structurally: the splice runs in ``DSMLCAPipeline.__init__`` before
    ``self.archetypes`` is set, so ``_flat_cache`` (archetype_id, scope, year),
    ``_flat_cache_year`` (archetype_id, year, scope, db) and
    ``_resolved_arc_cache`` (archetype_id, year) all key off an archetype whose
    children are already baked in. If splicing ever moves into ``_flatten``,
    those keys become wrong and this test is the alarm.
    """
    import inspect

    from mapper.core import dsm_lca_engine as eng

    init = inspect.getsource(eng.DSMLCAPipeline.__init__)
    assert "splice_includes" in init, "splice must be eager, in __init__"
    assert init.index("splice_includes") < init.index("self.archetypes = archetypes")

    for fn in (eng.DSMLCAPipeline._flatten, eng.DSMLCAPipeline._resolved_archetype):
        assert "splice_includes" not in inspect.getsource(fn), (
            f"{fn.__name__} splices lazily; its cache key would be stale")


def test_a_reference_survives_a_REIMPORT_in_BOTH_modes():
    """Superseded: replace used to orphan the reference, and no longer does.

    This test previously asserted the OPPOSITE -- that a reference survives
    merge "but not REPLACE" -- and did it by grepping the source for
    ``name_to_existing.get(name) if mode == "merge" else None``. It encoded the
    bug as the contract, which is why the bug outlived two orphanings of a real
    project.

    Both modes now match by NAME and preserve the archetype id; replace's job is
    deleting archetypes ABSENT from the workbook, nothing more. Node ids are
    still re-minted by both modes (``assign_node_ids`` only fills missing ones,
    and the parser builds nodes without them), which remains the reason a
    reference is by archetype id and never a node id.

    The behavioural coverage lives in ``test_import_preserves_archetype_ids.py``
    -- all three surfaces that carry an archetype id (system cohort mapping,
    subsystem cohort mapping, and composition). Composition is checked there in
    both modes, because ``_upsert`` also never carried ``includes`` at all, so
    even a preserved id came back with an empty list.
    """
    import inspect

    from mapper.api import bom as bom_mod

    src = inspect.getsource(bom_mod)
    assert 'name_to_existing.get(name) if mode == "merge" else None' not in src, (
        "replace mode is matching by name again only in merge -- it re-mints "
        "ids and orphans every archetype-id reference in the project"
    )
    assert "includes=existing.includes" in src, (
        "_upsert no longer carries composition; the workbook cannot express it, "
        "so dropping it destroys composition on every import"
    )
