"""Daily spend guard based on the real cost of every Token Factory call."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import Settings
from app.telemetry.models import TokenLedger


@dataclass
class BudgetStatus:
    allowed: bool
    reason: str
    daily_spent_usd: float
    daily_budget_usd: float
    remaining_usd: float


def daily_spent_usd(db: Session) -> float:
    total = (
        db.query(func.coalesce(func.sum(TokenLedger.cost_usd), 0.0))
        .filter(TokenLedger.day == date.today().isoformat())
        .scalar()
    )
    return float(total or 0.0)


def check_budget(db: Session, settings: Settings, upcoming_usd: float) -> BudgetStatus:
    spent = daily_spent_usd(db)
    limit = settings.nebius_daily_budget_usd
    remaining = max(0.0, limit - spent)
    if spent + upcoming_usd > limit:
        return BudgetStatus(
            False,
            f"Daily Nebius budget reached (${spent:.4f} of ${limit:.2f}).",
            spent,
            limit,
            remaining,
        )
    return BudgetStatus(True, "ok", spent, limit, remaining)
