# app/routes/workspace.py
import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from app.cloud.aws_sandbox import CloudPretestRequest, start_cloud_pretest
from app.core.safety_filter import check_command_safety, sanitize_user_text
from app.probes.cli_healer import diagnose_terminal_error

logger = logging.getLogger("silentfix.workspace")
router = APIRouter(prefix="/api/workspace", tags=["workspace"])
_VALID_PACKAGE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.+_-]{2,80}$")


class FixCard(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    title: str
    explanation: str
    command: str | None = None
    filter_status: Literal["VERIFIED_SAFE", "SANDBOX_PASSED", "BLOCKED_UNSAFE", "INFO_ONLY"]
    filter_notes: list[str] = Field(default_factory=list)


class WorkspaceChatRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    session_id: str = Field(min_length=2, max_length=64)
    message: str = Field(min_length=1, max_length=2000)
    folder_path: str | None = Field(default=None, max_length=400)


class WorkspaceChatResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    reply: str
    fix_card: FixCard | None = None


class FolderRepairRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    folder_path: str = Field(min_length=2, max_length=400)


class FolderRepairResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    folder_path: str
    detected_files: list[str]
    plain_explanation: str
    sandbox_verdict: str
    sandbox_backend: str
    safe_commands: list[str]
    blocked_commands: list[str]


class _GeminiFixSchema(BaseModel):
    title: str
    plain_explanation: str
    terminal_command: str | None = None
    package_to_pretest: str | None = None


def _ask_gemini_sync(prompt: str, context: str) -> _GeminiFixSchema | None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    model_id = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    sys_instruction = (
        "You are SilentFix, a friendly Windows troubleshooting assistant for students and everyday users. "
        "Explain the root cause in 1-3 simple, jargon-free sentences. "
        "Provide ONE safe, single-line Windows PowerShell command the user can copy and paste to fix the issue. "
        "Never use setx PATH, rm -rf, Invoke-Expression, or multi-line commands. "
        "If a missing software package needs installing, set package_to_pretest to its official winget ID."
    )
    try:
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=model_id,
            contents=f"Context:\n{context}\n\nUser request:\n{prompt}",
            config=types.GenerateContentConfig(
                system_instruction=sys_instruction,
                response_mime_type="application/json",
                response_schema=_GeminiFixSchema,
                temperature=0.1,
            ),
        )
        if not resp.text:
            return None
        return _GeminiFixSchema.model_validate_json(resp.text)
    except Exception as exc:
        logger.warning("Gemini fallback triggered: %s", exc)
        print(f"[SilentFix] Gemini fallback triggered: {exc}")
        return None


def _scan_broken_folder_sync(folder_path: str) -> tuple[list[str], str, str]:
    root = Path(folder_path).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Folder not found: {folder_path}")

    detected: list[str] = []
    snippets: list[str] = []
    default_pkg = "Python.Python.3.14"

    manifest_names = ("package.json", "requirements.txt", "pyproject.toml")
    for name in manifest_names:
        candidate = root / name
        if candidate.is_file():
            detected.append(name)
            try:
                text = candidate.read_text(encoding="utf-8", errors="replace")[:2500]
                snippets.append(f"--- {name} ---\n{text}")
            except OSError:
                pass
            if name == "package.json":
                default_pkg = "OpenJS.NodeJS.LTS"

    # Also detect .exe binaries and recent crash logs without executing them
    for item in sorted(root.iterdir())[:40]:
        if item.is_file() and item.suffix.lower() in {".exe", ".log"}:
            detected.append(item.name)
            if item.suffix.lower() == ".log":
                try:
                    log_tail = item.read_text(encoding="utf-8", errors="replace")[-1500:]
                    snippets.append(f"--- {item.name} (tail) ---\n{log_tail}")
                except OSError:
                    pass

    summary = "\n\n".join(snippets) if snippets else "No standard manifests found; folder files: " + ", ".join(detected)
    return detected, summary, default_pkg


@router.post("/chat", response_model=WorkspaceChatResponse)
async def workspace_chat(req: WorkspaceChatRequest) -> WorkspaceChatResponse:
    # 1. Input PII & Prompt-Injection Filter
    filtered = sanitize_user_text(req.message)
    notes: list[str] = []
    if filtered.pii_redacted:
        notes.append("Sensitive keys redacted before AI analysis")
    if filtered.injection_detected:
        return WorkspaceChatResponse(
            reply="That message looks like a security bypass attempt, so SilentFix blocked it to protect your PC.",
            fix_card=FixCard(
                title="Blocked Unsafe Prompt",
                explanation="Describe the error you are seeing normally and SilentFix will prepare a safe command.",
                command=None,
                filter_status="BLOCKED_UNSAFE",
                filter_notes=["Prompt injection filter triggered"],
            ),
        )

    # 2. Local CLI Probe (non-blocking)
    cli_diag = await asyncio.to_thread(diagnose_terminal_error, filtered.sanitized_text, req.folder_path)
    context_blob = json.dumps(cli_diag.model_dump(), indent=2)

    # 3. Gemini Diagnosis (with clean offline fallback)
    ai_fix = await asyncio.to_thread(_ask_gemini_sync, filtered.sanitized_text, context_blob)

    if ai_fix is None:
        # Offline deterministic fallback using cli_healer
        fallback_cmd: str | None = cli_diag.suggested_command
        if cli_diag.status == "FOUND_ON_DISK_NEEDS_PATH" and cli_diag.directory_to_add:
            fallback_cmd = (
                f'$u = [Environment]::GetEnvironmentVariable("Path","User"); '
                f'[Environment]::SetEnvironmentVariable("Path","$u;{cli_diag.directory_to_add}","User")'
            )
        elif cli_diag.status in ("NOT_INSTALLED_WINGET_AVAILABLE", "AVAILABLE_VIA_WINGET") and cli_diag.recommended_winget_id:
            fallback_cmd = f"winget install --id {cli_diag.recommended_winget_id} --exact --scope user --silent"

        title = (
            f"Fix for '{cli_diag.command}'"
            if cli_diag.command and cli_diag.command != "unknown"
            else "Local Diagnostic Result"
        )
        explanation = cli_diag.summary
        proposed_cmd = fallback_cmd
    else:
        title = ai_fix.title
        explanation = ai_fix.plain_explanation
        proposed_cmd = ai_fix.terminal_command

    # 4. Backend Command Safety Filter
    if proposed_cmd:
        safety = check_command_safety(proposed_cmd)
        if not safety.allowed:
            return WorkspaceChatResponse(
                reply=explanation,
                fix_card=FixCard(
                    title=title,
                    explanation=f"A suggested command was blocked by SilentFix safety rules: {safety.reason}",
                    command=None,
                    filter_status="BLOCKED_UNSAFE",
                    filter_notes=[*notes, safety.reason],
                ),
            )
        notes.append("Verified safe by backend command filter")
        return WorkspaceChatResponse(
            reply=explanation,
            fix_card=FixCard(
                title=title,
                explanation=explanation,
                command=proposed_cmd,
                filter_status="VERIFIED_SAFE",
                filter_notes=notes,
            ),
        )

    return WorkspaceChatResponse(
        reply=explanation,
        fix_card=FixCard(
            title=title,
            explanation=explanation,
            command=None,
            filter_status="INFO_ONLY",
            filter_notes=notes,
        ),
    )


@router.post("/repair-folder", response_model=FolderRepairResponse)
async def repair_broken_folder(req: FolderRepairRequest) -> FolderRepairResponse:
    """Scans a broken project/app folder, plans fixes with Gemini, and pre-tests in AWS Sandbox."""
    try:
        detected, folder_context, default_pkg = await asyncio.to_thread(
            _scan_broken_folder_sync, req.folder_path
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # 1. Gemini Package Diagnosis
    ai_fix = await asyncio.to_thread(
        _ask_gemini_sync,
        "Inspect this broken folder/program and give the cleanest single command to restore clean packages and make it runnable.",
        folder_context,
    )

    candidate_commands: list[str] = []
    package_id = default_pkg
    if ai_fix and ai_fix.terminal_command:
        candidate_commands.append(ai_fix.terminal_command)
        if ai_fix.package_to_pretest and _VALID_PACKAGE_ID_RE.match(ai_fix.package_to_pretest.strip()):
            package_id = ai_fix.package_to_pretest.strip()
        explanation = ai_fix.plain_explanation
    else:
        # Clean deterministic fallback based on detected manifests
        if "package.json" in detected:
            candidate_commands.append("npm ci")
            explanation = "Detected a Node.js project. Running 'npm ci' installs clean, lockfile-verified packages."
        elif "pyproject.toml" in detected:
            candidate_commands.append("uv sync")
            explanation = "Detected a Python project with pyproject.toml. Running 'uv sync' restores clean dependencies."
        elif "requirements.txt" in detected:
            candidate_commands.append("pip install -r requirements.txt")
            explanation = "Detected requirements.txt. Installing pinned Python dependencies cleanly."
        else:
            explanation = "Scanned the folder. No broken package manifest was found; check if a Windows compatibility runtime is needed."

    # 2. Pre-test package in AWS Cloud Sandbox (checks crashes/threats before touching host)
    sandbox_report = await start_cloud_pretest(
        CloudPretestRequest(package_id=package_id, source="winget", scope="user")
    )

    # 3. Filter every command through the Backend Command Safety Filter
    safe_cmds: list[str] = []
    blocked_cmds: list[str] = []
    for cmd in candidate_commands:
        if check_command_safety(cmd).allowed:
            safe_cmds.append(cmd)
        else:
            blocked_cmds.append(cmd)

    return FolderRepairResponse(
        folder_path=str(Path(req.folder_path).resolve()),
        detected_files=detected,
        plain_explanation=explanation,
        sandbox_verdict=sandbox_report.verdict,
        sandbox_backend=sandbox_report.backend,
        safe_commands=safe_cmds,
        blocked_commands=blocked_cmds,
    )
