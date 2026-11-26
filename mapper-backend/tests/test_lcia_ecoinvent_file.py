# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The ecoinvent LCIA implementation file, linked by flow UUID.

Synthetic workbooks, a synthetic ElementaryExchanges.xml and a throwaway
Brightway directory only: no real ecoinvent file is read and no real project
is opened.
"""
from __future__ import annotations

import gc
import json
import shutil
import uuid
from pathlib import Path

import bw2data
import openpyxl
import pytest

from mapper.core import lcia_ecoinvent_file as ei
from mapper.core import lcia_method_engine as lme
from mapper.core import method_labels, method_provenance

BIO = "biosphere3"
EI = "ecoinvent-3.10-cutoff"
H = "ReCiPe 2016 v1.03, midpoint (H)"
E = "ReCiPe 2016 v1.03, midpoint (E)"
CLIMATE_H = (H, "climate change", "global warming potential (GWP100)")
CLIMATE_E = (E, "climate change", "global warming potential (GWP1000)")
IONISING = (H, "ionising radiation", "ionising radiation potential (IRP)")

# UUIDs. The project's biosphere3 is OLDER than the file: U_DCM carries the 3.9 name.
U_CO2 = "aaaaaaaa-0000-0000-0000-000000000001"       # Carbon dioxide, fossil / air / unspecified
U_CO2_URBAN = "aaaaaaaa-0000-0000-0000-000000000002"  # Carbon dioxide, fossil / air / urban air close to ground
U_NONFOSSIL = "aaaaaaaa-0000-0000-0000-000000000003"
U_DCM = "aaaaaaaa-0000-0000-0000-000000000004"        # Dichloromethane (3.10) == Methane, dichloro-, HCC-30 (3.9)
U_ANILINE = "aaaaaaaa-0000-0000-0000-000000000005"
U_ANILAZINE = "aaaaaaaa-0000-0000-0000-000000000006"  # new in 3.10: not in the project's biosphere3
U_CO60 = "aaaaaaaa-0000-0000-0000-000000000007"
U_SOIL = "aaaaaaaa-0000-0000-0000-000000000008"       # in biosphere3 under a different compartment

MASTER = [
    (U_CO2, "Carbon dioxide, fossil", "air", "unspecified"),
    (U_CO2_URBAN, "Carbon dioxide, fossil", "air", "urban air close to ground"),
    (U_NONFOSSIL, "Carbon dioxide, non-fossil", "air", None),  # no subcompartment element: unspecified
    (U_DCM, "Dichloromethane", "air", "unspecified"),
    (U_ANILINE, "Aniline", "water", "unspecified"),
    (U_ANILAZINE, "Anilazine", "water", "unspecified"),
    (U_CO60, "Cobalt-60", "air", "unspecified"),
    (U_SOIL, "Carbon dioxide, to soil or biomass stock", "soil", "unspecified"),
]
BIOSPHERE = {
    U_CO2: ("Carbon dioxide, fossil", ("air",)),
    U_CO2_URBAN: ("Carbon dioxide, fossil", ("air", "urban air close to ground")),
    U_NONFOSSIL: ("Carbon dioxide, non-fossil", ("air",)),
    U_DCM: ("Methane, dichloro-, HCC-30", ("air",)),
    U_ANILINE: ("Aniline", ("water",)),
    U_CO60: ("Cobalt-60", ("air",)),
    U_SOIL: ("Carbon dioxide, to soil or biomass stock", ("soil", "agricultural")),
}
CFS = [
    (CLIMATE_H, "Carbon dioxide, fossil", "air", "unspecified", 1),
    (CLIMATE_H, "Carbon dioxide, fossil", "air", "urban air close to ground", 1),
    (CLIMATE_H, "Dichloromethane", "air", "unspecified", 11.2),
    (CLIMATE_H, "Carbon dioxide, to soil or biomass stock", "soil", "unspecified", -1),
    (CLIMATE_E, "Carbon dioxide, fossil", "air", "unspecified", 1),
    (CLIMATE_E, "Carbon dioxide, non-fossil", "air", "unspecified", 0),
    (IONISING, "Cobalt-60", "air", "unspecified", 1.5),
    (IONISING, "Aniline", "water", "unspecified", 0.2),
    (IONISING, "Anilazine", "water", "unspecified", 0.7),
]
UNITS = {CLIMATE_H: "kg CO2-Eq", CLIMATE_E: "kg CO2-Eq", IONISING: "kBq Co-60-Eq"}


# ── builders ─────────────────────────────────────────────────────────────────


def write_workbook(path: Path, *, version="3.10, November 2023", cfs=CFS, units=UNITS,
                   sheets=("Read me", "CFs", "Indicators"), cf_header=None, unit_header="Indicator Unit") -> Path:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    if "Read me" in sheets:
        ws = wb.create_sheet("Read me")
        ws.append(["© ecoinvent Association / 2023", None])
        if version is not None:
            ws.append(["Database Version", version])
    if "CFs" in sheets:
        ws = wb.create_sheet("CFs")
        ws.append(cf_header or ei.CF_COLUMNS)
        for (m, c, i), name, comp, sub, cf in cfs:
            ws.append([m, c, i, name, comp, sub, cf])
    if "Indicators" in sheets:
        ws = wb.create_sheet("Indicators")
        ws.append(["Method", "Category", "Indicator", unit_header])
        for (m, c, i), u in units.items():
            ws.append([m, c, i, u])
    wb.save(path)
    return path


def write_master(path: Path, flows=MASTER, root="validElementaryExchanges") -> Path:
    ns = "http://www.EcoInvent.org/EcoSpold02"
    parts = [f'<?xml version="1.0" encoding="utf-8"?>\n<{root} xmlns="{ns}">']
    for u, name, comp, sub in flows:
        subel = f'<subcompartment xml:lang="en">{sub}</subcompartment>' if sub else ""
        parts.append(
            f'<elementaryExchange id="{u}"><name xml:lang="en">{name}</name><unitName xml:lang="en">kg</unitName>'
            f'<compartment><compartment xml:lang="en">{comp}</compartment>{subel}</compartment></elementaryExchange>'
        )
    parts.append(f"</{root}>")
    path.write_text("".join(parts), encoding="utf-8")
    return path


def make_project(name: str, *, ei_db=EI, biosphere=BIOSPHERE, uses=(U_CO2,)) -> None:
    bw2data.projects.set_current(name)
    bw2data.Database(BIO).write({
        (BIO, code): {"name": n, "unit": "kilogram", "type": "emission", "categories": tuple(c)}
        for code, (n, c) in biosphere.items()
    })
    bw2data.Database(ei_db).write({
        (ei_db, "elec"): {
            "name": "market for electricity", "unit": "kilowatt hour", "location": "DK",
            "exchanges": [{"input": (ei_db, "elec"), "amount": 1, "type": "production"}]
            + [{"input": (BIO, u), "amount": 0.1, "type": "biosphere"} for u in uses],
        }
    })


def rows(db):
    from bw2data.backends.peewee import ActivityDataset
    return {(r.database, r.code): json.dumps(r.data, sort_keys=True, default=str)
            for r in ActivityDataset.select().where(ActivityDataset.database == db)}


def cfs_of(t):
    return sorted((tuple(k) if isinstance(k, (list, tuple)) else bw2data.get_activity(id=k).key, v)
                  for k, v in bw2data.Method(t).load())


@pytest.fixture()
def tmpbw(monkeypatch, tmp_path):
    """A throwaway Brightway directory and Method Library cache. Nothing real is touched."""
    monkeypatch.setattr(lme, "CACHE_ROOT", tmp_path / "lcia_cache")
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        make_project(f"pytest-eilcia-{uuid.uuid4().hex[:8]}")
        yield tmp_path
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture()
def files(tmp_path):
    return write_workbook(tmp_path / "LCIA Implementation 3.10.xlsx"), write_master(tmp_path / "ElementaryExchanges.xml")


def prepared(files):
    return ei.prepare(*files)


# ── reading the workbook ─────────────────────────────────────────────────────


def test_the_workbook_is_read_with_its_release_units_and_factors(files):
    wb = ei.read_workbook(files[0])
    assert wb.version == "3.10"
    assert wb.units[IONISING] == "kBq Co-60-Eq"
    assert len(wb.factors) == len(CFS)
    assert len(wb.sha256) == 64


@pytest.mark.parametrize("kwargs, message", [
    ({"sheets": ("Read me", "CFs")}, "no 'Indicators' sheet"),
    ({"sheets": ("CFs", "Indicators")}, "no 'Read me' sheet"),
    ({"version": None}, "no 'Database Version' row"),
    ({"version": "November 2023"}, "not a release number"),
    ({"cf_header": ["Method", "Category", "Indicator", "Name", "Compartment", "CF"]}, "no column 'Subcompartment'"),
    ({"unit_header": "Quantity"}, "no 'Unit' column"),
    ({"cfs": [(CLIMATE_H, "Carbon dioxide, fossil", "air", "unspecified", "one")]}, "not a number"),
    ({"cfs": [(("X", "y", "z"), "Carbon dioxide, fossil", "air", "unspecified", 1)]}, "which 'Indicators' does not list"),
    ({"cfs": []}, "no characterisation factors"),
])
def test_a_wrong_workbook_is_refused_with_the_reason(tmp_path, kwargs, message):
    with pytest.raises(ei.EcoinventFileError, match=message):
        ei.read_workbook(write_workbook(tmp_path / "w.xlsx", **kwargs))


def test_a_file_that_is_not_a_workbook_says_so(tmp_path):
    p = tmp_path / "w.xlsx"
    p.write_bytes(b"not a zip")
    with pytest.raises(ei.EcoinventFileError, match="Could not open the workbook: .+"):
        ei.read_workbook(p)


def test_a_wrong_master_data_file_is_refused(tmp_path):
    with pytest.raises(ei.EcoinventFileError, match="not ecoinvent's ElementaryExchanges.xml"):
        ei.read_master_data(write_master(tmp_path / "m.xml", root="validIntermediateExchanges"))
    p = tmp_path / "d.xml"
    p.write_text('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>', encoding="utf-8")
    with pytest.raises(ei.EcoinventFileError, match="DOCTYPE"):
        ei.read_master_data(p)
    p.write_text("<unclosed", encoding="utf-8")
    with pytest.raises(ei.EcoinventFileError, match="not valid XML"):
        ei.read_master_data(p)


# ── version refusal ──────────────────────────────────────────────────────────


def test_a_workbook_of_another_release_than_the_project_is_refused(tmpbw, tmp_path, files):
    make_project(f"pytest-eilcia-311-{uuid.uuid4().hex[:6]}", ei_db="ecoinvent-3.11-cutoff")
    with pytest.raises(ei.EcoinventFileError, match="ecoinvent 3.10 LCIA implementation, but this project holds ecoinvent 3.11"):
        ei.prepare(*files)


def test_master_data_of_another_release_is_refused(tmpbw, tmp_path):
    """The master data names no release, so it is checked by content: one flow short is another release."""
    wb = write_workbook(tmp_path / "w.xlsx")
    md = write_master(tmp_path / "m.xml", flows=[f for f in MASTER if f[1] != "Dichloromethane"])
    with pytest.raises(ei.EcoinventFileError, match="1 flows the workbook names are not in this master data"):
        ei.prepare(wb, md)


def test_a_project_without_a_detectable_release_needs_it_stated(tmpbw, files, monkeypatch):
    monkeypatch.setattr(lme, "detect_ecoinvent_version", lambda: None)
    with pytest.raises(ei.EcoinventFileError, match="Could not tell which ecoinvent release"):
        ei.prepare(*files)
    _, _, linked = ei.prepare(*files, ecoinvent_version="3.10")
    assert CLIMATE_H in linked


# ── linking ──────────────────────────────────────────────────────────────────


def test_a_renamed_flow_links_by_uuid(tmpbw, files):
    """biosphere3 holds the 3.9 name; the file uses the 3.10 one. Same UUID, so it links."""
    _, _, linked = prepared(files)
    assert ((BIO, U_DCM), 11.2) in linked[CLIMATE_H].cfs


def test_matching_is_exact_anilazine_is_not_aniline(tmpbw, files):
    _, _, linked = prepared(files)
    ion = dict(linked[IONISING].cfs)
    assert ion[(BIO, U_ANILINE)] == 0.2, "Aniline lost its own factor"
    assert (BIO, U_ANILAZINE) not in ion
    assert ion.get((BIO, U_ANILINE)) != 0.7, "Anilazine's factor landed on Aniline"
    assert linked[IONISING].skipped == {ei.NOT_IN_BIOSPHERE: 1}
    assert [f[1] for f in linked[IONISING].skipped_flows] == ["Anilazine"]


def test_link_itself_is_exact_even_without_the_release_check(tmp_path):
    """Defence in depth: ``link`` does not lean on ``check_versions`` to stay exact."""
    wb = ei.read_workbook(write_workbook(tmp_path / "w.xlsx", cfs=[
        (IONISING, "Anilazine", "water", "unspecified", 0.7),
    ]))
    md = ei.read_master_data(write_master(tmp_path / "m.xml", flows=[f for f in MASTER if f[1] != "Anilazine"]))
    with pytest.raises(ei.EcoinventFileError, match="Anilazine .* is not in the master data"):
        ei.link(wb, md, {u: c for u, (_, c) in BIOSPHERE.items()})
    wb = ei.read_workbook(write_workbook(tmp_path / "c.xlsx", cfs=[
        (IONISING, "cobalt-60", "air", "unspecified", 1.5),
    ]))
    with pytest.raises(ei.EcoinventFileError, match="cobalt-60 .* is not in the master data"):
        ei.link(wb, md, {u: c for u, (_, c) in BIOSPHERE.items()})


def test_a_name_differing_only_in_case_does_not_link(tmpbw, tmp_path):
    wb = write_workbook(tmp_path / "w.xlsx", cfs=[(CLIMATE_H, "carbon dioxide, fossil", "air", "unspecified", 1)])
    with pytest.raises(ei.EcoinventFileError, match="not in this master data"):
        ei.prepare(wb, write_master(tmp_path / "m.xml"))


def test_unspecified_is_its_own_flow_and_is_never_spread(tmpbw, tmp_path):
    """A factor on (air, unspecified) is the flow with biosphere3 categories ('air',), not the urban one;
    a master-data entry with no subcompartment element counts as unspecified."""
    wb = write_workbook(tmp_path / "w.xlsx", cfs=[
        (CLIMATE_E, "Carbon dioxide, fossil", "air", "unspecified", 1),
        (CLIMATE_E, "Carbon dioxide, non-fossil", "air", "unspecified", 0),
    ])
    _, _, linked = ei.prepare(wb, write_master(tmp_path / "m.xml"))
    assert sorted(linked[CLIMATE_E].cfs) == sorted([((BIO, U_CO2), 1.0), ((BIO, U_NONFOSSIL), 0.0)])


def test_a_uuid_under_another_compartment_in_biosphere3_is_skipped(tmpbw, files):
    _, _, linked = prepared(files)
    assert (BIO, U_SOIL) not in dict(linked[CLIMATE_H].cfs)
    assert linked[CLIMATE_H].skipped == {ei.COMPARTMENT_DIFFERS: 1}


def test_two_different_factors_for_one_flow_are_skipped_not_picked(tmpbw, tmp_path):
    wb = write_workbook(tmp_path / "w.xlsx", cfs=[
        (CLIMATE_H, "Carbon dioxide, fossil", "air", "unspecified", 1),
        (CLIMATE_H, "Carbon dioxide, fossil", "air", "unspecified", 2),
        (CLIMATE_H, "Dichloromethane", "air", "unspecified", 11.2),
        (CLIMATE_H, "Dichloromethane", "air", "unspecified", 11.2),
    ])
    _, _, linked = ei.prepare(wb, write_master(tmp_path / "m.xml"))
    assert linked[CLIMATE_H].cfs == [((BIO, U_DCM), 11.2)], "an exact duplicate is one factor"
    assert linked[CLIMATE_H].skipped == {ei.CONFLICTING_DUPLICATE: 1}


# ── preview ──────────────────────────────────────────────────────────────────


def test_the_preview_groups_by_family_counts_reasons_and_writes_nothing(tmpbw, files):
    make_project(f"pytest-eilcia-p-{uuid.uuid4().hex[:6]}", uses=(U_CO2, U_SOIL))
    methods_before = dict(bw2data.methods)
    bio_before = rows(BIO)
    workbook, master, linked = prepared(files)
    p = ei.preview(workbook, master, linked)

    assert dict(bw2data.methods) == methods_before
    assert rows(BIO) == bio_before
    assert not lme.CACHE_ROOT.exists(), "the preview wrote a manifest"
    fams = {f["family"]: f for f in p["families"]}
    assert set(fams) == {H, E}
    assert fams[H]["installs_as"] == f"{H} [ecoinvent 3.10 LCIA]"
    by_method = {tuple(r["method"]): r for r in fams[H]["methods"]}
    assert by_method[IONISING]["unit"] == "kBq Co-60-Eq"
    assert by_method[IONISING]["skipped"] == {ei.NOT_IN_BIOSPHERE: 1}
    assert by_method[CLIMATE_H]["skipped_used_by_project"] == 1, "the soil flow is used by the project's database"
    assert by_method[IONISING]["skipped_used_by_project"] == 0
    assert p["totals"]["factors"] == p["totals"]["linked"] + p["totals"]["skipped"]
    assert {f["name"] for f in p["skipped_flows"]} == {"Anilazine", "Carbon dioxide, to soil or biomass stock"}
    assert p["ecoinvent_version"] == "3.10" and p["method_id"] == "ecoinvent_lcia_3_10"


# ── install: next to, never over ─────────────────────────────────────────────


def test_install_registers_tagged_methods_next_to_the_existing_ones(tmpbw, files):
    bundled = (H, "climate change", "global warming potential (GWP1000)")
    bw2data.Method(bundled).register(unit="kg CO2-Eq", filename="LCIA_Implementation_3.9.xlsx")
    bw2data.Method(bundled).write([((BIO, U_CO2), 1.0), ((BIO, U_NONFOSSIL), 1.0)])
    before = cfs_of(bundled)

    workbook, master, linked = prepared(files)
    result = ei.install(workbook, master, linked, [list(CLIMATE_H), list(IONISING)])

    new_h = (f"{H} [ecoinvent 3.10 LCIA]", "climate change", "global warming potential (GWP100)")
    new_ion = (f"{H} [ecoinvent 3.10 LCIA]", *IONISING[1:])
    assert result.method_tuples == [new_h, new_ion]
    assert cfs_of(bundled) == before, "the bundled method was touched"
    meta = bw2data.methods[new_ion]
    assert meta["unit"] == "kBq Co-60-Eq"
    assert meta["filename"] == "LCIA Implementation 3.10.xlsx"
    assert meta["sha256"] == workbook.sha256 and meta["ecoinvent_version"] == "3.10"
    assert meta["description"]
    assert cfs_of(new_h) == sorted([((BIO, U_CO2), 1.0), ((BIO, U_CO2_URBAN), 1.0), ((BIO, U_DCM), 11.2)])


def test_an_install_that_would_reuse_a_registered_tuple_is_refused_whole(tmpbw, files):
    workbook, master, linked = prepared(files)
    new_ion = (f"{H} [ecoinvent 3.10 LCIA]", *IONISING[1:])
    bw2data.Method(new_ion).register(unit="mine")
    bw2data.Method(new_ion).write([((BIO, U_CO60), 99.0)])
    methods_before = set(bw2data.methods)

    with pytest.raises(ei.EcoinventFileError, match="already in this project"):
        ei.install(workbook, master, linked, [list(CLIMATE_H), list(IONISING)])

    assert set(bw2data.methods) == methods_before, "a partial install happened"
    assert cfs_of(new_ion) == [((BIO, U_CO60), 99.0)], "an existing method was overwritten"
    assert bw2data.methods[new_ion]["unit"] == "mine"


def test_a_failed_write_unregisters_what_the_install_registered(tmpbw, files, monkeypatch):
    workbook, master, linked = prepared(files)
    calls = {"n": 0}
    real = bw2data.Method.write

    def flaky(self, data, *a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("disk full")
        return real(self, data, *a, **k)

    monkeypatch.setattr(bw2data.Method, "write", flaky)
    with pytest.raises(RuntimeError):
        ei.install(workbook, master, linked, [list(CLIMATE_H), list(IONISING)])
    assert not any("[ecoinvent 3.10 LCIA]" in t[0] for t in bw2data.methods)


def test_unknown_or_unlinkable_selections_are_refused(tmpbw, tmp_path, files):
    workbook, master, linked = prepared(files)
    with pytest.raises(ei.EcoinventFileError, match="no method"):
        ei.install(workbook, master, linked, [["X", "y", "z"]])
    with pytest.raises(ei.EcoinventFileError, match="No methods were selected"):
        ei.install(workbook, master, linked, [])
    wb = write_workbook(tmp_path / "only-new.xlsx", cfs=[(IONISING, "Anilazine", "water", "unspecified", 0.7)])
    workbook, master, linked = ei.prepare(wb, files[1])
    with pytest.raises(ei.EcoinventFileError, match="No factor"):
        ei.install(workbook, master, linked, [list(IONISING)])


def test_biosphere3_is_never_modified(tmpbw, files):
    from bw2data.backends.peewee import ActivityDataset, ExchangeDataset

    before = (rows(BIO), dict(bw2data.databases[BIO]),
              ExchangeDataset.select().where(ExchangeDataset.output_database == BIO).count(),
              ActivityDataset.select().where(ActivityDataset.database == BIO).count())
    workbook, master, linked = prepared(files)
    ei.preview(workbook, master, linked)
    ei.install(workbook, master, linked, [list(CLIMATE_H), list(CLIMATE_E), list(IONISING)])
    lme.uninstall(ei.method_id("3.10"))
    after = (rows(BIO), dict(bw2data.databases[BIO]),
             ExchangeDataset.select().where(ExchangeDataset.output_database == BIO).count(),
             ActivityDataset.select().where(ActivityDataset.database == BIO).count())
    assert after == before


# ── per-project manifest and uninstall ───────────────────────────────────────


def test_manifest_and_uninstall_are_per_project(tmpbw, files):
    a = str(bw2data.projects.current)
    bw2data.Method(("Other", "x", "y")).register(unit="u")
    bw2data.Method(("Other", "x", "y")).write([((BIO, U_CO2), 1.0)])
    ei.install(*prepared(files), [list(CLIMATE_H), list(IONISING)])

    b = f"pytest-eilcia-b-{uuid.uuid4().hex[:6]}"
    make_project(b)
    ei.install(*prepared(files), [list(IONISING)])
    in_b = set(bw2data.methods)

    bw2data.projects.set_current(a)
    entry = next(m for m in lme.list_library() if m["id"] == "ecoinvent_lcia_3_10")
    assert entry["removable"] is True and entry["category_count"] == 2 and entry["source"] == "ecoinvent_file"
    assert not any(f["name"].endswith("[ecoinvent 3.10 LCIA]") for f in lme.list_library() if f["source"] == "bundled")
    assert lme.uninstall("ecoinvent_lcia_3_10") == 2
    assert list(bw2data.methods) == [("Other", "x", "y")], "uninstall removed a method it did not install"
    assert not any(m["id"] == "ecoinvent_lcia_3_10" for m in lme.list_library())

    bw2data.projects.set_current(b)
    assert set(bw2data.methods) == in_b, "uninstall in one project removed another project's methods"
    manifest = lme._read_manifest("ecoinvent_lcia_3_10")
    assert a not in manifest["projects"] and b in manifest["projects"]
    assert lme.uninstall("ecoinvent_lcia_3_10") == 1


def test_a_second_install_in_one_project_adds_to_its_manifest(tmpbw, files):
    ei.install(*prepared(files), [list(CLIMATE_H)])
    ei.install(*prepared(files), [list(IONISING)])
    assert lme.uninstall("ecoinvent_lcia_3_10") == 2


# ── labels, pickers and the export row ───────────────────────────────────────


def test_the_installed_climate_indicators_read_as_their_factors_and_apart_from_the_bundled_ones():
    tag = " [ecoinvent 3.10 LCIA]"
    bundled_h = (H, "climate change", "global warming potential (GWP1000)")
    new_h = (H + tag, "climate change", "global warming potential (GWP100)")
    new_i = ("ReCiPe 2016 v1.03, midpoint (I)" + tag, "climate change", "global warming potential (GWP20)")
    bundled_e, new_e = CLIMATE_E, (E + tag, *CLIMATE_E[1:])
    # The file already names them by their horizon; the #211 correction must not touch them.
    assert method_labels.display_method(new_h) == new_h
    assert method_labels.display_method(new_i) == new_i
    assert method_labels.display_method(bundled_h)[-1] == "global warming potential (GWP100)"
    labels = method_labels.disambiguated_labels([bundled_h, new_h, bundled_e, new_e])
    assert len(set(labels.values())) == 4, labels
    assert labels[new_e].startswith(E + tag) and labels[bundled_e].startswith(E + " /")
    # One family alone keeps its short labels.
    assert method_labels.disambiguated_labels([new_h, IONISING]) == {new_h: "climate change", IONISING: "ionising radiation"}


def test_the_export_row_names_the_tagged_family_and_its_source(tmpbw, files, monkeypatch):
    monkeypatch.setattr(method_provenance, "registered_metadata", method_provenance._registered_metadata)
    monkeypatch.setattr(method_provenance, "library_sources", method_provenance._library_sources)
    workbook, master, linked = prepared(files)
    [new_h] = ei.install(workbook, master, linked, [list(CLIMATE_H)]).method_tuples
    prov = method_provenance.describe_methods([new_h, CLIMATE_E])
    assert prov.meta_row() == ("Impact assessment method", f"{H} [ecoinvent 3.10 LCIA]; {E}")
    source = prov.categories[0].source
    assert "ecoinvent 3.10 LCIA implementation file (LCIA Implementation 3.10.xlsx" in source
    assert workbook.sha256 in source


# ── the custom upload ────────────────────────────────────────────────────────


def _custom(tmp_path, name="c.xlsx", sheets=(("Sheet1", ["name", "categories", "amount"]),)):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, header in sheets:
        ws = wb.create_sheet(title)
        ws.append(header)
        ws.append(["Carbon dioxide, fossil", "air", 1.0])
    p = tmp_path / name
    wb.save(p)
    return p


@pytest.mark.parametrize("sheets, message", [
    ((("CFs", ["Method"]), ("Indicators", ["Method"]), ("Read me", ["x"])), "looks like an ecoinvent LCIA implementation file"),
    ((("A", ["name", "categories", "amount"]), ("B", ["x"])), "expects one sheet; this workbook has 2"),
    ((("Sheet1", ["name", "amount"]),), "no column 'categories'"),
])
def test_the_custom_upload_says_why_it_refuses_a_workbook(tmpbw, tmp_path, sheets, message):
    with pytest.raises(lme.InstallError, match=message) as err:
        lme.install_excel(_custom(tmp_path, sheets=sheets), ("Mine", "x", "y"), "", "kg")
    assert not str(err.value).rstrip().endswith(":")


def test_an_importer_exception_with_no_message_is_named_by_its_type(tmpbw, tmp_path, monkeypatch):
    import bw2io.importers.excel_lcia as xl

    def boom(*a, **k):
        raise AssertionError()

    monkeypatch.setattr(xl, "ExcelLCIAImporter", boom)
    with pytest.raises(lme.InstallError, match=r"^Could not parse xlsx: AssertionError$"):
        lme.install_excel(_custom(tmp_path), ("Mine", "x", "y"), "", "kg")


def test_the_custom_upload_manifest_is_per_project(tmpbw, tmp_path):
    a = str(bw2data.projects.current)
    lme.install_excel(_custom(tmp_path), ("Mine", "x", "y"), "d", "kg")
    mid = next(m["id"] for m in lme.list_library() if m["source"] == "custom")
    assert lme._read_manifest(mid)["projects"][a]["method_tuples"] == [["Mine", "x", "y"]]

    b = f"pytest-eilcia-cb-{uuid.uuid4().hex[:6]}"
    make_project(b)
    bw2data.Method(("Mine", "x", "y")).register(unit="kg")
    bw2data.Method(("Mine", "x", "y")).write([((BIO, U_CO2), 5.0)])
    row = next(m for m in lme.list_library() if m["id"] == mid)
    assert row["installed"] is False, "another project's upload claims this project's method"
    assert lme.uninstall(mid) == 0
    assert ("Mine", "x", "y") in bw2data.methods

    bw2data.projects.set_current(a)
    assert lme.uninstall(mid) == 1


# ── routes, through the app ──────────────────────────────────────────────────


def test_the_preview_route_returns_the_preview_and_writes_nothing(tmpbw, files):
    from fastapi.testclient import TestClient

    from mapper.main import app

    before = dict(bw2data.methods)
    with TestClient(app) as client, open(files[0], "rb") as wb, open(files[1], "rb") as md:
        r = client.post("/api/impact/methods/ecoinvent-file/preview",
                        files={"file": ("LCIA Implementation 3.10.xlsx", wb), "master_data": ("ElementaryExchanges.xml", md)})
    assert r.status_code == 200, r.text
    assert r.json()["totals"]["methods"] == 3
    assert dict(bw2data.methods) == before


def test_the_preview_route_refuses_a_mismatch_with_a_reason(tmpbw, tmp_path):
    from fastapi.testclient import TestClient

    from mapper.main import app

    wb = write_workbook(tmp_path / "w.xlsx", version="3.11, November 2024")
    md = write_master(tmp_path / "m.xml")
    with TestClient(app) as client, open(wb, "rb") as fw, open(md, "rb") as fm:
        r = client.post("/api/impact/methods/ecoinvent-file/preview",
                        files={"file": ("w.xlsx", fw), "master_data": ("m.xml", fm)})
        bad = client.post("/api/impact/methods/ecoinvent-file/preview",
                          files={"file": ("w.txt", b"x"), "master_data": ("m.xml", b"<x/>")})
    assert r.status_code == 422 and "this project holds ecoinvent 3.10" in r.json()["detail"]
    assert bad.status_code == 400


def test_the_install_route_installs_through_a_task(tmpbw, files):
    import time

    from fastapi.testclient import TestClient

    from mapper.api import lcia_methods as api
    from mapper.main import app

    with TestClient(app) as client, open(files[0], "rb") as wb, open(files[1], "rb") as md:
        r = client.post("/api/impact/methods/ecoinvent-file/install",
                        files={"file": ("LCIA Implementation 3.10.xlsx", wb), "master_data": ("ElementaryExchanges.xml", md)},
                        data={"methods": json.dumps([list(IONISING)])})
        assert r.status_code == 200, r.text
        task = api._TASKS[r.json()["task_id"]]
        for _ in range(200):
            if task.done:
                break
            time.sleep(0.05)
    assert task.done and task.error is None, task.error
    assert task.method_tuples == [[f"{H} [ecoinvent 3.10 LCIA]", *IONISING[1:]]]
