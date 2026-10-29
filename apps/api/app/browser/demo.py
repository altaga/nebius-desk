"""Demo videos and rendered images on the board's Chromium.

record: open a URL in a fresh recording context, play scripted steps with a visible
cursor, save to Demos/ (webm; mp4/gif when system ffmpeg exists).
render: HTML or SVG → PNG/JPEG under the desk root (thumbnails, diagrams, mockups).
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.browser import runtime
from app.edge.files import fs_root, resolve_path

log = logging.getLogger(__name__)

DEMOS_REL = "Demos"
IMAGES_REL = "Images"
MAX_STEPS = 40
MAX_RECORD_SECONDS = 120
MAX_WAIT_SECONDS = 10.0
MAX_TYPE_CHARS = 300
MAX_HTML_CHARS = 200_000
STEP_GAP_MS = 450
FFMPEG_TIMEOUT = 180
_DIM_MIN, _DIM_MAX = 240, 1920

SIZES: dict[str, tuple[int, int]] = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "mobile": (390, 844),
    "square": (1080, 1080),
}
FORMATS = ("webm", "mp4", "gif")
_OPS = ("wait", "click", "hover", "type", "press", "scroll", "goto")
_KEY = re.compile(r"^[A-Za-z0-9+]{1,24}$")
_KV_LINE = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$")

# One recording at a time: it competes with Vite and the local model for RAM/CPU.
_RECORD_LOCK = threading.Lock()

# Playwright videos have no pointer — draw one so viewers can follow the demo.
CURSOR_JS = """
(() => {
  if (window.__deskCursor) return;
  window.__deskCursor = true;
  const mount = () => {
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'fixed', left: '0', top: '0', width: '18px', height: '18px',
      margin: '-9px 0 0 -9px', borderRadius: '50%', background: 'rgba(20,20,20,.55)',
      border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.45)',
      zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px,-100px)'
    });
    document.documentElement.appendChild(dot);
    let x = -100, y = -100;
    const place = (scale) => { dot.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(1); }, true);
    addEventListener('mouseup', () => place(1), true);
    addEventListener('mousedown', () => {
      place(0.7);
      const ring = document.createElement('div');
      Object.assign(ring.style, {
        position: 'fixed', left: `${x - 20}px`, top: `${y - 20}px`, width: '40px', height: '40px',
        borderRadius: '50%', border: '2px solid rgba(80,160,255,.9)', zIndex: '2147483646',
        pointerEvents: 'none', transition: 'transform .45s ease, opacity .45s ease',
        transform: 'scale(.3)', opacity: '1'
      });
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => { ring.style.transform = 'scale(1.25)'; ring.style.opacity = '0'; });
      setTimeout(() => ring.remove(), 520);
    }, true);
  };
  if (document.documentElement) mount();
  else addEventListener('DOMContentLoaded', mount);
})();
"""


@dataclass
class Step:
    op: str
    target: str = ""
    text: str = ""
    seconds: float = 0.0
    dy: float = 0.0


@dataclass
class RecordSpec:
    url: str
    width: int
    height: int
    fmt: str
    name: str
    steps: list[Step]
    errors: list[str]
    step_errors: list[str]


@dataclass
class RenderSpec:
    html: str
    width: int
    height: int
    scale: int
    out: str
    errors: list[str]


def _short(exc: BaseException) -> str:
    first = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
    return first[:200]


def _is_web_url(url: str) -> bool:
    return bool(re.match(r"^https?://\S+$", url or ""))


def parse_size(raw: str | None, default: str = "720p") -> tuple[int, int] | None:
    text = (raw or default).strip().lower()
    if text in SIZES:
        return SIZES[text]
    found = re.fullmatch(r"(\d{3,4})\s*[x×]\s*(\d{3,4})", text)
    if not found:
        return None
    w, h = int(found.group(1)), int(found.group(2))
    return max(_DIM_MIN, min(_DIM_MAX, w)), max(_DIM_MIN, min(_DIM_MAX, h))


def safe_name(raw: str | None, default: str = "demo") -> str:
    name = re.sub(r"[^\w.-]+", "-", (raw or "").strip()).strip(".-")
    name = re.sub(r"\.(webm|mp4|gif|png|jpe?g)$", "", name, flags=re.I)
    return name[:60] or default


def parse_steps(raw: str) -> tuple[list[Step], list[str]]:
    steps: list[Step] = []
    errors: list[str] = []
    for n, line in enumerate((raw or "").splitlines(), 1):
        text = re.sub(r"^[-*]\s*", "", line.strip())
        if not text or text.startswith("#"):
            continue
        if len(steps) >= MAX_STEPS:
            errors.append(f"only the first {MAX_STEPS} steps run")
            break
        op, _, rest = text.partition(" ")
        op, rest = op.lower().rstrip(":"), rest.strip()
        if op not in _OPS:
            errors.append(f"step {n}: unknown '{op}' (use {'|'.join(_OPS)})")
            continue
        try:
            steps.append(_parse_step(op, rest))
        except ValueError as exc:
            errors.append(f"step {n}: {exc}")
    return steps, errors


def _parse_step(op: str, rest: str) -> Step:
    if op == "wait":
        return Step(op, seconds=max(0.0, min(MAX_WAIT_SECONDS, float(rest or 1))))
    if op == "scroll":
        return Step(op, dy=max(-5000.0, min(5000.0, float(rest or 600))))
    if op == "press":
        if not _KEY.match(rest):
            raise ValueError("press needs a key like Enter or Control+A")
        return Step(op, target=rest)
    if op == "goto":
        if not _is_web_url(rest):
            raise ValueError("goto needs an http(s) URL")
        return Step(op, target=rest)
    if op == "type":
        target, sep, text = rest.partition(" :: ")
        if not sep or not target.strip():
            raise ValueError("type needs 'selector :: text'")
        return Step(op, target=target.strip(), text=text[:MAX_TYPE_CHARS])
    if not rest:
        raise ValueError(f"{op} needs a selector")
    return Step(op, target=rest)


def _split_header(body: str, stop: re.Pattern[str]) -> tuple[dict[str, str], str]:
    """Leading `key: value` lines become options; the rest (from `stop`) is the payload."""
    opts: dict[str, str] = {}
    lines = (body or "").splitlines()
    for i, line in enumerate(lines):
        if stop.match(line.strip()):
            rest = lines[i + 1 :] if line.strip().lower() in ("---", "steps:") else lines[i:]
            return opts, "\n".join(rest)
        found = _KV_LINE.match(line.strip())
        if found:
            opts[found.group(1).lower()] = found.group(2).strip()
    return opts, ""


_STEPS_START = re.compile(rf"^(steps:|---|[-*]\s|(?:{'|'.join(_OPS)})(?:\s|$))", re.I)


def parse_record_spec(body: str) -> RecordSpec:
    opts, rest = _split_header(body, _STEPS_START)
    errors: list[str] = []
    url = opts.get("url", "")
    if not _is_web_url(url):
        errors.append("record needs url: http(s)://…")
    size = parse_size(opts.get("size"))
    if size is None:
        errors.append("size must be 720p|1080p|mobile|square|WxH")
        size = SIZES["720p"]
    fmt = (opts.get("format") or "webm").lower().lstrip(".")
    if fmt not in FORMATS:
        errors.append(f"format must be {'|'.join(FORMATS)}")
        fmt = "webm"
    steps, step_errors = parse_steps(rest)
    if not steps and not step_errors:
        steps = [Step("wait", seconds=3.0)]
    return RecordSpec(url, size[0], size[1], fmt, safe_name(opts.get("name")), steps, errors, step_errors)


def parse_render_spec(body: str) -> RenderSpec:
    opts, html = _split_header(body, re.compile(r"^(---|<)"))
    errors: list[str] = []
    html = html.strip()
    if not html:
        errors.append("render needs HTML or SVG after the options (or after ---)")
    if len(html) > MAX_HTML_CHARS:
        errors.append(f"HTML is too long (max {MAX_HTML_CHARS} chars)")
    if html.lower().startswith("<svg"):
        html = f"<!doctype html><html><body style='margin:0'>{html}</body></html>"
    size = parse_size(opts.get("size"), default="1200x630")
    if size is None:
        errors.append("size must be WxH (e.g. 1200x630) or 720p|1080p|mobile|square")
        size = (1200, 630)
    scale = 2 if (opts.get("scale") or "").strip().lower() in ("2", "2x") else 1
    out = (opts.get("out") or "").strip()
    if out and not re.search(r"\.(png|jpe?g)$", out, re.I):
        errors.append("out must end in .png or .jpg")
    return RenderSpec(html, size[0], size[1], scale, out, errors)


def _unique(path: Path) -> Path:
    if not path.exists():
        return path
    for n in range(2, 1000):
        candidate = path.with_name(f"{path.stem}-{n}{path.suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{path.stem}-{uuid.uuid4().hex[:6]}{path.suffix}")


def _rel(path: Path) -> str:
    return path.relative_to(fs_root()).as_posix()


# --- recording (Playwright thread) -------------------------------------------------


def _point_at(page: object, selector: str, pos: list[float]) -> tuple[float, float]:
    loc = page.locator(selector).first  # type: ignore[union-attr]
    loc.scroll_into_view_if_needed(timeout=8_000)
    box = loc.bounding_box(timeout=8_000)
    if not box:
        raise RuntimeError(f"{selector} is not visible")
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y, steps=18)  # type: ignore[union-attr]
    pos[:] = [x, y]
    page.wait_for_timeout(180)  # type: ignore[union-attr]
    return x, y


def _play_step(page: object, step: Step, pos: list[float]) -> None:
    if step.op == "wait":
        page.wait_for_timeout(step.seconds * 1000)  # type: ignore[union-attr]
    elif step.op in ("click", "hover"):
        x, y = _point_at(page, step.target, pos)
        if step.op == "click":
            page.mouse.click(x, y)  # type: ignore[union-attr]
    elif step.op == "type":
        x, y = _point_at(page, step.target, pos)
        page.mouse.click(x, y)  # type: ignore[union-attr]
        page.keyboard.type(step.text, delay=55)  # type: ignore[union-attr]
    elif step.op == "press":
        page.keyboard.press(step.target)  # type: ignore[union-attr]
    elif step.op == "scroll":
        notches = max(1, int(abs(step.dy) // 100))
        each = step.dy / notches
        for _ in range(notches):
            page.mouse.wheel(0, each)  # type: ignore[union-attr]
            page.wait_for_timeout(30)  # type: ignore[union-attr]
    elif step.op == "goto":
        page.goto(step.target, wait_until="domcontentloaded", timeout=25_000)  # type: ignore[union-attr]
        runtime._wait_for_app_paint(page)


def _record_impl(user_id: int, spec: RecordSpec, tmp: Path) -> dict:
    sess = runtime._get_or_open(user_id)
    size = {"width": spec.width, "height": spec.height}
    ctx = sess._browser.new_context(  # type: ignore[union-attr]
        viewport=size, record_video_dir=str(tmp), record_video_size=size
    )
    ctx.add_init_script(CURSOR_JS)
    page = ctx.new_page()
    errors: list[str] = []
    ran = 0
    started = time.monotonic()
    pos = [spec.width / 2, spec.height / 2]
    opened = False
    try:
        page.goto(spec.url, wait_until="domcontentloaded", timeout=25_000)
        runtime._wait_for_app_paint(page)
        opened = True
        page.mouse.move(*pos)
        page.wait_for_timeout(700)
        for step in spec.steps:
            if time.monotonic() - started > MAX_RECORD_SECONDS:
                errors.append(f"stopped at the {MAX_RECORD_SECONDS}s limit")
                break
            try:
                _play_step(page, step, pos)
                ran += 1
            except Exception as exc:  # noqa: BLE001 — keep recording; report the step
                errors.append(f"{step.op} {step.target}: {_short(exc)}".strip())
            page.wait_for_timeout(STEP_GAP_MS)
        page.wait_for_timeout(900)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"open {spec.url}: {_short(exc)}")
    final_url = page.url
    video = page.video
    ctx.close()  # flushes the video file
    raw = Path(video.path()) if video and opened else None
    return {
        "raw": str(raw) if raw else None,
        "seconds": round(time.monotonic() - started, 1),
        "steps_run": ran,
        "errors": errors,
        "final_url": final_url,
    }


def _ffmpeg_exe() -> str | None:
    # Jetson's apt ffmpeg is NVENC-only (no libx264/gif) and Orin Nano has no NVENC,
    # so prefer the static imageio-ffmpeg build.
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 — optional dependency
        return shutil.which("ffmpeg")


def _convert(raw: Path, out: Path, fmt: str) -> str | None:
    """Encode with ffmpeg. Returns an error string, or None on success."""
    ffmpeg = _ffmpeg_exe()
    if not ffmpeg:
        return "ffmpeg is not installed"
    if fmt == "mp4":
        args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-an"]
    else:
        args = ["-vf", "fps=12,scale='min(960,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                "-loop", "0"]
    try:
        done = subprocess.run(  # noqa: S603 — fixed argv, paths under the desk root
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), *args, str(out)],
            capture_output=True, text=True, timeout=FFMPEG_TIMEOUT, check=False,
        )
    except subprocess.TimeoutExpired:
        return f"ffmpeg took longer than {FFMPEG_TIMEOUT}s"
    if done.returncode != 0 or not out.is_file():
        return (done.stderr or "ffmpeg failed").strip().splitlines()[-1][:200]
    return None


def _finish_video(raw: Path, spec: RecordSpec) -> tuple[Path, str, str | None]:
    folder = resolve_path(DEMOS_REL)
    folder.mkdir(parents=True, exist_ok=True)
    note = None
    if spec.fmt != "webm":
        target = _unique(folder / f"{spec.name}.{spec.fmt}")
        problem = _convert(raw, target, spec.fmt)
        if problem is None:
            return target, spec.fmt, None
        target.unlink(missing_ok=True)
        note = f"kept webm ({problem})"
    target = _unique(folder / f"{spec.name}.webm")
    shutil.move(str(raw), target)
    return target, "webm", note


def record_demo(user_id: int, body: str) -> dict:
    """Blocking: call via asyncio.to_thread. Holds the Playwright thread while recording."""
    spec = parse_record_spec(body)
    base = {"kind": "record", "url": spec.url, "format": spec.fmt}
    if spec.errors:
        return {**base, "ok": False, "error": "; ".join(spec.errors)}
    if not _RECORD_LOCK.acquire(blocking=False):
        return {**base, "ok": False, "error": "another recording is still running on this board"}
    tmp = resolve_path(f"{runtime.ARTIFACTS_REL}/rec-{uuid.uuid4().hex[:8]}")
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        played = runtime._on_pw_thread(
            _record_impl, user_id, spec, tmp, timeout=MAX_RECORD_SECONDS + 90
        )
        errors = spec.step_errors + played["errors"]
        if not played["raw"]:
            return {**base, "ok": False, "error": "; ".join(errors) or "no video produced"}
        out, fmt, note = _finish_video(Path(played["raw"]), spec)
        rel = _rel(out)
        return {
            **base,
            "ok": True,
            "path": rel,
            "format": fmt,
            "bytes": out.stat().st_size,
            "seconds": played["seconds"],
            "steps_run": played["steps_run"],
            "steps_total": len(spec.steps),
            "final_url": played["final_url"],
            "step_errors": errors[:10],
            "note": note,
            "media": {"type": "video", "path": rel},
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        _RECORD_LOCK.release()


# --- rendering ---------------------------------------------------------------------


def _render_impl(user_id: int, spec: RenderSpec, jpeg: bool) -> bytes:
    sess = runtime._get_or_open(user_id)
    ctx = sess._browser.new_context(  # type: ignore[union-attr]
        viewport={"width": spec.width, "height": spec.height}, device_scale_factor=spec.scale
    )
    try:
        page = ctx.new_page()
        page.set_content(spec.html, wait_until="load", timeout=15_000)
        page.wait_for_timeout(150)
        if jpeg:
            return page.screenshot(type="jpeg", quality=88, full_page=False)
        return page.screenshot(type="png", full_page=False)
    finally:
        ctx.close()


def render_image(user_id: int, body: str) -> dict:
    """Blocking: call via asyncio.to_thread."""
    spec = parse_render_spec(body)
    base = {"kind": "render", "width": spec.width, "height": spec.height}
    if spec.errors:
        return {**base, "ok": False, "error": "; ".join(spec.errors)}
    if spec.out:
        target = resolve_path(spec.out)
    else:
        target = _unique(resolve_path(IMAGES_REL) / f"render-{time.strftime('%Y%m%d-%H%M%S')}.png")
    if target.is_dir():
        return {**base, "ok": False, "error": "out points at a folder"}
    jpeg = target.suffix.lower() in (".jpg", ".jpeg")
    data = runtime._on_pw_thread(_render_impl, user_id, spec, jpeg, timeout=40)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    rel = _rel(target)
    return {
        **base,
        "ok": True,
        "path": rel,
        "bytes": len(data),
        "scale": spec.scale,
        "media": {"type": "image", "path": rel},
    }
