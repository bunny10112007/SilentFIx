"""Tests for Module 2: Transactional SQLite Ledger & Rollback Locks."""

import os
import pytest
import pytest_asyncio
from fastapi import HTTPException
from app.state.db import (
    init_db,
    get_connection,
    create_session,
    get_session,
    log_install_event,
    get_session_events,
    atomic_acquire_rollback_lock,
    mark_rollback_completed,
)


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db(tmp_path, monkeypatch):
    test_db = str(tmp_path / "test_silentfix.db")
    monkeypatch.setenv("DATABASE_PATH", test_db)
    await init_db()
    yield test_db


@pytest.mark.asyncio
async def test_sqlite_wal_mode_configured():
    """Chunk 1: Guarantees SQLite Write-Ahead Logging (WAL) is enabled."""
    async with get_connection() as conn:
        cursor = await conn.execute("PRAGMA journal_mode;")
        row = await cursor.fetchone()
        assert row[0].lower() == "wal"


@pytest.mark.asyncio
async def test_session_lifecycle_and_event_logging():
    """Verify session creation and sequential event tracking."""
    session_id = "test_sess_001"
    session = await create_session(
        session_id=session_id,
        package_id="Git.Git",
        package_name="Git for Windows",
        source="winget",
        status_val="SNAPSHOTTED",
    )
    assert session["session_id"] == session_id
    assert session["status"] == "SNAPSHOTTED"

    ev1 = await log_install_event(session_id, "DOWNLOADING", 25, "Downloaded 25%")
    ev2 = await log_install_event(session_id, "INSTALLING", 80, "Installing...")

    events = await get_session_events(session_id)
    assert len(events) == 2
    assert events[0]["phase"] == "DOWNLOADING"
    assert events[1]["phase"] == "INSTALLING"


@pytest.mark.asyncio
async def test_atomic_rollback_lock_cas_and_409_conflict():
    """Chunk 2: Uses BEGIN IMMEDIATE to execute atomic compare-and-swap.

    Second concurrent rollback request must fail cleanly with 409 Conflict.
    """
    session_id = "test_sess_cas"
    await create_session(
        session_id=session_id,
        package_id="Git.Git",
        package_name="Git",
        source="winget",
        status_val="COMPLETED",
    )

    # First request acquires lock and transitions to ROLLING_BACK
    lock1 = await atomic_acquire_rollback_lock(session_id, reason="User clicked rollback")
    assert lock1["current_status"] == "ROLLING_BACK"

    # Fetch session to verify DB update
    s = await get_session(session_id)
    assert s["status"] == "ROLLING_BACK"

    # Second request hits 409 Conflict (atomic CAS rejected)
    with pytest.raises(HTTPException) as exc:
        await atomic_acquire_rollback_lock(session_id, reason="Duplicate concurrent click")
    assert exc.value.status_code == 409
    assert "Conflict" in exc.value.detail

    # Finalize rollback
    await mark_rollback_completed(session_id, "Uninstalled cleanly")
    s_final = await get_session(session_id)
    assert s_final["status"] == "ROLLED_BACK"

    # Subsequent request on ROLLED_BACK also rejects with 409
    with pytest.raises(HTTPException) as exc2:
        await atomic_acquire_rollback_lock(session_id, reason="Third attempt")
    assert exc2.value.status_code == 409
