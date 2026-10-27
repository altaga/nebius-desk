from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_db
from app.subscription.service import subscription_view

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("")
def get_subscription(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return subscription_view(db, user.id)
