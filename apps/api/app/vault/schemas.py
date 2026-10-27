from pydantic import BaseModel, Field


class SecretName(BaseModel):
    name: str


class PutSecretRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=8000)
