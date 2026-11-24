# app/routes/voice.py
"""ElevenLabs Voice Accessibility & Speech-to-Text Proxy."""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger("silentfix.voice")

router = APIRouter(prefix="/api/voice", tags=["voice"])

DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
DEFAULT_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")


class SpeakRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    alert_type: Optional[str] = None


class TranscribeResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    text: str
    provider: str


@router.post("/speak")
async def stream_speech(req: SpeakRequest) -> Response:
    """Chunk 1 (Audio Proxy): Uses `eleven_flash_v2_5` for sub-300ms speech synthesis.

    Returns HTTP 204 if no API key is provided, maintaining silent UI execution.
    """
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key or not api_key.strip():
        logger.debug("ELEVENLABS_API_KEY is not configured. Returning HTTP 204 (Silent UI fallback).")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    voice_id = req.voice_id or DEFAULT_VOICE_ID
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"

    headers = {
        "xi-api-key": api_key.strip(),
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    body = {
        "text": req.text,
        "model_id": DEFAULT_MODEL_ID,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.8,
            "use_speaker_boost": True,
        },
    }

    client = httpx.AsyncClient(timeout=10.0)
    try:
        req_stream = client.build_request("POST", url, headers=headers, json=body)
        resp = await client.send(req_stream, stream=True)

        if resp.status_code != 200:
            await resp.aclose()
            await client.aclose()
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        async def audio_stream():
            try:
                async for chunk in resp.aiter_bytes(chunk_size=1024):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            audio_stream(),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-cache",
                "X-ElevenLabs-Model": DEFAULT_MODEL_ID,
            },
        )
    except Exception as exc:
        await client.aclose()
        logger.warning("Failed to reach ElevenLabs TTS: %s; falling back to 204", exc)
        return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/presets")
async def get_voice_presets():
    """Return pre-configured accessibility spoken prompts."""
    return {
        "presets": {
            "TRUST_GATE_PASSED": "SilentFix trust gate verified. HTTPS source confirmed and SHA-256 manifest hash validated. Installation is safe to proceed.",
            "WAITING_UAC": "Attention: Windows User Account Control requires your approval. Please look at your screen and click Yes on the elevation prompt to proceed.",
            "SCAM_POPUP_ALERT": "Warning: High risk scam popup detected on screen. Prompt injection signatures have been blocked and sensitive information has been blurred.",
            "ROLLBACK_TRIGGERED": "1-click rollback engaged. Restoring system state and uninstalling package deterministically.",
            "RECOVERY_REQUIRED": "SilentFix detected an interrupted installation from an unexpected system restart. You can safely recover or roll back now.",
        }
    }


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_voice(file: UploadFile = File(...)) -> TranscribeResponse:
    """Converts user microphone audio to text using ElevenLabs Speech-to-Text (Scribe)."""
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ELEVENLABS_API_KEY not configured; switch to browser speech recognition.",
        )

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")

    client = httpx.AsyncClient(timeout=20.0)
    try:
        resp = await client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": api_key},
            data={"model_id": "scribe_v1"},
            files={
                "file": (
                    file.filename or "command.webm",
                    audio_bytes,
                    file.content_type or "audio/webm",
                )
            },
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"ElevenLabs STT error ({resp.status_code}).",
            )
        payload = resp.json()
        transcript = str(payload.get("text", "")).strip()
        return TranscribeResponse(text=transcript, provider="elevenlabs")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Voice service unavailable: {exc}") from exc
    finally:
        await client.aclose()
