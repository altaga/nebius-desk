from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.auth.schemas import LoginRequest, MeResponse, Setup2FAResponse, TokenResponse
from app.auth.service import authenticate, ensure_bootstrap_user, get_setup_payload
from app.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    token, expires_in = authenticate(db, body.username, body.password, body.totp_code)
    return TokenResponse(access_token=token, expires_in=expires_in)


@router.get("/setup-2fa", response_model=Setup2FAResponse)
def setup_2fa(db: Session = Depends(get_db)) -> Setup2FAResponse:
    """Return QR for bootstrap user. Safe for first-run; requires knowing bootstrap password later."""
    created = ensure_bootstrap_user(db)
    user = created or db.query(User).order_by(User.id.asc()).first()
    if not user:
        ensure_bootstrap_user(db)
        user = db.query(User).order_by(User.id.asc()).first()
    assert user is not None
    return Setup2FAResponse(**get_setup_payload(user))


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(id=user.id, username=user.username, totp_enabled=user.totp_enabled)
