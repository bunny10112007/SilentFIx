"""Windows 11 Compatibility Shim Engine API Router."""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.actions.compat_fixer import (
    CompatShimParams,
    CompatShimResult,
    apply_compatibility_shim,
    restore_compatibility_shim,
)
from app.state.db import consume_token_sync, store_ephemeral_token_sync

logger = logging.getLogger("silentfix.compat_route")

router = APIRouter(prefix="/api/compat", tags=["compat"])

UNDO_TOKEN_TTL_SECONDS = 3600.0  # 1 hour TTL


class ApplyCompatResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    result: CompatShimResult
    undo_token: str | None = None


class UndoCompatRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    undo_token: str = Field(min_length=12, max_length=128)


@router.post("/apply", response_model=ApplyCompatResponse)
async def compat_apply(params: CompatShimParams) -> ApplyCompatResponse:
    """Apply compatibility shims to a Windows executable."""
    res = await asyncio.to_thread(apply_compatibility_shim, params)
    undo_token = None
    if res.success:
        undo_token = secrets.token_urlsafe(16)
        payload = {
            "executable_path": res.executable_path,
            "previous_layer": res.previous_layer,
        }
        store_ephemeral_token_sync(
            token=undo_token,
            token_type="compat_undo",
            payload=payload,
            expires_at=time.time() + UNDO_TOKEN_TTL_SECONDS,
        )
    return ApplyCompatResponse(result=res, undo_token=undo_token)


@router.post("/undo")
async def compat_undo(req: UndoCompatRequest) -> dict:
    """Restore previous compatibility configuration using single-use undo token."""
    payload = consume_token_sync(req.undo_token, "compat_undo")
    if payload is None:
        raise HTTPException(status_code=404, detail="Invalid or expired undo token.")
    exe_path = payload.get("executable_path", "")
    prev_layer = payload.get("previous_layer")
    await asyncio.to_thread(restore_compatibility_shim, exe_path, prev_layer)
    return {"restored": True, "message": f"Restored previous settings for {exe_path}."}
