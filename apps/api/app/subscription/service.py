"""One Desk plan per user. Inactive plans keep the Jetson, and close Nebius and Tavily."""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

import httpx

from app.auth.models import User
from app.cloudlink import cloud_config
from app.config import get_settings
from app.subscription.catalog import (
    CLOUD_CREDIT_USD,
    FAST_INPUT_PER_M,
    FAST_OUTPUT_PER_M,
    INSTALL,
    PLAN_ID,
    PLAN_NAME,
    PRICE_LABEL,
    TAVILY_CREDITS,
    TOOLS,
)
from app.subscription.models import Subscription
from app.telemetry.models import TokenLedger
from app.tools.credits import credits_spent


def ensure_subscription(db: Session, user_id: int) -> Subscription:
    row = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    if row:
        return row
    row = Subscription(user_id=user_id, plan_id=PLAN_ID, status="active")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def ensure_bootstrap_subscription(db: Session) -> None:
    settings = get_settings()
    user = db.query(User).filter(User.username == settings.bootstrap_username).first()
    if user:
        ensure_subscription(db, user.id)


def is_active(db: Session, user_id: int) -> bool:
    row = ensure_subscription(db, user_id)
    return row.status == "active"


def cloud_spent_usd(db: Session, user_id: int) -> float:
    total = (
        db.query(func.coalesce(func.sum(TokenLedger.cost_usd), 0.0))
        .filter(TokenLedger.user_id == user_id)
        .scalar()
    )
    return float(total or 0.0)


def tavily_allowance(key_cap: int) -> int:
    """Plan credits, never above the real key cap."""
    return max(0, min(key_cap, TAVILY_CREDITS))


def jetson_savings(db: Session, user_id: int) -> dict:
    """What local turns would have cost on the fast Nebius model."""
    tokens, turns = (
        db.query(
            func.coalesce(func.sum(TokenLedger.local_tokens), 0),
            func.count(TokenLedger.id),
        )
        .filter(TokenLedger.user_id == user_id, TokenLedger.route == "local")
        .one()
    )
    local_tokens = int(tokens or 0)
    blended_per_m = (FAST_INPUT_PER_M + FAST_OUTPUT_PER_M) / 2
    return {
        "local_turns": int(turns or 0),
        "local_tokens": local_tokens,
        "avoided_usd": round(local_tokens * blended_per_m / 1_000_000, 4),
        "rate_per_million": blended_per_m,
        "basis": "Fast Nebius list price, half input and half output, on tokens the Jetson answered.",
    }


def _gateway_balance() -> dict | None:
    cloud = cloud_config()
    if not cloud:
        return None
    try:
        resp = httpx.get(
            f"{cloud[0]}/v1/gateway/balance",
            headers={"Authorization": f"Bearer {cloud[1]}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
    except httpx.HTTPError:
        return None
    return data if isinstance(data, dict) else None


def subscription_view(db: Session, user_id: int) -> dict:
    row = ensure_subscription(db, user_id)
    settings = get_settings()
    remote = _gateway_balance()
    if remote:
        active = bool(remote.get("active"))
        credit_usd = float(remote.get("cloud_credit_usd") or CLOUD_CREDIT_USD)
        cloud_spent = float(remote.get("cloud_spent_usd") or 0)
        cloud_left = float(remote.get("cloud_remaining_usd") or 0)
        tavily_cap = int(remote.get("tavily_credits") or 0)
        tavily_spent = int(remote.get("tavily_credits_spent") or 0)
        status = str(remote.get("status") or row.status)
    else:
        active = row.status == "active"
        cloud_spent = cloud_spent_usd(db, user_id)
        cloud_left = max(0.0, CLOUD_CREDIT_USD - cloud_spent)
        tavily_cap = tavily_allowance(settings.tavily_credit_cap)
        tavily_spent = credits_spent(db)
        status = row.status
        credit_usd = CLOUD_CREDIT_USD
    return {
        "plan_id": row.plan_id,
        "plan_name": PLAN_NAME,
        "status": status,
        "price_label": PRICE_LABEL,
        "install": INSTALL,
        "active": active,
        "allowances": {
            "cloud_credit_usd": credit_usd,
            "cloud_spent_usd": round(cloud_spent, 6),
            "cloud_remaining_usd": round(cloud_left, 6),
            "tavily_credits": tavily_cap,
            "tavily_credits_spent": tavily_spent,
            "tavily_credits_remaining": max(0, tavily_cap - tavily_spent),
            "remote_access": "unlimited",
            "local_processing": "unlimited",
        },
        "savings": jetson_savings(db, user_id),
        "tools": [{**tool, "included": active} for tool in TOOLS],
    }
