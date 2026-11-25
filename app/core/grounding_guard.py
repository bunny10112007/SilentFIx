# app/core/grounding_guard.py
import platform
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

# Fast-path static allowlist (lowercase key -> exact Winget ID)
VERIFIED_WINGET_PACKAGES: dict[str, str] = {
    "git.git": "Git.Git",
    "python.python.3.12": "Python.Python.3.12",
    "python.python.3.13": "Python.Python.3.13",
    "openjs.nodejs.lts": "OpenJS.NodeJS.LTS",
    "openjs.nodejs": "OpenJS.NodeJS",
    "astral-sh.uv": "astral-sh.uv",
    "microsoft.visualstudiocode": "Microsoft.VisualStudioCode",
    "microsoft.vcredist.2015+.x64": "Microsoft.VCRedist.2015+.x64",
    "microsoft.vcredist.2015+.x86": "Microsoft.VCRedist.2015+.x86",
    "microsoft.vcredist.2013.x64": "Microsoft.VCRedist.2013.x64",
    "microsoft.vcredist.2012.x64": "Microsoft.VCRedist.2012.x64",
    "microsoft.vcredist.2010.x64": "Microsoft.VCRedist.2010.x64",
    "microsoft.directx": "Microsoft.DirectX",
    "microsoft.edgewebview2runtime": "Microsoft.EdgeWebView2Runtime",
    "7zip.7zip": "7zip.7zip",
    "notepad++.notepad++": "Notepad++.Notepad++",
    "docker.dockerdesktop": "Docker.DockerDesktop",
    "golang.go": "GoLang.Go",
    "rustlang.rustup": "Rustlang.Rustup",
    "kitware.cmake": "Kitware.CMake",
    "hashicorp.terraform": "HashiCorp.Terraform",
    "kubernetes.kubectl": "Kubernetes.kubectl",
    "helm.helm": "Helm.Helm",
    "amazon.awscli": "Amazon.AWSCLI",
    "microsoft.azurecli": "Microsoft.AzureCLI",
    "github.cli": "GitHub.cli",
    "jqlang.jq": "jqlang.jq",
    "gypsect.ffmpeg": "Gypsect.FFmpeg",
}

PROBED_TOOLS = ("git", "python", "py", "uv", "node", "npm", "winget", "code", "go", "docker")

_WINGET_ID_RE = re.compile(r"\bwinget\s+install\b.*?--id\s+([^\s\"']+)", re.IGNORECASE)
_WIN_PATH_RE = re.compile(r"[A-Za-z]:\\[^\s\"'`;|<>]+")
_QUOTED_WIN_PATH_RE = re.compile(r'["\']([A-Za-z]:\\[^"\';|<>]+)["\']')
_SAFE_PKG_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-_+]{2,127}$")

_FOUND_ID_RE = re.compile(r"\[([A-Za-z0-9][A-Za-z0-9.\-_+]{2,127})\]")
_PUBLISHER_RE = re.compile(r"^\s*Publisher:\s*(.+)$", re.MULTILINE)
_SHA256_RE = re.compile(r"^\s*Installer SHA256:\s*([A-Fa-f0-9]{64})\s*$", re.MULTILINE)

_CACHE_TTL_SEC = 900.0
_CACHE_MAX_SIZE = 256


class LiveWingetProbeResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    found: bool
    canonical_id: str | None = None
    publisher: str | None = None
    installer_sha256: str | None = None
    source: Literal["static_allowlist", "live_winget", "rejected"] = "rejected"
    detail: str = ""


# Bounded in-memory TTL cache: lowercase_id -> (expires_at, LiveWingetProbeResult)
_LIVE_WINGET_CACHE: dict[str, tuple[float, LiveWingetProbeResult]] = {}


class VerifiedSystemContext(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    os_name: str
    installed_tools: dict[str, str | None]
    attached_folder: str | None = None
    folder_exists: bool = False
    folder_files: list[str] = Field(default_factory=list)


class GroundingAuditResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    is_grounded: bool
    violations: list[str] = Field(default_factory=list)
    canonical_package_id: str | None = None
    verification_source: str | None = None
    publisher: str | None = None
    installer_sha256: str | None = None


def _prune_winget_cache() -> None:
    now = time.monotonic()
    expired = [k for k, (exp, _) in _LIVE_WINGET_CACHE.items() if exp <= now]
    for k in expired:
        _LIVE_WINGET_CACHE.pop(k, None)
    if len(_LIVE_WINGET_CACHE) >= _CACHE_MAX_SIZE:
        oldest_key = min(_LIVE_WINGET_CACHE, key=lambda k: _LIVE_WINGET_CACHE[k][0])
        _LIVE_WINGET_CACHE.pop(oldest_key, None)


def clear_winget_cache() -> None:
    """Helper for deterministic unit tests."""
    _LIVE_WINGET_CACHE.clear()


def verify_winget_package(
    package_id: str,
    *,
    allow_live_probe: bool = True,
    timeout_sec: float = 8.0,
) -> LiveWingetProbeResult:
    """Checks static allowlist first, then verifies unlisted IDs via `winget show --id --exact`."""
    cleaned = package_id.strip()
    if not cleaned or ".." in cleaned or not _SAFE_PKG_ID_RE.match(cleaned):
        return LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"Invalid or unsafe package ID syntax: '{package_id}'.",
        )

    key = cleaned.lower()

    # 1. Instant static allowlist hit
    if key in VERIFIED_WINGET_PACKAGES:
        return LiveWingetProbeResult(
            found=True,
            canonical_id=VERIFIED_WINGET_PACKAGES[key],
            source="static_allowlist",
            detail="Verified in static allowlist.",
        )

    if not allow_live_probe:
        return LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"Package '{cleaned}' is not in the static allowlist and live probing is disabled.",
        )

    # 2. TTL cache hit
    now = time.monotonic()
    cached = _LIVE_WINGET_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]

    # 3. Live Windows catalog probe (shell=False, no interactivity, strict timeout)
    winget_bin = shutil.which("winget")
    if not winget_bin:
        return LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"winget CLI unavailable; cannot verify unlisted package '{cleaned}'.",
        )

    argv = [
        winget_bin,
        "show",
        "--id",
        cleaned,
        "--exact",
        "--accept-source-agreements",
        "--disable-interactivity",
    ]
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_sec,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        return LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"Live winget catalog lookup timed out for '{cleaned}'.",
        )
    except OSError as exc:
        return LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"Could not run winget lookup: {exc}",
        )

    stdout = proc.stdout or ""
    if proc.returncode != 0:
        result = LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"Package '{cleaned}' was not found in the official Winget catalog.",
        )
        _prune_winget_cache()
        _LIVE_WINGET_CACHE[key] = (now + 120.0, result)
        return result

    # Confirm exact package ID in winget show output
    found_matches = _FOUND_ID_RE.findall(stdout)
    canonical_id = next((m for m in found_matches if m.lower() == key), None)
    if not canonical_id:
        result = LiveWingetProbeResult(
            found=False,
            source="rejected",
            detail=f"Winget output did not confirm an exact match for '{cleaned}'.",
        )
        _prune_winget_cache()
        _LIVE_WINGET_CACHE[key] = (now + 120.0, result)
        return result

    pub_match = _PUBLISHER_RE.search(stdout)
    sha_match = _SHA256_RE.search(stdout)

    result = LiveWingetProbeResult(
        found=True,
        canonical_id=canonical_id,
        publisher=pub_match.group(1).strip() if pub_match else None,
        installer_sha256=sha_match.group(1).lower() if sha_match else None,
        source="live_winget",
        detail=f"Verified live against Windows Winget catalog ({canonical_id}).",
    )
    _prune_winget_cache()
    _LIVE_WINGET_CACHE[key] = (now + _CACHE_TTL_SEC, result)
    return result


def collect_verified_context(folder_path: str | None = None) -> VerifiedSystemContext:
    """Gathers real, deterministic machine facts so Gemini does not guess."""
    installed = {tool: shutil.which(tool) for tool in PROBED_TOOLS}

    folder_exists = False
    folder_files: list[str] = []
    resolved_folder: str | None = None

    if folder_path:
        p = Path(folder_path).resolve()
        resolved_folder = str(p)
        if p.is_dir():
            folder_exists = True
            try:
                folder_files = sorted(item.name for item in list(p.iterdir())[:30])
            except OSError:
                folder_files = []

    return VerifiedSystemContext(
        os_name=f"{platform.system()} {platform.release()}",
        installed_tools=installed,
        attached_folder=resolved_folder,
        folder_exists=folder_exists,
        folder_files=folder_files,
    )


def _extract_windows_paths(text: str) -> list[str]:
    """Extract quoted (space-containing) and unquoted Windows paths."""
    paths: list[str] = []
    covered_spans: list[tuple[int, int]] = []
    for m in _QUOTED_WIN_PATH_RE.finditer(text):
        paths.append(m.group(1))
        covered_spans.append(m.span())
    for m in _WIN_PATH_RE.finditer(text):
        if any(s <= m.start() and m.end() <= e for s, e in covered_spans):
            continue
        paths.append(m.group(0))
    return paths


def verify_ai_output(
    *,
    user_message: str,
    confidence: str,
    grounded_evidence: list[str],
    terminal_command: str | None,
    package_id: str | None,
    executable_path: str | None,
    verified_paths: set[str],
    allow_live_winget: bool = True,
) -> GroundingAuditResult:
    """Blocks hallucinated package IDs, invented file paths, and ungrounded guesses."""
    violations: list[str] = []
    canonical_pkg: str | None = None
    verification_source: str | None = None
    publisher: str | None = None
    installer_sha256: str | None = None

    # 1. Reject low-confidence or evidence-free commands
    if terminal_command and (confidence == "low" or len(grounded_evidence) == 0):
        violations.append("Proposed command lacked grounded evidence or had low confidence.")

    # 2. Extract package ID from command if present and check for mismatch with package_id
    cmd_pkg: str | None = None
    if terminal_command:
        id_match = _WINGET_ID_RE.search(terminal_command)
        if id_match:
            cmd_pkg = id_match.group(1)

    if package_id and cmd_pkg and package_id.strip().lower() != cmd_pkg.strip().lower():
        violations.append(
            f"Package ID mismatch between metadata ('{package_id}') and command ('{cmd_pkg}')."
        )

    # 3. Verify package against static allowlist or live `winget show --id --exact`
    target_pkg = cmd_pkg or package_id
    if target_pkg:
        probe = verify_winget_package(target_pkg, allow_live_probe=allow_live_winget)
        if not probe.found:
            violations.append(probe.detail)
        else:
            canonical_pkg = probe.canonical_id
            verification_source = probe.source
            publisher = probe.publisher
            installer_sha256 = probe.installer_sha256

    # 4. Verify every Windows path referenced in executable_path or terminal_command
    user_paths_lower = {p.lower() for p in _extract_windows_paths(user_message)}
    known_paths_lower = {p.lower() for p in verified_paths if p}
    allowed_paths = user_paths_lower | known_paths_lower

    candidate_paths: list[str] = []
    if executable_path:
        candidate_paths.append(executable_path)
    if terminal_command:
        candidate_paths.extend(_extract_windows_paths(terminal_command))

    for raw_path in candidate_paths:
        cleaned = raw_path.rstrip(".,;:)")
        lower = cleaned.lower()
        if lower in allowed_paths or any(ap.startswith(lower + " ") for ap in allowed_paths):
            continue
        try:
            exists = Path(cleaned).exists()
        except OSError:
            exists = False
        if not exists:
            violations.append(f"Referenced path '{cleaned}' does not exist on this system.")

    return GroundingAuditResult(
        is_grounded=len(violations) == 0,
        violations=violations,
        canonical_package_id=canonical_pkg,
        verification_source=verification_source,
        publisher=publisher,
        installer_sha256=installer_sha256,
    )
