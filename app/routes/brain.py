"""Gemini AI Brain & Safe Terminal Execution Router."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.actions.git_configurator import (
    SafeTerminalExecutionResult,
    execute_authorized_brain_actions,
    get_current_git_identity,
)
from app.ai.brain import BrainDecision, plan_intent_with_gemini

logger = logging.getLogger("silentfix.brain_route")

router = APIRouter(prefix="/api/brain", tags=["AI Brain & Safe Execution"])


class IntentRequest(BaseModel):
    prompt: str
    context: Optional[dict[str, Any]] = None


class ExecuteIntentRequest(BaseModel):
    execution_token: str


@router.post("/decide", response_model=BrainDecision)
async def decide_intent(req: IntentRequest) -> BrainDecision:
    """Analyze user prompt using Gemini 3.5 Flash Lite structured outputs.

    If parameters are missing, returns action_type='NEEDS_INFO'.
    When complete, issues single-use execution token.
    """
    return await plan_intent_with_gemini(req.prompt, req.context)


@router.post("/execute", response_model=SafeTerminalExecutionResult)
async def execute_decision(req: ExecuteIntentRequest) -> SafeTerminalExecutionResult:
    """Execute pre-planned actions using a validated single-use execution token

    via non-shell subprocess execution (shell=False).
    """
    return await execute_authorized_brain_actions(req.execution_token)


@router.get("/identity")
async def get_git_identity() -> dict[str, Any]:
    """Retrieve current Git author identity via non-shell inspection."""
    return await get_current_git_identity()
