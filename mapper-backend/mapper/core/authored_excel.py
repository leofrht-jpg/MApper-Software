# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Authored databases through Excel: a template, an export, and an all-or-nothing import.

The workbook is only a different way to hand the SAME inputs to the SAME engine. Nothing here
validates a rule of its own: an exchange is checked by ``authored_engine.resolve_exchange``, an
activity by ``build_activity``, the database name by ``validate_database_name``. What this module
adds is the plumbing around them: reading cells safely, resolving a flow from its name and
compartment, attributing each engine verdict to a sheet, row and column, and refusing the whole
file if there is a single error.

Sheets: ``Read me``, ``Database``, ``Activities``, ``Exchanges``, ``Lists``.

What the workbook does not carry, because the stored model has no field for it: an activity
description and an exchange comment (an activity's ``comment`` and the database description are
carried). Activity codes are minted new on import, so BOM links point at the new database.

Safety: the file is size-checked and its zip structure inspected before it is parsed, rows are
capped, formulas are rejected (never evaluated), and on export any text that starts with ``=``,
``+``, ``-`` or ``@`` is prefixed with an apostrophe so a spreadsheet cannot run it; import removes
exactly that prefix, so the round trip is exact.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import ValidationError

from mapper.core import authored_engine as eng
from mapper.core.bom_validator import _canonical_unit
from mapper.core.pedigree import INDICATORS
from mapper.models.authored_schemas import (
    ActivityInput,
    AuthoredActivity,
    AuthoredDatabase,
    AuthoredDefinitions,
    ExchangeInput,
)

TEMPLATE_VERSION = "1"

SHEET_README = "Read me"
SHEET_DB = "Database"
SHEET_ACT = "Activities"
SHEET_EXC = "Exchanges"
SHEET_LISTS = "Lists"

#: Limits. A real inventory is a few hundred exchanges; these are generous and stop a hostile file.
MAX_BYTES = 5 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_ZIP_MEMBERS = 100
MAX_RATIO = 100            # uncompressed / compressed, for a member larger than 1 MiB
MAX_ROWS = 5000            # per data sheet
MAX_CELL_CHARS = 5000
MAX_REPORTED_ERRORS = 500

#: Pedigree indicator (engine key) -> Exchanges column.
PEDIGREE_COLUMNS: dict[str, str] = {
    "reliability": "Pedigree reliability",
    "completeness": "Pedigree completeness",
    "temporal correlation": "Pedigree temporal correlation",
    "geographical correlation": "Pedigree geographical correlation",
    "further technological correlation": "Pedigree further technological correlation",
}
assert tuple(PEDIGREE_COLUMNS) == INDICATORS

DB_COLUMNS = ["Name", "Description"]
ACT_COLUMNS = ["Activity key", "Name", "Location", "Unit", "Reference product", "Scope", "Scope note",
               "Complete indicators", "Comment"]
EXC_COLUMNS = ["Activity key", "Flow database", "Flow code", "Flow name", "Compartment", "Amount", "Unit",
               *PEDIGREE_COLUMNS.values(), "Uncertainty basis", "Basic variance", "Basic variance reason",
               "Floor reason"]

_REQUIRED = {
    SHEET_DB: ["Name"],
    SHEET_ACT: ["Activity key", "Name", "Unit", "Scope"],
    SHEET_EXC: ["Activity key", "Amount", *PEDIGREE_COLUMNS.values()],
}
#: Columns that exist in other tools' workbooks and that this one cannot store.
_UNSUPPORTED = {SHEET_ACT: ["Description"], SHEET_EXC: ["Comment", "Comments"]}

EXAMPLE_PREFIX = "EXAMPLE"
SCOPES = ("complete", "partial")
BASES = ("ecoinvent", "supplied")


class WorkbookRejected(ValueError):
    """The file cannot be read as a workbook at all (not xlsx, too big, a zip bomb)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class CellError:
    sheet: str
    row: int | None
    column: str | None
    message: str
    code: str = "invalid"

    def as_dict(self) -> dict:
        return {"sheet": self.sheet, "row": self.row, "column": self.column, "code": self.code,
                "message": self.message}


# ── Text safety ──────────────────────────────────────────────────────────────

_TRIGGER = r"[=+\-@\t\r]"
_NEEDS_PREFIX = re.compile(rf"^'*{_TRIGGER}")
_HAS_PREFIX = re.compile(rf"^'+{_TRIGGER}")


def neutralise(value: Any) -> Any:
    """Text a spreadsheet could run as a formula gets one leading apostrophe. Injective: a value
    that already starts with apostrophes before a trigger gets one more, so ``restore`` is exact."""
    if isinstance(value, str) and _NEEDS_PREFIX.match(value):
        return "'" + value
    return value


def restore(value: Any) -> Any:
    """Undo ``neutralise``: drop exactly one apostrophe when apostrophes precede a trigger."""
    if isinstance(value, str) and _HAS_PREFIX.match(value):
        return value[1:]
    return value


# ── The file ─────────────────────────────────────────────────────────────────


def check_file(data: bytes) -> None:
    """Refuse what is not a plausible xlsx BEFORE openpyxl sees it."""
    if len(data) > MAX_BYTES:
        raise WorkbookRejected(f"The file is {len(data) / 1e6:.1f} MB; the limit is {MAX_BYTES // (1024 * 1024)} MB.", 413)
    if not data:
        raise WorkbookRejected("The file is empty.")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise WorkbookRejected("This is not an Excel .xlsx workbook (it is not a valid zip file).") from exc
    with zf:
        infos = zf.infolist()
        names = {i.filename for i in infos}
        if "xl/workbook.xml" not in names or "[Content_Types].xml" not in names:
            raise WorkbookRejected("This is not an Excel .xlsx workbook (the workbook parts are missing).")
        if len(infos) > MAX_ZIP_MEMBERS:
            raise WorkbookRejected(f"The workbook has {len(infos)} internal parts; the limit is {MAX_ZIP_MEMBERS}.")
        total = sum(i.file_size for i in infos)
        if total > MAX_UNCOMPRESSED_BYTES:
            raise WorkbookRejected("The workbook expands to far more data than a database definition needs; refused.", 413)
        for i in infos:
            if i.file_size > 1024 * 1024 and i.compress_size and i.file_size / i.compress_size > MAX_RATIO:
                raise WorkbookRejected("The workbook contains a part with an implausible compression ratio; refused.", 413)


@dataclass
class Sheet:
    name: str
    headers: dict[str, int]                       # header (casefolded) -> column index (1-based)
    header_names: list[str]
    rows: list[tuple[int, dict[str, Any]]]        # (excel row number, {column name: value})


def _cell_value(cell, errors: list[CellError], sheet: str, row: int, column: str) -> Any:
    v = cell.value
    if getattr(cell, "data_type", None) == "f":
        errors.append(CellError(sheet, row, column, "This cell holds a formula. Formulas are not accepted; paste the value instead.", "formula"))
        return None
    if isinstance(v, str):
        v = v.strip()
        if len(v) > MAX_CELL_CHARS:
            errors.append(CellError(sheet, row, column, f"Text longer than {MAX_CELL_CHARS} characters.", "too_long"))
            return None
        v = restore(v)
        return v or None
    return v


def read_sheets(data: bytes) -> tuple[dict[str, Sheet], list[CellError], list[str]]:
    """The data sheets as plain values, plus file-level cell errors and warnings.

    Formulas are never evaluated: a cell of type formula is reported and read as empty.
    """
    check_file(data)
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=False, keep_links=False)
    except Exception as exc:
        raise WorkbookRejected(f"The workbook could not be read: {exc}") from exc
    errors: list[CellError] = []
    warnings: list[str] = []
    sheets: dict[str, Sheet] = {}
    try:
        for name in (SHEET_DB, SHEET_ACT, SHEET_EXC):
            if name not in wb.sheetnames:
                errors.append(CellError(name, None, None, f"The workbook has no '{name}' sheet.", "missing_sheet"))
                continue
            ws = wb[name]
            it = ws.iter_rows()
            header_cells = next(it, None)
            if not header_cells:
                errors.append(CellError(name, 1, None, "The sheet is empty: the first row must hold the column headers.", "no_header"))
                continue
            header_names = [str(c.value).strip() if c.value is not None else "" for c in header_cells]
            headers: dict[str, int] = {}
            for i, h in enumerate(header_names, start=1):
                if h and h.casefold() not in headers:
                    headers[h.casefold()] = i
            for req in _REQUIRED[name]:
                if req.casefold() not in headers:
                    errors.append(CellError(name, 1, req, f"The required column '{req}' is missing from the header row.", "missing_column"))
            known = {c.casefold() for c in {SHEET_DB: DB_COLUMNS, SHEET_ACT: ACT_COLUMNS, SHEET_EXC: EXC_COLUMNS}[name]}
            for h in header_names:
                if h and h.casefold() not in known:
                    if h.casefold() in {u.casefold() for u in _UNSUPPORTED.get(name, [])}:
                        warnings.append(f"{name}: the '{h}' column is not supported yet and was ignored.")
                    else:
                        warnings.append(f"{name}: the column '{h}' is not recognised and was ignored.")
            rows: list[tuple[int, dict[str, Any]]] = []
            n = 1
            for cells in it:
                n += 1
                if n > MAX_ROWS + 1:
                    raise WorkbookRejected(f"The '{name}' sheet has more than {MAX_ROWS} rows.", 413)
                values: dict[str, Any] = {}
                empty = True
                for col_name, idx in ((h, headers[h.casefold()]) for h in header_names if h and h.casefold() in headers):
                    if idx - 1 >= len(cells):
                        continue
                    v = _cell_value(cells[idx - 1], errors, name, n, col_name)
                    if v is not None:
                        empty = False
                    values[col_name] = v
                # a row of only formulas / blanks still counts as non-empty when it raised an error
                if empty and not any(e.sheet == name and e.row == n for e in errors):
                    continue
                rows.append((n, values))
            sheets[name] = Sheet(name, headers, header_names, rows)
        if SHEET_README in wb.sheetnames:
            for cells in wb[SHEET_README].iter_rows(max_row=60):
                vals = [c.value for c in cells[:2]]
                if vals and isinstance(vals[0], str) and vals[0].strip().casefold() == "template version":
                    ver = str(vals[1]).strip() if len(vals) > 1 and vals[1] is not None else ""
                    if ver and ver != TEMPLATE_VERSION:
                        errors.append(CellError(SHEET_README, None, "Template version",
                                                f"This workbook is template version {ver}; this MApper reads version {TEMPLATE_VERSION}.",
                                                "template_version"))
    finally:
        wb.close()
    if len(errors) > MAX_REPORTED_ERRORS:
        extra = len(errors) - MAX_REPORTED_ERRORS
        errors = errors[:MAX_REPORTED_ERRORS] + [CellError("(file)", None, None, f"... and {extra} more errors.", "truncated")]
    return sheets, errors, warnings


# ── Cell parsing helpers ─────────────────────────────────────────────────────


def _number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _score(v: Any) -> int | None:
    x = _number(v)
    if x is None or x != int(x) or not 1 <= int(x) <= 5:
        return None
    return int(x)


def _text(v: Any) -> str | None:
    if v is None:
        return None
    return v if isinstance(v, str) else (str(int(v)) if isinstance(v, float) and v == int(v) else str(v))


def parse_indicators(cell: str | None) -> list[list[str]]:
    """``a › b › c; d › e › f`` -> [[a, b, c], [d, e, f]]."""
    if not cell:
        return []
    out = []
    for part in cell.split(";"):
        p = part.strip()
        if p:
            out.append([x.strip() for x in p.split("›")])
    return out


def format_indicators(methods: Iterable[Iterable[str]]) -> str:
    return "; ".join(" › ".join(m) for m in methods)


def compartment_of(categories: Iterable[str]) -> str:
    return " / ".join(categories)


#: engine code -> the Exchanges column the verdict is about
_CODE_COLUMN = {
    "negative_amount": "Amount", "amount_not_positive": "Amount", "not_biosphere": "Flow database",
    "unknown_flow": "Flow code", "flow_type": "Flow code", "bv_not_settable": "Basic variance",
    "bv_required": "Basic variance", "bv_invalid": "Basic variance", "bv_reason_required": "Basic variance reason",
    "below_floor": "Floor reason", "floor_reason_not_applicable": "Floor reason",
}


# ── Plan ─────────────────────────────────────────────────────────────────────


@dataclass
class ImportPlan:
    errors: list[CellError] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    database: AuthoredDatabase | None = None
    preview: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors and self.database is not None


def _candidates(flows: list, limit: int = 8) -> str:
    shown = [f"{f.name} [{compartment_of(f.categories) or '(none)'}] code {f.code}" for f in flows[:limit]]
    more = f" (and {len(flows) - limit} more)" if len(flows) > limit else ""
    return "; ".join(shown) + more


def validate_workbook(
    data: bytes,
    backend: eng.Backend,
    defs: AuthoredDefinitions,
    *,
    name_override: str | None = None,
    code_factory: Callable[[], str] = eng.new_code,
) -> ImportPlan:
    """Parse and validate the whole workbook in memory. Writes NOTHING. Returns every error.

    ``backend.find_flows`` is used to resolve a flow from its name and compartment.
    """
    plan = ImportPlan()
    sheets, errors, plan.warnings = read_sheets(data)
    plan.errors.extend(errors)
    if any(e.code in ("missing_sheet", "no_header", "missing_column") for e in errors):
        return plan

    # ── Database ────────────────────────────────────────────────────────────
    db_rows = sheets[SHEET_DB].rows
    db_name: str | None = None
    description = ""
    if len(db_rows) != 1:
        plan.errors.append(CellError(SHEET_DB, 2, "Name", f"The Database sheet must hold exactly one row, found {len(db_rows)}.", "database_rows"))
    else:
        row_no, vals = db_rows[0]
        raw_name = (name_override or _text(vals.get("Name")) or "").strip()
        description = _text(vals.get("Description")) or ""
        try:
            db_name = eng.validate_database_name(raw_name, backend.installed(), defs)
        except eng.AuthoredError as err:
            for p in err.problems:
                plan.errors.append(CellError(SHEET_DB, row_no, "Name", p, "database_name"))

    # ── Activities ──────────────────────────────────────────────────────────
    acts: dict[str, dict] = {}
    seen_name_loc: dict[tuple[str, str], int] = {}
    for row_no, v in sheets[SHEET_ACT].rows:
        key = _text(v.get("Activity key"))
        if not key:
            plan.errors.append(CellError(SHEET_ACT, row_no, "Activity key", "An activity key is required: the Exchanges sheet uses it to say which activity an exchange belongs to.", "key_required"))
            continue
        if key.casefold().startswith(EXAMPLE_PREFIX.casefold()):
            plan.errors.append(CellError(SHEET_ACT, row_no, "Activity key", "This is an example row from the template. Delete it, or replace it with your own activity.", "example_row"))
            continue
        if key in acts:
            plan.errors.append(CellError(SHEET_ACT, row_no, "Activity key", f"The activity key '{key}' is used more than once (first on row {acts[key]['row']}).", "duplicate_key"))
            continue
        name = _text(v.get("Name"))
        unit = _text(v.get("Unit"))
        scope = (_text(v.get("Scope")) or "").casefold()
        if not name:
            plan.errors.append(CellError(SHEET_ACT, row_no, "Name", "The activity name is required.", "name_required"))
        if not unit:
            plan.errors.append(CellError(SHEET_ACT, row_no, "Unit", "The activity's unit is required (for example kilogram).", "unit_required"))
        if scope not in SCOPES:
            plan.errors.append(CellError(SHEET_ACT, row_no, "Scope", "The scope must be 'complete' or 'partial': say whether the listed flows are the whole inventory.", "scope_invalid"))
        scope_note = _text(v.get("Scope note"))
        if scope == "partial" and not scope_note:
            plan.errors.append(CellError(SHEET_ACT, row_no, "Scope note", "A partial inventory needs a scope note saying what it leaves out.", "scope_note_required"))
        indicators = parse_indicators(_text(v.get("Complete indicators")))
        if indicators and scope == "complete":
            plan.errors.append(CellError(SHEET_ACT, row_no, "Complete indicators", "Indicators declared complete apply only to a partial inventory; a complete one covers every indicator.", "indicators_on_complete"))
        loc = _text(v.get("Location")) or "GLO"
        if name:
            nl = (name, loc)
            if nl in seen_name_loc:
                plan.errors.append(CellError(SHEET_ACT, row_no, "Name", f"Two activities share the name '{name}' and the location '{loc}' (first on row {seen_name_loc[nl]}).", "duplicate_name"))
            else:
                seen_name_loc[nl] = row_no
        acts[key] = {"row": row_no, "name": name, "unit": unit, "location": loc, "scope": scope,
                     "scope_note": scope_note, "indicators": indicators, "comment": _text(v.get("Comment")) or "",
                     "reference": _text(v.get("Reference product")), "exchanges": [], "rows": 0}
    if not acts and not any(e.sheet == SHEET_ACT for e in plan.errors):
        plan.errors.append(CellError(SHEET_ACT, 2, None, "The Activities sheet has no activities.", "no_activities"))

    # ── Exchanges ───────────────────────────────────────────────────────────
    by_name = 0
    resolved_by_name: list[dict] = []
    find_flows = getattr(backend, "find_flows", None)
    for row_no, v in sheets[SHEET_EXC].rows:
        key = _text(v.get("Activity key"))
        if not key:
            plan.errors.append(CellError(SHEET_EXC, row_no, "Activity key", "An activity key is required.", "key_required"))
            continue
        if key.casefold().startswith(EXAMPLE_PREFIX.casefold()):
            plan.errors.append(CellError(SHEET_EXC, row_no, "Activity key", "This is an example row from the template. Delete it, or replace it with your own exchange.", "example_row"))
            continue
        if key not in acts:
            plan.errors.append(CellError(SHEET_EXC, row_no, "Activity key", f"No activity with the key '{key}' on the Activities sheet.", "unknown_activity"))
            continue
        acts[key]["rows"] += 1
        row_errors_before = len(plan.errors)

        fdb = _text(v.get("Flow database")) or "biosphere3"
        code = _text(v.get("Flow code"))
        fname = _text(v.get("Flow name"))
        comp = _text(v.get("Compartment"))
        resolved_from_name = False
        if not code:
            if not fname:
                plan.errors.append(CellError(SHEET_EXC, row_no, "Flow code", "Give the Flow code, or the Flow name and Compartment to look it up.", "flow_required"))
            elif find_flows is None:
                plan.errors.append(CellError(SHEET_EXC, row_no, "Flow name", "Looking a flow up by name is not available here; give the Flow code.", "no_lookup"))
            else:
                matches = find_flows(fdb, fname, comp)
                if len(matches) == 1:
                    code = matches[0].code
                    resolved_from_name = True
                elif not matches:
                    near = find_flows(fdb, fname, None)
                    hint = f" Flows with that name: {_candidates(near)}." if near else ""
                    plan.errors.append(CellError(SHEET_EXC, row_no, "Flow name", f"No flow in '{fdb}' is named '{fname}'" + (f" in the compartment '{comp}'." if comp else ".") + hint, "flow_not_found"))
                else:
                    plan.errors.append(CellError(SHEET_EXC, row_no, "Compartment" if comp else "Flow name",
                        f"'{fname}'" + (f" in '{comp}'" if comp else "") + f" matches {len(matches)} flows, so the choice would be a guess: {_candidates(matches)}. "
                        + ("Give the Flow code." if comp else "Add the Compartment, or give the Flow code."), "flow_ambiguous"))
        flow = backend.flow(fdb, code) if code else None
        if code and flow is not None and not resolved_from_name:
            if fname and fname.casefold() != flow.name.casefold():
                plan.errors.append(CellError(SHEET_EXC, row_no, "Flow name", f"The flow code {code} is '{flow.name}', not '{fname}'.", "flow_name_mismatch"))
            if comp and comp.casefold() != compartment_of(flow.categories).casefold():
                plan.errors.append(CellError(SHEET_EXC, row_no, "Compartment", f"The flow code {code} is in '{compartment_of(flow.categories)}', not '{comp}'.", "compartment_mismatch"))
        unit = _text(v.get("Unit"))
        if flow is not None and unit and _canonical_unit(unit) != _canonical_unit(flow.unit):
            plan.errors.append(CellError(SHEET_EXC, row_no, "Unit", f"The unit is '{unit}' but the flow '{flow.name}' is in '{flow.unit}'. Amounts are taken in the flow's own unit, with no conversion.", "unit_mismatch"))

        amount = _number(v.get("Amount"))
        if v.get("Amount") is None:
            plan.errors.append(CellError(SHEET_EXC, row_no, "Amount", "The amount is required.", "amount_required"))
        elif amount is None:
            plan.errors.append(CellError(SHEET_EXC, row_no, "Amount", f"The amount '{v.get('Amount')}' is not a number (use a point as the decimal separator).", "amount_not_number"))
        pedigree: dict[str, int] = {}
        for key_, col in PEDIGREE_COLUMNS.items():
            raw = v.get(col)
            if raw is None:
                plan.errors.append(CellError(SHEET_EXC, row_no, col, "Every pedigree score must be set, 1 to 5: a missing one would count as no added uncertainty.", "pedigree_missing"))
                continue
            s = _score(raw)
            if s is None:
                plan.errors.append(CellError(SHEET_EXC, row_no, col, f"The pedigree score '{raw}' must be a whole number from 1 to 5.", "pedigree_invalid"))
            else:
                pedigree[key_] = s
        basis_raw = (_text(v.get("Uncertainty basis")) or "ecoinvent").casefold()
        if basis_raw not in BASES:
            plan.errors.append(CellError(SHEET_EXC, row_no, "Uncertainty basis", "The uncertainty basis must be 'ecoinvent' or 'supplied'.", "basis_invalid"))
        bv = _number(v.get("Basic variance"))
        if v.get("Basic variance") is not None and bv is None:
            plan.errors.append(CellError(SHEET_EXC, row_no, "Basic variance", f"The basic variance '{v.get('Basic variance')}' is not a number.", "bv_not_number"))

        if len(plan.errors) > row_errors_before or code is None or amount is None or len(pedigree) != len(PEDIGREE_COLUMNS) or basis_raw not in BASES:
            continue
        inp = ExchangeInput(
            flow_database=fdb, flow_code=code, amount=amount, pedigree=pedigree,
            basic_variance=bv, basic_variance_reason=_text(v.get("Basic variance reason")),
            uncertainty_basis=basis_raw, floor_reason=_text(v.get("Floor reason")),  # type: ignore[arg-type]
        )
        # THE ENGINE decides. The same function saving calls.
        try:
            eng.resolve_exchange(inp, backend)
        except eng.AuthoredError as err:
            ok_pairs = len(err.codes) == len(err.problems)
            for i, p in enumerate(err.problems):
                c = err.codes[i] if ok_pairs else "invalid"
                plan.errors.append(CellError(SHEET_EXC, row_no, _CODE_COLUMN.get(c), p, c))
            continue
        acts[key]["exchanges"].append((row_no, inp))
        if resolved_from_name:
            by_name += 1
            resolved_by_name.append({"row": row_no, "name": fname, "compartment": comp or "", "code": code})

    for key, a in acts.items():
        if a["rows"] == 0:
            plan.errors.append(CellError(SHEET_ACT, a["row"], "Activity key", f"The activity '{key}' has no exchanges on the Exchanges sheet; an authored activity needs at least one.", "no_exchanges"))

    # ── Build through the engine, only when every cell was clean ─────────────
    if plan.errors or db_name is None:
        plan.preview = _preview(acts, by_name, resolved_by_name, db_name, description)
        return plan
    built: list[AuthoredActivity] = []
    for key, a in acts.items():
        try:
            act_in = ActivityInput(
                name=a["name"], reference_product=a["reference"], unit=a["unit"], location=a["location"],
                comment=a["comment"], scope=a["scope"], scope_note=a["scope_note"],
                exchanges=[inp for _, inp in a["exchanges"]], complete_indicators=a["indicators"],
            )
            built.append(eng.build_activity(act_in, backend, code_factory()))
        except eng.AuthoredError as err:
            ok_pairs = len(err.codes) == len(err.problems)
            for i, p in enumerate(err.problems):
                c = err.codes[i] if ok_pairs else "invalid"
                col = "Complete indicators" if c == "indicator_not_reached" else "Activity key"
                plan.errors.append(CellError(SHEET_ACT, a["row"], col, p, c))
        except (ValidationError, ValueError) as err:
            plan.errors.append(CellError(SHEET_ACT, a["row"], None, str(err).splitlines()[0], "invalid"))
    plan.preview = _preview(acts, by_name, resolved_by_name, db_name, description)
    if plan.errors:
        return plan
    ts = eng.now_iso()
    try:
        plan.database = AuthoredDatabase(name=db_name, description=description, created_at=ts, updated_at=ts, activities=built)
    except ValueError as err:
        plan.errors.append(CellError(SHEET_ACT, None, None, str(err).splitlines()[0], "invalid"))
    return plan


def _preview(acts: dict, by_name: int, resolved: list[dict], db_name: str | None, description: str) -> dict:
    return {
        "database": db_name,
        "description": description,
        "activities": len(acts),
        "exchanges": sum(len(a["exchanges"]) for a in acts.values()),
        "partial": sum(1 for a in acts.values() if a["scope"] == "partial"),
        "flows_resolved_by_name": by_name,
        "resolved_by_name": resolved[:50],
        "activity_list": [{"key": k, "name": a["name"], "scope": a["scope"], "exchanges": len(a["exchanges"])} for k, a in acts.items()],
    }


# ── Writing workbooks (template and export) ──────────────────────────────────

_HEAD_FONT = Font(bold=True, color="FFFFFF")
_HEAD_FILL = PatternFill("solid", fgColor="3ECFCF")
_EXAMPLE_FILL = PatternFill("solid", fgColor="FFF2CC")
_WIDTHS = {
    "Activity key": 16, "Name": 34, "Location": 10, "Unit": 12, "Reference product": 26, "Scope": 10,
    "Scope note": 36, "Complete indicators": 40, "Comment": 30, "Flow database": 14, "Flow code": 38,
    "Flow name": 30, "Compartment": 30, "Amount": 12, "Uncertainty basis": 16, "Basic variance": 14,
    "Basic variance reason": 34, "Floor reason": 30, "Description": 40,
    **{c: 16 for c in PEDIGREE_COLUMNS.values()},
}
_UNITS = ["kilogram", "kilo Becquerel", "cubic meter", "square meter", "megajoule", "square meter-year", "kilowatt hour", "hectare"]


def _put(ws, row: int, values: list[Any]) -> None:
    for i, v in enumerate(values, start=1):
        c = ws.cell(row=row, column=i)
        v = neutralise(v)
        if isinstance(v, str):
            c.value = v
            c.data_type = "s"                            # text stays text, never a formula
        else:
            c.value = v


def _header(ws, columns: list[str]) -> None:
    ws.append(columns)
    for i, name in enumerate(columns, start=1):
        c = ws.cell(row=1, column=i)
        c.font, c.fill = _HEAD_FONT, _HEAD_FILL
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = _WIDTHS.get(name, 16)
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 32


def _add_validations(wb: Workbook) -> None:
    act, exc = wb[SHEET_ACT], wb[SHEET_EXC]

    def dv(ws, columns: list[str], col_name: str, formula: str, *, strict: bool = True) -> None:
        d = DataValidation(type="list", formula1=formula, allow_blank=True, showErrorMessage=True)
        d.errorStyle = "stop" if strict else "warning"
        col = get_column_letter(columns.index(col_name) + 1)
        d.add(f"{col}2:{col}{MAX_ROWS}")
        ws.add_data_validation(d)

    dv(act, ACT_COLUMNS, "Scope", f"={SHEET_LISTS}!$A$2:$A$3")
    dv(act, ACT_COLUMNS, "Unit", f"={SHEET_LISTS}!$D$2:${'D'}${1 + len(_UNITS)}", strict=False)
    dv(exc, EXC_COLUMNS, "Unit", f"={SHEET_LISTS}!$D$2:${'D'}${1 + len(_UNITS)}", strict=False)
    dv(exc, EXC_COLUMNS, "Uncertainty basis", f"={SHEET_LISTS}!$C$2:$C$3")
    for col in PEDIGREE_COLUMNS.values():
        dv(exc, EXC_COLUMNS, col, f"={SHEET_LISTS}!$B$2:$B$6")


def _lists_sheet(wb: Workbook) -> None:
    ws = wb.create_sheet(SHEET_LISTS)
    ws.append(["Scope", "Pedigree score", "Uncertainty basis", "Units"])
    for i in range(1, 5):
        ws.cell(row=1, column=i).font = Font(bold=True)
    for i in range(max(len(_UNITS), 5)):
        ws.append([
            SCOPES[i] if i < 2 else None, i + 1 if i < 5 else None, BASES[i] if i < 2 else None,
            _UNITS[i] if i < len(_UNITS) else None,
        ])
    for letter, w in zip("ABCD", (12, 16, 18, 20)):
        ws.column_dimensions[letter].width = w


README_LINES: list[tuple[str, str]] = [
    ("Authored database workbook", "Fill the Database, Activities and Exchanges sheets, then import the file in Database Explorer > Import from Excel."),
    ("Template version", TEMPLATE_VERSION),
    ("", ""),
    ("How it works", "One workbook is one authored database. Each activity is a process described by its direct emissions or resource uses, as biosphere exchanges. The Exchanges sheet lists them, one per row, and names the activity each belongs to with the Activity key."),
    ("All or nothing", "The file is checked as a whole first. If there is a single error, nothing is imported and every error is listed with its sheet, row and column. Use 'Validate only' to check without importing."),
    ("Delete the examples", "Rows whose Activity key starts with EXAMPLE are examples. They are refused on import until you delete them or replace them with your own."),
    ("", ""),
    ("Database sheet", "Name (required) and Description. The name must be new: an existing database is never overwritten, and a name containing 'biosphere' is refused."),
    ("Activities sheet", "Activity key (a short id you choose, unique), Name, Location (default GLO), Unit, Reference product (default: the name), Scope, Scope note, Complete indicators, Comment."),
    ("Scope", "complete = the listed flows are the whole inventory. partial = they are not; a Scope note saying what is left out is then required. There is no default: you must choose."),
    ("Complete indicators", "Partial activities only. The indicators you declare the partial inventory complete for, as method paths joined with ' > ' as exported, separated by ';'. Leave empty to leave every indicator marked 'not specified'."),
    ("Exchanges sheet", "Activity key, then the flow, then the amount and the pedigree scores."),
    ("The flow", "Give the Flow code (and Flow database, default biosphere3). Or leave the code empty and give the exact Flow name and Compartment: it is looked up in the project's biosphere, and refused if no flow or more than one matches (the error lists the candidates). The Compartment is the full path, for example 'air' or 'air / non-urban air or from high stacks'; they are different flows."),
    ("Amount and unit", "A positive number, in the flow's OWN unit (kilogram for most emissions). The Unit column is only a check: it must match the flow's unit. There is no conversion."),
    ("Pedigree", "All five scores, each a whole number from 1 to 5. A missing score is refused: it would count as no added uncertainty."),
    ("Basic variance", "Leave empty for flows ecoinvent measures (CO2, ammonia and most common emissions): the variance comes from ecoinvent, and entering one is refused (bv_not_settable). For a flow ecoinvent does NOT measure, a value and a reason (Basic variance reason) are required. Export writes a value and reason only when you supplied them."),
    ("Uncertainty basis", "ecoinvent (default): the amount is an emission this activity releases, ecoinvent's spread applies. supplied: the amount is a figure whose uncertainty belongs to its producer (a supplier's footprint, an EPD); a Basic variance and its reason are then required, and no ecoinvent floor is applied."),
    ("Floor reason", "Only when your pedigree gives a tighter spread than ecoinvent's own for that flow: say why. The import tells you when it is needed."),
    ("Comments", "Comment fields are NOT supported yet: there is no activity description column and no exchange comment column, because the database cannot store them (a follow-up). The database Description and the activity Comment are kept."),
    ("Codes", "Activity codes are created on import. If you export a database and import it under a new name, the copy has new activity codes; BOM rows link to the new database's activities."),
    ("Safety", "Formulas are not accepted. Export prefixes any text starting with = + - @ with an apostrophe so a spreadsheet cannot run it; import removes exactly that apostrophe."),
    ("Limits", f"At most {MAX_BYTES // (1024 * 1024)} MB and {MAX_ROWS} rows per sheet."),
]


def _readme(wb: Workbook) -> None:
    ws = wb.active
    ws.title = SHEET_README
    for i, (a, b) in enumerate(README_LINES, start=1):
        ws.cell(row=i, column=1, value=a).font = Font(bold=True)
        c = ws.cell(row=i, column=2)
        c.value = b
        c.data_type = "s"
        c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 110


def _skeleton() -> Workbook:
    wb = Workbook()
    _readme(wb)
    for name, cols in ((SHEET_DB, DB_COLUMNS), (SHEET_ACT, ACT_COLUMNS), (SHEET_EXC, EXC_COLUMNS)):
        _header(wb.create_sheet(name), cols)
    _lists_sheet(wb)
    _add_validations(wb)
    return wb


def build_template() -> Workbook:
    """An empty workbook with ONE clearly marked example per sheet (CO2 and ammonia to air per kg)."""
    wb = _skeleton()
    ped = [4, 4, 4, 4, 4]      # example scores; ecoinvent's floor may ask for more, and says so
    rows = {
        SHEET_DB: [["My authored database", "EXAMPLE description: delete this row and write your own."]],
        SHEET_ACT: [[f"{EXAMPLE_PREFIX}-1", "EXAMPLE cathode production, direct emissions", "GLO", "kilogram",
                     "EXAMPLE cathode", "partial", "Direct process emissions only; no inputs, no waste streams.",
                     "", "EXAMPLE: delete this row"]],
        SHEET_EXC: [
            [f"{EXAMPLE_PREFIX}-1", "biosphere3", "", "Carbon dioxide, fossil", "air", 0.8, "kilogram", *ped, "ecoinvent", None, None, None],
            [f"{EXAMPLE_PREFIX}-1", "biosphere3", "", "Ammonia", "air", 0.02, "kilogram", *ped, "ecoinvent", None, None, None],
        ],
    }
    for sheet, data in rows.items():
        ws = wb[sheet]
        for r, vals in enumerate(data, start=2):
            _put(ws, r, vals)
            if sheet != SHEET_DB:
                for c in range(1, ws.max_column + 1):
                    ws.cell(row=r, column=c).fill = _EXAMPLE_FILL
        if sheet == SHEET_DB:
            for c in range(1, 3):
                ws.cell(row=2, column=c).fill = _EXAMPLE_FILL
    return wb


def export_database(db: AuthoredDatabase) -> Workbook:
    """The database in the template's format. Exporting then importing under a new name gives
    the same activities and exchanges (flow codes, amounts, pedigree, variance, scope, notes)."""
    wb = _skeleton()
    _put(wb[SHEET_DB], 2, [db.name, db.description or None])
    ws_a, ws_e = wb[SHEET_ACT], wb[SHEET_EXC]
    ra = re_ = 2
    for i, act in enumerate(db.activities, start=1):
        key = f"a{i}"
        _put(ws_a, ra, [key, act.name, act.location, act.unit, act.reference_product, act.scope,
                        act.scope_note, format_indicators(act.complete_indicators) or None, act.comment or None])
        ra += 1
        for ex in act.exchanges:
            user_bv = ex.basic_variance_source in ("user_entered", "supplied")
            _put(ws_e, re_, [
                key, ex.flow.database, ex.flow.code, ex.flow.name, compartment_of(ex.flow.categories), ex.amount, ex.flow.unit,
                *(ex.pedigree[k] for k in INDICATORS), ex.uncertainty_basis,
                ex.basic_variance if user_bv else None, ex.basic_variance_detail if user_bv else None, ex.floor_reason,
            ])
            re_ += 1
    return wb


def workbook_bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
