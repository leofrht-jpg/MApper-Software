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

# ── A name that disagrees with the factors it holds (DISPLAY only) ───────────
#
# bw2io's bundled ReCiPe 2016 midpoint data calls the climate indicator of the
# hierarchist AND the individualist perspective "global warming potential
# (GWP1000)", but the factors are not 1000-year ones: (H) holds the 100-year
# factors (CH4 36, N2O 298), (I) the 20-year ones (CH4 85, N2O 264). Only (E) is
# what it says (CH4 4.9, N2O 78.8). The "no LT" variants have the same fault.
# The ecoinvent LCIA implementation files name them GWP100 and GWP20.
#
# The TUPLE is not touched: it is the registered method's identity, the key every
# stored result, saved selection and AESA mapping uses, and renaming it would make
# `installed_tuples` / `is_complete` report existing projects as incomplete. Only
# what a person READS is corrected, here, once. A project that already carries the
# corrected names (installed from the ecoinvent file) is not in this map, so it is
# left alone: the correction is idempotent and never applied twice. The frontend
# mirrors this table in `utils/methodLabels.ts`; `tests/test_method_display_labels.py`
# fails if the two disagree.
_RECIPE_H = "ReCiPe 2016 v1.03, midpoint (H)"
_RECIPE_I = "ReCiPe 2016 v1.03, midpoint (I)"
_CLIMATE = "climate change"
_GWP1000 = "global warming potential (GWP1000)"
RECIPE_GWP_DISPLAY: dict[Method, str] = {
    (_RECIPE_H, _CLIMATE, _GWP1000): "global warming potential (GWP100)",
    (_RECIPE_I, _CLIMATE, _GWP1000): "global warming potential (GWP20)",
    (_RECIPE_H + " no LT", _CLIMATE + " no LT", _GWP1000 + " no LT"): "global warming potential (GWP100) no LT",
    (_RECIPE_I + " no LT", _CLIMATE + " no LT", _GWP1000 + " no LT"): "global warming potential (GWP20) no LT",
}


def display_method(method: Iterable[str]) -> Method:
    """The method as a person should read it. Same tuple, except that an
    indicator whose bundled name contradicts its factors gets the right name.
    NEVER a key and never a stored value: use the original tuple for identity."""
    t = tuple(method)
    fixed = RECIPE_GWP_DISPLAY.get(t)
    return (*t[:-1], fixed) if fixed else t


def display_indicator(method: Iterable[str]) -> str:
    """The indicator part (last element) of ``display_method``, or "" if empty."""
    d = display_method(method)
    return d[-1] if d else ""


def disambiguated_labels(methods: Iterable[Iterable[str]]) -> dict[Method, str]:
    """``{method_tuple: label}`` for one table's methods.

    Order-independent and idempotent: the same set of methods always yields the
    same labels, so two sheets built from one result agree.
    """
    tuples = [tuple(m) for m in methods]
    shown = {m: display_method(m) for m in tuples}      # display text only; keys stay the tuples
    by_cat: dict[str, int] = defaultdict(int)
    for m in tuples:
        if len(m) > 1:
            by_cat[m[1]] += 1
    out: dict[Method, str] = {}
    for m in tuples:
        if len(m) > 1:
            out[m] = m[1] if by_cat[m[1]] == 1 else " / ".join(shown[m][1:])
        else:
            out[m] = m[0] if m else "method"
    return out


def label_for(method: Iterable[str], among: Iterable[Iterable[str]]) -> str:
    """One method's label within ``among``. Convenience over the dict."""
    return disambiguated_labels(among).get(tuple(method), "method")


def method_path(method: Iterable[str]) -> str:
    """The full tuple as text, for a "Method path" column. Never a key.

    DELIBERATELY raw, not ``display_method``: a path column is how a reader finds
    the registered method again, so it must match the stored tuple exactly."""
    return " › ".join(method)
