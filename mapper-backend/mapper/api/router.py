from fastapi import APIRouter

from mapper.api.activities import router as activities_router
from mapper.api.aesa import router as aesa_router
from mapper.api.bom import router as bom_router
from mapper.api.databases import router as databases_router
from mapper.api.ecoinvent import router as ecoinvent_router
from mapper.api.impact import router as impact_router
from mapper.api.lca import router as lca_router
from mapper.api.mfa import router as mfa_router
from mapper.api.plca import router as plca_router

router = APIRouter()
router.include_router(databases_router)
router.include_router(activities_router)
router.include_router(ecoinvent_router)
router.include_router(lca_router)
router.include_router(mfa_router)
router.include_router(bom_router)
router.include_router(plca_router)
router.include_router(impact_router)
router.include_router(aesa_router)
