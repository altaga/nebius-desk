from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_db
from app.vault.schemas import PutSecretRequest, SecretName
from app.vault.service import delete_secret, list_names, put_secret

router = APIRouter(prefix="/vault", tags=["vault"])


@router.get("", response_model=list[SecretName])
def api_list_secrets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SecretName]:
    return [SecretName(name=name) for name in list_names(db, user.id)]


@router.put("", response_model=SecretName)
def api_put_secret(
    body: PutSecretRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SecretName:
    return SecretName(name=put_secret(db, user.id, body.name, body.value))


@router.delete("/{name}", response_model=dict)
def api_delete_secret(
    name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    delete_secret(db, user.id, name)
    return {"ok": True}
