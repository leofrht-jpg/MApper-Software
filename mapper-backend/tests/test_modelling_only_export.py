# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Modelling-only project export.

`export_project` buffered the whole tarball via `io.BytesIO`. That is fine for
an archive of kilobytes and fatal for one of 38 GB: exporting MAp-test wedged
the backend. It now streams to a temp file and returns a path.

"modelling" is the DEFAULT because a full archive is unshareable -- it bundles
licensed ecoinvent content -- and because it is the one that OOMs. "full" is
opt-in and marked as carrying licensed content in the manifest AND the
filename, since a recipient reads the filename first.

The manifest records database NAMES with link counts rather than an ecoinvent
version string: resolution is by `(database, code)`, so "ecoinvent 3.10 cutoff"
does not match a link stored against "ecoinvent-3.10-cutoff". Premise databases
are listed separately because licensing ecoinvent does not obtain them.
"""
from __future__ import annotations

import json
import tarfile
from pathlib import Path

import pytest

from mapper.core import project_storage as ps
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

SRC = "SourceProj"
SYS_ID = "sys-1"
ARC_IDS = ["arc-1111", "arc-2222"]


@pytest.fixture()
def store(tmp_path, monkeypatch):
    roots = {k: tmp_path / k for k in ("dsm", "aesa", "parameters", "plca", "mfa")}
    monkeypatch.setattr(ps, "storage_roots", lambda: dict(roots))
    from mapper.models.dsm_schemas import (
        DimensionDef, DSMSystemState, SystemDefinition, TimeHorizon,
    )
    d = roots["dsm"] / SRC
    (d / SYS_ID).mkdir(parents=True)
    (d / SYS_ID / "system.json").write_text(SystemDefinition(
        id=SYS_ID, name="Fleet",
        dimensions=[DimensionDef(name="fuel", display_name="Fuel", values=["BEV"])],
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
    ).model_dump_json())
    (d / SYS_ID / "state.json").write_text(DSMSystemState(system_id=SYS_ID).model_dump_json())
    (d / SYS_ID / "cohort_mappings.json").write_text(json.dumps({
        "mfa_system_id": SYS_ID,
        "mappings": [
            {"cohort_key": "BEV|Small", "archetype_id": ARC_IDS[0], "scaling_factor": 1.0},
            {"cohort_key": "BEV|Large", "archetype_id": ARC_IDS[1], "scaling_factor": 1.3},
        ],
        "row_colors": {},
    }))
    (d / "archetypes").mkdir()
    for a in ARC_IDS:
        arc = Archetype(id=a, name=f"Arch {a}", bom=[
            BOMNode(id=f"s-{a}", name="Manufacturing", node_type="component",
                    scope="inflows", children=[
                        BOMNode(id=f"m-{a}", name="Steel", node_type="material",
                                quantity=100.0, unit="kg",
                                ecoinvent_activity=EcoinventLink(
                                    database="ecoinvent-3.10-cutoff",
                                    code="a" * 32, name="market for steel", unit="kg"))])],
            created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00")
        (d / "archetypes" / f"{a}.json").write_text(arc.model_dump_json())
    return roots


def _archetypes():
    out = {}
    for a in ARC_IDS:
        out[a] = Archetype(id=a, name=f"Arch {a}", bom=[
            BOMNode(id=f"s-{a}", name="Manufacturing", node_type="component", children=[
                BOMNode(id=f"m-{a}", name="Steel", node_type="material",
                        quantity=1.0, unit="kg",
                        ecoinvent_activity=EcoinventLink(
                            database="ecoinvent-3.10-cutoff", code="a" * 32,
                            name="steel", unit="kg")),
                BOMNode(id=f"p-{a}", name="Elec", node_type="material",
                        quantity=1.0, unit="kWh",
                        ecoinvent_activity=EcoinventLink(
                            database="ei-3.10_premise_remind_ssp2_2030", code="b" * 32,
                            name="elec", unit="kWh")),
            ])])
    return out


# ── The manifest tells a recipient what they actually need ─────────────────

def test_the_manifest_records_database_NAMES_with_link_counts():
    """Not just an ecoinvent version.

    Resolution is by (database, code), so a version string is not actionable:
    "ecoinvent 3.10 cutoff" will not match "ecoinvent-3.10-cutoff".
    """
    inv = ps.database_inventory(SRC, _archetypes())
    assert inv["linked"]["ecoinvent-3.10-cutoff"] == 2
    assert inv["linked"]["ei-3.10_premise_remind_ssp2_2030"] == 2


def test_premise_databases_are_listed_separately(monkeypatch):
    """A recipient cannot obtain these by licensing ecoinvent."""
    class _DBs:
        def __iter__(self):
            return iter([
                "biosphere3", "ecoinvent-3.10-cutoff",
                "ecoinvent-3.10-cutoff_premise_remind_ssp1_2030",
                "ecoinvent-3.10-cutoff_premise_remind_ssp2_2050",
            ])
    import bw2data
    monkeypatch.setattr(bw2data, "databases", _DBs())
    inv = ps.database_inventory(SRC, _archetypes())
    assert inv["premise_count"] == 2
    assert all("_premise_" in d for d in inv["installed_premise"])
    assert "ecoinvent-3.10-cutoff" in inv["installed_base"]
    assert not any("_premise_" in d for d in inv["installed_base"])


def test_only_a_full_archive_is_marked_as_licensed(store, tmp_path):
    for mode, expected in (("modelling", False), ("full", True)):
        out = tmp_path / f"{mode}.tar.gz"
        with tarfile.open(str(out), mode="w:gz") as tf:
            info = tarfile.TarInfo(SRC); info.type = tarfile.DIRTYPE; info.mode = 0o755
            tf.addfile(info)
            m = ps.write_archive_storage(tf, SRC, SRC, mode=mode, databases={})
        assert m["mode"] == mode
        assert m["contains_licensed_content"] is expected


# ── Acceptance: the round trip that caught the id-reminting problem ────────

def test_modelling_only_round_trip_keeps_the_cohort_mapping_RESOLVABLE(store, tmp_path):
    """Export modelling-only, install under a NEW name, and require that the
    archetypes and BOM trees are present and a cohort mapping still resolves.

    Id equality alone would pass while every pointer dangled -- which is
    exactly how the WP5 mapping broke.
    """
    archive = tmp_path / "modelling.tar.gz"
    with tarfile.open(str(archive), mode="w:gz") as tf:
        info = tarfile.TarInfo(SRC); info.type = tarfile.DIRTYPE; info.mode = 0o755
        tf.addfile(info)
        manifest = ps.write_archive_storage(
            tf, SRC, SRC, mode="modelling",
            databases=ps.database_inventory(SRC, _archetypes()))
    assert manifest["total_files"] > 0, "nothing was carried"

    # No bw2 payload in a modelling-only archive.
    with tarfile.open(str(archive)) as tf:
        names = tf.getnames()
    assert any(f"{SRC}/{ps.ARCHIVE_DIR}/" in n for n in names)
    assert not any(n.endswith(".db") or "lci" in n.lower() for n in names), \
        "modelling-only archive carries bw2 payload"

    # Install under a NEW name.
    extract = tmp_path / "x"
    extract.mkdir()
    with tarfile.open(str(archive)) as tf:
        tf.extractall(extract)
    installed = ps.install_archive_storage(extract / SRC, "Imported")
    assert installed, "nothing installed"

    # Archetypes present, with their BOM trees.
    arc_dir = store["dsm"] / "Imported" / "archetypes"
    present = {p.stem for p in arc_dir.glob("*.json")}
    assert present == set(ARC_IDS), f"archetypes missing: {set(ARC_IDS) - present}"
    for f in arc_dir.glob("*.json"):
        arc = Archetype(**json.loads(f.read_text()))
        assert arc.bom and arc.bom[0].children, "BOM tree did not survive"
        assert arc.bom[0].children[0].ecoinvent_activity is not None

    # And the cohort mapping still RESOLVES against them.
    cm = json.loads(
        (store["dsm"] / "Imported" / SYS_ID / "cohort_mappings.json").read_text())
    referenced = {m["archetype_id"] for m in cm["mappings"]}
    assert referenced == set(ARC_IDS), "archetype ids were re-minted"
    orphans = referenced - present
    assert not orphans, f"cohort mapping points at missing archetypes: {orphans}"


def test_export_returns_a_path_not_bytes():
    """Streamed to a temp file. BytesIO held 38 GB in memory for MAp-test."""
    import inspect

    from mapper.core.bw2_wrapper import export_project

    src = inspect.getsource(export_project)
    body = src.split('"""')[2] if src.count('"""') >= 2 else src
    assert "BytesIO" not in body, "export is buffering again"
    assert inspect.signature(export_project).return_annotation is Path
    assert inspect.signature(export_project).parameters["mode"].default == "modelling"


def test_an_unknown_mode_is_refused():
    from mapper.core.bw2_wrapper import export_project

    with pytest.raises(ValueError, match="Unknown export mode"):
        export_project("whatever", mode="everything")
