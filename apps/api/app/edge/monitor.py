"""Live host snapshot read from /proc and /sys (Jetson-aware). No synthetic values."""

from __future__ import annotations

import glob
import os
import platform
import shutil
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

GPU_LOAD_PATHS = (
    "/sys/devices/platform/gpu.0/load",
    "/sys/devices/gpu.0/load",
    "/sys/devices/platform/17000000.gpu/load",
    "/sys/devices/platform/bus@0/17000000.gpu/load",
)


def _read(path: str) -> str | None:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _meminfo() -> tuple[float | None, float | None]:
    raw = _read("/proc/meminfo")
    if not raw:
        return None, None
    vals: dict[str, int] = {}
    for line in raw.splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            vals[key] = int(parts[0])
    total = vals.get("MemTotal")
    avail = vals.get("MemAvailable")
    if total is None or avail is None:
        return None, None
    return round((total - avail) / 1024), round(total / 1024)


def _gpu_load_pct() -> float | None:
    for path in GPU_LOAD_PATHS:
        raw = _read(path)
        if raw and raw.isdigit():
            return round(int(raw) / 10, 1)
    return None


def _max_temp_c() -> float | None:
    temps: list[float] = []
    for zone in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
        raw = _read(zone)
        if raw and raw.lstrip("-").isdigit():
            value = int(raw) / 1000
            if 0 < value < 120:
                temps.append(value)
    return round(max(temps), 1) if temps else None


# Rolling /proc/stat sample — avoids sleeping 200ms on every Health request.
_cpu_prev: tuple[int, int, float] | None = None  # idle, total, monotonic


def _cpu_sample() -> tuple[int, int] | None:
    raw = _read("/proc/stat")
    if not raw:
        return None
    parts = raw.splitlines()[0].split()
    if not parts or parts[0] != "cpu":
        return None
    nums = [int(n) for n in parts[1:] if n.isdigit()]
    if len(nums) < 4:
        return None
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
    return idle, sum(nums)


def _cpu_pct() -> float | None:
    """Non-blocking CPU % from the gap since the last Health call. None without procfs."""
    global _cpu_prev
    now = time.monotonic()
    cur = _cpu_sample()
    if not cur:
        return None
    prev = _cpu_prev
    _cpu_prev = (cur[0], cur[1], now)
    if not prev:
        return None
    idle_d = cur[0] - prev[0]
    total_d = cur[1] - prev[1]
    if total_d <= 0:
        return None
    return round(100 * (1 - idle_d / total_d), 1)


_SNAPSHOT_CACHE: tuple[float, dict] | None = None
_SNAPSHOT_TTL_S = 0.75


def _cached_snapshot(build) -> dict:
    global _SNAPSHOT_CACHE
    now = time.monotonic()
    if _SNAPSHOT_CACHE and now - _SNAPSHOT_CACHE[0] < _SNAPSHOT_TTL_S:
        return _SNAPSHOT_CACHE[1]
    data = build()
    _SNAPSHOT_CACHE = (now, data)
    return data


def _disk() -> dict:
    path = "/" if os.name != "nt" else (os.environ.get("SystemDrive", "C:") + "\\")
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return {"disk_path": path, "disk_used_gb": None, "disk_total_gb": None, "disk_used_pct": None}
    gib = 1024**3
    pct = round(usage.used / usage.total * 100, 1) if usage.total else None
    return {
        "disk_path": path,
        "disk_used_gb": round(usage.used / gib, 2),
        "disk_total_gb": round(usage.total / gib, 2),
        "disk_used_pct": pct,
    }


def _uptime_sec() -> int | None:
    raw = _read("/proc/uptime")
    return int(float(raw.split()[0])) if raw else None


def _model() -> str | None:
    raw = _read("/proc/device-tree/model")
    return raw.replace("\x00", "").strip() if raw else None


def _cpu_model() -> str | None:
    raw = _read("/proc/cpuinfo")
    if raw:
        for key in ("model name", "Hardware", "Processor"):
            for line in raw.splitlines():
                if line.startswith(f"{key}\t:") or line.startswith(f"{key} :"):
                    return line.split(":", 1)[1].strip() or None
    value = platform.processor().strip()
    return value or None


def _runtime_kind() -> str:
    if Path("/.dockerenv").exists():
        return "docker"
    if os.environ.get("KUBERNETES_SERVICE_HOST"):
        return "kubernetes"
    return "host"


def _dmi_info() -> dict[str, str | None]:
    return {
        "sys_vendor": _read("/sys/devices/virtual/dmi/id/sys_vendor"),
        "product_name": _read("/sys/devices/virtual/dmi/id/product_name"),
        "product_version": _read("/sys/devices/virtual/dmi/id/product_version"),
    }


def _local_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


_AWS_CACHE: tuple[float, dict] | None = None
_AWS_CACHE_TTL_S = 300.0


def _aws_metadata() -> dict[str, str | None]:
    global _AWS_CACHE
    now = time.monotonic()
    if _AWS_CACHE and now - _AWS_CACHE[0] < _AWS_CACHE_TTL_S:
        return _AWS_CACHE[1]

    base = "http://169.254.169.254/latest"
    token = None
    try:
        req = urllib.request.Request(
            f"{base}/api/token",
            method="PUT",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
        )
        with urllib.request.urlopen(req, timeout=0.25) as res:
            token = res.read().decode("utf-8").strip() or None
    except (OSError, urllib.error.URLError):
        token = None

    if not token:
        data = {
            "cloud_provider": None,
            "instance_id": None,
            "instance_type": None,
            "availability_zone": None,
            "local_ipv4": _local_ip(),
        }
        _AWS_CACHE = (now, data)
        return data

    headers = {"X-aws-ec2-metadata-token": token}

    def fetch(path: str) -> str | None:
        try:
            req = urllib.request.Request(f"{base}/meta-data/{path}", headers=headers)
            with urllib.request.urlopen(req, timeout=0.25) as res:
                return res.read().decode("utf-8").strip() or None
        except (OSError, urllib.error.URLError):
            return None

    data = {
        "cloud_provider": "aws",
        "instance_id": fetch("instance-id"),
        "instance_type": fetch("instance-type"),
        "availability_zone": fetch("placement/availability-zone"),
        "local_ipv4": fetch("local-ipv4") or _local_ip(),
    }
    _AWS_CACHE = (now, data)
    return data


def snapshot() -> dict:
    """Host readings from /proc and /sys. board-emu uses the same path — no fake Orin numbers."""

    def build() -> dict:
        from app.config import get_settings

        emu = get_settings().board_emu
        ram_used, ram_total = _meminfo()
        gpu = _gpu_load_pct()
        model = _model()
        dmi = _dmi_info()
        aws = _aws_metadata() if emu else {
            "cloud_provider": None,
            "instance_id": None,
            "instance_type": None,
            "availability_zone": None,
            "local_ipv4": _local_ip(),
        }
        if emu and not model:
            model = "Docker cloud board"
        from app.edge.identity import host_identity

        ident = host_identity()
        return {
            "host": ident["hostname"],
            "hostname": ident["hostname"],
            "os_user": ident["os_user"],
            "home": ident["home"],
            "desk_root": ident["desk_root"],
            "desk_root_is_home": ident["desk_root_is_home"],
            "model": model,
            "platform": platform.platform(),
            "arch": platform.machine() or None,
            "kernel": platform.release() or None,
            "runtime": _runtime_kind(),
            "cpu_model": _cpu_model(),
            "cpu_cores": os.cpu_count(),
            **dmi,
            **aws,
            "jetson_online": (not emu)
            and (bool(model and "jetson" in model.lower()) or gpu is not None),
            "uptime_sec": _uptime_sec(),
            "gpu_util_pct": gpu,
            "ram_used_mb": ram_used,
            "ram_total_mb": ram_total,
            "temp_c": _max_temp_c(),
            "cpu_pct": _cpu_pct(),
            **_disk(),
            "source": "board-emu" if emu else "host",
            **({"board_emu": True} if emu else {}),
        }

    return _cached_snapshot(build)
