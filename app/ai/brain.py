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
from typing import Any, Literal, Optional

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field

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


def mint_execution_token(action_type: str, git_arguments: list[list[str]]) -> str:
    """Issue a single-use execution token for verified deterministic commands."""
    now = time.time()
    # Purge expired tokens
    expired = [k for k, v in _brain_execution_tokens.items() if v[2] <= now]
    for k in expired:
        _brain_execution_tokens.pop(k, None)

    token = f"exec_{secrets.token_urlsafe(16)}"
    _brain_execution_tokens[token] = (action_type, git_arguments, now + EXECUTION_TOKEN_TTL_SECONDS)
    return token


def validate_and_evict_execution_token(token: str) -> tuple[str, list[list[str]]]:
    """Validate and consume single-use execution token."""
    now = time.time()
    if not token or token not in _brain_execution_tokens:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Invalid or expired execution token. Safe non-shell execution requires pre-authorized token.",
        )

    action_type, git_args, expires_at = _brain_execution_tokens.pop(token)
    if now > expires_at:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Execution token has expired. Please plan intent again.",
        )

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
