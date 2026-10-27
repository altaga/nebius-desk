from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TokenLedger(Base):
    __tablename__ = "token_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    day: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    route: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128))
    original_tokens: Mapped[int] = mapped_column(Integer, default=0)
    sent_tokens: Mapped[int] = mapped_column(Integer, default=0)
    saved_tokens: Mapped[int] = mapped_column(Integer, default=0)
    nebius_tokens: Mapped[int] = mapped_column(Integer, default=0)
    local_tokens: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
