"""CLI Error Healer API Router."""

from __future__ import annotations

import asyncio
import logging
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.probes.cli_healer import CliDiagnosis, diagnose_terminal_error

logger = logging.getLogger("silentfix.healer_route")

router = APIRouter(prefix="/api/healer", tags=["healer"])


class DiagnoseRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    error_text: str


@router.post("/diagnose", response_model=CliDiagnosis)
async def healer_diagnose(req: DiagnoseRequest) -> CliDiagnosis:
    """Diagnose missing command from shell error output."""
    # Offload blocking multi-directory disk glob scan to worker thread pool
    return await asyncio.to_thread(diagnose_terminal_error, req.error_text)
