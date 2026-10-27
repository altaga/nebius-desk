import hmac
import re

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.security import decode_access_token, hash_password
from app.auth.service import get_user_by_username
from app.auth.totp import generate_totp_secret
from app.cloudlink import relay_secret
from app.db import get_db
from app.subscription.service import ensure_subscription

bearer = HTTPBearer(auto_error=False)
_USER = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _relay_user(request: Request, db: Session) -> User | None:
    """The board agent is the only caller that knows the local relay secret."""
    secret = relay_secret()
    given = request.headers.get("x-desk-relay") or ""
    username = (request.headers.get("x-desk-user") or "").strip()
    if not secret or not given or not hmac.compare_digest(given, secret):
        return None
    if not _USER.match(username):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid relay user")
    user = get_user_by_username(db, username)
    if user:
        return user
    user = User(
        username=username,
        password_hash=hash_password(os_token()),
        totp_secret=generate_totp_secret(),
        totp_enabled=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    ensure_subscription(db, user.id)
    return user


def os_token() -> str:
    import secrets

    return secrets.token_urlsafe(32)


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    relay_user = _relay_user(request, db)
    if relay_user:
        return relay_user
    if not creds or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    username = decode_access_token(creds.credentials)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user = get_user_by_username(db, username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user
