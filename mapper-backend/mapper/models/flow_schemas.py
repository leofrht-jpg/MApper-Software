# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Biosphere-flow search, grouped by substance (the compartment picker)."""
from __future__ import annotations

from pydantic import BaseModel


class MethodRef(BaseModel):
    label: str
    method: list[str]


class FlowCandidate(BaseModel):
    """One compartment of a substance."""

    database: str
    code: str
    name: str
    categories: list[str]
    unit: str
    type: str
    #: How many ecoinvent exchanges use this exact flow. Information, not a
    #: recommendation: the UI says so, and candidates are never sorted by it.
    ecoinvent_exchanges: int
    #: Whether authoring can apply the GSD2 floor to this flow (enough
    #: lognormal ecoinvent exchanges for a median), and its value.
    floor_available: bool
    floor_gsd2: float | None = None
    floor_n: int = 0
    #: ecoinvent's median basic variance for this flow, when it has a usable
    #: one; None means authoring will require the user to enter one. Decided
    #: by the same helper ``resolve_exchange`` uses.
    basic_variance: float | None = None
    basic_variance_n: int = 0
    #: Indicators of the selected family that characterise this flow.
    characterised: int
    #: label -> characterisation factor, for the selected family only.
    factors: dict[str, float]


class SubstanceGroup(BaseModel):
    name: str
    database: str
    units: list[str]
    #: Alphabetical by compartment. The order carries no meaning.
    candidates: list[FlowCandidate]
    #: Methods whose factor differs between candidates. A factor present for
    #: one candidate and absent for another counts as differing.
    varying_methods: list[MethodRef]
    #: Methods with the same factor for every candidate.
    uniform_methods: list[MethodRef]
    #: How many indicators the selected family has in total.
    family_indicator_count: int


class FlowSearchResponse(BaseModel):
    database: str
    family: str
    families: list[str]
    groups: list[SubstanceGroup]
    truncated: bool
