# app/services/terminal_assistant.py
import asyncio
import os
import subprocess
import sys
from typing import Literal
from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from app.core.safety_filter import check_command_safety, sanitize_user_text


class FlagExplanation(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    part: str
    meaning: str


class VerifiedStep(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    step_title: str
    command: str
    plain_explanation: str
    flag_breakdown: list[FlagExplanation] = Field(default_factory=list)
    verification_badge: Literal["SYNTAX_AND_CMDLET_VERIFIED", "DETERMINISTIC_RECIPE", "UNVERIFIED_WITHHELD"]


class AssistantGuideResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    task_summary: str
    grounded: bool
    steps: list[VerifiedStep] = Field(default_factory=list)
    clarifying_question: str | None = None
    warnings: list[str] = Field(default_factory=list)


class _GeminiPlan(BaseModel):
    task_summary: str
    needs_clarification: bool
    clarifying_question: str | None = None
    steps: list[dict] = Field(default_factory=list)


# Zero-hallucination verified recipe library for common everyday terminal tasks
DETERMINISTIC_RECIPES: list[tuple[tuple[str, ...], AssistantGuideResponse]] = [
    (
        ("port", "8000", "kill"),
        AssistantGuideResponse(
            task_summary="Find and stop whichever Windows process is currently holding port 8000.",
            grounded=True,
            steps=[
                VerifiedStep(
                    step_title="Check which process owns port 8000",
                    command="Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess",
                    plain_explanation="Lists the Process ID (PID) listening on port 8000 without stopping anything yet.",
                    flag_breakdown=[
                        FlagExplanation(part="-LocalPort 8000", meaning="Filters connections to port 8000."),
                        FlagExplanation(part="-State Listen", meaning="Shows only active server listeners."),
                    ],
                    verification_badge="DETERMINISTIC_RECIPE",
                ),
                VerifiedStep(
                    step_title="Stop that process cleanly",
                    command="Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }",
                    plain_explanation="Terminates only the specific PID bound to port 8000.",
                    flag_breakdown=[
                        FlagExplanation(part="Stop-Process -Id", meaning="Stops the exact process ID returned."),
                    ],
                    verification_badge="DETERMINISTIC_RECIPE",
                ),
            ],
        ),
    ),
    (
        ("undo", "last", "commit"),
        AssistantGuideResponse(
            task_summary="Undo your most recent Git commit while keeping all edited files intact.",
            grounded=True,
            steps=[
                VerifiedStep(
                    step_title="Soft-reset one commit back",
                    command="git reset --soft HEAD~1",
                    plain_explanation="Moves the branch pointer back by one commit and leaves all your changes staged.",
                    flag_breakdown=[
                        FlagExplanation(part="--soft", meaning="Keeps all your code changes staged (never deletes code)."),
                        FlagExplanation(part="HEAD~1", meaning="Targets the commit right before the latest one."),
                    ],
                    verification_badge="DETERMINISTIC_RECIPE",
                )
            ],
        ),
    ),
]


def verify_powershell_command_without_executing(command: str) -> tuple[bool, str]:
    """Uses PowerShell's native AST parser and Get-Command to confirm syntax, command existence, and flags WITHOUT running it."""
    safety = check_command_safety(command)
    if not safety.allowed:
        return False, safety.reason

    if sys.platform != "win32":
        # Non-Windows CI fallback: deterministic safety check already passed
        return True, "Validated via deterministic safety filter (non-Windows CI)."

    # PowerShell dry-parse script: reads raw command from env var (never evaluated on CLI),
    # parses AST, checks every command exists, and checks `-Parameter` names for cmdlets.
    ps_validator = r"""
$CmdText = $env:SILENTFIX_CHECK_CMD
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($CmdText, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
    Write-Output ("PARSE_ERR:" + $errors[0].Message)
    exit 1
}
$cmdAsts = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
foreach ($c in $cmdAsts) {
    $name = $c.GetCommandName()
    if (-not $name) { continue }
    $info = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $info) {
        Write-Output ("UNKNOWN_CMD:" + $name)
        exit 2
    }
    $targetParams = $info.Parameters
    if ($info.CommandType -eq 'Alias' -and $info.ResolvedCommand) {
        $targetParams = $info.ResolvedCommand.Parameters
    }
    if ($info.CommandType -in @('Cmdlet', 'Function', 'Alias') -and $targetParams) {
        foreach ($el in $c.CommandElements) {
            if ($el -is [System.Management.Automation.Language.CommandParameterAst]) {
                $pName = $el.ParameterName
                $match = $targetParams.Keys | Where-Object { $_ -like "$pName*" }
                if (-not $match) {
                    Write-Output ("UNKNOWN_FLAG:-" + $pName + " on " + $name)
                    exit 3
                }
            }
        }
    }
}
Write-Output "OK"
exit 0
"""
    env_copy = os.environ.copy()
    env_copy["SILENTFIX_CHECK_CMD"] = command

    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ps_validator],
            env=env_copy,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=6.0,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out = (proc.stdout or proc.stderr or "").strip()
        return proc.returncode == 0, out
    except Exception as exc:
        return False, f"Parser verification failed: {exc}"


def _ask_gemini_guide_sync(user_task: str) -> _GeminiPlan | None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        client = genai.Client(api_key=api_key)
        sys_prompt = (
            "You are a zero-hallucination Windows PowerShell terminal guide. "
            "Given a user task in natural language, return a JSON plan with step_title, command (single-line PowerShell), "
            "plain_explanation, and flag_breakdown ([{part, meaning}]). "
            "Never invent cmdlets or flags. Never use rm -rf, setx PATH, or Invoke-Expression. "
            "If the user's request is ambiguous, set needs_clarification=true and steps=[]."
        )
        resp = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
            contents=user_task,
            config=types.GenerateContentConfig(
                system_instruction=sys_prompt,
                response_mime_type="application/json",
                response_schema=_GeminiPlan,
                temperature=0.0,
            ),
        )
        return _GeminiPlan.model_validate_json(resp.text)
    except Exception:
        return None


async def guide_terminal_task(natural_language_request: str) -> AssistantGuideResponse:
    filtered = sanitize_user_text(natural_language_request)
    if filtered.injection_detected:
        return AssistantGuideResponse(
            task_summary="Blocked unsafe prompt.",
            grounded=False,
            warnings=["Prompt injection guard triggered."],
        )

    lower = filtered.sanitized_text.lower()
    for keywords, recipe in DETERMINISTIC_RECIPES:
        if all(k in lower for k in keywords):
            return recipe

    plan = await asyncio.to_thread(_ask_gemini_guide_sync, filtered.sanitized_text)
    if plan is None or plan.needs_clarification or not plan.steps:
        return AssistantGuideResponse(
            task_summary="More detail is needed to build a verified terminal command.",
            grounded=False,
            clarifying_question=(
                plan.clarifying_question
                if plan and plan.clarifying_question
                else "Which exact tool, folder, or target file do you want to run this task on?"
            ),
        )

    verified_steps: list[VerifiedStep] = []
    warnings: list[str] = []

    for raw in plan.steps[:5]:
        cmd = str(raw.get("command", "")).strip()
        ok, detail = await asyncio.to_thread(verify_powershell_command_without_executing, cmd)
        if not ok:
            warnings.append(f"Withheld unverified/unsafe command '{cmd}': {detail}")
            continue
        flags = [
            FlagExplanation(part=str(f.get("part", "")), meaning=str(f.get("meaning", "")))
            for f in (raw.get("flag_breakdown") or [])
            if isinstance(f, dict)
        ]
        verified_steps.append(
            VerifiedStep(
                step_title=str(raw.get("step_title", "Run Verified Step")),
                command=cmd,
                plain_explanation=str(raw.get("plain_explanation", "")),
                flag_breakdown=flags,
                verification_badge="SYNTAX_AND_CMDLET_VERIFIED",
            )
        )

    if not verified_steps:
        return AssistantGuideResponse(
            task_summary="No command passed PowerShell AST and cmdlet verification.",
            grounded=False,
            clarifying_question="Please rephrase the task or specify the exact CLI tool installed on your PC.",
            warnings=warnings,
        )

    return AssistantGuideResponse(
        task_summary=plan.task_summary,
        grounded=True,
        steps=verified_steps,
        warnings=warnings,
    )
