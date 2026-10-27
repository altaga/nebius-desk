from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TavilyLedger(Base):
    """Lifetime credit ledger. Positive rows spend; negative rows refund a failed call."""

    __tablename__ = "tavily_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    credits: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
