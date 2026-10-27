"""Lifetime Tavily credit cap. One basic search costs 1 credit."""

from __future__ import annotations

import threading

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.tools.models import TavilyLedger

_lock = threading.Lock()

BASIC_SEARCH_CREDITS = 1


class TavilyCapReached(Exception):
    def __init__(self, spent: int, cap: int) -> None:
        self.spent = spent
        self.cap = cap
        super().__init__(f"Tavily credit cap reached ({spent} of {cap}).")


def credits_spent(db: Session) -> int:
    total = db.query(func.coalesce(func.sum(TavilyLedger.credits), 0)).scalar()
    return int(total or 0)


def credits_remaining(db: Session, cap: int) -> int:
    return max(0, cap - credits_spent(db))


def reserve(db: Session, cap: int, cost: int, note: str) -> int:
    """Commit a spend before the HTTP call. Returns credits still left after it."""
    with _lock:
        spent = credits_spent(db)
        if spent + cost > cap:
            raise TavilyCapReached(spent, cap)
        db.add(TavilyLedger(credits=cost, note=note[:200]))
        db.commit()
        return cap - (spent + cost)


def refund(db: Session, cost: int, note: str) -> None:
    with _lock:
        db.add(TavilyLedger(credits=-cost, note=f"refund:{note}"[:200]))
        db.commit()
