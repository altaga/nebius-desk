from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _ensure_data_dir(url: str) -> None:
    if url.startswith("sqlite:///./"):
        Path("data").mkdir(parents=True, exist_ok=True)


settings = get_settings()
_ensure_data_dir(settings.database_url)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.auth import models as _auth_models  # noqa: F401
    from app.brains import models as _brain_models  # noqa: F401
    from app.chat import models as _chat_models  # noqa: F401
    from app.devices import models as _device_models  # noqa: F401
    from app.subscription import models as _sub_models  # noqa: F401
    from app.telemetry import models as _tel_models  # noqa: F401
    from app.tools import models as _tool_models  # noqa: F401
    from app.vault import models as _vault_models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_sqlite_columns()


def _ensure_sqlite_columns() -> None:
    """Add columns introduced after first create_all (SQLite has no ALTER via ORM)."""
    if not settings.database_url.startswith("sqlite"):
        return
    added = {
        "devices": {"agent_name": "VARCHAR(64) DEFAULT 'millie'"},
        "chat_sessions": {
            "device_id": "VARCHAR(64)",
            "pinned": "INTEGER NOT NULL DEFAULT 0",
            "pinned_at": "DATETIME",
        },
        "token_ledger": {
            "prompt_tokens": "INTEGER DEFAULT 0",
            "completion_tokens": "INTEGER DEFAULT 0",
            "cost_usd": "FLOAT DEFAULT 0",
        },
    }
    with engine.begin() as conn:
        for table, columns in added.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
