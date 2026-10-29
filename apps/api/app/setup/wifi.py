"""Wi-Fi apply. Dummy on Docker / for now; real nmcli on a Jetson comes later."""

from __future__ import annotations


def connect_dummy(ssid: str, password: str) -> dict:
    name = (ssid or "").strip()
    if not name:
        raise ValueError("wifi_ssid_required")
    _ = password  # stored nowhere — dummy link does not join a real AP
    return {
        "ssid": name,
        "connected": True,
        "dummy": True,
        "detail": "Dummy link on Docker. A real Jetson will join this SSID over NetworkManager later.",
    }
