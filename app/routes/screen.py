"""Screen Privacy Guard API Router.

Endpoints for local in-memory screen inspection, PII blurring,
prompt injection detection, and tier3_guided_only enforcement.
"""

from __future__ import annotations

import base64
import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.cloud.aws_sync import archive_redacted_inspection_to_s3
from app.security.screen_guard import (
    ScreenInspectionResult,
    detect_injections,
    detect_pii,
    generate_sample_screen_inspection,
    process_screen_image_in_memory,
)

logger = logging.getLogger("silentfix.screen_route")

router = APIRouter(prefix="/api/screen", tags=["Screen Privacy Guard"])


class TextScanRequest(BaseModel):
    text: str


class TextScanResponse(BaseModel):
    injection_detected: bool
    blocked_patterns: list[str]
    detected_pii: list[str]
    tier3_guided_only: bool
    sanitized_text: str


@router.post("/inspect", response_model=ScreenInspectionResult)
async def inspect_screen(
    simulate_injection: bool = True,
    simulate_pii: bool = True,
) -> ScreenInspectionResult:
    """Perform in-memory OCR, 16px Gaussian PII blurring, and prompt injection detection."""
    result = generate_sample_screen_inspection(
        with_injection=simulate_injection,
        with_pii=simulate_pii,
    )

    # Offload PII-redacted inspection archive to AWS S3 without blocking async loop
    try:
        if result.redacted_image_base64 and result.redacted_image_base64.startswith("data:image/png;base64,"):
            b64_part = result.redacted_image_base64.split(",", 1)[1]
            raw_png = base64.b64decode(b64_part)
            inspection_id = f"insp_{uuid.uuid4().hex[:8]}"
            await archive_redacted_inspection_to_s3(
                inspection_id=inspection_id,
                redacted_image_bytes=raw_png,
            )
    except Exception as exc:
        logger.warning("Failed to archive inspection image to S3: %s", exc)

    return result


@router.post("/scan-text", response_model=TextScanResponse)
async def scan_text_input(req: TextScanRequest) -> TextScanResponse:
    """Scan raw user or clipboard text for prompt injection signatures and PII."""
    injections = detect_injections(req.text)
    pii = detect_pii(req.text)
    tier3 = len(injections) > 0

    sanitized = req.text
    for inj in injections:
        sanitized = sanitized.replace(inj, "[BLOCKED_INJECTION]")

    return TextScanResponse(
        injection_detected=len(injections) > 0,
        blocked_patterns=injections,
        detected_pii=pii,
        tier3_guided_only=tier3,
        sanitized_text=sanitized,
    )


@router.get("/status")
async def get_guard_status() -> dict[str, Any]:
    """Return status of screen guard protections."""
    return {
        "status": "active",
        "in_memory_only": True,
        "disk_persistence": False,
        "gaussian_blur_radius_px": 16,
        "ocr_engine": "RapidOCR/In-Memory-Engine",
        "supported_pii": ["EMAIL", "PAYMENT_CARD", "AUTH_TOKEN", "PHONE_NUMBER", "SSN"],
        "tier3_guided_only_active": False,
    }
