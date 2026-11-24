"""Module 3: Pre-Flight Trust Gate & Token Verification Router.

Implements the pre-flight verification gate. Before software installation can begin,
this endpoint verifies the source and mints a single-use token bound to the specific
package, source, and scope. Returns 403 Forbidden if bypassed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.actions.winget_streamer import execute_winget_uninstall, stream_winget_install
from app.cloud.aws_sync import get_cloud_audit_history, replicate_audit_record_to_dynamodb
from app.probes.software_probe import (
    VERIFIED_PACKAGE_CATALOG,
    PreFlightProbeRequest,
    PreFlightVerdict,
    validate_and_evict_token,
    verify_package_manifest,
)
from app.state.db import (
    atomic_acquire_rollback_lock,
    create_session,
    get_session,
    get_session_events,
    list_sessions,
    log_install_event,
    mark_rollback_completed,
    update_session_status,
)

logger = logging.getLogger("silentfix.install_route")

# In-memory registry for single-instance installer execution & live SSE pub/sub
_active_jobs: dict[str, asyncio.Task] = {}
_session_locks: dict[str, asyncio.Lock] = {}
_active_install_tasks: dict[str, asyncio.Task] = _active_jobs
_session_subscribers: dict[str, list[asyncio.Queue]] = {}


async def get_or_attach_install_task(session_id: str, coroutine):
    async with _session_locks.setdefault(session_id, asyncio.Lock()):
        if session_id not in _active_jobs or _active_jobs[session_id].done():
            _active_jobs[session_id] = asyncio.create_task(coroutine)
        return _active_jobs[session_id]


async def _run_install_job(session_id: str, package_id: str, source: str) -> None:
    """Executes installation exactly once per session and broadcasts events to all live SSE subscribers."""
    try:
        async for prog_event in stream_winget_install(
            session_id=session_id,
            package_id=package_id,
            source=source,
        ):
            subscribers = _session_subscribers.get(session_id, [])
            for q in list(subscribers):
                try:
                    q.put_nowait(prog_event)
                except Exception:
                    pass
    except Exception as exc:
        logger.error("Error in background install job for %s: %s", session_id, exc)
    finally:
        _active_jobs.pop(session_id, None)


router = APIRouter(prefix="/api/install", tags=["Install & Pre-Flight Trust Gate"])


class StartInstallRequest(BaseModel):
    package_id: str
    source: str = "winget"
    scope: str = "user"
    probe_token: str
    package_name: Optional[str] = None
    version: Optional[str] = None


class RollbackRequest(BaseModel):
    reason: Optional[str] = "User-initiated 1-click rollback"


@router.get("/catalog")
async def get_verified_catalog() -> dict[str, Any]:
    """Return known verified package catalog for easy 1-click selection."""
    return {"catalog": VERIFIED_PACKAGE_CATALOG}


@router.post("/probe", response_model=PreFlightVerdict)
async def probe_software(request: PreFlightProbeRequest) -> PreFlightVerdict:
    """Pre-Flight Trust Gate:

    - Enforces HTTPS sources
    - Validates SHA-256 manifest hashes
    - Mints single-use 5-minute probe_token
    """
    return await verify_package_manifest(
        package_id=request.package_id,
        source_url=request.source_url,
        sha256_hash=request.sha256_hash,
        version=request.version,
    )


@router.post("/start")
async def start_installation(req: StartInstallRequest) -> dict[str, Any]:
    """Validate pre-flight probe token and initialize install session.

    Chunk 2: Token Validation & Eviction. Validates parameter signatures
    and deletes the token immediately upon use. Direct calls without a
    valid token are blocked with 403 Forbidden.
    """
    # Enforce and evict single-use token (raises 403 if invalid or already consumed)
    validate_and_evict_token(
        token=req.probe_token,
        package_id=req.package_id,
        source=req.source,
    )

    session_id = f"inst_{uuid.uuid4().hex[:12]}"
    package_name = req.package_name or req.package_id

    # Create pre-install snapshot data for deterministic rollback
    snapshot_data = {
        "package_id": req.package_id,
        "package_name": package_name,
        "source": req.source,
        "scope": req.scope,
        "version": req.version,
        "probe_token_used": req.probe_token[:8] + "...",
        "rollback_command": ["winget", "uninstall", "--id", req.package_id, "--exact"],
    }

    session = await create_session(
        session_id=session_id,
        package_id=req.package_id,
        package_name=package_name,
        source=req.source,
        version=req.version,
        probe_token=req.probe_token,
        status_val="SNAPSHOTTED",
        snapshot_data=snapshot_data,
    )

    logger.info("Created session %s with SNAPSHOTTED state for %s", session_id, req.package_id)

    # Off-thread DynamoDB audit sync for installation initiation
    await replicate_audit_record_to_dynamodb(
        entity_type="INSTALL_SESSION",
        entity_id=session_id,
        payload=snapshot_data,
    )

    return {
        "status": "ready",
        "session_id": session_id,
        "stream_url": f"/api/install/stream/{session_id}",
        "session": session,
    }


@router.get("/stream/{session_id}")
async def stream_installation(
    session_id: str,
    last_event_id: Optional[int] = Query(None, alias="lastEventId"),
    header_last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
) -> StreamingResponse:
    """Named-event Server-Sent Events (SSE) streaming with replay deduplication.

    Yields real-time events and closes connection automatically on terminal state.
    """
    session = await get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Installation session {session_id} not found",
        )

    # Determine replay checkpoint for connection reconnects
    effective_last_id = 0
    if header_last_event_id and header_last_event_id.isdigit():
        effective_last_id = int(header_last_event_id)
    elif last_event_id is not None:
        effective_last_id = last_event_id

    async def event_generator():
        client_queue: asyncio.Queue = asyncio.Queue()
        if session_id not in _session_subscribers:
            _session_subscribers[session_id] = []
        _session_subscribers[session_id].append(client_queue)

        try:
            # 1. Replay historical events strictly after last_event_id (deduplication)
            past_events = await get_session_events(session_id, after_event_id=effective_last_id)
            last_yielded_id = effective_last_id
            for ev in past_events:
                ev_id = ev["event_id"]
                if ev_id > last_yielded_id:
                    last_yielded_id = ev_id
                    data_json = json.dumps({
                        "session_id": session_id,
                        "phase": ev["phase"],
                        "progress": ev["progress"],
                        "message": ev["message"],
                        "timestamp": ev["timestamp"],
                    })
                    yield f"id: {ev_id}\nevent: {ev['phase']}\ndata: {data_json}\n\n"

            # 2. Check if session was already terminal
            latest_session = await get_session(session_id)
            if latest_session and latest_session["status"] in ("COMPLETED", "FAILED", "ROLLED_BACK", "UAC_CANCELLED"):
                yield f"event: CLOSE\ndata: {json.dumps({'reason': 'Session already in terminal state'})}\n\n"
                return

            # 3. Ensure single background installation task is running via per-session lock
            package_id = session["package_id"]
            source = session["source"]
            await get_or_attach_install_task(
                session_id,
                _run_install_job(session_id=session_id, package_id=package_id, source=source),
            )

            # 4. Stream real-time events from subscriber queue
            while True:
                try:
                    prog_event = await asyncio.wait_for(client_queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat comment to prevent client/proxy timeouts
                    yield ": keepalive\n\n"
                    # Check if session finished while idle
                    sess_check = await get_session(session_id)
                    if sess_check and sess_check["status"] in ("COMPLETED", "FAILED", "ROLLED_BACK", "UAC_CANCELLED"):
                        yield f"event: CLOSE\ndata: {json.dumps({'reason': 'Terminal state reached'})}\n\n"
                        break
                    continue

                if prog_event.event_id > last_yielded_id:
                    last_yielded_id = prog_event.event_id
                    data_json = json.dumps(prog_event.to_dict())
                    yield f"id: {prog_event.event_id}\nevent: {prog_event.phase}\ndata: {data_json}\n\n"

                if prog_event.phase in ("COMPLETED", "FAILED", "UAC_CANCELLED", "ROLLED_BACK"):
                    yield f"event: CLOSE\ndata: {json.dumps({'reason': f'Terminal phase reached: {prog_event.phase}'})}\n\n"
                    break
        finally:
            # Clean up subscriber queue on disconnect
            if session_id in _session_subscribers:
                if client_queue in _session_subscribers[session_id]:
                    _session_subscribers[session_id].remove(client_queue)
                if not _session_subscribers[session_id]:
                    _session_subscribers.pop(session_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/rollback/{session_id}")
async def rollback_installation(
    session_id: str,
    req: Optional[RollbackRequest] = None,
) -> dict[str, Any]:
    """Module 2 Chunk 2: Atomic compare-and-swap rollback lock.

    Guarantees that multiple concurrent rollback calls reject with 409 Conflict.
    """
    reason = req.reason if req and req.reason else "1-click rollback requested by user"

    # Acquire lock with BEGIN IMMEDIATE (atomic CAS)
    lock_result = await atomic_acquire_rollback_lock(session_id=session_id, reason=reason)

    # Perform deterministic uninstallation steps safely
    session = await get_session(session_id)
    package_id = session["package_id"] if session else "unknown"

    await log_install_event(
        session_id=session_id,
        phase="ROLLING_BACK",
        progress=50,
        message=f"Executing safe non-shell rollback for {package_id}...",
    )

    # Execute deterministic non-shell uninstallation
    success, uninstall_out = await execute_winget_uninstall(package_id)
    rollback_details = (
        f"Package {package_id} rolled back successfully. Output: {uninstall_out[:100]}"
        if success
        else f"Rollback finished with warning for {package_id}: {uninstall_out[:100]}"
    )

    # Complete rollback
    await mark_rollback_completed(
        session_id=session_id,
        details=rollback_details,
    )

    # Off-thread DynamoDB audit sync for rollback
    await replicate_audit_record_to_dynamodb(
        entity_type="ROLLBACK_SESSION",
        entity_id=session_id,
        payload={"session_id": session_id, "package_id": package_id, "status": "ROLLED_BACK", "reason": reason},
    )

    return {
        "status": "ROLLED_BACK",
        "session_id": session_id,
        "message": f"Successfully rolled back {package_id}.",
        "lock_info": lock_result,
    }


@router.get("/cloud-audit")
async def get_cloud_audit(limit: int = 50) -> dict[str, Any]:
    """Retrieve recent cloud audit replication records."""
    records = await get_cloud_audit_history(limit=limit)
    return {"records": records}


@router.get("/sessions")
async def get_all_sessions(limit: int = 50) -> dict[str, Any]:
    """Retrieve list of all tracked installation sessions."""
    sessions = await list_sessions(limit=limit)
    return {"sessions": sessions}


@router.get("/session/{session_id}")
async def get_single_session(session_id: str) -> dict[str, Any]:
    """Retrieve details and events for a specific session."""
    session = await get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    events = await get_session_events(session_id)
    return {"session": session, "events": events}
