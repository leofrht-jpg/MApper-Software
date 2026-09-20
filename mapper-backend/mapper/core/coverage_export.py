# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The coverage statement every impact / AESA / Monte Carlo workbook carries.

A workbook that names some indicators "not specified" and says nothing about
the others invites the reader to infer the silent ones were checked. So every
indicator a workbook reports gets an explicit status on a ``Coverage`` sheet,
in one of three states -- and the three are never collapsed:

* ``specified``      -- checked; no partial authored activity leaves it open.
* ``NOT SPECIFIED``  -- a partial authored activity used by the result has no
                        flow characterised by it: its contribution is unknown,
                        not zero. One row per such activity.
* ``not recorded``   -- the result was computed before MApper checked this
                        (``coverage_gaps is None``). Unknown whether it is
                        specified; silence here must not read as "specified".

The first sheet carries one line pointing at the Coverage sheet with the
headline count, so the statement is seen without opening it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

SPECIFIED = "specified"
NOT_SPECIFIED = "NOT SPECIFIED"
NOT_RECORDED = "not recorded"

SHEET = "Coverage"
LABEL = "Authored-activity coverage"

EXPLANATION = (
    "Status per indicator. 'NOT SPECIFIED': a PARTIAL authored activity this "
    "result used is not declared complete for the indicator -- either no listed "
    "flow is characterised by it, or listed flows contribute but its author has "
    "not declared them sufficient -- so its contribution is UNKNOWN, not zero. "
    "'specified': checked, nothing left open. 'not recorded': "
    "the result was computed before MApper checked this; it is unknown "
    "whether the indicator is specified."
)


@dataclass
class CoverageEntry:
    """One result in the workbook: its label (None when there is only one),
    its gaps (None = not recorded) and the indicators it reports.

    For AESA, ``indicators`` are ``(pb_id, pb_name)`` and gaps carry pb_id.
    """
    label: str | None
    gaps: list | None
    indicators: Sequence
    aesa: bool = False


WHY = {
    "not_reached": "no listed flow is characterised by this indicator",
    "not_declared": "listed flows contribute, but the author has not declared the partial inventory complete for it",
}


def _method_path(m) -> str:
    return " › ".join(m)


def _rows(entry: CoverageEntry) -> list[list]:
    out = []
    for ind in entry.indicators:
        if entry.aesa:
            pb_id, pb_name = ind
            name, match = pb_name, [g for g in (entry.gaps or []) if g.pb_id == pb_id]
        else:
            name, match = _method_path(ind), [g for g in (entry.gaps or []) if list(g.method) == list(ind)]
        lead = [entry.label] if entry.label is not None else []
        if entry.gaps is None:
            out.append(lead + [name] + ([""] if entry.aesa else []) + [NOT_RECORDED, "", "", "", ""])
        elif not match:
            out.append(lead + [name] + ([""] if entry.aesa else []) + [SPECIFIED, "", "", "", ""])
        else:
            for g in match:
                out.append(lead + [name] + ([_method_path(g.method)] if entry.aesa else [])
                           + [NOT_SPECIFIED, g.activity_name, g.database, g.scope_note,
                              WHY.get(getattr(g, "kind", "not_reached"), "")])
    return out


def summary_line(entries: Iterable[CoverageEntry]) -> str:
    entries = list(entries)
    total = sum(len(e.indicators) for e in entries)
    if any(e.gaps is None for e in entries):
        unrec = sum(len(e.indicators) for e in entries if e.gaps is None)
        head = (f"NOT RECORDED for {unrec} of {total} indicator(s) -- computed before this "
                f"check existed; do not read silence as 'specified'.")
        rest = [e for e in entries if e.gaps is not None]
        n = _count_not_specified(rest)
        return head + (f" {n} further indicator(s) NOT SPECIFIED." if n else "") + f" See the {SHEET} sheet."
    n = _count_not_specified(entries)
    if n:
        return (f"{n} of {total} indicator(s) NOT SPECIFIED: a partial authored activity "
                f"leaves them unknown, not zero. See the {SHEET} sheet.")
    return f"Checked: all {total} indicator(s) specified. See the {SHEET} sheet."


def _count_not_specified(entries) -> int:
    n = 0
    for e in entries:
        for ind in e.indicators:
            if e.aesa:
                n += any(g.pb_id == ind[0] for g in e.gaps or [])
            else:
                n += any(list(g.method) == list(ind) for g in e.gaps or [])
    return n


BASIS_HEADER = "Authored exchanges: where each uncertainty comes from"
BASIS_NOTE = (
    "'supplied' means the amount is a figure whose uncertainty belongs to whoever produced it "
    "(a supplier PCF, an EPD, a measurement report) -- a characterised result, not an emission "
    "amount -- so ecoinvent's per-flow median does not apply and no GSD2 floor was checked "
    "against it. Do not compare a supplied GSD2 with an ecoinvent-referenced one: they describe "
    "different quantities."
)


def dedupe_notes(*groups) -> list:
    """One row per authored exchange across every result in a workbook."""
    out = {}
    for g in groups:
        for n in g or []:
            out.setdefault((n.database, n.code, n.flow_name), n)
    return list(out.values())


def basis_rows(notes) -> list[list]:
    """The authored-exchange basis block. Both bases are listed, so silence
    about an exchange never has to be read as 'ecoinvent'."""
    rows: list[list] = [[], [BASIS_HEADER], [BASIS_NOTE],
                        ["Activity", "Database", "Flow", "Basic variance", "GSD2", "Uncertainty basis", "Detail"]]
    for n in notes or []:
        flow = n.flow_name + (f" [{', '.join(n.flow_categories)}]" if n.flow_categories else "")
        rows.append([n.activity_name, n.database, flow, n.basic_variance, round(n.gsd2, 4), n.basis, n.detail])
    return rows


def add_coverage_sheet(wb, entries: Sequence[CoverageEntry], *, discriminator: str = "Result",
                       notes=None) -> str:
    """Append the Coverage sheet; return the one-line summary for sheet one."""
    from openpyxl.styles import Alignment, Font

    ws = wb.create_sheet(SHEET)
    ws.append([EXPLANATION])
    ws["A1"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.append([])
    multi = any(e.label is not None for e in entries)
    aesa = any(e.aesa for e in entries)
    header = ([discriminator] if multi else []) + (["Boundary", "Method"] if aesa else ["Indicator"]) + [
        "Status", "Partial authored activity", "Database", "Declared scope (author's note)", "Why"]
    ws.append(header)
    for c in ws[3]:
        c.font = Font(bold=True)
    for e in entries:
        for row in _rows(e):
            ws.append(row)
    if notes:
        for row in basis_rows(notes):
            ws.append(row)
        ws.cell(row=ws.max_row - len(notes) - 1, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    return summary_line(entries)


def finalize_coverage(wb, entries: Sequence[CoverageEntry], *, discriminator: str = "Result",
                      notes=None) -> None:
    """Add the Coverage sheet and a pointer line at the foot of the first sheet.

    Appended rather than inserted, so no existing cell moves. ``notes`` adds the
    authored-exchange uncertainty-basis block.
    """
    first = wb.worksheets[0]
    line = add_coverage_sheet(wb, entries, discriminator=discriminator, notes=notes)
    first.append([])
    first.append([LABEL, line])


def methods_of(result) -> list:
    """The indicator tuples a result reports, in its own order."""
    return [list(r.method) for r in getattr(result, "results", None) or []]
