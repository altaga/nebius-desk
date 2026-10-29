"""Search-then-install with domain trust checks — block shady package sources.

Flow the model must follow:
  1. ```search``` official install docs for the tool
  2. ```install``` with tool/package name — we re-search, filter trusted hosts,
     match a known recipe, refuse curl|bash from unknown domains
  3. Operator still approves any shell that is not on the soft allowlist
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# Hosts we trust for install instructions / scripts (exact or suffix match).
TRUSTED_SUFFIXES: tuple[str, ...] = (
    "nodejs.org",
    "nodejs.dev",
    "python.org",
    "docs.python.org",
    "pypi.org",
    "docs.expo.dev",
    "expo.dev",
    "npmjs.com",
    "docs.npmjs.com",
    "yarnpkg.com",
    "pnpm.io",
    "rust-lang.org",
    "go.dev",
    "golang.org",
    "getcomposer.org",
    "ruby-lang.org",
    "dotnet.microsoft.com",
    "learn.microsoft.com",
    "adoptium.net",
    "temurin",
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "gitlab.com",
    "debian.org",
    "ubuntu.com",
    "snapcraft.io",
    "formulae.brew.sh",
    "brew.sh",
    "tavily.com",
)

# GitHub orgs / paths we treat as first-party for bootstrap scripts.
TRUSTED_GH_PATH_PREFIXES: tuple[str, ...] = (
    "/nvm-sh/nvm/",
    "/pyenv/pyenv/",
    "/ohmyzsh/ohmyzsh/",
    "/expo/",
    "/nodejs/",
)

# Typosquat / malware patterns — refuse immediately (pipe-to-shell checked separately).
_MALICIOUS_HINTS = re.compile(
    r"(?i)("
    r"free[-_]?crypto|wallet[-_]?drain|pastebin\.com/raw|"
    r"bit\.ly/|tinyurl\.com/|grabify|"
    r"base64\s+-d\s*\|\s*(?:ba)?sh|"
    r"chmod\s+\+x\s+/tmp/"
    r")"
)

_PIPE_SHELL = re.compile(
    r"(?i)(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b"
)


@dataclass
class InstallPlan:
    tool: str
    ok: bool
    trusted_urls: list[str]
    untrusted_urls: list[str]
    recipe: str | None
    warnings: list[str]
    needs_approval: bool
    error: str | None = None


def host_trusted(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    if any(host == s or host.endswith("." + s) for s in TRUSTED_SUFFIXES if "." in s):
        # Special-case github: only allow known orgs for raw install scripts.
        if host in ("github.com", "raw.githubusercontent.com", "objects.githubusercontent.com"):
            path = (urlparse(url).path or "").lower()
            if host.startswith("raw.") or "raw.githubusercontent" in host:
                return any(path.startswith(p) for p in TRUSTED_GH_PATH_PREFIXES)
            # github.com docs / releases pages for those orgs
            return any(p.strip("/") in path for p in ("nvm-sh/nvm", "pyenv/pyenv", "expo/", "nodejs/"))
        return True
    return False


def filter_hits(results: list[dict]) -> tuple[list[dict], list[dict]]:
    trusted, untrusted = [], []
    for row in results or []:
        url = (row.get("url") or "").strip()
        if not url:
            continue
        if host_trusted(url):
            trusted.append(row)
        else:
            untrusted.append(row)
    return trusted, untrusted


# Curated recipes — only returned when search found at least one trusted hit.
_RECIPES: dict[str, dict] = {
    "node": {
        "aliases": ("node", "nodejs", "npm", "nvm"),
        "recipe": (
            'export NVM_DIR="$HOME/.nvm"; '
            'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; '
            '. "$NVM_DIR/nvm.sh"; nvm install --lts; node -v; npm -v'
        ),
        "needs_approval": True,  # pipe-to-bash even from trusted host
        "note": "Official nvm install from nvm-sh/nvm (GitHub).",
    },
    "python": {
        "aliases": ("python", "python3", "pyenv"),
        "recipe": (
            "python3 --version || true; "
            "command -v python3; "
            "echo 'System python preferred on Jetson. For pyenv see https://github.com/pyenv/pyenv'"
        ),
        "needs_approval": False,
        "note": "Prefer distro python3; do not curl random get-pip from untrusted hosts.",
    },
    "expo": {
        "aliases": ("expo", "expo-cli", "create-expo-app"),
        "recipe": (
            "command -v npm >/dev/null || "
            '(export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"); '
            "npx --yes create-expo-app@latest --version >/dev/null; "
            "npm view expo version"
        ),
        "needs_approval": True,
        "note": "Uses npm registry expo packages after node is present.",
    },
    "playwright": {
        "aliases": ("playwright", "chromium"),
        # Jetson: ~/nebius-desk venv. board-emu: system pip at /opt/api (image may already bake Chromium).
        "recipe": (
            "if [ -x \"$HOME/nebius-desk/apps/api/.venv/bin/pip\" ]; then "
            "cd \"$HOME/nebius-desk/apps/api\" && "
            ".venv/bin/pip install -U playwright && "
            ".venv/bin/playwright install chromium; "
            "elif [ -d /opt/api/app ]; then "
            "python -m pip install -U playwright && "
            "python -m playwright install chromium; "
            "else "
            "python -m pip install -U playwright && "
            "python -m playwright install chromium; "
            "fi"
        ),
        "needs_approval": True,
        "note": "PyPI playwright + official browser download.",
    },
}


def normalize_tool(name: str) -> str:
    raw = (name or "").strip().lower()
    raw = re.sub(r"[^a-z0-9._+-]+", "", raw)
    for key, meta in _RECIPES.items():
        if raw == key or raw in meta["aliases"]:
            return key
    return raw


def command_looks_malicious(command: str) -> str | None:
    cmd = command or ""
    if _MALICIOUS_HINTS.search(cmd):
        return "Command matches malware / typosquat patterns"
    # curl|bash only allowed for known raw.githubusercontent nvm/pyenv paths
    m = _PIPE_SHELL.search(cmd)
    if m:
        urls = re.findall(r"https?://[^\s'\"|]+", cmd)
        if not urls or not all(host_trusted(u) for u in urls):
            return "Refusing curl|bash from a non-allowlisted host"
    return None


def plan_install(*, tool: str, search_results: list[dict], package: str | None = None) -> InstallPlan:
    name = normalize_tool(tool or package or "")
    warnings: list[str] = []
    if not name:
        return InstallPlan(
            tool="",
            ok=False,
            trusted_urls=[],
            untrusted_urls=[],
            recipe=None,
            warnings=[],
            needs_approval=True,
            error="Missing tool/package name",
        )

    trusted, untrusted = filter_hits(search_results)
    trusted_urls = [r.get("url") for r in trusted if r.get("url")]
    untrusted_urls = [r.get("url") for r in untrusted if r.get("url")][:8]

    if untrusted:
        warnings.append(f"Ignored {len(untrusted)} non-trusted hit(s) (possible typosquat).")
    if not trusted:
        return InstallPlan(
            tool=name,
            ok=False,
            trusted_urls=[],
            untrusted_urls=untrusted_urls,
            recipe=None,
            warnings=warnings,
            needs_approval=True,
            error=(
                "No trusted official sources in search results. "
                "Refuse install; ask operator to confirm a known domain "
                f"(e.g. nodejs.org, python.org, docs.expo.dev). Untrusted: {untrusted_urls[:3]}"
            ),
        )

    meta = _RECIPES.get(name)
    if not meta:
        # npm/pypi package name — only allow if npmjs.com or pypi.org appeared
        eco_ok = any(
            (urlparse(u).hostname or "").endswith(("npmjs.com", "pypi.org", "docs.expo.dev", "expo.dev"))
            for u in trusted_urls
        )
        if not eco_ok:
            return InstallPlan(
                tool=name,
                ok=False,
                trusted_urls=trusted_urls,
                untrusted_urls=untrusted_urls,
                recipe=None,
                warnings=warnings,
                needs_approval=True,
                error=f"No curated recipe for '{name}' and no npmjs/pypi/expo hit. Search official docs first.",
            )
        # Conservative: show how to inspect, don't auto-install unknown packages.
        recipe = (
            f"npm view {name} name version description repository --json 2>/dev/null || "
            f"python3 -m pip index versions {name} 2>/dev/null || true; "
            f"echo 'Review registry metadata before npm i / pip install'"
        )
        return InstallPlan(
            tool=name,
            ok=True,
            trusted_urls=trusted_urls,
            untrusted_urls=untrusted_urls,
            recipe=recipe,
            warnings=warnings + ["Unknown package: metadata probe only — no silent install."],
            needs_approval=True,
        )

    recipe = str(meta["recipe"])
    bad = command_looks_malicious(recipe)
    if bad and "nvm-sh" not in recipe:
        return InstallPlan(
            tool=name,
            ok=False,
            trusted_urls=trusted_urls,
            untrusted_urls=untrusted_urls,
            recipe=None,
            warnings=warnings,
            needs_approval=True,
            error=bad,
        )

    warnings.append(str(meta.get("note") or ""))
    return InstallPlan(
        tool=name,
        ok=True,
        trusted_urls=trusted_urls,
        untrusted_urls=untrusted_urls,
        recipe=recipe,
        warnings=[w for w in warnings if w],
        needs_approval=bool(meta.get("needs_approval", True)),
    )


def search_query_for(tool: str) -> str:
    name = normalize_tool(tool)
    if name == "node":
        return "official Node.js install nvm-sh nvm site:nodejs.org OR site:github.com/nvm-sh"
    if name == "python":
        return "official Python install site:python.org"
    if name == "expo":
        return "official Expo install create-expo-app site:docs.expo.dev"
    if name == "playwright":
        return "official Playwright Python install site:playwright.dev"
    return f"official {tool} install documentation"
