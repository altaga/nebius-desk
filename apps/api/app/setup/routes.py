"""Unauthenticated local setup — the desk browser talks to the board on USB/Docker LAN."""

from __future__ import annotations

import socket

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import get_settings
from app.edge.identity import host_identity
from app.setup import pairing
from app.setup.store import public_board, set_credentials
from app.setup.wifi import connect_dummy

router = APIRouter(tags=["setup"])


class SetupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=4, max_length=200)
    wifi_ssid: str = Field(min_length=1, max_length=64)
    wifi_password: str = Field(default="", max_length=128)


def _payload(*, prefer_custom: bool = False) -> dict:
    settings = get_settings()
    board = public_board(prefer_custom=prefer_custom)
    pair = pairing.snapshot()
    host = host_identity()
    return {
        "ok": True,
        "hostname": host.get("hostname") or socket.gethostname(),
        "board_emu": bool(settings.board_emu),
        "name": board.get("name"),
        "factory_id": board.get("factory_id"),
        "has_password": board.get("has_password"),
        "wifi": board.get("wifi"),
        "paired": board.get("paired") or pair.get("status") == "paired",
        "code": pair.get("code"),
        "expires_in": pair.get("expires_in"),
        "pair_status": pair.get("status"),
        "error": pair.get("error"),
    }


@router.get("/setup")
def get_setup() -> dict:
    return _payload()


@router.post("/setup")
def post_setup(body: SetupRequest) -> dict:
    try:
        wifi = connect_dummy(body.wifi_ssid, body.wifi_password)
        set_credentials(body.name, body.password, wifi)
        pairing.start_or_resume(body.name.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)}) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail={"error": "pair_cloud_unreachable"}) from exc
    return _payload(prefer_custom=True)


@router.options("/setup")
def options_setup(request: Request) -> dict:
    _ = request
    return {"ok": True}
