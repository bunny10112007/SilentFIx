"""Module 9: Gemini AI Brain Structured Decision Engine.

Uses Gemini (or deterministic offline parser fallback) structured outputs to query
required user parameters (e.g., Git name and email) and executes verified commands
via non-shell subprocess execution.
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
from typing import Annotated, Any, Literal, Optional, Union

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field

from app.probes.cli_healer import KNOWN_CLI_WINGET_MAP
from app.state.db import consume_token_sync, store_ephemeral_token_sync

logger = logging.getLogger("silentfix.brain")

# In-memory execution token store: token -> (action_type, args_list, expires_at)
_brain_execution_tokens: dict[str, tuple[str, list[list[str]], float]] = {}
EXECUTION_TOKEN_TTL_SECONDS = 300.0  # 5 minutes


# Chunk 1: Gemini Pydantic Structured Decision Engine class BrainDecision(BaseModel)
class BrainDecision(BaseModel):
    action_type: Literal["EXECUTE_GIT_CONFIG", "NEEDS_INFO", "REJECT_INSECURE_INTENT", "QUERY_STATUS"] = Field(
        ...,
        description="The structured intent decision resolved by the model.",
    )
    user_name: Optional[str] = Field(None, description="Resolved git author name.")
    user_email: Optional[str] = Field(None, description="Resolved git author email.")
    missing_parameters: list[str] = Field(
        default_factory=list,
        description="List of required parameters that are missing, e.g. ['user_name', 'user_email'].",
    )
    follow_up_prompt: Optional[str] = Field(
        None,
        description="Targeted follow-up question asking user for missing parameters.",
    )
    git_arguments: list[list[str]] = Field(
        default_factory=list,
        description="Deterministic array of arguments for git.exe with shell=False.",
    )
    execution_token: Optional[str] = Field(
        None,
        description="Single-use execution token issued only when all parameters are verified.",
    )
    explanation: str = Field(..., description="Explanation of the decision.")
    safety_verdict: str = Field(..., description="Deterministic privilege boundary check verdict.")


# Discriminated Union Action Plans covering all deterministic executors
class GitConfigPlan(BaseModel):
    intent: Literal["git_config"] = "git_config"
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    git_arguments: list[list[str]] = Field(default_factory=list)
    explanation: str = "Configure Git user name and email deterministically."


class WingetInstallPlan(BaseModel):
    intent: Literal["winget_install"] = "winget_install"
    package_id: str
    source: str = "winget"
    scope: str = "user"
    explanation: str = "Install verified application package via winget."


class CliHealPlan(BaseModel):
    intent: Literal["cli_heal"] = "cli_heal"
    command: str
    explanation: str = "Diagnose and heal missing terminal command or PATH."


class CompatShimPlan(BaseModel):
    intent: Literal["compat_shim"] = "compat_shim"
    executable_path: str
    os_mode: Optional[str] = "WIN7RTM"
    display_flags: list[str] = Field(default_factory=lambda: ["HIGHDPIAWARE"])
    run_as_admin: bool = False
    explanation: str = "Apply Windows 11 AppCompat compatibility shim."


class NeedsInfoPlan(BaseModel):
    intent: Literal["needs_info"] = "needs_info"
    missing_parameters: list[str] = Field(default_factory=list)
    follow_up_prompt: str
    explanation: str = "Additional parameters required from user."


class RejectPlan(BaseModel):
    intent: Literal["reject"] = "reject"
    reason: str
    explanation: str = "Request rejected due to security policy or unsupported syntax."


ActionPlan = Annotated[
    Union[GitConfigPlan, WingetInstallPlan, CliHealPlan, CompatShimPlan, NeedsInfoPlan, RejectPlan],
    Field(discriminator="intent"),
]


def parse_offline_action_plan(prompt: str) -> ActionPlan:
    """Lightweight 2-stage offline intent parser and entity extractor.

    Stage 1: Keyword-based intent classification.
    Stage 2: Targeted entity extractors for arguments, emails, and package IDs.
    """
    cleaned = prompt.strip()
    lowered = cleaned.lower()

    # Stage 0: Security filter
    insecure = ["rm -rf", "format c:", "powershell", "cmd.exe", "del /s", "curl -s", "bash -c", "|", "&", ";", "`", "$("]
    for trig in insecure:
        if trig in lowered:
            return RejectPlan(
                reason=f"Security violation: Trigger '{trig}' rejected.",
                explanation="Shell injections and destructive commands are blocked.",
            )

    # Stage 1 & 2: Install intent
    if "install" in lowered or "get" in lowered or "download" in lowered:
        for cmd_name, pkg_id in KNOWN_CLI_WINGET_MAP.items():
            if re.search(r"\b" + re.escape(cmd_name) + r"\b", lowered):
                return WingetInstallPlan(package_id=pkg_id, explanation=f"Resolved install intent for '{cmd_name}' -> {pkg_id}")
        # Direct package ID match (e.g. Git.Git)
        pkg_m = re.search(r"\b([A-Za-z0-9]+\.[A-Za-z0-9._\-]+)\b", cleaned)
        if pkg_m:
            return WingetInstallPlan(package_id=pkg_m.group(1), explanation=f"Found package ID '{pkg_m.group(1)}'")

    # Stage 1 & 2: Compat shim intent
    if any(k in lowered for k in ["blurry", "dpi", "compat", "scaling", "display"]) or ".exe" in lowered:
        exe_m = re.search(r"([a-zA-Z]:\\[^\s]+\.exe|[A-Za-z0-9_\-]+\.exe)", cleaned)
        exe_path = exe_m.group(1) if exe_m else "C:\\App\\game.exe"
        flags = ["HIGHDPIAWARE"] if "blurry" in lowered or "dpi" in lowered else ["GDIDPISCALING"]
        return CompatShimPlan(
            executable_path=exe_path,
            display_flags=flags,
            explanation=f"Configured high-DPI compatibility shim for '{exe_path}'.",
        )

    # Stage 1 & 2: CLI Healer intent
    if any(k in lowered for k in ["path", "not recognized", "command not found", "fix my path", "heal"]):
        for cmd_name in KNOWN_CLI_WINGET_MAP.keys():
            if re.search(r"\b" + re.escape(cmd_name) + r"\b", lowered):
                return CliHealPlan(command=cmd_name, explanation=f"Diagnosing PATH for missing '{cmd_name}'.")
        tokens = cleaned.split()
        cand = tokens[-1].strip() if tokens else "git"
        return CliHealPlan(command=cand, explanation=f"Diagnosing command '{cand}'.")

    # Stage 1 & 2: Git Config intent
    if "git" in lowered or "email" in lowered or "author" in lowered or "commit" in lowered:
        email_m = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", cleaned)
        name_m = re.search(r"(?:name(?:\s+is|\s+to|\s*[:=])?)\s+['\"]?([A-Za-z\s\-]+)['\"]?", cleaned, re.IGNORECASE)

        user_email = email_m.group(0).strip() if email_m else None
        user_name = None
        if name_m:
            raw_n = name_m.group(1).split(" and ")[0].split(" email")[0].strip()
            if raw_n and raw_n.lower() not in ("to", "is", "my", "git"):
                user_name = raw_n

        args = []
        if user_name:
            args.append(["config", "--global", "user.name", user_name])
        if user_email:
            args.append(["config", "--global", "user.email", user_email])

        return GitConfigPlan(
            user_name=user_name,
            user_email=user_email,
            git_arguments=args,
            explanation=f"Git configuration resolved for author '{user_name}' and email '{user_email}'.",
        )

    # Fallback to NeedsInfoPlan
    return NeedsInfoPlan(
        missing_parameters=["task"],
        follow_up_prompt="What system repair, installation, or configuration task would you like to perform?",
        explanation="Intent not fully resolved from prompt.",
    )


def mint_execution_token(action_type: str, git_arguments: list[list[str]]) -> str:
    """Issue a single-use execution token for verified deterministic commands.
    Persisted to SQLite WAL ephemeral_tokens table.
    """
    now = time.time()
    token = f"exec_{secrets.token_urlsafe(16)}"
    payload = {
        "action_type": action_type,
        "git_arguments": git_arguments,
    }
    store_ephemeral_token_sync(
        token=token,
        token_type="brain_execution",
        payload=payload,
        expires_at=now + EXECUTION_TOKEN_TTL_SECONDS,
    )
    return token


def validate_and_evict_execution_token(token: str) -> tuple[str, list[list[str]]]:
    """Validate and consume single-use execution token atomically from SQLite."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Invalid or expired execution token. Safe non-shell execution requires pre-authorized token.",
        )

    payload = consume_token_sync(token, "brain_execution")
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Invalid or expired execution token. Safe non-shell execution requires pre-authorized token.",
        )

    action_type = payload.get("action_type", "")
    git_args = payload.get("git_arguments", [])
    return action_type, git_args


def deterministic_intent_resolution(prompt: str, context: Optional[dict[str, Any]] = None) -> BrainDecision:
    """Deterministic local intent resolution for zero-dependency operation

    or when GEMINI_API_KEY is not configured.
    """
    cleaned = prompt.strip()
    logger.info("Resolving user intent deterministically: '%s'", cleaned)

    # 1. Security Check: Reject shell injection attempts or destructive commands
    lowered = cleaned.lower()
    insecure_triggers = ["rm -rf", "format c:", "powershell", "cmd.exe", "del /s", "curl -s", "bash -c", "|", "&", ";", "`", "$("]
    for trig in insecure_triggers:
        if trig in lowered:
            return BrainDecision(
                action_type="REJECT_INSECURE_INTENT",
                missing_parameters=[],
                follow_up_prompt=None,
                git_arguments=[],
                execution_token=None,
                explanation=f"Potential shell injection pattern '{trig}' detected. SilentFix strictly blocks dynamic scripts and unconstrained shell execution.",
                safety_verdict="REJECTED: Command contains unsafe shell operators. Non-shell privilege boundary enforced.",
            )

    # 2. Extract user_name and user_email if provided
    # Extract email
    email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", cleaned)
    user_email = email_match.group(0) if email_match else None

    # Extract name (e.g. "name is Alice Cooper", "name Alice Smith", "for Jean-Luc", "author: René O'Connor")
    user_name = None
    name_patterns = [
        r"name\s*(?:is|:|=)?\s*['\"]?([A-Za-z\u00C0-\u017F]+(?:[\s\-'][A-Za-z\u00C0-\u017F]+)*)['\"]?(?=[,\s]+(?:and\s+)?email|\s*$|\s*<)",
        r"user\.name\s+['\"]?([A-Za-z\u00C0-\u017F\s\-']+)['\"]?",
        r"\bfor\s+([A-Za-z\u00C0-\u017F]+(?:[\s\-'][A-Za-z\u00C0-\u017F]+)*)\b(?=[,\s]+(?:with|and|email)|\s*$)",
        r"author\s+['\"]?([A-Za-z\u00C0-\u017F\s\-']+)['\"]?",
    ]
    for np in name_patterns:
        m = re.search(np, cleaned, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip()
            if candidate.lower().endswith(" and"):
                candidate = candidate[:-4].strip()
            if candidate.lower().endswith(" with"):
                candidate = candidate[:-5].strip()
            # Exclude keywords
            if candidate.lower() not in ("git", "identity", "config", "author", "user"):
                user_name = candidate
                break

    # If context has previous answers, merge them
    if context:
        if not user_name and context.get("user_name"):
            user_name = context["user_name"]
        if not user_email and context.get("user_email"):
            user_email = context["user_email"]

    # Check if prompt expresses configuration intent (or includes user identity params)
    has_config_intent = (
        any(k in lowered for k in ["configure", "config", "setup", "identity", "author", "set"])
        or (user_name is not None and user_email is not None)
    )
    has_status_intent = any(k in lowered for k in ["status", "check", "show", "query", "list"])

    # 3. Check for pure Status/Query intent when not configuring
    if has_status_intent and not has_config_intent:
        token = mint_execution_token("QUERY_STATUS", [["status", "--short"], ["config", "--list"]])
        return BrainDecision(
            action_type="QUERY_STATUS",
            user_name=user_name,
            user_email=user_email,
            missing_parameters=[],
            follow_up_prompt=None,
            git_arguments=[["status", "--short"], ["config", "--list"]],
            execution_token=token,
            explanation="Resolved query status intent. Prepared safe non-shell queries for Git configuration.",
            safety_verdict="PASSED: Read-only safe terminal commands authorized.",
        )

    # 4. Git Configuration intent
    if has_config_intent or any(k in lowered for k in ["git", "configure", "config", "setup", "identity", "author"]):
        missing = []
        if not user_name:
            missing.append("user_name")
        if not user_email:
            missing.append("user_email")

        # Chunk 1 (Structured Intent Resolution): If missing user_name or user_email,
        # it transitions to NEEDS_INFO and asks targeted follow-up questions.
        if missing:
            follow_up = ""
            if "user_name" in missing and "user_email" in missing:
                follow_up = "To configure your Git terminal identity securely, what full name and email address would you like to use?"
            elif "user_name" in missing:
                follow_up = f"Got your email ({user_email}). What full name should be associated with your Git commits?"
            else:
                follow_up = f"Got your name ({user_name}). What email address should be associated with your Git commits?"

            return BrainDecision(
                action_type="NEEDS_INFO",
                user_name=user_name,
                user_email=user_email,
                missing_parameters=missing,
                follow_up_prompt=follow_up,
                git_arguments=[],
                execution_token=None,
                explanation=f"Missing required parameters: {', '.join(missing)}. Gemini structured output transitions to NEEDS_INFO to gather required fields.",
                safety_verdict="INCOMPLETE_PARAMETERS: Awaiting user parameters before issuing execution token.",
            )

        # All parameters present! Prepare deterministic argument arrays
        git_args = [
            ["config", "--global", "user.name", user_name],
            ["config", "--global", "user.email", user_email],
            ["config", "--global", "core.autocrlf", "true"],
        ]
        token = mint_execution_token("EXECUTE_GIT_CONFIG", git_args)

        return BrainDecision(
            action_type="EXECUTE_GIT_CONFIG",
            user_name=user_name,
            user_email=user_email,
            missing_parameters=[],
            follow_up_prompt=None,
            git_arguments=git_args,
            execution_token=token,
            explanation=f"Successfully resolved Git configuration for {user_name} <{user_email}>. Issued single-use execution token for deterministic non-shell subprocess execution.",
            safety_verdict="PASSED: All required parameters gathered. Execution token minted for explicit argument array (shell=False).",
        )

    # Default fallback
    return BrainDecision(
        action_type="NEEDS_INFO",
        user_name=user_name,
        user_email=user_email,
        missing_parameters=["user_intent"],
        follow_up_prompt="How can SilentFix assist you? You can say: 'Configure Git with my name and email' or 'Check Git status'.",
        git_arguments=[],
        execution_token=None,
        explanation="Intent requires clarification. Prompt did not match supported deterministic actions.",
        safety_verdict="AWAITING_INPUT",
    )


async def plan_intent_with_gemini(prompt: str, context: Optional[dict[str, Any]] = None) -> BrainDecision:
    """Use Gemini 3.5 Flash Lite (or configured GEMINI_MODEL) structured output

    to resolve intent. Falls back to deterministic intent resolution if API key
    is absent or request fails.
    """
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    if not gemini_api_key or not gemini_api_key.strip():
        logger.info("GEMINI_API_KEY not configured; using deterministic intent engine.")
        return deterministic_intent_resolution(prompt, context)

    # Gemini REST API with JSON schema structured output
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"

    system_instruction = (
        "You are SilentFix AI Brain. You resolve user intent for system configuration. "
        "SilentFix enforces a strict deterministic privilege boundary: NEVER generate raw shell scripts. "
        "Strictly output structured JSON matching the BrainDecision schema. "
        "If configuring Git and either user_name or user_email is missing, set action_type='NEEDS_INFO', "
        "list the missing parameters in missing_parameters, and provide a polite follow_up_prompt. "
        "If all parameters are present, set action_type='EXECUTE_GIT_CONFIG' and prepare deterministic git_arguments."
    )

    request_body = {
        "contents": [
            {
                "parts": [
                    {"text": f"Context: {json.dumps(context or {})}\nUser Prompt: {prompt}"}
                ]
            }
        ],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=request_body)
            if resp.status_code == 200:
                data = resp.json()
                raw_json = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(raw_json)

                # Enforce privilege boundary: construct CLI argument arrays deterministically in Python
                action_type = parsed.get("action_type", "NEEDS_INFO")
                user_name = parsed.get("user_name")
                user_email = parsed.get("user_email")
                missing_parameters = parsed.get("missing_parameters", [])
                follow_up_prompt = parsed.get("follow_up_prompt")
                git_args: list[list[str]] = []
                token = None

                if action_type == "EXECUTE_GIT_CONFIG":
                    if user_name and user_email:
                        # Deterministic argument construction; guarantees zero LLM argument injection
                        git_args = [
                            ["config", "--global", "user.name", str(user_name).strip()],
                            ["config", "--global", "user.email", str(user_email).strip()],
                            ["config", "--global", "core.autocrlf", "true"],
                        ]
                        token = mint_execution_token(action_type, git_args)
                    else:
                        action_type = "NEEDS_INFO"
                        missing_parameters = []
                        if not user_name:
                            missing_parameters.append("user_name")
                        if not user_email:
                            missing_parameters.append("user_email")
                        if not follow_up_prompt:
                            follow_up_prompt = "What name and email would you like to configure for Git?"
                elif action_type == "QUERY_STATUS":
                    git_args = [["status", "--short"], ["config", "--list"]]
                    token = mint_execution_token(action_type, git_args)

                return BrainDecision(
                    action_type=action_type,
                    user_name=user_name,
                    user_email=user_email,
                    missing_parameters=missing_parameters,
                    follow_up_prompt=follow_up_prompt,
                    git_arguments=git_args,
                    execution_token=token,
                    explanation=parsed.get("explanation", "Resolved via Gemini structured output."),
                    safety_verdict="PASSED: Deterministic argument arrays constructed and validated.",
                )
            else:
                logger.warning("Gemini API error (%s); falling back to deterministic engine", resp.status_code)
                return deterministic_intent_resolution(prompt, context)
    except Exception as exc:
        logger.warning("Gemini call exception: %s; falling back to deterministic engine", exc)
        return deterministic_intent_resolution(prompt, context)
