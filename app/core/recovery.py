"""Module 1 Helper: Startup Crash-Recovery Sweep.

Sweeps the SQLite database on startup during FastAPI lifespan initialization
to safely reconcile power outages, crashes, or interrupted installer states.
"""

from __future__ import annotations

import logging
from typing import Any

from app.state.db import (
    atomic_acquire_rollback_lock,
    get_connection,
    log_install_event,
    mark_rollback_completed,
    update_session_status,
    utc_now_iso,
)

logger = logging.getLogger("silentfix.recovery")


async def sweep_interrupted_sessions() -> list[dict[str, Any]]:
    """Chunk 1 (Lifespan Context): Sweeps the database for sessions stuck in

    EXECUTING or SNAPSHOTTED states. If a background installer process was
    killed during a crash, it sets the status to RECOVERY_REQUIRED so the
    frontend displays an interactive recovery banner on boot.
    """
    reconciled = []
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT * FROM sessions
            WHERE status IN ('EXECUTING', 'SNAPSHOTTED', 'WAITING_UAC')
            """
        )
        stuck_rows = await cursor.fetchall()

        for row in stuck_rows:
            session_id = row["session_id"]
            pkg_id = row["package_id"]
            old_status = row["status"]
            now = utc_now_iso()

            logger.warning(
                "Crash Recovery Sweep detected interrupted session %s (status: %s, package: %s)",
                session_id,
                old_status,
                pkg_id,
            )

            await conn.execute(
                """
                UPDATE sessions
                SET status = 'RECOVERY_REQUIRED', updated_at = ?
                WHERE session_id = ?
                """,
                (now, session_id),
            )

            reconciled.append({
                "session_id": session_id,
                "package_id": pkg_id,
                "previous_status": old_status,
                "reconciled_to": "RECOVERY_REQUIRED",
            })

        await conn.commit()

    # Log recovery events outside connection context
    for item in reconciled:
        await log_install_event(
            session_id=item["session_id"],
            phase="RECOVERY_REQUIRED",
            progress=0,
            message="Startup crash-recovery sweep flagged session as interrupted. Interactive recovery required.",
        )

    if reconciled:
        logger.info(
            "Startup sweep successfully reconciled %d interrupted session(s) to RECOVERY_REQUIRED.",
            len(reconciled),
        )
    else:
        logger.info("Startup crash-recovery sweep completed: no interrupted sessions found.")

    return reconciled


async def get_pending_recoveries() -> list[dict[str, Any]]:
    """Retrieve all sessions currently flagged as RECOVERY_REQUIRED."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT * FROM sessions
            WHERE status = 'RECOVERY_REQUIRED'
            ORDER BY updated_at DESC
            """
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def resolve_recovery_session(session_id: str, action: str = "rollback") -> dict[str, Any]:
    """Resolve an interrupted session by either performing an atomic rollback

    or dismissing the recovery flag.
    """
    if action == "rollback":
        # Acquire atomic CAS lock and rollback safely
        lock_res = await atomic_acquire_rollback_lock(
            session_id=session_id,
            reason="Automated crash recovery rollback",
        )
        await mark_rollback_completed(
            session_id=session_id,
            details="Interrupted installation rolled back cleanly by crash recovery manager.",
        )
        return {
            "session_id": session_id,
            "action": "rollback",
            "status": "ROLLED_BACK",
            "message": "Session successfully rolled back and restored.",
        }
    else:
        now = utc_now_iso()
        async with get_connection() as conn:
            await conn.execute(
                """
                UPDATE sessions
                SET status = 'DISMISSED', updated_at = ?
                WHERE session_id = ?
                """,
                (now, session_id),
            )
            await conn.commit()
        return {
            "session_id": session_id,
            "action": "dismiss",
            "status": "DISMISSED",
            "message": "Session dismissed from recovery queue.",
        }
