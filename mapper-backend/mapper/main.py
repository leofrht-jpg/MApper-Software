import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from mapper.api import dsm as _dsm
from mapper.api import parameters as _parameters
from mapper.api.router import router
from mapper.core import parameter_storage
from mapper.core.log_config import configure_logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
configure_logging()

app = FastAPI(title="MApper API")


@app.on_event("startup")
async def _hydrate() -> None:
    _dsm.hydrate_from_disk()
    _parameters.install_parameters(parameter_storage.load_all())

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST + WebSocket routes all live under /api
# WebSocket routes defined in ecoinvent.py and lca.py are included via the router
app.include_router(router, prefix="/api")


@app.exception_handler(Exception)
async def _log_unhandled(request: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("mapper.api").exception(
        "Unhandled exception on %s %s", request.method, request.url.path
    )
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")
