# app/routes/folder_repair.py
import asyncio
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app.services.folder_vm_repair import (
    _REPAIR_JOBS,
    FolderRepairJob,
    apply_selective_files_sync,
    respond_to_display_check,
    start_folder_repair_pipeline,
)

router = APIRouter(prefix="/api/folder-repair", tags=["folder-repair"])


class StartRepairRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    folder_path: str = Field(min_length=2, max_length=400)
    screen_width: int = Field(default=1920, ge=640, le=7680)
    screen_height: int = Field(default=1080, ge=480, le=4320)
    dpi_scale_percent: int = Field(default=100, ge=100, le=300)


class DisplayFeedbackRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    fits_screen: bool


class SelectiveApplyRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    selected_files: list[str] = Field(min_length=1)


@router.post("/start", response_model=FolderRepairJob)
async def start_repair(req: StartRepairRequest) -> FolderRepairJob:
    try:
        return await start_folder_repair_pipeline(
            req.folder_path, req.screen_width, req.screen_height, req.dpi_scale_percent
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{job_id}", response_model=FolderRepairJob)
async def get_repair_job(job_id: str) -> FolderRepairJob:
    job = _REPAIR_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Repair job not found.")
    return job


@router.post("/{job_id}/display-feedback", response_model=FolderRepairJob)
async def display_feedback(job_id: str, req: DisplayFeedbackRequest) -> FolderRepairJob:
    try:
        return await respond_to_display_check(job_id, req.fits_screen)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/apply-diff")
async def apply_diff(job_id: str, req: SelectiveApplyRequest) -> dict:
    try:
        return await asyncio.to_thread(apply_selective_files_sync, job_id, req.selected_files)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{job_id}/download-zip")
async def download_full_zip(job_id: str) -> FileResponse:
    job = _REPAIR_JOBS.get(job_id)
    if not job or not job.verified_zip_path or not Path(job.verified_zip_path).is_file():
        raise HTTPException(status_code=404, detail="Verified zip bundle not found.")
    return FileResponse(
        path=job.verified_zip_path,
        media_type="application/zip",
        filename=f"silentfix_verified_{job_id}.zip",
    )


@router.get("/{job_id}/preview")
async def get_preview_image(job_id: str, layer: str | None = Query(default=None)) -> Response:
    job = _REPAIR_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Repair job not found.")

    applied = layer or (job.display_preview.applied_compat_layer if job.display_preview else "STANDARD")
    width = job.display_preview.target_width if job.display_preview else 1920
    height = job.display_preview.target_height if job.display_preview else 1080
    dpi = job.display_preview.dpi_scale_percent if job.display_preview else 100

    # Return clean, deterministic SVG display preview
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{min(width, 800)}" height="{min(height, 600)}" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#0B0D12"/>
  <rect x="20" y="20" width="760" height="560" rx="8" fill="#131722" stroke="#2a3042" stroke-width="2"/>
  <rect x="20" y="20" width="760" height="36" fill="#1b2030"/>
  <circle cx="45" cy="38" r="6" fill="#ef4444"/>
  <circle cx="65" cy="38" r="6" fill="#f59e0b"/>
  <circle cx="85" cy="38" r="6" fill="#10b981"/>
  <text x="110" y="42" font-family="monospace" font-size="12" fill="#94a3b8">SilentFix VM Display Preview - Job {job_id}</text>
  <text x="50" y="100" font-family="monospace" font-size="16" fill="#6366f1">Resolution: {width}x{height} @ {dpi}% DPI</text>
  <text x="50" y="140" font-family="monospace" font-size="14" fill="#10b981">Compat Layer: {applied}</text>
  <text x="50" y="180" font-family="monospace" font-size="12" fill="#cbd5e1">VM Backend: {job.vm_backend} ({job.vm_instance_id or 'none'})</text>
  <text x="50" y="220" font-family="monospace" font-size="12" fill="#94a3b8">Malware Scan: {'CLEAN (Exit 0)' if job.malware_report and job.malware_report.clean else 'PENDING'}</text>
  <rect x="50" y="260" width="700" height="280" rx="4" fill="#0a0c10" stroke="#334155" stroke-dasharray="4"/>
  <text x="400" y="400" font-family="sans-serif" font-size="18" fill="#64748b" text-anchor="middle">Simulated Application Window Fits Display Bounds</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")
