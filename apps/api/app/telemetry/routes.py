from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.config import get_settings
from app.db import get_db
from app.router import local_llm
from app.router.pricing import canonical_model, model_info
from app.subscription.service import subscription_view
from app.telemetry.service import session_stats

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


@router.get("/session/{session_id}")
def get_session_telemetry(
    session_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    return session_stats(db, session_id)


@router.get("/budget")
def get_budget(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    allowance = subscription_view(db, _user.id)["allowances"]
    return {
        "llm_mode": settings.llm_mode,
        "daily_budget_usd": allowance["cloud_credit_usd"],
        "daily_spent_usd": allowance["cloud_spent_usd"],
        "remaining_usd": allowance["cloud_remaining_usd"],
        "tavily_credit_cap": allowance["tavily_credits"],
        "tavily_credits_spent": allowance["tavily_credits_spent"],
        "tavily_credits_remaining": allowance["tavily_credits_remaining"],
    }


@router.get("/models")
async def get_models(_user: User = Depends(get_current_user)) -> dict:
    """The models the router can use right now, with live prices and availability."""
    settings = get_settings()
    cloud = []
    for role, model in (
        ("nano", canonical_model(settings.nebius_model_balanced)),
        ("fast", canonical_model(settings.nebius_model_fast)),
        ("heavy", canonical_model(settings.nebius_model_heavy)),
        ("ultra", canonical_model(settings.nebius_model_ultra)),
    ):
        info = await model_info(model)
        cloud.append(
            {
                "role": role,
                "model": model,
                "input_per_m": info.input_per_m,
                "output_per_m": info.output_per_m,
                "context_window": info.context_window,
                "price_source": info.source,
            }
        )
    return {
        "llm_mode": settings.llm_mode,
        "cloud": cloud,
        "local": {
            "model": settings.ollama_model,
            "available": await local_llm.is_available(settings),
            "context_window": settings.ollama_context_tokens,
        },
    }
