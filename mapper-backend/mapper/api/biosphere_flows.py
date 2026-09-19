# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Biosphere flows grouped by substance: the compartment picker's backend.

A separate prefix from ``/authored-databases`` on purpose: that router has a
``GET /{name}`` route that would otherwise capture ``/flows``.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from mapper.core import flow_characterisation as fc
from mapper.models.flow_schemas import FlowSearchResponse

router = APIRouter(prefix="/biosphere-flows", tags=["biosphere-flows"])


def _bw2():
    import bw2data

    return bw2data


def _statistics() -> tuple[dict, dict, dict]:
    """(usage, floors, variances) from the shared ecoinvent statistics pass.

    Never fails the search: without ecoinvent (a biosphere-only project, a
    fresh import) usage is zero and no floor is available, which is true.
    """
    from mapper.core import authored_engine as eng

    try:
        backend = eng.Bw2Backend()
        stats = backend.all_stats()
        usage = backend.usage()
    except Exception:
        return {}, {}, {}
    # The same helpers resolve_exchange uses, so the picker cannot tell the
    # editor something about a flow that saving would then contradict.
    floors = {}
    variances = {}
    for k, st in stats.items():
        floor = eng.floor_gsd2_of(st)
        if floor is not None:
            floors[k] = (st.n_lognormal, floor)
        bv = eng.derived_basic_variance(st)
        if bv is not None:
            variances[k] = (st.n_basic_variance, bv)
    return usage, floors, variances


@router.get("/search", response_model=FlowSearchResponse)
async def search_flows(
    q: str = Query("", description="Substance name, or part of one (case-insensitive)"),
    database: str | None = Query(None, description="Biosphere database; default: the first installed"),
    family: str | None = Query(None, description="Method family; default: EF v3.1, else the first installed"),
    limit: int = Query(30, ge=1, le=200),
) -> FlowSearchResponse:
    bd = _bw2()
    dbs = fc.biosphere_databases(bd)
    if database is None:
        if not dbs:
            raise HTTPException(status_code=404, detail="No biosphere database is installed in this project.")
        database = dbs[0]
    elif database not in dbs:
        raise HTTPException(status_code=404, detail=f"{database!r} is not an installed biosphere database.")

    fams = fc.families(bd)
    fam = fc.pick_family(family, fams)
    family_methods = [tuple(m) for m in bd.methods if len(m) >= 3 and m[0] == fam]
    usage, floors, variances = _statistics()
    groups, truncated = fc.search_groups(
        fc.biosphere_flows(bd, database), fc.characterisation_index(bd),
        fam, family_methods, q, usage=usage, floors=floors, variances=variances, limit=limit,
    )
    return FlowSearchResponse(database=database, family=fam, families=fams,
                              groups=groups, truncated=truncated)
