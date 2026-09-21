# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A method is identified by its full tuple. The label is display only.

``method[-1]`` is not unique. Across EF v3.1's 25 indicators there are 14
distinct ones: "global warming potential (GWP100)" names four, "comparative
toxic unit for human (CTUh)" six, "comparative toxic unit for ecosystems
(CTUe)" three, and "accumulated exceedance (AE)" names both acidification and
terrestrial eutrophication.

Keyed by that label, the single-product exports silently dropped 11 of 25
indicators -- each group collapsing onto whichever member was written last --
and the per-item SB_ sheets wrote all 25 rows while giving four climate
indicators ONE shared stage vector, which is worse, because it looks complete.
The fleet pipeline was never affected: it keys on the tuple throughout, and its
own ``method_label`` is the whole tuple joined.

These tests pin the rule at both ends: the shape that carries per-method data,
and the labels that go on a sheet.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from mapper.core.method_labels import disambiguated_labels, method_path

BACKEND = Path(__file__).resolve().parents[1] / "mapper"

# The real EF v3.1 collision, as installed.
EF = [
    ("EF v3.1", "climate change", "global warming potential (GWP100)"),
    ("EF v3.1", "climate change: biogenic", "global warming potential (GWP100)"),
    ("EF v3.1", "climate change: fossil", "global warming potential (GWP100)"),
    ("EF v3.1", "climate change: land use and land use change", "global warming potential (GWP100)"),
    ("EF v3.1", "acidification", "accumulated exceedance (AE)"),
    ("EF v3.1", "eutrophication: terrestrial", "accumulated exceedance (AE)"),
    ("EF v3.1", "water use", "user deprivation potential"),
]


def test_the_collision_these_tests_exist_for():
    """If this ever stops holding, the rest of this file is moot."""
    assert len({m[-1] for m in EF}) == 3, "the indicator names collide"
    assert len({m[1] for m in EF}) == len(EF), "the categories do not"


def test_a_label_is_extended_only_where_it_must_be():
    labels = disambiguated_labels(EF)
    # Unique category -> the bare category, which is the readable case.
    assert labels[EF[-1]] == "water use"
    # Colliding indicator -> category kept distinct, so no two labels match.
    assert labels[EF[0]] == "climate change"
    assert labels[EF[2]] == "climate change: fossil"
    assert len(set(labels.values())) == len(EF), "two methods share a label"


def test_the_label_depends_on_the_SET_not_the_method():
    """A method alone cannot know whether it needs extending."""
    alone = disambiguated_labels([EF[0]])[EF[0]]
    with_siblings = disambiguated_labels(EF)[EF[0]]
    assert alone == with_siblings == "climate change"
    pair = [("EF v3.1", "climate change", "x"), ("IPCC 2021", "climate change", "y")]
    assert len(set(disambiguated_labels(pair).values())) == 2, "same category, two packages"


def test_labels_are_order_independent():
    assert disambiguated_labels(EF) == disambiguated_labels(list(reversed(EF)))


def test_the_path_is_the_whole_tuple():
    assert method_path(EF[2]) == "EF v3.1 › climate change: fossil › global warming potential (GWP100)"


# ── The shape ───────────────────────────────────────────────────────────────

def test_stage_breakdown_carries_the_tuple_not_a_label():
    """The payload that collapsed. A list of entries, each with its method."""
    from mapper.models.schemas import StageBreakdownEntry

    entries = [StageBreakdownEntry(method=list(m), by_stage={"Manufacturing": i})
               for i, m in enumerate(EF)]
    by_method = {tuple(e.method): e.by_stage for e in entries}
    assert len(by_method) == len(EF), "a method lost its entry"
    # The thing that used to happen:
    by_label = {e.method[-1]: e.by_stage for e in entries}
    assert len(by_label) == 3, "sanity: the label key really does collapse"


def test_an_entry_without_its_method_is_refused():
    """``method`` is REQUIRED, not defaulted. An entry that can be built
    without one is an entry that can be written without one, and then the
    consumer is back to guessing which indicator it belongs to."""
    import pydantic

    from mapper.models.schemas import StageBreakdownEntry

    with pytest.raises(pydantic.ValidationError):
        StageBreakdownEntry(by_stage={"Manufacturing": 1.0})


# ── The guard ───────────────────────────────────────────────────────────────

def _assignments_keyed_by_label(path: Path) -> list[str]:
    """Dict comprehensions/literals whose KEY is a bare method label.

    Catches ``{m.method_label: ...}`` and ``{_sp_short_method(r.method): ...}``
    -- the two shapes that caused this. A label in a VALUE is fine; a label in
    a row being appended to a sheet is fine. Only keys are the defect.
    """
    hits: list[str] = []
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        key = None
        if isinstance(node, ast.DictComp):
            key = node.key
        elif isinstance(node, ast.Dict) and node.keys:
            key = node.keys[0]
        if key is None:
            continue
        # {x.method_label: ...}
        if isinstance(key, ast.Attribute) and key.attr == "method_label":
            hits.append(f"{path.name}:{key.lineno} keyed by .method_label")
        # {_short_label(...): ...}
        if (isinstance(key, ast.Call) and isinstance(key.func, ast.Name)
                and key.func.id in {"_sp_short_method", "_short_method_label"}):
            hits.append(f"{path.name}:{key.lineno} keyed by {key.func.id}()")
        # {method[-1]: ...}
        if (isinstance(key, ast.Subscript) and isinstance(key.slice, ast.UnaryOp)
                and isinstance(key.slice.op, ast.USub)):
            hits.append(f"{path.name}:{key.lineno} keyed by method[-1]")
    return hits


@pytest.mark.parametrize("name", ["api/lca.py", "api/impact.py", "api/bom.py",
                                  "api/cohort_export.py", "api/aesa.py",
                                  "core/dsm_lca_engine.py", "core/aesa_engine.py"])
def test_no_result_dict_is_keyed_by_a_method_label(name):
    hits = _assignments_keyed_by_label(BACKEND / name)
    assert hits == [], "a method label used as a dict key:\n" + "\n".join(hits)
