import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.routes import router as auth_router
from app.brains.routes import router as brains_router
from app.auth.service import ensure_bootstrap_user
from app.chat.routes import router as chat_router
from app.config import get_settings
from app.db import SessionLocal, init_db
from app.devices.routes import router as devices_router
from app.edge.routes import router as edge_router
from app.guide.routes import router as guide_router
from app.router.local_llm import warm_up
from app.router.pricing import refresh_catalog
from app.sessions.routes import router as missions_router
from app.subscription.routes import router as subscription_router
from app.subscription.service import ensure_bootstrap_subscription
from app.telemetry.routes import router as telemetry_router
from app.tools.routes import router as tools_router
from app.vault.routes import router as vault_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        ensure_bootstrap_user(db)
        ensure_bootstrap_subscription(db)
    finally:
        db.close()
    await refresh_catalog()
    settings = get_settings()
    warm = None
    if not settings.board_emu:
        warm = asyncio.create_task(warm_up(settings))
    yield
    if warm:
        warm.cancel()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Hybrid Jetson edge + Nebius Token Factory orchestrator",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "app": settings.app_name,
            "llm_mode": settings.llm_mode,
            "board_emu": settings.board_emu,
            "models": ["nano", "fast", "heavy"] if settings.board_emu else None,
        }

    app.include_router(auth_router, prefix="/api")
    app.include_router(devices_router, prefix="/api")
    app.include_router(chat_router, prefix="/api")
    app.include_router(guide_router, prefix="/api")
    app.include_router(missions_router, prefix="/api")
    app.include_router(telemetry_router, prefix="/api")
    app.include_router(subscription_router, prefix="/api")
    app.include_router(tools_router, prefix="/api")
    app.include_router(edge_router, prefix="/api")
    app.include_router(brains_router, prefix="/api")
    app.include_router(vault_router, prefix="/api")
    return app


app = create_app()
