"""Module 9: Deterministic Git Terminal Executor.

Invokes git.exe directly via create_subprocess_exec without shell wrappers,
ensuring zero risk of string injection. Requires verified single-use execution tokens.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from typing import Any, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel

from app.ai.brain import validate_and_evict_execution_token

logger = logging.getLogger("silentfix.git_configurator")


class CommandExecutionOutput(BaseModel):
    command: list[str]
    return_code: int
    stdout: str
    stderr: str
    success: bool


class SafeTerminalExecutionResult(BaseModel):
    execution_token: str
    action_type: str
    total_commands: int
    successful_commands: int
    results: list[CommandExecutionOutput]
    overall_success: bool


async def execute_safe_git_command(args: list[str]) -> CommandExecutionOutput:
    """Chunk 2 (Safe Non-Shell Terminal Execution): Invokes `git.exe` directly

    via `create_subprocess_exec` without shell wrappers, ensuring zero risk
    of string injection.
    """
    git_bin = shutil.which("git") or shutil.which("git.exe") or "git"

    # Enforce argument validation
    # Refuse any argument containing shell piping, redirection, or backticks
    for arg in args:
        if any(c in arg for c in [";", "|", "&", ">", "<", "`", "$"]):
            return CommandExecutionOutput(
                command=[git_bin] + args,
                return_code=-1,
                stdout="",
                stderr=f"Security Violation: Argument '{arg}' contains shell redirection/pipe characters. Execution blocked.",
                success=False,
            )

    try:
        # Launch directly without shell, preventing stdin hang
        process = await asyncio.create_subprocess_exec(
            git_bin,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(), timeout=4.0
            )
        except asyncio.TimeoutError:
            try:
                process.kill()
            except Exception:
                pass
            return CommandExecutionOutput(
                command=[git_bin] + args,
                return_code=-1,
                stdout="",
                stderr="Execution timed out after 4.0s.",
                success=False,
            )

        stdout_str = stdout_bytes.decode("utf-8", errors="replace")
        stderr_str = stderr_bytes.decode("utf-8", errors="replace")

        return CommandExecutionOutput(
            command=[git_bin] + args,
            return_code=process.returncode or 0,
            stdout=stdout_str,
            stderr=stderr_str,
            success=process.returncode == 0,
        )
    except FileNotFoundError:
        return CommandExecutionOutput(
            command=[git_bin] + args,
            return_code=-1,
            stdout="",
            stderr="Git executable not found in system PATH.",
            success=False,
        )
    except Exception as exc:
        return CommandExecutionOutput(
            command=[git_bin] + args,
            return_code=-1,
            stdout="",
            stderr=f"Execution error: {str(exc)}",
            success=False,
        )


async def execute_authorized_brain_actions(
    execution_token: str,
) -> SafeTerminalExecutionResult:
    """Execute pre-planned Git terminal commands using a single-use token.

    Evicts token immediately on use.
    """
    action_type, command_batches = validate_and_evict_execution_token(execution_token)

    results: list[CommandExecutionOutput] = []
    success_count = 0

    for cmd_args in command_batches:
        logger.info("Executing authorized non-shell command: git %s", " ".join(cmd_args))
        cmd_result = await execute_safe_git_command(cmd_args)
        results.append(cmd_result)
        if cmd_result.success:
            success_count += 1

    overall_success = (success_count == len(command_batches)) and len(command_batches) > 0

    return SafeTerminalExecutionResult(
        execution_token=execution_token[:8] + "...",
        action_type=action_type,
        total_commands=len(command_batches),
        successful_commands=success_count,
        results=results,
        overall_success=overall_success,
    )


async def get_current_git_identity() -> dict[str, Any]:
    """Safely query current Git name and email using non-shell execution."""
    name_out = await execute_safe_git_command(["config", "--get", "user.name"])
    email_out = await execute_safe_git_command(["config", "--get", "user.email"])

    return {
        "user_name": name_out.stdout.strip() if name_out.success else None,
        "user_email": email_out.stdout.strip() if email_out.success else None,
        "configured": bool(name_out.stdout.strip() and email_out.stdout.strip()),
    }
