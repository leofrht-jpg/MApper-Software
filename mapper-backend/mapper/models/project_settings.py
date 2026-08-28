# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Project-level conventions — properties of a project, not of one archetype."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

UsePhaseBasis = Literal["life_cycle", "one_year"]

# What a project that predates this feature gets. "one_year" reproduces the
# previous behaviour exactly -- the control renders, the preset defaults to
# 1 year, every multiplier is 1 -- so no existing number moves.
LEGACY_DEFAULT: UsePhaseBasis = "one_year"

# What a NEW project gets. A fresh project has no BOM, so the setting is a
# statement of intent about the BOM about to be imported, and whole-lifecycle
# is the more common LCA convention outside fleet modelling. It is also the
# more conservative failure: getting it wrong shows an implausibly small use
# phase, where the other direction silently multiplies a whole-life BOM by the
# lifetime.
NEW_PROJECT_DEFAULT: UsePhaseBasis = "life_cycle"


class ProjectSettings(BaseModel):
    """Conventions that hold for every archetype in a project.

    ``use_phase_basis`` supplies the DEFAULT basis for Use Phase and
    Maintenance only. Manufacturing and End of Life are per-unit in every
    project examined, and a per-stage declaration (PR #41) still overrides
    whatever this says.
    """

    use_phase_basis: UsePhaseBasis = NEW_PROJECT_DEFAULT
