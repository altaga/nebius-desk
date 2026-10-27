from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.router.types import RouteResult
from app.telemetry.models import TokenLedger


def record_turn(db: Session, *, user_id: int, session_id: str, result: RouteResult) -> None:
    db.add(
        TokenLedger(
            user_id=user_id,
            session_id=session_id,
            day=date.today().isoformat(),
            route=result.route,
            model=result.model,
            original_tokens=result.original_tokens,
            sent_tokens=result.sent_tokens,
            saved_tokens=result.saved_tokens,
            nebius_tokens=result.nebius_tokens,
            local_tokens=result.local_tokens,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            cost_usd=result.cost_usd,
        )
    )
    db.commit()


def session_stats(db: Session, session_id: str) -> dict:
    saved, original, nebius, local, cost, turns = (
        db.query(
            func.coalesce(func.sum(TokenLedger.saved_tokens), 0),
            func.coalesce(func.sum(TokenLedger.original_tokens), 0),
            func.coalesce(func.sum(TokenLedger.nebius_tokens), 0),
            func.coalesce(func.sum(TokenLedger.local_tokens), 0),
            func.coalesce(func.sum(TokenLedger.cost_usd), 0.0),
            func.count(TokenLedger.id),
        )
        .filter(TokenLedger.session_id == session_id)
        .one()
    )
    last = (
        db.query(TokenLedger)
        .filter(TokenLedger.session_id == session_id)
        .order_by(TokenLedger.id.desc())
        .first()
    )
    original_i, saved_i = int(original or 0), int(saved or 0)
    return {
        "session_id": session_id,
        "turns": int(turns or 0),
        "saved_tokens": saved_i,
        "original_tokens": original_i,
        "nebius_tokens": int(nebius or 0),
        "local_tokens": int(local or 0),
        "saved_pct": round(saved_i / original_i * 100, 1) if original_i else 0.0,
        "cost_usd": round(float(cost or 0.0), 6),
        "last_prompt_tokens": last.prompt_tokens if last else 0,
        "last_model": last.model if last else None,
        "last_route": last.route if last else None,
    }
