from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.security import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.auth.totp import (
    build_otpauth_url,
    generate_totp_secret,
    qr_png_base64,
    verify_totp,
)
from app.config import get_settings


def ensure_bootstrap_user(db: Session) -> User | None:
    """Create default admin on first boot; returns user if newly created (for QR setup)."""
    settings = get_settings()
    existing = db.query(User).filter(User.username == settings.bootstrap_username).first()
    if existing:
        # Keep password in sync with env on boot; disable 2FA while auth_require_totp is off
        changed = False
        if not settings.auth_require_totp and existing.totp_enabled:
            existing.totp_enabled = False
            changed = True
        if settings.bootstrap_password:
            existing.password_hash = hash_password(settings.bootstrap_password)
            changed = True
        if changed:
            db.add(existing)
            db.commit()
        return None

    secret = generate_totp_secret()
    user = User(
        username=settings.bootstrap_username,
        password_hash=hash_password(settings.bootstrap_password),
        totp_secret=secret,
        # 2FA off until we wire authenticator / email flow
        totp_enabled=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_setup_payload(user: User) -> dict:
    url = build_otpauth_url(user.username, user.totp_secret)
    return {
        "username": user.username,
        "totp_secret": user.totp_secret,
        "otpauth_url": url,
        "qr_png_base64": qr_png_base64(url),
        "message": (
            "Scan this QR with Google Authenticator / Authy. "
            "Default password is BOOTSTRAP_PASSWORD from .env — change it after first login."
        ),
    }


def authenticate(db: Session, username: str, password: str, totp_code: str) -> tuple[str, int]:
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    settings = get_settings()
    if settings.auth_require_totp and user.totp_enabled:
        if not verify_totp(user.totp_secret, totp_code or ""):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid 2FA code",
            )
    return create_access_token(user.username)


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()
