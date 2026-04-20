import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from mapper.api import mfa as _mfa
from mapper.api.router import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="MApper API")


@app.on_event("startup")
async def _hydrate() -> None:
    _mfa.hydrate_from_disk()

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


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")
