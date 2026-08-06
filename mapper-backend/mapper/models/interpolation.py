# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""One implementation of MApper's year-anchor interpolation rule.

The rule — *linear between anchors, clamped outside the range, never
extrapolated* — governs every year-varying quantity in the app:

* ``Parameter.keyframes``            (parameter_schemas)
* ``QuantityMilestone``              (bom_schemas / bom_engine.resolve_quantity)
* per-principle sharing shares       (aesa_schemas, resolution mode
                                      ``"interpolate"``)

Each of those grew its own copy of the arithmetic. This module is the single
copy; callers adapt their own shape down to ``(year, value)`` pairs and call
:func:`interpolate_anchors`. Adapting is cheap — the rule is not, because three
subtly different clamps are three subtly different methodologies.

No extrapolation is deliberate and load-bearing: a share, a mass or a budget
projected past its last supplied anchor is an assumption the user did not
make. Holding the endpoint states the assumption plainly.
"""
from __future__ import annotations

from collections.abc import Sequence


def interpolate_anchors(anchors: Sequence[tuple[int, float]], year: int) -> float:
    """Value at ``year``, linear between anchors, clamped at both ends.

    ``anchors`` is a sequence of ``(year, value)`` pairs; it need not be
    sorted, and a single anchor makes the series a constant. Duplicate years
    resolve to the first one after sorting, which keeps the function total
    rather than raising on data the callers may already have persisted.

    Raises ``ValueError`` on an empty sequence — "no anchors" is a caller bug,
    not a value, and returning 0.0 would silently poison a ratio.
    """
    if not anchors:
        raise ValueError("interpolate_anchors requires at least one anchor")

    pts = sorted(anchors, key=lambda p: p[0])
    if year <= pts[0][0]:
        return float(pts[0][1])
    if year >= pts[-1][0]:
        return float(pts[-1][1])

    for (y0, v0), (y1, v1) in zip(pts, pts[1:]):
        if y0 <= year <= y1:
            span = y1 - y0
            if span == 0:
                return float(v0)
            t = (year - y0) / span
            return float(v0) + t * (float(v1) - float(v0))

    # Unreachable: the clamps above cover everything outside [first, last], and
    # the loop covers everything inside. Kept so the function is total.
    return float(pts[-1][1])
