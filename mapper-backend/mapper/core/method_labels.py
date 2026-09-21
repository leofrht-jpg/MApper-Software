# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""One short label per method, extended where it would otherwise be ambiguous.

An LCIA method tuple is ``(package, category, indicator)``. The indicator alone
-- ``method[-1]`` -- is NOT unique: across EF v3.1's 25 indicators there are
only 14 distinct ones. "global warming potential (GWP100)" names four of them
(climate change, and its biogenic / fossil / land-use variants), "comparative
toxic unit for human (CTUh)" names six, "comparative toxic unit for ecosystems
(CTUe)" three, and "accumulated exceedance (AE)" names both acidification and
terrestrial eutrophication.

Using it as a DICT KEY silently dropped 11 of those 25 indicators, each group
collapsing onto whichever member was written last. Using it as a COLUMN HEADER
produced four columns with the same name over correct but unidentifiable data,
which is how a number gets transcribed out of the wrong column.

So: never key on a label -- key on the full tuple. Where a label is needed for
display, ask for it here, and it is disambiguated against the OTHER methods in
the same table: ``m[1]`` when that category appears once, ``" / ".join(m[1:])``
when it does not. The labels are therefore a property of the set, not of a
method on its own, which is why this takes the whole list.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

Method = tuple[str, ...]


def disambiguated_labels(methods: Iterable[Iterable[str]]) -> dict[Method, str]:
    """``{method_tuple: label}`` for one table's methods.

    Order-independent and idempotent: the same set of methods always yields the
    same labels, so two sheets built from one result agree.
    """
    tuples = [tuple(m) for m in methods]
    by_cat: dict[str, int] = defaultdict(int)
    for m in tuples:
        if len(m) > 1:
            by_cat[m[1]] += 1
    out: dict[Method, str] = {}
    for m in tuples:
        if len(m) > 1:
            out[m] = m[1] if by_cat[m[1]] == 1 else " / ".join(m[1:])
        else:
            out[m] = m[0] if m else "method"
    return out


def label_for(method: Iterable[str], among: Iterable[Iterable[str]]) -> str:
    """One method's label within ``among``. Convenience over the dict."""
    return disambiguated_labels(among).get(tuple(method), "method")


def method_path(method: Iterable[str]) -> str:
    """The full tuple as text, for a "Method path" column. Never a key."""
    return " › ".join(method)
