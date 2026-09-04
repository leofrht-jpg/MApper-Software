# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""An upload that resolves NOTHING must not overwrite what is already there.

Found live: a cohort-mapping workbook whose 51 rows all named archetypes that
did not resolve in the project. Every row was skipped, an empty
``CohortMapping`` was built, and it was persisted over 51 good mappings. The
store went from 51 to 0 on a file that was merely WRONG.

THE RULE, and why it is this one:

    the file asserted rows, and none of them survived  ->  refuse, write nothing

Expressed as ``rows_seen > 0 and resolved == 0``. The discriminating quantity
is a property of the UPLOAD ALONE:

* NOT "refuse when the result is empty" -- clearing every mapping by uploading
  a file with blank archetype cells is a real workflow, and blank cells are
  skipped by design. ``rows_seen == 0`` is that case and stays allowed.
* NOT "refuse when the result is empty AND the store is non-empty" -- that
  makes the same bad file succeed on an empty system and fail on a populated
  one. Whether an upload is destructive should not depend on what it happens
  to land on.
* NOT "refuse when the invalid count equals the row count" -- rows can fail for
  several reasons at once (unresolvable archetype, invalid cohort key, both),
  and no single failure counter expresses "nothing survived".

PARTIAL uploads are ACCEPTED, not refused. 50 of 51 resolving is the normal
shape of someone fixing a file incrementally, and refusing it would make the
tool unusable for exactly that workflow. The per-row problems are already
reported back to the caller; the line is *nothing landed*, not *something was
imperfect*.

Replace-vs-merge is deliberately NOT changed here. Replace is the documented
contract ("Replaces all existing mappings"), and a partial upload therefore
still drops rows it omits. Changing that default silently would be worse than
the sharp edge; if it ever needs to change it should be an explicit choice at
upload time.
"""

from __future__ import annotations

from fastapi import HTTPException


def refuse_if_nothing_resolved(
    *,
    rows_seen: int,
    resolved: int,
    what: str,
    hint: str = "",
) -> None:
    """Raise 422 when a non-empty upload produced no usable rows.

    ``rows_seen`` counts rows the file actually ASSERTED something in -- not
    the raw row count, or a file of blank rows would be refused instead of
    clearing. ``resolved`` counts what survived parsing and lookup.
    """
    if rows_seen > 0 and resolved == 0:
        detail = (
            f"None of the {rows_seen} {what} row(s) in this file could be used, "
            "so nothing was saved and your existing data is unchanged."
        )
        if hint:
            detail += f" {hint}"
        raise HTTPException(status_code=422, detail=detail)
