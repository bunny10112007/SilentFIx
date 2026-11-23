"""Tests for Module 1: Entry Point & Startup Crash-Recovery Sweep."""

import pytest
import pytest_asyncio
from app.state.db import init_db, create_session, get_session
from app.core.recovery import sweep_interrupted_sessions, get_pending_recoveries, resolve_recovery_session


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db(tmp_path, monkeypatch):
    test_db = str(tmp_path / "test_recovery.db")
    monkeypatch.setenv("DATABASE_PATH", test_db)
    await init_db()
    yield test_db


@pytest.mark.asyncio
async def test_startup_crash_recovery_sweep_detects_interrupted_sessions():
    """Chunk 1 (Lifespan Context): Sweeps database for sessions stuck in

    EXECUTING, SNAPSHOTTED, or WAITING_UAC and sets status to RECOVERY_REQUIRED.
    """
    # Create simulated interrupted sessions
    await create_session("sess_exec", "Git.Git", "Git", "winget", status_val="EXECUTING")
    await create_session("sess_snap", "GitHub.cli", "GitHub CLI", "winget", status_val="SNAPSHOTTED")
    await create_session("sess_uac", "VSCode", "VSCode", "winget", status_val="WAITING_UAC")
    await create_session("sess_done", "Python", "Python", "winget", status_val="COMPLETED")

    # Run startup sweep
    reconciled = await sweep_interrupted_sessions()
    assert len(reconciled) == 3

    # Check that pending recoveries returns the 3 items
    pending = await get_pending_recoveries()
    assert len(pending) == 3
    for p in pending:
        assert p["status"] == "RECOVERY_REQUIRED"

    # COMPLETED session must NOT be touched
    done_sess = await get_session("sess_done")
    assert done_sess["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_resolve_recovery_via_rollback():
    """1-Click recovery resolution safely rolls back interrupted state."""
    await create_session("sess_interrupted", "Git.Git", "Git", "winget", status_val="EXECUTING")
    await sweep_interrupted_sessions()

    # Reconcile via rollback
    res = await resolve_recovery_session("sess_interrupted", action="rollback")
    assert res["status"] == "ROLLED_BACK"

    s = await get_session("sess_interrupted")
    assert s["status"] == "ROLLED_BACK"
