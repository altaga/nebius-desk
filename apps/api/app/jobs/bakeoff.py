"""Light provider bakeoff — latency/error rate for configured endpoints."""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

from app.edge.files import resolve_path, write_file

BAKEOFF_REL = ".desk/bakeoff.json"
REPORT_REL = ".desk/bakeoff-report.md"


def load_targets() -> list[dict]:
    path = resolve_path(BAKEOFF_REL)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, list):
        targets = data
    else:
        targets = data.get("targets") or []
    out = []
    for t in targets:
        if isinstance(t, str):
            out.append({"name": t, "url": t})
        elif isinstance(t, dict) and t.get("url"):
            out.append({"name": str(t.get("name") or t["url"]), "url": str(t["url"])})
    return out


def write_default_bakeoff(targets: list[dict] | None = None) -> Path:
    path = resolve_path(BAKEOFF_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "targets": targets
        or [
            {"name": "example", "url": "https://example.com"},
        ]
    }
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    return path


def run_bakeoff(*, repeats: int = 3, timeout_s: float = 8.0) -> dict:
    targets = load_targets()
    repeats = max(1, min(int(repeats), 20))
    if not targets:
        return {
            "ok": False,
            "error": f"No targets. Create {BAKEOFF_REL} with {{\"targets\": [{{\"name\":…,\"url\":…}}]}}.",
            "results": [],
        }

    results = []
    with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
        for t in targets:
            latencies: list[float] = []
            errors = 0
            last_status = None
            for _ in range(repeats):
                t0 = time.monotonic()
                try:
                    resp = client.get(t["url"])
                    last_status = resp.status_code
                    latencies.append((time.monotonic() - t0) * 1000)
                    if resp.status_code >= 500:
                        errors += 1
                except httpx.HTTPError:
                    errors += 1
                    latencies.append((time.monotonic() - t0) * 1000)
            avg = round(sum(latencies) / len(latencies), 1) if latencies else None
            results.append(
                {
                    "name": t["name"],
                    "url": t["url"],
                    "repeats": repeats,
                    "errors": errors,
                    "error_rate": round(errors / repeats, 4),
                    "avg_latency_ms": avg,
                    "last_status": last_status,
                }
            )

    lines = [
        "# Bakeoff report",
        "",
        f"Repeats per target: {repeats}",
        "",
        "| Name | Avg ms | Errors | Last status |",
        "|---|---:|---:|---:|",
    ]
    for r in results:
        lines.append(
            f"| {r['name']} | {r['avg_latency_ms']} | {r['errors']}/{r['repeats']} | {r['last_status']} |"
        )
    write_file(REPORT_REL, "\n".join(lines) + "\n")
    return {"ok": True, "results": results, "report": REPORT_REL}
