"""Encrypt secret values with a key derived from the desk JWT secret."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

_SALT = b"nebius-desk-vault-v1"


def _fernet() -> Fernet:
    raw = hashlib.pbkdf2_hmac("sha256", get_settings().jwt_secret.encode(), _SALT, 100_000, dklen=32)
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_value(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_value(ciphertext: str) -> str | None:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError):
        return None
