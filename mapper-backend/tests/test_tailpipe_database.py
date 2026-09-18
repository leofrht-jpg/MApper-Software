# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The ``mapper-tailpipe`` database and its build script.

ecoinvent 3.10 has no operation-style passenger-car dataset -- of the 151
non-market EURO datasets, zero lack a vehicle or road input -- so a BOM that
models the vehicle and the fuel separately cannot link one without
double-counting. ``scripts/build_tailpipe_db.py`` derives the missing
tank-to-wheel half from those same datasets instead.

These tests cover the two properties that are cheap to get wrong and expensive
to discover late: that the codes survive a rebuild, and that a recipient is
told how to rebuild. The numeric derivation itself is guarded by the script's
own refusal to run against a source it cannot find, and by the round-trip
closure recorded in CLAUDE.md.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from mapper.core import project_storage as ps
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_tailpipe_db.py"


def _script():
    """Load the build script by path -- ``scripts/`` is not a package."""
    spec = importlib.util.spec_from_file_location("build_tailpipe_db", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── Codes must survive a rebuild, or every link into the database dangles ──

def test_the_code_is_deterministic_across_runs():
    """A BOM row links by (database, code).

    If regenerating minted fresh codes, every link into the database would
    dangle on rebuild -- the same failure that orphaned WP5's cohort mapping
    when archetypes were re-imported. This is why the code is a hash of a
    stable string and not ``uuid4()``.
    """
    m = _script()
    assert m.stable_code("petrol combustion, EURO 5") == \
        m.stable_code("petrol combustion, EURO 5")
    # And across a fresh import of the module, not just a repeated call.
    assert _script().stable_code("petrol combustion, EURO 5") == \
        m.stable_code("petrol combustion, EURO 5")


def test_the_code_satisfies_the_validator_length_rule():
    """32 hex characters.

    ``bom_validator._EXPECTED_CODE_LENGTH`` is 32 and a mismatch is a
    ``code_truncated`` ERROR that blocks compute with a 422. This is exactly
    what rejects biosphere3's 36-char hyphenated UUIDs, and it is the reason
    a custom activity works where a raw elementary flow does not.
    """
    from mapper.core.bom_validator import _EXPECTED_CODE_LENGTH

    m = _script()
    for name in ("petrol combustion, EURO 5", "diesel combustion, EURO 5"):
        code = m.stable_code(name)
        assert len(code) == _EXPECTED_CODE_LENGTH == 32
        assert all(c in "0123456789abcdef" for c in code)


def test_the_two_activities_do_not_collide():
    m = _script()
    assert m.stable_code("petrol combustion, EURO 5") != \
        m.stable_code("diesel combustion, EURO 5")


# ── The database name must not trip the biosphere refusals ─────────────────

def test_the_database_name_avoids_the_biosphere_substring():
    """Four separate refusals filter on the literal substring "biosphere".

    ``lca.py`` rejects biosphere demand keys in three places and
    ``search_all_activities`` skips such databases when ``technosphere_only``.
    All four test the DATABASE NAME, so a name containing "biosphere" would
    make the activity unlinkable and invisible in the picker at once.
    """
    m = _script()
    assert "biosphere" not in m.TAILPIPE_DB.lower()


# ── Nothing may leave the carbon term unscored ─────────────────────────────

def test_the_carbon_term_is_required_not_optional():
    """Losing CO2 would defeat the point of the database.

    A source that carries no fossil CO2 must refuse the build rather than
    write an activity whose dominant flow is silently absent.
    """
    m = _script()
    assert "Carbon dioxide, fossil" in m.REQUIRED_FLOWS
    assert m.REQUIRED_FLOWS.issubset(set(m.FLOWS))


def test_the_fallback_pedigree_composes_through_the_shared_rule():
    """One implementation of sigma^2 = sigma_basic^2 + SUM (ln f / 2)^2.

    The script must not carry a second copy of the composition rule; a
    divergent copy would score foreground rows differently from the rest of
    MApper while still producing plausible numbers.
    """
    from mapper.core.pedigree import INDICATORS, total_sigma

    m = _script()
    assert set(m.FALLBACK_PEDIGREE).issubset(set(INDICATORS))
    # Raises on an unknown indicator, so this also pins the key spellings.
    sigma = total_sigma(m.FALLBACK_PEDIGREE, m.FALLBACK_BASIC_VARIANCE)
    assert sigma > 0


# ── A recipient must be told how to rebuild, not just that it is missing ───

def _archetypes(tailpipe: bool = False):
    children = [
        BOMNode(id="m-1", name="Steel", node_type="material", quantity=1.0, unit="kg",
                ecoinvent_activity=EcoinventLink(
                    database="ecoinvent-3.10-cutoff", code="a" * 32,
                    name="steel", unit="kg")),
    ]
    if tailpipe:
        children.append(
            BOMNode(id="m-2", name="Combustion", node_type="material",
                    quantity=1.0, unit="kg",
                    ecoinvent_activity=EcoinventLink(
                        database="mapper-tailpipe", code="c" * 32,
                        name="petrol combustion, EURO 5", unit="kg")))
    return {"arc-1": Archetype(id="arc-1", name="Arch", bom=[
        BOMNode(id="s-1", name="Manufacturing", node_type="component",
                children=children)])}


def _installed(monkeypatch, names):
    class _DBs:
        def __iter__(self):
            return iter(names)
    import bw2data
    monkeypatch.setattr(bw2data, "databases", _DBs())


def test_a_generated_database_is_not_listed_as_licensed_base(monkeypatch):
    """It is neither licensed ecoinvent nor premise.

    Listing it under ``installed_base`` would tell a recipient they need an
    ecoinvent licence to obtain something they can rebuild in one command.
    """
    _installed(monkeypatch, ["biosphere3", "ecoinvent-3.10-cutoff", "mapper-tailpipe"])
    inv = ps.database_inventory("P", _archetypes())
    assert inv["installed_generated"] == ["mapper-tailpipe"]
    assert "mapper-tailpipe" not in inv["installed_base"]
    assert "mapper-tailpipe" not in inv["installed_premise"]
    assert "ecoinvent-3.10-cutoff" in inv["installed_base"]


def test_the_build_script_is_named_when_the_project_links_to_it(monkeypatch):
    """Even when the database is NOT installed on the exporting machine.

    The recipient is the one who needs the command, and a link into an absent
    database is precisely the case that matters. Gating the pointer on local
    installation would omit it exactly when it is needed.
    """
    _installed(monkeypatch, ["biosphere3", "ecoinvent-3.10-cutoff"])
    inv = ps.database_inventory("P", _archetypes(tailpipe=True))
    assert inv["linked"]["mapper-tailpipe"] == 1
    assert inv["installed_generated"] == []
    assert inv["regenerate_with"]["mapper-tailpipe"].endswith("build_tailpipe_db.py")


def test_the_named_script_actually_exists_at_that_path():
    """A pointer to a path that is not shipped is worse than no pointer."""
    repo = Path(__file__).resolve().parents[2]
    for rel in ps._GENERATED_DATABASES.values():
        assert (repo / rel).is_file(), f"manifest names a missing script: {rel}"


def test_no_pointer_when_the_project_neither_links_nor_installs(monkeypatch):
    """The manifest should not carry rebuild instructions for the irrelevant."""
    _installed(monkeypatch, ["biosphere3", "ecoinvent-3.10-cutoff"])
    inv = ps.database_inventory("P", _archetypes())
    assert inv["regenerate_with"] == {}


# ── derive() must key by FLOW, not by flow name ─────────────────────────────
#
# A substance can be emitted to several compartments (NOx has five in
# biosphere3), and the compartment changes characterisation: EF v3.1's
# particulate-matter factor for NOx is 1.6e-6 in urban air and 2.1e-7 from
# high stacks. derive() used to group by NAME and keep the first key it met,
# so a source leaf splitting one substance across two compartments was merged
# onto one of them, amounts summed, with nothing said. The EURO 5 leaves happen
# to use one compartment per flow, which is why the installed database was
# right -- by luck, not by construction. These drive derive() with a fake leaf
# so they run without ecoinvent.

_FUEL = "petrol, low-sulfur"
_SOURCE = "fake leaf"
_URBAN = ("biosphere3", "nox-urban")
_STACK = ("biosphere3", "nox-stack")
_CO2 = ("biosphere3", "co2")


class _Flow(dict):
    def __init__(self, key, name, categories, unit="kilogram"):
        super().__init__(name=name, categories=categories, unit=unit)
        self.key = key


class _Exc(dict):
    def __init__(self, flow, amount, scale=None):
        super().__init__(amount=amount)
        if scale is not None:
            self.update({"uncertainty type": 2, "scale": scale, "loc": 0.0,
                         "pedigree": {"reliability": 2}})
        else:
            self["uncertainty type"] = 0
        self.input = flow


class _Leaf(dict):
    def __init__(self, biosphere, fuel=0.05):
        super().__init__(name=_SOURCE, location="RER", database="ei", code="leaf",
                         unit="kilometer")
        self._bio = biosphere
        self._tech = [_Exc(_Flow(("ei", "fuel"), _FUEL, ()), fuel)]

    def biosphere(self):
        return list(self._bio)

    def technosphere(self):
        return list(self._tech)


class _EI(list):
    name = "fake-ecoinvent"


def _derive(biosphere, fuel=0.05):
    m = _script()
    return m, m.derive(_EI([_Leaf(biosphere, fuel)]), _SOURCE, _FUEL)


def _co2(amount=0.15):
    return _Exc(_Flow(_CO2, "Carbon dioxide, fossil", ("air", "urban air close to ground")),
                amount, scale=0.1)


def test_two_compartments_of_one_substance_stay_two_rows():
    """THE test. A split in the source is information, not an error.

    Each compartment must come through with its own key and its own amount.
    Against the name-keyed version this fails: one row, amounts summed, and
    the stack emission relabelled as urban air.
    """
    _, d = _derive([
        _co2(),
        _Exc(_Flow(_URBAN, "Nitrogen oxides", ("air", "urban air close to ground")), 0.0003, scale=0.2),
        _Exc(_Flow(_STACK, "Nitrogen oxides", ("air", "non-urban air or from high stacks")), 0.0001, scale=0.4),
    ], fuel=0.05)
    nox = {r["key"]: r for r in d["rows"].values() if r["key"] != _CO2}
    assert set(nox) == {_URBAN, _STACK}, "compartments merged onto one flow"
    assert nox[_URBAN]["factor"] == pytest.approx(0.0003 / 0.05)
    assert nox[_STACK]["factor"] == pytest.approx(0.0001 / 0.05)


def test_the_same_flow_listed_twice_is_still_summed():
    """Duplicate rows for ONE flow in ONE compartment are one emission."""
    flow = _Flow(_URBAN, "Nitrogen oxides", ("air", "urban air close to ground"))
    _, d = _derive([_co2(), _Exc(flow, 0.0002, scale=0.2), _Exc(flow, 0.0001, scale=0.2)], fuel=0.05)
    rows = [r for r in d["rows"].values() if r["key"] == _URBAN]
    assert len(rows) == 1
    assert rows[0]["factor"] == pytest.approx(0.0003 / 0.05)


def test_each_compartment_keeps_its_own_uncertainty():
    """Never the other compartment's scale -- they are different measurements."""
    _, d = _derive([
        _co2(),
        _Exc(_Flow(_URBAN, "Nitrogen oxides", ("air", "urban air close to ground")), 0.0003, scale=0.2),
        _Exc(_Flow(_STACK, "Nitrogen oxides", ("air", "non-urban air or from high stacks")), 0.0001, scale=0.4),
    ])
    by = {r["key"]: r for r in d["rows"].values()}
    assert by[_URBAN]["sigma"] == pytest.approx(0.2)
    assert by[_STACK]["sigma"] == pytest.approx(0.4)


def test_a_source_without_fossil_co2_still_refuses():
    """Keying by flow must not weaken the required-flow check."""
    with pytest.raises(SystemExit, match="Carbon dioxide, fossil"):
        _derive([_Exc(_Flow(_URBAN, "Nitrogen oxides", ("air", "urban air close to ground")),
                      0.0003, scale=0.2)])
