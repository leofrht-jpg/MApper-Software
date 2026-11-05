# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Biosphere coverage for an ecoinvent import, shared by both import routes.

An ecoinvent release lists its elementary flows in
``MasterData/ElementaryExchanges.xml`` and its activities reference them by
uuid. bw2io links an exchange to ``biosphere3`` only when that uuid is already a
flow in the project's ``biosphere3``. A project whose ``biosphere3`` came from an
older release (3.10: 4,709 flows) importing 3.11 (9,795 flows) therefore had
5,514 flows to link to that did not exist. No bw2io strategy removes those
exchanges and ``match_database`` cannot link them (an ecospold exchange carries no
categories to match on); the route's own filter on exchanges without an
``input`` removed them, and the only trace was a count in a progress message that
mixed them with unlinked technosphere exchanges.

``BiosphereAudit`` does two things for a route:

* before the import, compares the release's flow list with the existing
  ``biosphere3`` and ADDS the missing flows (never modifies or deletes one), or
  refuses when an existing flow has the same code but a different identity;
* around the import, counts the biosphere exchanges found, dropped by design,
  linked and dropped for want of a flow, so the result says what happened.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

#: Fields that make a flow the same flow. A code (uuid) that maps to a different
#: name, unit or categories is not a flow we can safely extend around.
_IDENTITY = ("name", "unit", "categories")

#: Longest list of conflicting flows quoted in the error message.
_MAX_QUOTED = 5


class BiosphereConflict(RuntimeError):
    """An existing biosphere3 flow has the same code as a release flow but not
    the same name, unit or categories."""


def _identity(name: Any, unit: Any, categories: Any) -> tuple:
    return (name, unit, tuple(categories or ()))


def find_elementary_exchanges_xml(*candidates: Path) -> Path | None:
    """The first existing ``ElementaryExchanges.xml`` among ``candidates``."""
    return next((c for c in candidates if c is not None and Path(c).is_file()), None)


def release_flows(bio_db_name: str, xml_path: Path) -> list[dict]:
    """The release's elementary flows, normalised exactly as a fresh
    ``biosphere3`` import would write them (units, unspecified subcategories)."""
    import bw2io

    importer = bw2io.importers.ecospold2_biosphere.Ecospold2BiosphereImporter(
        name=bio_db_name, filepath=str(xml_path)
    )
    importer.apply_strategies()
    return importer.data


@dataclass
class BiosphereAudit:
    """Counts and checks for one import. ``summary()`` is the task result."""

    bio_db_name: str = "biosphere3"
    #: False when no ElementaryExchanges.xml was available: the comparison and
    #: the repair did not happen, the exchange counts below still did.
    coverage_checked: bool = False
    release_flow_count: int = 0
    existing_flow_count: int = 0
    flows_missing: int = 0
    flows_added: int = 0
    exchanges_found: int = 0
    dropped_by_design: int = 0
    exchanges_linked: int = 0
    exchanges_dropped: int = 0
    exchanges_stored: int | None = None
    #: A few (name, categories) of flows that stayed unlinked, for the warning.
    dropped_examples: list[str] = field(default_factory=list)

    # ── before the import ────────────────────────────────────────────────────

    def reconcile(self, xml_path: Path | None) -> None:
        """Add the release's flows that ``biosphere3`` lacks. Raises
        ``BiosphereConflict`` (and writes nothing) when a flow it does have
        disagrees with the release about what that code is."""
        import bw2data

        if xml_path is None:
            return
        wanted = release_flows(self.bio_db_name, xml_path)
        bio = bw2data.Database(self.bio_db_name)
        existing = {a["code"]: _identity(a["name"], a["unit"], a.get("categories")) for a in bio}

        missing, conflicts = [], []
        for ds in wanted:
            have = existing.get(ds["code"])
            if have is None:
                missing.append(ds)
            elif have != _identity(ds["name"], ds["unit"], ds.get("categories")):
                conflicts.append((ds, have))

        self.coverage_checked = True
        self.release_flow_count = len(wanted)
        self.existing_flow_count = len(existing)
        self.flows_missing = len(missing)

        if conflicts:
            quoted = "; ".join(
                f"{have[0]} {list(have[2])} [{have[1]}] is {ds['name']} {list(ds.get('categories') or ())} "
                f"[{ds['unit']}] in the release"
                for ds, have in conflicts[:_MAX_QUOTED]
            )
            more = f" (and {len(conflicts) - _MAX_QUOTED} more)" if len(conflicts) > _MAX_QUOTED else ""
            raise BiosphereConflict(
                f"Import stopped, nothing was changed: {len(conflicts)} flow(s) in this project's "
                f"'{self.bio_db_name}' have the same code as a flow in this ecoinvent release but a "
                f"different name, unit or categories: {quoted}{more}. Adding the release's flows to it "
                "would mix two definitions of the same flow. Import this release into a new project."
            )
        if missing:
            self.flows_added = _add_flows(self.bio_db_name, missing)

    # ── around the import ────────────────────────────────────────────────────

    def count_found(self, data: list[dict]) -> None:
        """Biosphere exchanges as extracted, before any strategy ran."""
        self.exchanges_found = _count(data)

    def after_strategies(self, data: list[dict]) -> None:
        """What the strategies removed on purpose is what is gone now."""
        self.dropped_by_design = self.exchanges_found - _count(data)

    def drop_unlinked(self, data: list[dict]) -> None:
        """Remove (and count) biosphere exchanges that still have no flow, so
        the write cannot fail on them and nothing leaves unrecorded."""
        linked = dropped = 0
        examples: list[str] = []
        for ds in data:
            keep = []
            for exc in ds.get("exchanges", []):
                if exc.get("type") != "biosphere":
                    keep.append(exc)
                elif exc.get("input"):
                    linked += 1
                    keep.append(exc)
                else:
                    dropped += 1
                    if len(examples) < _MAX_QUOTED and exc.get("name") not in examples:
                        examples.append(str(exc.get("name")))
            ds["exchanges"] = keep
        self.exchanges_linked = linked
        self.exchanges_dropped = dropped
        self.dropped_examples = examples

    def after_write(self, db_name: str) -> None:
        """What the database now holds, read back, to check the counts above."""
        import bw2data
        from bw2data.backends.peewee import ExchangeDataset

        self.exchanges_stored = (
            ExchangeDataset.select()
            .where(ExchangeDataset.output_database == db_name, ExchangeDataset.type == "biosphere")
            .count()
        ) if db_name in bw2data.databases else None

    # ── what the user sees ───────────────────────────────────────────────────

    @property
    def warning(self) -> str:
        if not self.exchanges_dropped:
            return ""
        pct = 100 * self.exchanges_dropped / max(self.exchanges_found, 1)
        eg = f" Examples: {', '.join(self.dropped_examples)}." if self.dropped_examples else ""
        return (
            f"WARNING: {self.exchanges_dropped:,} of {self.exchanges_found:,} biosphere exchanges "
            f"({pct:.2f}%) were dropped because their flow is not in '{self.bio_db_name}'. "
            f"Results for the affected activities miss those emissions.{eg}"
        )

    @property
    def message(self) -> str:
        if not self.coverage_checked:
            checked = "Biosphere coverage was not checked (ElementaryExchanges.xml not found). "
        else:
            checked = f"{self.flows_added:,} flows added to '{self.bio_db_name}'. "
        tail = (
            f"Biosphere exchanges: {self.exchanges_found:,} found, {self.dropped_by_design:,} dropped by "
            f"design, {self.exchanges_linked:,} linked, {self.exchanges_dropped:,} dropped."
        )
        return f"{checked}{tail}" + (f" {self.warning}" if self.warning else "")

    def summary(self) -> dict:
        out = asdict(self)
        out["warning"] = self.warning
        out["message"] = self.message
        return out


def _count(data: list[dict]) -> int:
    return sum(1 for ds in data for exc in ds.get("exchanges", []) if exc.get("type") == "biosphere")


def _add_flows(bio_db_name: str, flows: list[dict]) -> int:
    """Insert ``flows`` into the existing ``biosphere3``. Only inserts: each flow
    is a new row, no existing row is read back, rewritten or removed, and the
    insert is one transaction so a failure leaves ``biosphere3`` as it was."""
    import bw2data
    from bw2data.backends.peewee import sqlite3_lci_db

    bio = bw2data.Database(bio_db_name)
    with sqlite3_lci_db.atomic():
        for ds in flows:
            fields = {k: v for k, v in ds.items() if k not in ("code", "database", "exchanges")}
            bio.new_activity(ds["code"], **fields).save()
    # Refresh the derived arrays (flow ids -> matrix rows); it re-reads, it does
    # not rewrite, the flows.
    bio.process()
    return len(flows)
