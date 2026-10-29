from fastapi import APIRouter, Depends

from app.auth.deps import get_current_user
from app.auth.models import User
from app.ops.local import summary

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/summary")
def api_ops_summary(hours: float = 24.0, _user: User = Depends(get_current_user)) -> dict:
    """Aggregated board-local ops (works even when cloud ingest is down)."""
    return summary(hours=hours)
