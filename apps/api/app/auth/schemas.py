from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    totp_code: str = Field(default="", max_length=12)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class Setup2FAResponse(BaseModel):
    username: str
    totp_secret: str
    otpauth_url: str
    qr_png_base64: str
    message: str


class MeResponse(BaseModel):
    id: int
    username: str
    totp_enabled: bool
