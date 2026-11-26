# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Install ecoinvent's own LCIA implementation workbook, linked by flow UUID.

ecoinvent publishes, per release, an ``LCIA Implementation <version>.xlsx``
with three sheets: ``Read me`` (the release in a "Database Version" row),
``CFs`` (Method, Category, Indicator, Name, Compartment, Subcompartment, CF)
and ``Indicators`` (Method, Category, Indicator, Unit). The CFs sheet has NO
flow UUID: a flow is named by name + compartment + subcompartment, in that
release's vocabulary.

A project's ``biosphere3`` can carry an older release's names under the SAME
UUIDs (398 of 4,362 flows renamed between 3.9 and 3.10, e.g. "Methane,
dichloro-, HCC-30" became "Dichloromethane"), so linking by name drops those
factors silently: 83.4 % linked on a real 3.10 project, against 97.8 % by UUID.

So the link goes through the release's master data, ``ElementaryExchanges.xml``,
which the user supplies from their own ecoinvent download:

    (name, compartment, subcompartment)  → exact →  UUID  → exact →  biosphere3 code

**Exact only, both steps.** No case folding, no prefix, no fuzzy match:
"Anilazine" is not "Aniline". A subcompartment of ``unspecified`` is the flow
whose master-data subcompartment is ``unspecified`` (biosphere3 categories
``(compartment,)``); it is never spread over the other subcompartments.

**Version consistency is refused, not warned.** The workbook names its release;
the project's ecoinvent database names its release; the master data names
NONE (its header carries only a revision counter). The master data is
therefore checked by content: every flow the workbook names must resolve in
it. Measured: a 3.10 workbook resolves 100 % in the 3.10 master data and
99.62 % in the 3.11 one, so anything short of all of them means another
release and is refused.

**Nothing in the project is modified except the new methods.** biosphere3 is
only read. A method is installed NEXT TO the existing ones, under a tuple whose
first element carries ``TAG`` (``"ReCiPe 2016 v1.03, midpoint (H) [ecoinvent
3.10 LCIA]"``), and an install that would reuse a registered tuple is refused
whole. A per-project manifest records exactly what was registered, so
Uninstall removes only those.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

import bw2data

from mapper.core import lcia_method_engine as lme

BIOSPHERE = "biosphere3"
INSTALLER = "ecoinvent_lcia"
NS = "{http://www.EcoInvent.org/EcoSpold02}"
UNSPECIFIED = "unspecified"

SHEET_README = "Read me"
SHEET_CFS = "CFs"
SHEET_INDICATORS = "Indicators"
CF_COLUMNS = ["Method", "Category", "Indicator", "Name", "Compartment", "Subcompartment", "CF"]
INDICATOR_COLUMNS = ["Method", "Category", "Indicator"]
UNIT_COLUMNS = ("Unit", "Indicator Unit")  # the Read me says "Unit"; the 3.10 file's header is "Indicator Unit"

MAX_WORKBOOK_BYTES = 64 * 1024 * 1024
MAX_MASTER_DATA_BYTES = 64 * 1024 * 1024

#: Skip reasons. A factor the workbook names but the master data lacks is not
#: a reason: it refuses the whole file (another release).
NOT_IN_BIOSPHERE = "not_in_biosphere3"
COMPARTMENT_DIFFERS = "biosphere3_compartment_differs"
CONFLICTING_DUPLICATE = "conflicting_duplicate"
SKIP_REASONS = {
    NOT_IN_BIOSPHERE: "the flow's UUID is not in this project's biosphere3 (a flow newer than the project's biosphere)",
    COMPARTMENT_DIFFERS: "biosphere3 holds this UUID under a different compartment",
    CONFLICTING_DUPLICATE: "the workbook gives the same flow two different factors for this indicator",
}

Method = tuple[str, ...]


class EcoinventFileError(lme.InstallError):
    """The workbook, the master data or the project cannot be used. The message says why."""


def tag(version: str) -> str:
    return f"[ecoinvent {version} LCIA]"


def tagged(method: Iterable[str], version: str) -> Method:
    """The tuple an installed method gets: the family carries the tag, the rest is verbatim."""
    t = tuple(method)
    return (f"{t[0]} {tag(version)}", *t[1:])


def method_id(version: str) -> str:
    return f"{INSTALLER}_{version.replace('.', '_')}"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ── The workbook ─────────────────────────────────────────────────────────────


@dataclass
class LCIAWorkbook:
    file_name: str
    sha256: str
    version: str
    units: dict[Method, str]
    #: (method, name, compartment, subcompartment, cf), in sheet order
    factors: list[tuple[Method, str, str, str, float]]


def looks_like_ecoinvent_lcia(sheet_names: Iterable[str]) -> bool:
    names = set(sheet_names)
    return {SHEET_CFS, SHEET_INDICATORS}.issubset(names)


def _text(v) -> str:
    return "" if v is None else str(v).strip()


def _header(ws, wanted: list[str], sheet: str) -> list[str]:
    row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ())
    header = [_text(c) for c in row]
    missing = [c for c in wanted if c not in header]
    if missing:
        raise EcoinventFileError(
            f"The '{sheet}' sheet has no column {', '.join(repr(m) for m in missing)}. "
            f"Expected the columns {', '.join(wanted)}."
        )
    return header


def _version_from_readme(ws) -> str:
    for row in ws.iter_rows(values_only=True):
        cells = [_text(c) for c in row]
        if cells and cells[0].lower() == "database version":
            value = next((c for c in cells[1:] if c), "")
            m = re.match(r"^\s*(\d+)\.(\d+)\b", value)
            if not m:
                raise EcoinventFileError(f"The 'Read me' sheet gives the database version as {value!r}, which is not a release number.")
            return f"{m.group(1)}.{m.group(2)}"
    raise EcoinventFileError("The 'Read me' sheet has no 'Database Version' row, so the release of this file is unknown.")


def read_workbook(path: Path, file_name: str | None = None) -> LCIAWorkbook:
    """Read and check an ecoinvent LCIA implementation workbook. Raises with a reason."""
    import openpyxl

    path = Path(path)
    if path.stat().st_size > MAX_WORKBOOK_BYTES:
        raise EcoinventFileError(f"The workbook is larger than {MAX_WORKBOOK_BYTES // (1024 * 1024)} MB.")
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise EcoinventFileError(f"Could not open the workbook: {str(exc) or type(exc).__name__}.") from exc
    try:
        missing = [s for s in (SHEET_README, SHEET_CFS, SHEET_INDICATORS) if s not in wb.sheetnames]
        if missing:
            raise EcoinventFileError(
                f"This is not an ecoinvent LCIA implementation workbook: it has no {', '.join(repr(s) for s in missing)} "
                f"sheet (it has {', '.join(repr(s) for s in wb.sheetnames)})."
            )
        version = _version_from_readme(wb[SHEET_README])

        ws = wb[SHEET_INDICATORS]
        header = _header(ws, INDICATOR_COLUMNS, SHEET_INDICATORS)
        unit_col = next((c for c in UNIT_COLUMNS if c in header), None)
        if unit_col is None:
            raise EcoinventFileError("The 'Indicators' sheet has no 'Unit' column.")
        ix = [header.index(c) for c in INDICATOR_COLUMNS] + [header.index(unit_col)]
        units: dict[Method, str] = {}
        for n, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            vals = [_text(row[i]) if i < len(row) else "" for i in ix]
            if not any(vals[:3]):
                continue
            t = tuple(vals[:3])
            if not all(t):
                raise EcoinventFileError(f"'Indicators' row {n} has an empty Method, Category or Indicator.")
            if t in units and units[t] != vals[3]:
                raise EcoinventFileError(f"'Indicators' gives {' / '.join(t)} two units: {units[t]!r} and {vals[3]!r}.")
            units[t] = vals[3]

        ws = wb[SHEET_CFS]
        header = _header(ws, CF_COLUMNS, SHEET_CFS)
        ix = [header.index(c) for c in CF_COLUMNS]
        factors: list[tuple[Method, str, str, str, float]] = []
        for n, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            vals = [row[i] if i < len(row) else None for i in ix]
            if all(v is None or _text(v) == "" for v in vals):
                continue
            m, cat, ind, name, comp, sub = (_text(v) for v in vals[:6])
            if not (m and cat and ind and name and comp):
                raise EcoinventFileError(f"'CFs' row {n} has an empty Method, Category, Indicator, Name or Compartment.")
            raw = vals[6]
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                try:
                    cf = float(_text(raw))
                except ValueError:
                    raise EcoinventFileError(f"'CFs' row {n} has a CF that is not a number: {raw!r}.") from None
            else:
                cf = float(raw)
            t = (m, cat, ind)
            if t not in units:
                raise EcoinventFileError(f"'CFs' row {n} names the indicator {' / '.join(t)}, which 'Indicators' does not list.")
            factors.append((t, name, comp, sub or UNSPECIFIED, cf))
    finally:
        wb.close()
    if not factors:
        raise EcoinventFileError("The 'CFs' sheet has no characterisation factors.")
    return LCIAWorkbook(file_name=file_name or path.name, sha256=sha256_of(path), version=version,
                        units=units, factors=factors)


# ── The master data ──────────────────────────────────────────────────────────


@dataclass
class MasterData:
    file_name: str
    sha256: str
    #: (name, compartment, subcompartment) -> UUID
    by_triple: dict[tuple[str, str, str], str]
    #: UUID -> (compartment, subcompartment)
    compartments: dict[str, tuple[str, str]]


def read_master_data(path: Path, file_name: str | None = None) -> MasterData:
    """Read ``ElementaryExchanges.xml`` (EcoSpold02 master data). Raises with a reason."""
    path = Path(path)
    if path.stat().st_size > MAX_MASTER_DATA_BYTES:
        raise EcoinventFileError(f"The master data file is larger than {MAX_MASTER_DATA_BYTES // (1024 * 1024)} MB.")
    with path.open("rb") as fh:
        head = fh.read(4096)
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise EcoinventFileError("The master data file declares a DOCTYPE or entities, which ElementaryExchanges.xml never does.")
    by_triple: dict[tuple[str, str, str], str] = {}
    compartments: dict[str, tuple[str, str]] = {}
    ambiguous: set[tuple[str, str, str]] = set()
    root_tag = None
    try:
        for event, el in ET.iterparse(path, events=("start", "end")):
            if event == "start":
                if root_tag is None:
                    root_tag = el.tag
                continue
            if el.tag != NS + "elementaryExchange":
                continue
            uuid = (el.get("id") or "").strip()
            name = _text(el.findtext(NS + "name"))
            comp_el = el.find(NS + "compartment")
            comp = _text(comp_el.findtext(NS + "compartment")) if comp_el is not None else ""
            sub = (_text(comp_el.findtext(NS + "subcompartment")) if comp_el is not None else "") or UNSPECIFIED
            el.clear()
            if not (uuid and name and comp):
                continue
            key = (name, comp, sub)
            if key in by_triple and by_triple[key] != uuid:
                ambiguous.add(key)
            by_triple[key] = uuid
            compartments[uuid] = (comp, sub)
    except ET.ParseError as exc:
        raise EcoinventFileError(f"The master data file is not valid XML: {exc}.") from exc
    if root_tag != NS + "validElementaryExchanges":
        raise EcoinventFileError(
            "This is not ecoinvent's ElementaryExchanges.xml (EcoSpold02 master data): "
            f"its root element is {root_tag!r}."
        )
    for key in ambiguous:
        by_triple.pop(key, None)  # two UUIDs for one name: neither is linked by guessing
    if not by_triple:
        raise EcoinventFileError("The master data file lists no elementary exchanges.")
    return MasterData(file_name=file_name or path.name, sha256=sha256_of(path),
                      by_triple=by_triple, compartments=compartments)


# ── The project ──────────────────────────────────────────────────────────────


def _norm_cats(cats) -> tuple[str, ...]:
    return tuple(str(c) for c in (cats or ()))


def biosphere_index(database: str = BIOSPHERE) -> dict[str, tuple[str, ...]]:
    """``{code: categories}`` of the project's biosphere. Read only."""
    if database not in bw2data.databases:
        raise EcoinventFileError(
            f"This project has no '{database}', so there is nothing to link the factors to. "
            "Import an ecoinvent database into the project first."
        )
    from bw2data.backends.peewee import ActivityDataset

    out: dict[str, tuple[str, ...]] = {}
    for row in ActivityDataset.select(ActivityDataset.code, ActivityDataset.data).where(ActivityDataset.database == database):
        out[row.code] = _norm_cats((row.data or {}).get("categories"))
    if not out:
        raise EcoinventFileError(f"'{database}' in this project is empty, so there is nothing to link the factors to.")
    return out


def used_biosphere_codes(database: str = BIOSPHERE) -> set[str]:
    """Codes of ``database`` that some exchange in the project points at. Read only."""
    from bw2data.backends.peewee import ExchangeDataset

    q = (ExchangeDataset.select(ExchangeDataset.input_code)
         .where(ExchangeDataset.input_database == database).distinct())
    return {r.input_code for r in q}


def project_version(override: str | None = None) -> str:
    detected = lme.detect_ecoinvent_version()
    if detected is not None:
        return detected
    if override:
        return override
    raise EcoinventFileError(
        "Could not tell which ecoinvent release this project holds (no ecoinvent database, or more than one "
        "release). Pass the release explicitly."
    )


def check_versions(workbook: LCIAWorkbook, master: MasterData, project: str) -> None:
    """Refuse any mismatch between the workbook, the master data and the project."""
    if workbook.version != project:
        raise EcoinventFileError(
            f"The workbook is the ecoinvent {workbook.version} LCIA implementation, but this project holds "
            f"ecoinvent {project}. Use the {project} file."
        )
    missing = {(name, comp, sub) for _, name, comp, sub, _ in workbook.factors} - set(master.by_triple)
    if missing:
        sample = "; ".join(f"{n} ({c} / {s})" for n, c, s in sorted(missing)[:5])
        raise EcoinventFileError(
            f"{len(missing)} flows the workbook names are not in this master data, so it is not the "
            f"ecoinvent {workbook.version} ElementaryExchanges.xml (or the names differ). For example: {sample}."
        )


# ── Linking ──────────────────────────────────────────────────────────────────


@dataclass
class LinkedMethod:
    method: Method
    unit: str
    cfs: list[tuple[tuple[str, str], float]] = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)
    #: (reason, name, compartment, subcompartment, uuid or "")
    skipped_flows: list[tuple[str, str, str, str, str]] = field(default_factory=list)

    @property
    def factors(self) -> int:
        return len(self.cfs) + sum(self.skipped.values())


def link(workbook: LCIAWorkbook, master: MasterData, biosphere: dict[str, tuple[str, ...]],
         database: str = BIOSPHERE) -> dict[Method, LinkedMethod]:
    """Link every factor by UUID. Pure: reads its inputs, writes nothing.

    Call ``check_versions`` first; a factor whose flow the master data lacks
    raises here too rather than being skipped.
    """
    per: dict[Method, dict[str, list]] = defaultdict(dict)
    out: dict[Method, LinkedMethod] = {}
    for method, name, comp, sub, cf in workbook.factors:
        out.setdefault(method, LinkedMethod(method=method, unit=workbook.units[method]))
        uuid = master.by_triple.get((name, comp, sub))
        if uuid is None:
            raise EcoinventFileError(f"{name} ({comp} / {sub}) is not in the master data.")
        seen = per[method].get(uuid)
        if seen is not None:
            seen[1].append(cf)
            continue
        per[method][uuid] = [(name, comp, sub), [cf]]
    for method, flows in per.items():
        lm = out[method]
        for uuid, ((name, comp, sub), values) in flows.items():
            if len(set(values)) > 1:
                reason = CONFLICTING_DUPLICATE
            elif uuid not in biosphere:
                reason = NOT_IN_BIOSPHERE
            elif biosphere[uuid] != ((comp,) if sub == UNSPECIFIED else (comp, sub)):
                reason = COMPARTMENT_DIFFERS
            else:
                lm.cfs.append(((database, uuid), values[0]))
                continue
            lm.skipped[reason] += 1
            lm.skipped_flows.append((reason, name, comp, sub, uuid))
    return out


# ── Preview ──────────────────────────────────────────────────────────────────


def prepare(workbook_path: Path, master_path: Path, *, workbook_name: str | None = None,
            master_name: str | None = None, ecoinvent_version: str | None = None,
            database: str = BIOSPHERE):
    workbook = read_workbook(workbook_path, workbook_name)
    master = read_master_data(master_path, master_name)
    check_versions(workbook, master, project_version(ecoinvent_version))
    return workbook, master, link(workbook, master, biosphere_index(database), database)


def preview(workbook: LCIAWorkbook, master: MasterData, linked: dict[Method, LinkedMethod],
            database: str = BIOSPHERE) -> dict:
    """What an install would do, grouped by family. Writes nothing."""
    used = used_biosphere_codes(database)
    families: dict[str, list[dict]] = defaultdict(list)
    totals = Counter()
    skipped_used_total: set[str] = set()
    for method, lm in linked.items():
        used_skipped = {f[4] for f in lm.skipped_flows if f[4] in used}
        skipped_used_total |= used_skipped
        new = tagged(method, workbook.version)
        families[method[0]].append({
            "method": list(method),
            "installs_as": list(new),
            "unit": lm.unit,
            "factors": lm.factors,
            "linked": len(lm.cfs),
            "skipped": dict(lm.skipped),
            "skipped_used_by_project": len(used_skipped),
            "already_installed": new in bw2data.methods,
        })
        totals.update(factors=lm.factors, linked=len(lm.cfs), skipped=sum(lm.skipped.values()))
    skipped_flows = sorted({(r, n, c, s, u) for lm in linked.values() for r, n, c, s, u in lm.skipped_flows})
    return {
        "file_name": workbook.file_name,
        "sha256": workbook.sha256,
        "ecoinvent_version": workbook.version,
        "master_data_file_name": master.file_name,
        "master_data_sha256": master.sha256,
        "tag": tag(workbook.version),
        "method_id": method_id(workbook.version),
        "totals": {**dict(totals), "skipped_used_by_project": len(skipped_used_total), "methods": len(linked)},
        "skip_reasons": SKIP_REASONS,
        "families": [
            {"family": fam, "installs_as": f"{fam} {tag(workbook.version)}", "methods": rows,
             "factors": sum(r["factors"] for r in rows), "linked": sum(r["linked"] for r in rows)}
            for fam, rows in families.items()
        ],
        "skipped_flows": [
            {"reason": r, "name": n, "compartment": c, "subcompartment": s, "uuid": u, "used_by_project": u in used}
            for r, n, c, s, u in skipped_flows
        ],
    }


# ── Install / uninstall ──────────────────────────────────────────────────────


def install(workbook: LCIAWorkbook, master: MasterData, linked: dict[Method, LinkedMethod],
            methods: Iterable[Iterable[str]], on_progress: lme.ProgressCallback | None = None) -> lme.InstallResult:
    """Register the selected methods under their tagged tuples. Never overwrites.

    ``methods`` are the workbook's own tuples (untagged). The whole install is
    refused if any selected method is unknown, already registered under its
    tagged tuple, or would link no factor.
    """
    chosen = [tuple(m) for m in methods]
    if not chosen:
        raise EcoinventFileError("No methods were selected.")
    unknown = [m for m in chosen if m not in linked]
    if unknown:
        raise EcoinventFileError(f"The workbook has no method {' / '.join(unknown[0])}.")
    targets = [(m, tagged(m, workbook.version)) for m in dict.fromkeys(chosen)]
    present = [t for _, t in targets if t in bw2data.methods]
    if present:
        raise EcoinventFileError(
            f"{len(present)} of the selected methods are already in this project (for example "
            f"{' / '.join(present[0])}). Nothing was installed; uninstall them first to reinstall."
        )
    empty = [m for m, _ in targets if not linked[m].cfs]
    if empty:
        raise EcoinventFileError(f"No factor of {' / '.join(empty[0])} links to this project's biosphere3, so nothing was installed.")

    registered: list[Method] = []
    try:
        for i, (orig, new) in enumerate(targets):
            lme._emit(on_progress, f"writing {' / '.join(new[1:])}", 0.05 + 0.9 * i / len(targets))
            lm = linked[orig]
            m = bw2data.Method(new)
            m.register(
                unit=lm.unit,
                description=(f"{' / '.join(orig)}, from the ecoinvent {workbook.version} LCIA implementation file, "
                             f"linked to biosphere3 by flow UUID through the release's ElementaryExchanges.xml."),
                filename=workbook.file_name,
                sha256=workbook.sha256,
                ecoinvent_version=workbook.version,
                master_data_sha256=master.sha256,
                source_method=list(orig),
            )
            registered.append(new)
            m.write(lm.cfs)
    except BaseException:
        for t in registered:
            if t in bw2data.methods:
                try:
                    del bw2data.methods[t]
                except Exception:  # noqa: BLE001 - best effort; the original error matters
                    pass
        raise

    mid = method_id(workbook.version)
    manifest = lme._read_manifest(mid) or {}
    projects = dict(manifest.get("projects") or {})
    here = str(bw2data.projects.current)
    previous = [tuple(t) for t in (projects.get(here) or {}).get("method_tuples", []) if tuple(t) in bw2data.methods]
    projects[here] = {
        "method_tuples": [list(t) for t in dict.fromkeys(previous + registered)],
        "file_name": workbook.file_name,
        "sha256": workbook.sha256,
        "master_data_file_name": master.file_name,
        "master_data_sha256": master.sha256,
    }
    lme._write_manifest(mid, {"method_id": mid, "installer": INSTALLER, "ecoinvent_version": workbook.version,
                              "projects": projects})
    skipped = sum(sum(linked[m].skipped.values()) for m, _ in targets)
    factors = sum(linked[m].factors for m, _ in targets)
    warnings = []
    if skipped:
        warnings.append(f"{skipped:,} of {factors:,} factors were skipped; the preview lists each with its reason.")
    lme._emit(on_progress, "done", 1.0)
    return lme.InstallResult(method_id=mid, method_tuples=registered, warnings=warnings,
                             report={"factors": factors, "linked": factors - skipped, "skipped": skipped})
