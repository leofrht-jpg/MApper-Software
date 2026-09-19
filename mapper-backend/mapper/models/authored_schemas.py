# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""User-authored databases: activities defined by their biosphere exchanges.

The definition file (``dsm/{project}/authored_databases.json``) is the source
of truth; the Brightway database is a materialisation of it. Every number a
reader might question carries its provenance on the same exchange, so the
claim travels with the value:

* ``basic_variance_source`` / ``basic_variance_detail`` -- where the basic
  variance came from: ecoinvent's own median for that flow, or a value the
  user entered together with their reason.
* ``floor_status`` -- whether the exchange's GSD2 could be checked against
  ecoinvent's median for that flow, and what happened:

  ``floored``                  checked, at or above the ecoinvent median
  ``below_floor_with_reason``  checked, below the median, reason recorded
  ``unfloored``                could NOT be checked: ecoinvent carries too few
                               lognormal exchanges for this flow to give a
                               median. ``floor_detail`` says why.

  ``unfloored`` is stated, never implied by an absent field, so a reader can
  tell which exchanges were floored and which could not be. An activity with
  any such exchange reports ``has_unfloored_exchange``.

* ``scope`` -- whether the listed flows are the complete inventory or a
  partial one. Required on every activity from the first write, so no
  activity exists without a coverage declaration.

Stored models validate their own arithmetic on load: ``sigma`` must equal the
composition of ``pedigree`` and ``basic_variance`` and ``gsd2`` must equal
``exp(2*sigma)``, so a hand-edited file cannot carry numbers that disagree
with the scores that claim to produce them.
"""
from __future__ import annotations

import math
import re
from typing import Literal

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

from mapper.core.pedigree import INDICATORS, gsd2_from_sigma, total_sigma

AUTHORED_SCHEMA_VERSION = 1

ScopeKind = Literal["complete", "partial"]
FloorStatus = Literal["floored", "below_floor_with_reason", "unfloored"]
BasicVarianceSource = Literal["ecoinvent_median", "user_entered"]

_CODE_RE = re.compile(r"^[0-9a-f]{32}$")
_REL_TOL = 1e-9


def _blank(s: str | None) -> bool:
    return s is None or not s.strip()


def _check_pedigree(scores: dict[str, int]) -> dict[str, int]:
    """All five indicators, each an integer 1..5. No partial score sets.

    A missing indicator would compose as score 1 (no added uncertainty), which
    is exactly the understatement authored activities must not be able to make
    by omission.
    """
    missing = [i for i in INDICATORS if i not in scores]
    unknown = sorted(set(scores) - set(INDICATORS))
    if missing or unknown:
        parts = []
        if missing:
            parts.append(f"missing {', '.join(missing)}")
        if unknown:
            parts.append(f"unknown {', '.join(unknown)}")
        raise ValueError(
            "pedigree must score all five indicators "
            f"({', '.join(INDICATORS)}): {'; '.join(parts)}"
        )
    for k, v in scores.items():
        if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 5:
            raise ValueError(f"pedigree score for {k!r} must be an integer 1-5, got {v!r}")
    return scores


# ── Requests ────────────────────────────────────────────────────────────────


class ExchangeInput(BaseModel):
    """One biosphere exchange as the user specifies it.

    ``basic_variance`` is accepted ONLY for a flow ecoinvent carries no usable
    basic variance for; otherwise it comes from ecoinvent and is not
    user-settable. When given, ``basic_variance_reason`` is required.
    """

    flow_database: str = "biosphere3"
    flow_code: str
    amount: float
    pedigree: dict[str, int]
    basic_variance: float | None = None
    basic_variance_reason: str | None = None
    floor_reason: str | None = None

    @field_validator("pedigree")
    @classmethod
    def _pedigree(cls, v: dict[str, int]) -> dict[str, int]:
        return _check_pedigree(v)


class ActivityInput(BaseModel):
    name: str
    reference_product: str | None = None
    unit: str
    location: str = "GLO"
    comment: str = ""
    scope: ScopeKind  # required: no default, from the first write
    scope_note: str | None = None
    exchanges: list[ExchangeInput] = Field(min_length=1)

    @model_validator(mode="after")
    def _scope_note_for_partial(self) -> "ActivityInput":
        if self.scope == "partial" and _blank(self.scope_note):
            raise ValueError(
                "scope_note is required when scope is 'partial': say which flows "
                "were specified and which were not"
            )
        if _blank(self.name):
            raise ValueError("activity name is required")
        return self


class DatabaseCreate(BaseModel):
    name: str
    description: str = ""


# ── Stored definition ──────────────────────────────────────────────────────


class FlowSnapshot(BaseModel):
    """The flow as it was when authored.

    The key is what links; the rest lets a reader see the compartment without a
    lookup, and lets a rebuild in another installation confirm the key still
    means the same flow.
    """

    database: str
    code: str
    name: str
    categories: list[str]
    unit: str


class AuthoredExchange(BaseModel):
    flow: FlowSnapshot
    amount: float
    pedigree: dict[str, int]
    basic_variance: float
    basic_variance_source: BasicVarianceSource
    basic_variance_detail: str
    sigma: float
    gsd2: float
    floor_status: FloorStatus
    floor_gsd2: float | None = None
    floor_detail: str
    floor_reason: str | None = None

    @field_validator("pedigree")
    @classmethod
    def _pedigree(cls, v: dict[str, int]) -> dict[str, int]:
        return _check_pedigree(v)

    @model_validator(mode="after")
    def _consistent(self) -> "AuthoredExchange":
        if not self.amount > 0:
            raise ValueError(f"amount must be positive, got {self.amount!r}")
        if not (self.basic_variance >= 0 and math.isfinite(self.basic_variance)):
            raise ValueError(f"basic_variance must be a finite value >= 0, got {self.basic_variance!r}")
        if _blank(self.basic_variance_detail):
            raise ValueError("basic_variance_detail is required (provenance or the user's reason)")
        expected = total_sigma(self.pedigree, self.basic_variance)
        if not math.isclose(self.sigma, expected, rel_tol=_REL_TOL, abs_tol=1e-12):
            raise ValueError(
                f"sigma {self.sigma!r} does not match the pedigree and basic variance "
                f"it claims to come from ({expected!r})"
            )
        if not math.isclose(self.gsd2, gsd2_from_sigma(self.sigma), rel_tol=_REL_TOL):
            raise ValueError("gsd2 does not equal exp(2*sigma)")
        if _blank(self.floor_detail):
            raise ValueError("floor_detail is required")
        if self.floor_status == "unfloored":
            if self.floor_gsd2 is not None:
                raise ValueError("an unfloored exchange cannot carry a floor value")
        else:
            if self.floor_gsd2 is None:
                raise ValueError(f"floor_status {self.floor_status!r} requires floor_gsd2")
            below = self.gsd2 < self.floor_gsd2
            if self.floor_status == "floored" and below:
                raise ValueError("gsd2 is below the floor but floor_status is 'floored'")
            if self.floor_status == "below_floor_with_reason":
                if not below:
                    raise ValueError("floor_status 'below_floor_with_reason' but gsd2 is not below the floor")
                if _blank(self.floor_reason):
                    raise ValueError("an exchange below its floor must carry floor_reason")
        return self


class AuthoredActivity(BaseModel):
    code: str
    name: str
    reference_product: str
    unit: str
    location: str
    comment: str = ""
    scope: ScopeKind
    scope_note: str | None = None
    exchanges: list[AuthoredExchange] = Field(min_length=1)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if not _CODE_RE.match(v):
            raise ValueError("code must be 32 lowercase hex characters")
        return v

    @model_validator(mode="after")
    def _checks(self) -> "AuthoredActivity":
        if self.scope == "partial" and _blank(self.scope_note):
            raise ValueError("scope_note is required when scope is 'partial'")
        keys = [(e.flow.database, e.flow.code) for e in self.exchanges]
        dupes = sorted({k for k in keys if keys.count(k) > 1})
        if dupes:
            raise ValueError(f"the same flow appears more than once: {dupes}")
        return self

    @computed_field  # serialised, so the flag is visible in the file itself
    @property
    def has_unfloored_exchange(self) -> bool:
        return any(e.floor_status == "unfloored" for e in self.exchanges)


class AuthoredDatabase(BaseModel):
    name: str
    description: str = ""
    created_at: str
    updated_at: str
    activities: list[AuthoredActivity] = []

    @model_validator(mode="after")
    def _unique(self) -> "AuthoredDatabase":
        codes = [a.code for a in self.activities]
        if len(codes) != len(set(codes)):
            raise ValueError(f"duplicate activity codes in {self.name!r}")
        ids = [(a.name, a.location) for a in self.activities]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(
                f"two activities in {self.name!r} share a name and location: {dupes}"
            )
        return self


class AuthoredDefinitions(BaseModel):
    schema_version: int = AUTHORED_SCHEMA_VERSION
    databases: list[AuthoredDatabase] = []

    def get(self, name: str) -> AuthoredDatabase | None:
        return next((d for d in self.databases if d.name == name), None)


# ── Responses ──────────────────────────────────────────────────────────────


class MaterialisationStatus(BaseModel):
    database: str
    state: Literal["in_sync", "rebuilt", "pending", "failed"]
    detail: str = ""


class AuthoredDatabaseView(BaseModel):
    database: AuthoredDatabase
    status: MaterialisationStatus


class ExchangePreview(BaseModel):
    """What saving this exchange would do, computed by the same code as saving.

    ``ok`` is the verdict; on success ``exchange`` is exactly what would be
    stored, on failure ``problems`` is exactly what saving would report.
    """

    ok: bool
    exchange: AuthoredExchange | None = None
    problems: list[str] = []
    #: Parallel to ``problems``: machine-readable, e.g. ``below_floor``.
    codes: list[str] = []

