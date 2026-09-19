# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Activity summaries for biosphere flows.

A biosphere flow has no reference product and no location; its compartment is
what tells same-named flows apart (Nitrogen oxides has five in biosphere3).
Before this the summary sent no compartment at all, and fell back to the NAME
for the reference product -- a duplicate that reads as data.
"""
from __future__ import annotations

from mapper.core import bw2_wrapper as w


class _Act(dict):
    def __init__(self, key, **kw):
        super().__init__(**kw)
        self.key = key


def test_a_flow_sends_its_compartment_and_no_reference_product():
    flow = _Act(("biosphere3", "n1"), code="n1", name="Nitrogen oxides", unit="kilogram",
                database="biosphere3", type="emission",
                categories=("air", "urban air close to ground"))
    s = w._activity_to_summary(flow)
    assert s["categories"] == ["air", "urban air close to ground"]
    assert s["product"] == "", "a flow's reference product must not repeat its name"


def test_a_technosphere_activity_keeps_the_name_fallback():
    """The BOM linker stores `product` as reference_product, and the demo
    project's synthetic activities carry none, so the fallback stays here."""
    act = _Act(("demo", "a"), code="a", name="DEMO widget", unit="kilogram",
               database="demo", type="process", location="GLO")
    s = w._activity_to_summary(act)
    assert s["product"] == "DEMO widget"
    assert s["categories"] == []


def test_a_real_reference_product_is_passed_through():
    act = _Act(("ei", "b"), code="b", name="market for steel", unit="kilogram",
               database="ei", type="process", location="GLO", **{"reference product": "steel"})
    assert w._activity_to_summary(act)["product"] == "steel"


def test_every_biosphere_flow_type_is_recognised():
    for t in ("emission", "natural resource", "economic", "inventory indicator"):
        assert w._is_biosphere_flow({"type": t}), t
    assert not w._is_biosphere_flow({"type": "process"})
