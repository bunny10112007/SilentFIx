# app/routes/terminal.py
import asyncio
import os
import subprocess
import sys
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.core.safety_filter import check_command_safety

router = APIRouter(prefix="/api/terminal", tags=["terminal"])

# Per-session tracked working directories
_session_cwds: dict[str, str] = {}


class TerminalExecRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    session_id: str = Field(min_length=2, max_length=64)
    command: str = Field(min_length=1, max_length=1000)
    cwd: str | None = Field(default=None, max_length=400)


class TerminalExecResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    command: str
    cwd: str
    stdout: str
    stderr: str
    exit_code: int
    blocked: bool = False
    filter_reason: str | None = None


def _resolve_cwd(session_id: str, requested_cwd: str | None) -> str:
    if requested_cwd:
        p = Path(requested_cwd).resolve()
        if p.is_dir():
            _session_cwds[session_id] = str(p)
            return str(p)
    if session_id in _session_cwds and Path(_session_cwds[session_id]).is_dir():
        return _session_cwds[session_id]
    default_dir = os.getcwd()
    _session_cwds[session_id] = default_dir
    return default_dir


@router.post("/exec", response_model=TerminalExecResponse)
async def execute_terminal_command(req: TerminalExecRequest) -> TerminalExecResponse:
    active_cwd = _resolve_cwd(req.session_id, req.cwd)

    # 1. Backend Safety Filter
    safety = check_command_safety(req.command)
    if not safety.allowed:
        return TerminalExecResponse(
            command=req.command,
            cwd=active_cwd,
            stdout="",
            stderr=f"[SilentFix Safety Filter] {safety.reason}",
            exit_code=403,
            blocked=True,
            filter_reason=safety.reason,
        )

    cmd_trimmed = req.command.strip()

    # 2. Handle 'cd <path>' natively so session working directory persists
    if cmd_trimmed.lower().startswith("cd "):
        target_raw = cmd_trimmed[3:].strip().strip('"').strip("'")
        target = (Path(active_cwd) / target_raw).resolve()
        if target.is_dir():
            _session_cwds[req.session_id] = str(target)
            return TerminalExecResponse(
                command=cmd_trimmed,
                cwd=str(target),
                stdout="",
                stderr="",
                exit_code=0,
            )
        return TerminalExecResponse(
            command=cmd_trimmed,
            cwd=active_cwd,
            stdout="",
            stderr=f"Directory not found: {target_raw}",
            exit_code=1,
        )

    # 3. Execute safely via PowerShell on Windows (sh fallback on Linux CI)
    if sys.platform == "win32":
        argv = ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", cmd_trimmed]
    else:
        argv = ["/bin/sh", "-c", cmd_trimmed]

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=active_cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw_out, raw_err = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        return TerminalExecResponse(
            command=cmd_trimmed,
            cwd=active_cwd,
            stdout=raw_out.decode("utf-8", errors="replace").strip(),
            stderr=raw_err.decode("utf-8", errors="replace").strip(),
            exit_code=proc.returncode or 0,
        )
    except asyncio.TimeoutError:
        return TerminalExecResponse(
            command=cmd_trimmed,
            cwd=active_cwd,
            stdout="",
            stderr="Command timed out after 30 seconds.",
            exit_code=124,
        )
