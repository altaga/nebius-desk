import base64
import io

import pyotp
import qrcode
from qrcode.image.pure import PyPNGImage


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def build_otpauth_url(username: str, secret: str, issuer: str = "Nebius Desk") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def qr_png_base64(otpauth_url: str) -> str:
    try:
        img = qrcode.make(otpauth_url, image_factory=PyPNGImage)
        buf = io.BytesIO()
        img.save(buf)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        # Secret + otpauth_url still enough for Authenticator apps
        return ""
