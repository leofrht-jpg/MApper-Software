# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

import datetime
import re

from fastapi import APIRouter, HTTPException, Query, Response

from mapper.core.bw2_wrapper import (
    build_selection_csv,
    build_selection_xlsx,
    get_activities,
    get_activities_export_details,
    get_activity_detail,
    get_distinct_values,
    get_methods,
    search_all_activities,
)
from mapper.models.schemas import (
    ActivityDetail,
    ActivityDistinctValues,
    ActivityExportDetail,
    ActivityExportRequest,
    ActivityExportSelectionRequest,
    ActivityPage,
    ActivitySummary,
    MethodFamily,
)

router = APIRouter()


@router.get("/activities/search-all", response_model=list[ActivitySummary])
async def search_all(
    search: str = "",
    limit: int = 50,
    technosphere_only: bool = False,
) -> list[ActivitySummary]:
    """Search across all databases in the current project."""
    try:
        items = search_all_activities(search, limit=limit, technosphere_only=technosphere_only)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return [ActivitySummary(**a) for a in items]


# NOTE: /activities/{db}/distinct-values has 3 segments, so it doesn't collide
# with /activities/{db} (2 segments) — FastAPI routes by segment count first.
@router.get("/activities/{database_name}/distinct-values", response_model=ActivityDistinctValues)
async def list_distinct_values(database_name: str) -> ActivityDistinctValues:
    try:
        values = get_distinct_values(database_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ActivityDistinctValues(**values)


@router.get("/activities/{database_name}", response_model=ActivityPage)
async def list_activities(
    database_name: str,
    offset: int = 0,
    limit: int = 50,
    search: str | None = None,
    locations: list[str] | None = Query(default=None),
    units: list[str] | None = Query(default=None),
    sort_by: str = "name_asc",
) -> ActivityPage:
    try:
        items, total = get_activities(
            database_name,
            offset=offset,
            limit=limit,
            search=search,
            locations=locations,
            units=units,
            sort_by=sort_by,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ActivityPage(
        items=[ActivitySummary(**a) for a in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/activities/{database_name}/export-details",
    response_model=list[ActivityExportDetail],
)
async def export_details(
    database_name: str, payload: ActivityExportRequest
) -> list[ActivityExportDetail]:
    try:
        rows = get_activities_export_details(database_name, payload.codes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return [ActivityExportDetail(**r) for r in rows]


@router.post("/activities/{database_name}/export-selection")
async def export_selection(
    database_name: str, payload: ActivityExportSelectionRequest
) -> Response:
    fmt = (payload.format or "xlsx").lower()
    if fmt not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="format must be 'csv' or 'xlsx'")
    try:
        rows = get_activities_export_details(database_name, payload.codes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    date_tag = datetime.date.today().isoformat()
    safe_db = re.sub(r"[^A-Za-z0-9._-]+", "_", database_name) or "db"
    filename = f"activities_{safe_db}_{date_tag}.{fmt}"

    if fmt == "xlsx":
        content = build_selection_xlsx(rows)
        media_type = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    else:
        content = build_selection_csv(rows)
        media_type = "text/csv; charset=utf-8"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/activities/detail/{database_name}/{code}", response_model=ActivityDetail)
async def get_activity(database_name: str, code: str) -> ActivityDetail:
    try:
        detail = get_activity_detail(database_name, code)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ActivityDetail(**detail)


@router.get("/methods", response_model=list[MethodFamily])
async def list_methods() -> list[MethodFamily]:
    return [MethodFamily(**f) for f in get_methods()]
