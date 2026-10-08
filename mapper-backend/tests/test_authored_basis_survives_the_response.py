# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""`uncertainty_basis` must survive the trip to the editor.

Opened as a bug report: a stored `supplied` exchange appeared to reopen on the
ecoinvent basis. It did not reproduce -- the file, the model, the declared
`response_model` and the editor all carried `supplied` -- but the investigation
found the chain had coverage at both ENDS and none in the middle:

  file -> model            pinned by test_uncertainty_basis.py
  model -> HTTP response   NOTHING
  response -> editor       pinned by authoredActivityEditor.test.tsx

That middle link is exactly where such a field disappears quietly. The default
is `"ecoinvent"` and the TypeScript field is optional, so a response that
omitted it would not error anywhere: the editor would simply fall back, show
the ecoinvent basis, and the GSD2 floor would reappear on an exchange that is
not an emission. A silent downgrade to the stricter default is the worst shape
this could take, because it looks like a correct screen.
"""
from __future__ import annotations

import pytest
from fastapi.encoders import jsonable_encoder

from mapper.core.pedigree import gsd2_from_sigma, total_sigma

from mapper.models.authored_schemas import (
    AuthoredActivity,
    AuthoredDatabase,
    AuthoredDatabaseView,
    AuthoredExchange,
    FlowSnapshot,
    MaterialisationStatus,
)

BASES = ["ecoinvent", "supplied"]

_PEDIGREE = {"reliability": 3, "completeness": 2, "temporal correlation": 1,
             "geographical correlation": 1, "further technological correlation": 1}
_BASIC_VARIANCE = 0.0083
_SIGMA = total_sigma(_PEDIGREE, _BASIC_VARIANCE)


def _exchange(basis: str) -> AuthoredExchange:
    """A supplied exchange shaped like the stored worked example."""
    supplied = basis == "supplied"
    return AuthoredExchange(
        flow=FlowSnapshot(database="biosphere3", code="349b29d1",
                          name="Carbon dioxide, fossil", categories=["air"], unit="kilogram"),
        amount=3.5,
        pedigree=dict(_PEDIGREE),
        basic_variance=_BASIC_VARIANCE,
        basic_variance_source="supplied" if supplied else "ecoinvent_median",
        basic_variance_detail="Supplier PCF: no uncertainty reported",
        # Derived, not typed: the model refuses a sigma that does not follow
        # from the pedigree and basic variance it claims to come from.
        sigma=_SIGMA, gsd2=gsd2_from_sigma(_SIGMA),
        floor_status="not_applicable" if supplied else "floored",
        # Below the derived GSD2, so 'floored' is self-consistent -- the model
        # refuses a 'floored' exchange whose gsd2 sits under its floor.
        floor_gsd2=None if supplied else 1.10,
        floor_detail="does not apply" if supplied else "floored",
        floor_reason=None,
        uncertainty_basis=basis,
    )


def _view(basis: str) -> AuthoredDatabaseView:
    act = AuthoredActivity(
        code="c375813659c14b0c957afc46bc82df71",
        name="Polycarbonate, 75 % recycled - supplier PCF",
        reference_product="polycarbonate, 75 % recycled", unit="kilogram",
        location="GLO", scope="partial", scope_note="PCF only",
        exchanges=[_exchange(basis)],
    )
    db = AuthoredDatabase(name="Supplier PCFs (worked example)", created_at="t",
                          updated_at="t", activities=[act])
    return AuthoredDatabaseView(
        database=db,
        status=MaterialisationStatus(database=db.name, state="in_sync", detail=""),
    )


@pytest.mark.parametrize("basis", BASES)
def test_the_basis_reaches_the_client_through_the_declared_response_model(basis):
    """Encoded the way FastAPI encodes it for `response_model=AuthoredDatabaseView`."""
    enc = jsonable_encoder(_view(basis))
    ex = enc["database"]["activities"][0]["exchanges"][0]
    assert ex.get("uncertainty_basis") == basis, (
        "uncertainty_basis did not survive encoding. The editor defaults a "
        "missing value to 'ecoinvent', so the supplied basis would vanish with "
        "no error anywhere."
    )
    # The basis alone is not enough: the editor reads floor_status to decide
    # whether to show "no floor" or the unfloored warning.
    assert ex.get("floor_status") == ("not_applicable" if basis == "supplied" else "floored")


def test_a_response_that_drops_the_field_is_detectably_different():
    """Anti-vacuity: the assertion above must be able to fail.

    Encoding with the field excluded is what a narrowed response model or an
    `exclude` would produce, and it must not look like a supplied exchange.
    """
    enc = jsonable_encoder(
        _view("supplied"),
        exclude={"database": {"activities": {"__all__": {"exchanges": {"__all__": {"uncertainty_basis"}}}}}},
    )
    ex = enc["database"]["activities"][0]["exchanges"][0]
    assert "uncertainty_basis" not in ex
    # ...and this is the silent part: every other field still reads as supplied,
    # so nothing downstream can tell that the basis was lost rather than never set.
    assert ex["basic_variance_source"] == "supplied"
    assert ex["floor_status"] == "not_applicable"
