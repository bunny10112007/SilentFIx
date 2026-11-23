"""Crash Recovery API Router."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.recovery import get_pending_recoveries, resolve_recovery_session

logger = logging.getLogger("silentfix.recovery_route")

router = APIRouter(prefix="/api/recovery", tags=["Crash Recovery"])


class ResolveRecoveryRequest(BaseModel):
    action: Literal["rollback", "dismiss"] = "rollback"


@router.get("/pending")
async def list_pending_recoveries() -> dict[str, Any]:
    """Return all sessions flagged as RECOVERY_REQUIRED after a crash or power cut."""
    recoveries = await get_pending_recoveries()
    return {
        "count": len(recoveries),
        "recovery_required": len(recoveries) > 0,
        "sessions": recoveries,
    }


@router.post("/resolve/{session_id}")
async def resolve_session(session_id: str, req: ResolveRecoveryRequest) -> dict[str, Any]:
    """Execute 1-click recovery resolution (rollback or dismiss) on an interrupted session."""
    return await resolve_recovery_session(session_id=session_id, action=req.action)
