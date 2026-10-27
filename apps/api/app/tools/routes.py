from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_db
from app.config import get_settings
from app.subscription.service import is_active as subscription_active
from app.subscription.service import tavily_allowance
from app.tools.credits import TavilyCapReached
from app.tools.tavily import web_search

router = APIRouter(prefix="/tools", tags=["tools"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)


@router.post("/tavily")
async def tavily_search(
    body: SearchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if not subscription_active(db, user.id):
        raise HTTPException(
            status_code=402,
            detail={"error": "subscription_inactive", "tool": "tavily"},
        )
    try:
        cap = tavily_allowance(get_settings().tavily_credit_cap)
        return await web_search(db, body.query, credit_cap=cap)
    except TavilyCapReached as exc:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "tavily_credit_cap",
                "credits_spent": exc.spent,
                "credit_cap": exc.cap,
            },
        ) from exc
