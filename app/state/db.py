"""Module 2: Transactional SQLite Ledger & Rollback Locks.

Provides thread-safe async SQLite access using aiosqlite.
Configures Write-Ahead Logging (WAL) and implements an atomic compare-and-swap
lock to prevent race conditions during 1-click uninstalls.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import aiosqlite
from fastapi import HTTPException, status

logger = logging.getLogger("silentfix.db")

DEFAULT_DB_PATH = os.getenv("DATABASE_PATH", "silentfix_state.db")


def get_db_path() -> str:
    """Return the database path, allowing runtime environment overrides."""
    return os.getenv("DATABASE_PATH", DEFAULT_DB_PATH)


# Chunk 1 (WAL Configuration): Enables Write-Ahead Logging so real-time SSE progress
# events can be logged simultaneously without locking readers or interrupting active installations.
@asynccontextmanager
async def get_connection() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Connect to SQLite and configure WAL mode and busy timeout."""
    db_path = get_db_path()
    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode = WAL;")
    await conn.execute("PRAGMA synchronous = NORMAL;")
    await conn.execute("PRAGMA busy_timeout = 5000;")
    await conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
    finally:
        await conn.close()


async def init_db() -> None:
    """Initialize database schemas and tables."""
    db_path = Path(get_db_path())
    db_path.parent.mkdir(parents=True, exist_ok=True)

    async with get_connection() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                package_id TEXT NOT NULL,
                package_name TEXT,
                source TEXT NOT NULL,
                version TEXT,
                status TEXT NOT NULL,
                probe_token TEXT,
                snapshot_data TEXT,
                rollback_reason TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS install_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                event_id INTEGER NOT NULL,
                phase TEXT NOT NULL,
                progress INTEGER DEFAULT 0,
                message TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            );
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cloud_audit_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                sync_status TEXT NOT NULL,
                dynamo_synced_at TEXT,
                s3_synced_at TEXT,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ephemeral_tokens (
                token TEXT PRIMARY KEY,
                token_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                expires_at REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ephemeral_tokens_type_exp
            ON ephemeral_tokens(token_type, expires_at);
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS manifest_cache (
                package_id TEXT PRIMARY KEY,
                installer_url TEXT NOT NULL,
                installer_sha256 TEXT NOT NULL,
                version TEXT,
                publisher TEXT,
                fetched_at REAL NOT NULL,
                expires_at REAL NOT NULL
            );
            """
        )

        await conn.commit()
    logger.info("Initialized SQLite WAL database at %s", db_path)


def utc_now_iso() -> str:
    """Current UTC timestamp formatted as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


async def create_session(
    session_id: str,
    package_id: str,
    package_name: str,
    source: str,
    version: Optional[str] = None,
    probe_token: Optional[str] = None,
    status_val: str = "PENDING",
    snapshot_data: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Create a new installation session in the ledger."""
    now = utc_now_iso()
    snapshot_json = json.dumps(snapshot_data or {})

    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO sessions (
                session_id, package_id, package_name, source, version,
                status, probe_token, snapshot_data, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                package_id,
                package_name,
                source,
                version,
                status_val,
                probe_token,
                snapshot_json,
                now,
                now,
            ),
        )
        await conn.commit()

    return {
        "session_id": session_id,
        "package_id": package_id,
        "package_name": package_name,
        "source": source,
        "version": version,
        "status": status_val,
        "created_at": now,
        "updated_at": now,
    }


async def get_session(session_id: str) -> Optional[dict[str, Any]]:
    """Retrieve session details by ID."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        data = dict(row)
        if data.get("snapshot_data"):
            try:
                data["snapshot_data"] = json.loads(data["snapshot_data"])
            except Exception:
                pass
        return data


async def list_sessions(limit: int = 50) -> list[dict[str, Any]]:
    """List recent sessions."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            if d.get("snapshot_data"):
                try:
                    d["snapshot_data"] = json.loads(d["snapshot_data"])
                except Exception:
                    pass
            result.append(d)
        return result


async def update_session_status(
    session_id: str,
    new_status: str,
    snapshot_data: Optional[dict[str, Any]] = None,
    rollback_reason: Optional[str] = None,
) -> bool:
    """Update status and optional snapshot/rollback data for a session."""
    now = utc_now_iso()
    async with get_connection() as conn:
        if snapshot_data is not None:
            snapshot_json = json.dumps(snapshot_data)
            await conn.execute(
                """
                UPDATE sessions
                SET status = ?, snapshot_data = ?, updated_at = ?
                WHERE session_id = ?
                """,
                (new_status, snapshot_json, now, session_id),
            )
        elif rollback_reason is not None:
            await conn.execute(
                """
                UPDATE sessions
                SET status = ?, rollback_reason = ?, updated_at = ?
                WHERE session_id = ?
                """,
                (new_status, rollback_reason, now, session_id),
            )
        else:
            await conn.execute(
                """
                UPDATE sessions
                SET status = ?, updated_at = ?
                WHERE session_id = ?
                """,
                (new_status, now, session_id),
            )
        await conn.commit()
    return True


async def log_install_event(
    session_id: str,
    phase: str,
    progress: int,
    message: str,
) -> int:
    """Log an SSE install event to the local database."""
    now = utc_now_iso()
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT COALESCE(MAX(event_id), 0) + 1 FROM install_events WHERE session_id = ?",
            (session_id,),
        )
        next_event_id = (await cursor.fetchone())[0]

        cursor = await conn.execute(
            """
            INSERT INTO install_events (session_id, event_id, phase, progress, message, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, next_event_id, phase, progress, message, now),
        )
        await conn.commit()
        return next_event_id


async def get_session_events(
    session_id: str,
    after_event_id: int = 0,
) -> list[dict[str, Any]]:
    """Retrieve logged events for reconnection replay deduplication."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT * FROM install_events
            WHERE session_id = ? AND event_id > ?
            ORDER BY event_id ASC
            """,
            (session_id, after_event_id),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# Chunk 2 (Atomic Lock): Uses BEGIN IMMEDIATE to execute an atomic compare-and-swap update.
# If multiple requests trigger rollback at the same time, only one request transitions
# the row status to ROLLING_BACK; subsequent requests fail cleanly with 409 Conflict.
async def atomic_acquire_rollback_lock(session_id: str, reason: str = "User initiated 1-click rollback") -> dict[str, Any]:
    """Atomically acquire the rollback lock for a session.

    Raises:
        HTTPException 404: Session not found.
        HTTPException 409: Rollback already in progress or already rolled back.
    """
    now = utc_now_iso()
    async with get_connection() as conn:
        # Acquire reserved write lock immediately
        await conn.execute("BEGIN IMMEDIATE")

        cursor = await conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        )
        row = await cursor.fetchone()
        if not row:
            await conn.execute("ROLLBACK")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {session_id} not found",
            )

        current_status = row["status"]

        # Conflict condition: Already rolling back or already completed rollback
        if current_status in ("ROLLING_BACK", "ROLLED_BACK"):
            await conn.execute("ROLLBACK")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Conflict: Session {session_id} is already in state '{current_status}'. Rollback lock rejected.",
            )

        # Transition status to ROLLING_BACK atomically
        await conn.execute(
            """
            UPDATE sessions
            SET status = 'ROLLING_BACK', rollback_reason = ?, updated_at = ?
            WHERE session_id = ? AND status = ?
            """,
            (reason, now, session_id, current_status),
        )
        await conn.commit()

    # Log atomic rollback event
    await log_install_event(
        session_id=session_id,
        phase="ROLLING_BACK",
        progress=0,
        message=f"Atomic rollback lock acquired. Reason: {reason}",
    )

    return {
        "session_id": session_id,
        "previous_status": current_status,
        "current_status": "ROLLING_BACK",
        "lock_acquired_at": now,
    }


async def mark_rollback_completed(session_id: str, details: Optional[str] = None) -> None:
    """Transition session status to ROLLED_BACK."""
    now = utc_now_iso()
    async with get_connection() as conn:
        await conn.execute(
            """
            UPDATE sessions
            SET status = 'ROLLED_BACK', updated_at = ?
            WHERE session_id = ?
            """,
            (now, session_id),
        )
        await conn.commit()

    await log_install_event(
        session_id=session_id,
        phase="ROLLED_BACK",
        progress=100,
        message=details or "Rollback completed successfully.",
    )


async def store_ephemeral_token(
    token: str,
    token_type: str,
    payload: dict[str, Any],
    expires_at: float,
) -> None:
    """Store an ephemeral single-use token in SQLite WAL database."""
    now = utc_now_iso()
    payload_str = json.dumps(payload)
    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO ephemeral_tokens (token, token_type, payload_json, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET
                token_type=excluded.token_type,
                payload_json=excluded.payload_json,
                expires_at=excluded.expires_at,
                created_at=excluded.created_at
            """,
            (token, token_type, payload_str, expires_at, now),
        )
        await conn.commit()


async def consume_token(token: str, expected_type: str) -> dict[str, Any] | None:
    """Atomically validate and evict a single-use token.

    Uses atomic DELETE ... RETURNING (or transactional fallback) to prevent
    concurrency race conditions and token replay across restarts and workers.
    """
    now = time.time()
    async with get_connection() as conn:
        try:
            cursor = await conn.execute(
                """
                DELETE FROM ephemeral_tokens
                WHERE token = ? AND token_type = ? AND expires_at > ?
                RETURNING payload_json
                """,
                (token, expected_type, now),
            )
            row = await cursor.fetchone()
            await conn.commit()
            if row and row[0]:
                return json.loads(row[0])
            return None
        except Exception:
            # Transactional fallback if RETURNING is not supported
            await conn.execute("BEGIN IMMEDIATE")
            cursor = await conn.execute(
                """
                SELECT payload_json FROM ephemeral_tokens
                WHERE token = ? AND token_type = ? AND expires_at > ?
                """,
                (token, expected_type, now),
            )
            row = await cursor.fetchone()
            if row:
                await conn.execute(
                    "DELETE FROM ephemeral_tokens WHERE token = ?",
                    (token,),
                )
                await conn.commit()
                return json.loads(row[0])
            await conn.execute("COMMIT")
            return None


async def prune_expired_tokens() -> int:
    """Prune expired ephemeral tokens from the database."""
    now = time.time()
    async with get_connection() as conn:
        cursor = await conn.execute(
            "DELETE FROM ephemeral_tokens WHERE expires_at <= ?",
            (now,),
        )
        await conn.commit()
        return cursor.rowcount


async def get_cached_manifest(package_id: str) -> dict[str, Any] | None:
    """Retrieve non-expired package manifest from manifest_cache table."""
    now = time.time()
    async with get_connection() as conn:
        try:
            cursor = await conn.execute(
                """
                SELECT package_id, installer_url, installer_sha256, version, publisher, expires_at
                FROM manifest_cache
                WHERE package_id = ? AND expires_at > ?
                """,
                (package_id, now),
            )
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None
        except Exception:
            return None


async def set_cached_manifest(
    package_id: str,
    installer_url: str,
    installer_sha256: str,
    version: Optional[str] = None,
    publisher: Optional[str] = None,
    ttl_seconds: float = 21600.0,  # 6 hours TTL
) -> None:
    """Cache live package manifest with 6-hour TTL."""
    now = time.time()
    expires_at = now + ttl_seconds
    async with get_connection() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS manifest_cache (
                package_id TEXT PRIMARY KEY,
                installer_url TEXT NOT NULL,
                installer_sha256 TEXT NOT NULL,
                version TEXT,
                publisher TEXT,
                fetched_at REAL NOT NULL,
                expires_at REAL NOT NULL
            );
            """
        )
        await conn.execute(
            """
            INSERT INTO manifest_cache (package_id, installer_url, installer_sha256, version, publisher, fetched_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(package_id) DO UPDATE SET
                installer_url=excluded.installer_url,
                installer_sha256=excluded.installer_sha256,
                version=excluded.version,
                publisher=excluded.publisher,
                fetched_at=excluded.fetched_at,
                expires_at=excluded.expires_at
            """,
            (package_id, installer_url, installer_sha256, version, publisher, now, expires_at),
        )
        await conn.commit()


def get_sync_connection() -> sqlite3.Connection:
    """Synchronous SQLite connection for sync probe callers & tests."""
    db_path = get_db_path()
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ephemeral_tokens (
            token TEXT PRIMARY KEY,
            token_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            expires_at REAL NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ephemeral_tokens_type_exp
        ON ephemeral_tokens(token_type, expires_at);
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS manifest_cache (
            package_id TEXT PRIMARY KEY,
            installer_url TEXT NOT NULL,
            installer_sha256 TEXT NOT NULL,
            version TEXT,
            publisher TEXT,
            fetched_at REAL NOT NULL,
            expires_at REAL NOT NULL
        );
        """
    )
    conn.commit()
    return conn


def store_ephemeral_token_sync(
    token: str,
    token_type: str,
    payload: dict[str, Any],
    expires_at: float,
) -> None:
    """Store an ephemeral token synchronously."""
    now = utc_now_iso()
    payload_str = json.dumps(payload)
    with get_sync_connection() as conn:
        conn.execute(
            """
            INSERT INTO ephemeral_tokens (token, token_type, payload_json, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET
                token_type=excluded.token_type,
                payload_json=excluded.payload_json,
                expires_at=excluded.expires_at,
                created_at=excluded.created_at
            """,
            (token, token_type, payload_str, expires_at, now),
        )
        conn.commit()


def consume_token_sync(token: str, expected_type: str) -> dict[str, Any] | None:
    """Synchronously validate and evict single-use token atomically."""
    now = time.time()
    with get_sync_connection() as conn:
        try:
            cursor = conn.execute(
                """
                DELETE FROM ephemeral_tokens
                WHERE token = ? AND token_type = ? AND expires_at > ?
                RETURNING payload_json
                """,
                (token, expected_type, now),
            )
            row = cursor.fetchone()
            conn.commit()
            if row and row[0]:
                return json.loads(row[0])
            return None
        except Exception:
            cursor = conn.execute(
                """
                SELECT payload_json FROM ephemeral_tokens
                WHERE token = ? AND token_type = ? AND expires_at > ?
                """,
                (token, expected_type, now),
            )
            row = cursor.fetchone()
            if row:
                conn.execute("DELETE FROM ephemeral_tokens WHERE token = ?", (token,))
                conn.commit()
                return json.loads(row[0])
            return None
