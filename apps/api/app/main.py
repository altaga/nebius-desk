import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.routes import router as auth_router
from app.setup.cors import PrivateNetworkMiddleware
from app.setup.routes import router as setup_router
from app.brains.routes import router as brains_router
from app.auth.service import ensure_bootstrap_user
from app.browser.routes import router as browser_router
from app.chat.routes import router as chat_router
from app.config import get_settings
from app.db import SessionLocal, init_db
from app.devices.routes import router as devices_router
from app.edge.routes import router as edge_router
from app.guide.routes import router as guide_router
from app.jobs import runner as job_runner
from app.jobs.routes import router as jobs_router
from app.ops.routes import router as ops_router
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
    await job_runner.start_worker()
    settings = get_settings()
    warm = None
    browser_warm = None
    if not settings.board_emu:
        warm = asyncio.create_task(warm_up(settings))

        async def _warm_browser() -> None:
            # Chromium cold start is fine in the background; Live preview then reuses the session.
            try:
                from app.browser import runtime as browser_runtime

                await asyncio.to_thread(browser_runtime.warm_session, 0)
            except Exception:
                pass

        browser_warm = asyncio.create_task(_warm_browser())
    yield
    await job_runner.stop_worker()
    if warm:
        warm.cancel()
    if browser_warm:
        browser_warm.cancel()


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
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(PrivateNetworkMiddleware)

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "app": settings.app_name,
            "llm_mode": settings.llm_mode,
            "board_emu": settings.board_emu,
            "models": ["nano", "fast", "heavy"] if settings.board_emu else None,
        }

    app.include_router(setup_router)
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
    app.include_router(jobs_router, prefix="/api")
    app.include_router(ops_router, prefix="/api")
    app.include_router(browser_router, prefix="/api")
    return app


app = create_app()
