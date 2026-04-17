import bw2data
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from mapper.core.bw2_wrapper import (
    create_project,
    delete_project,
    duplicate_project,
    export_project,
    get_current_project,
    import_project,
    list_databases,
    list_projects,
    switch_project,
)
from mapper.models.schemas import (
    CreateProjectRequest,
    DatabaseResponse,
    DeleteProjectResponse,
    DuplicateProjectRequest,
    ExportProjectRequest,
    HealthResponse,
    ProjectResponse,
    SwitchProjectRequest,
)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    try:
        current = get_current_project()
    except Exception:
        current = "(none)"
    return HealthResponse(
        status="ok",
        brightway2_version=".".join(str(v) for v in bw2data.__version__),
        current_project=current,
    )


@router.get("/projects", response_model=list[ProjectResponse])
async def get_projects() -> list[ProjectResponse]:
    return [ProjectResponse(**p) for p in list_projects()]


@router.post("/projects/switch", response_model=ProjectResponse)
async def post_switch_project(body: SwitchProjectRequest) -> ProjectResponse:
    try:
        switch_project(body.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectResponse(name=body.name, is_current=True)


@router.post("/projects/create", response_model=ProjectResponse)
async def post_create_project(body: CreateProjectRequest) -> ProjectResponse:
    try:
        name = create_project(body.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectResponse(name=name, is_current=True)


@router.post("/projects/duplicate", response_model=ProjectResponse)
async def post_duplicate_project(body: DuplicateProjectRequest) -> ProjectResponse:
    try:
        name = duplicate_project(body.source_name, body.new_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectResponse(name=name, is_current=True)


@router.delete("/projects/{name}", response_model=DeleteProjectResponse)
async def delete_project_endpoint(name: str) -> DeleteProjectResponse:
    try:
        current = delete_project(name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return DeleteProjectResponse(deleted=True, current_project=current)


@router.post("/projects/export")
async def post_export_project(body: ExportProjectRequest) -> Response:
    try:
        data = export_project(body.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in body.name) or "project"
    return Response(
        content=data,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{safe}.mapperproj.tar.gz"'},
    )


@router.post("/projects/import", response_model=ProjectResponse)
async def post_import_project(file: UploadFile = File(...)) -> ProjectResponse:
    data = await file.read()
    try:
        name = import_project(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectResponse(name=name, is_current=True)


@router.get("/databases", response_model=list[DatabaseResponse])
async def get_databases() -> list[DatabaseResponse]:
    return [DatabaseResponse(**db) for db in list_databases()]
