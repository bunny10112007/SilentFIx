"""Tests for Module 7 & 8: AWS Cloud Sync and ElevenLabs Voice Accessibility."""

import pytest
import pytest_asyncio
import os
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.cloud.aws_sync import (
    replicate_audit_record_to_dynamodb,
    archive_redacted_inspection_to_s3,
    get_cloud_audit_history,
)
from app.state.db import init_db


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db(tmp_path, monkeypatch):
    test_db = str(tmp_path / "test_cloud.db")
    monkeypatch.setenv("DATABASE_PATH", test_db)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.delenv("AWS_SESSION_TOKEN", raising=False)
    await init_db()
    yield test_db


@pytest.mark.asyncio
async def test_elevenlabs_voice_returns_204_when_no_api_key():
    """Module 8 Chunk 1: Returns HTTP 204 if no API key is provided,

    maintaining silent UI execution.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/voice/speak",
            json={"text": "Pre-flight check verified.", "alert_type": "TRUST_GATE_PASSED"},
        )
        assert resp.status_code == 204


@pytest.mark.asyncio
async def test_off_thread_dynamodb_fallback_without_cloud_credentials():
    """Module 7 Chunk 1: Missing cloud credentials fallback cleanly to local

    SQLite ledger without blocking the async event loop.
    """
    res = await replicate_audit_record_to_dynamodb(
        entity_type="SESSION_INSTALL",
        entity_id="inst_test_123",
        payload={"package_id": "Git.Git", "status": "COMPLETED"},
    )
    assert res["sync_status"] == "LOCAL_ONLY"

    records = await get_cloud_audit_history()
    assert len(records) >= 1
    assert records[0]["entity_id"] == "inst_test_123"


@pytest.mark.asyncio
async def test_privacy_preserving_s3_archive_telemetry():
    """Module 7 Chunk 2: Privacy-preserving inspection archive records in ledger."""
    dummy_redacted_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    res = await archive_redacted_inspection_to_s3(
        inspection_id="inspect_999",
        redacted_image_bytes=dummy_redacted_bytes,
    )
    assert res["sync_status"] == "LOCAL_ONLY"
    assert "redacted_inspections" in res["s3_key"]


@pytest.mark.asyncio
async def test_cloud_audit_endpoint_and_session_token(monkeypatch):
    """Verifies /api/install/cloud-audit endpoint and AWS_SESSION_TOKEN environment handling."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test_key")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test_secret")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "test_token")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Trigger an audit record creation
        await replicate_audit_record_to_dynamodb(
            entity_type="TEST_SESSION",
            entity_id="test_id_token",
            payload={"test": "data"},
        )

        resp = await client.get("/api/install/cloud-audit")
        assert resp.status_code == 200
        data = resp.json()
        assert "records" in data
        assert any(r["entity_id"] == "test_id_token" for r in data["records"])
