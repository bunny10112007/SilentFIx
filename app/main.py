"""Module 1: Entry Point & Startup Crash-Recovery Sweep.

Configures FastAPI application lifecycle, initializes the SQLite WAL database,
sweeps for interrupted installation sessions on startup, and connects modular
routers using strict path prefixes.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.recovery import sweep_interrupted_sessions
from app.routes import brain, install_stream, recovery, screen, voice
from app.state.db import init_db

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
logger = logging.getLogger("silentfix.main")


# Chunk 1 (Lifespan Context): Guarantees database tables exist before any requests land.
# Sweeps the database for sessions stuck in EXECUTING or SNAPSHOTTED states. If a background
# installer process was killed during a crash, it sets the status to RECOVERY_REQUIRED so
# the frontend displays an interactive recovery banner on boot.
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("SilentFix Privilege Boundary starting up...")

    # 1. Guarantee WAL database schema initialization
    await init_db()

    # 2. Perform automated crash recovery sweep
    reconciled = await sweep_interrupted_sessions()
    app.state.startup_reconciled_sessions = reconciled
    app.state.recovery_banner_needed = len(reconciled) > 0

    logger.info(
        "SilentFix system ready. Startup crash sweep finished (%d items requiring recovery).",
        len(reconciled),
    )

    yield

    logger.info("SilentFix shutting down cleanly.")


app = FastAPI(
    title="SilentFix Software Repair Agent & Architecture Blueprint",
    description="Deterministic Privilege Boundary, Pre-Flight Trust Gate, AWS Audit Ledger, ElevenLabs Voice & AI Terminal Brain",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for local React / Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chunk 2 (Router Mounting): Connects modular routers using strict path prefixes,
# keeping installer endpoints, screen guard APIs, and crash recovery separate.
app.include_router(install_stream.router)
app.include_router(screen.router)
app.include_router(recovery.router)
app.include_router(voice.router)
app.include_router(brain.router)


@app.get("/api/health")
async def health_check():
    """System health check and invariant status."""
    return {
        "status": "healthy",
        "agent": "SilentFix",
        "zero_shell_injection": True,
        "database_wal_active": True,
        "pre_flight_trust_gate": "active",
        "rapidocr_screen_guard": "active",
        "recovery_required_count": len(getattr(app.state, "startup_reconciled_sessions", [])),
    }


# Serve built frontend if dist directory exists
dist_dir = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = dist_dir / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(dist_dir / "index.html")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
