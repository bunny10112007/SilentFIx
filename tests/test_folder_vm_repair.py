import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.folder_vm_repair import (
    _REPAIR_JOBS,
    DISPLAY_FIX_PRESETS,
    FolderIssue,
    FolderRepairJob,
    apply_selective_files_sync,
    compute_zip_vs_local_diff,
    respond_to_display_check,
    scan_folder_for_issues,
    start_folder_repair_pipeline,
)


@pytest.fixture
def sample_folder(tmp_path: Path):
    """Creates a temporary sample folder with issues for scanning."""
    folder = tmp_path / "legacy_app"
    folder.mkdir()

    # Issue 1: package.json without node_modules
    (folder / "package.json").write_text('{"name": "test-pkg"}', encoding="utf-8")

    # Issue 2: requirements.txt without .venv
    (folder / "requirements.txt").write_text("requests==2.31.0\n", encoding="utf-8")

    # Issue 3: pyproject.toml without .venv
    (folder / "pyproject.toml").write_text("[project]\nname = 'demo'\n", encoding="utf-8")

    # Issue 4: Crash log
    (folder / "error.log").write_text(
        "Application crashed with VCRUNTIME140.dll missing exception", encoding="utf-8"
    )

    # Issue 5: Legacy executable
    (folder / "legacy.exe").write_bytes(b"MZ\x90\x00dummyexe")

    # Standard file
    (folder / "config.ini").write_text("[settings]\ndebug=true\n", encoding="utf-8")

    return folder


def test_scan_folder_issues(sample_folder: Path):
    root, issues, deps = scan_folder_for_issues(str(sample_folder))
    assert root == sample_folder.resolve()
    assert len(issues) >= 5

    categories = {issue.category for issue in issues}
    assert "missing_dependency" in categories
    assert "crash_log" in categories
    assert "display_dpi" in categories

    assert "npm ci --ignore-scripts" in deps
    assert "pip install -r requirements.txt --target .silentfix_deps" in deps
    assert "uv sync --frozen" in deps


def test_scan_folder_not_found():
    with pytest.raises(FileNotFoundError):
        scan_folder_for_issues("non_existent_folder_xyz_12345")


@pytest.mark.asyncio
async def test_folder_repair_pipeline_e2e(sample_folder: Path):
    # 1. Start pipeline
    job = await start_folder_repair_pipeline(
        folder_path=str(sample_folder),
        target_width=1920,
        target_height=1080,
        dpi_scale_percent=125,
    )

    assert job.job_id in _REPAIR_JOBS
    assert job.status == "AWAITING_DISPLAY_CHECK"
    assert job.vm_backend == "local_mock_vm"
    assert job.malware_report is not None
    assert job.malware_report.clean is True
    assert job.crash_test_passed is True
    assert job.display_preview is not None
    assert job.display_preview.iteration == 1
    assert job.display_preview.applied_compat_layer == DISPLAY_FIX_PRESETS[0][0]

    # 2. Respond to display check: "Does not fit screen" (iteration advances)
    updated_job = await respond_to_display_check(job.job_id, fits_screen=False)
    assert updated_job.display_preview.iteration == 2
    assert updated_job.display_preview.applied_compat_layer == DISPLAY_FIX_PRESETS[1][0]
    assert updated_job.display_preview.fits_resolution is False

    # 3. Respond to display check: "Fits screen" -> READY_TO_APPLY
    approved_job = await respond_to_display_check(job.job_id, fits_screen=True)
    assert approved_job.status == "READY_TO_APPLY"
    assert approved_job.display_preview.fits_resolution is True
    assert len(approved_job.file_diffs) > 0

    # 4. Check diffs
    diff_paths = {d.relative_path for d in approved_job.file_diffs}
    assert "silentfix_repair_manifest.json" in diff_paths

    # 5. Apply selective files
    res = apply_selective_files_sync(job.job_id, ["silentfix_repair_manifest.json"])
    assert "silentfix_repair_manifest.json" in res["applied_files"]
    assert (sample_folder / "silentfix_repair_manifest.json").is_file()


def test_apply_selective_files_zip_slip_prevention(sample_folder: Path):
    job = FolderRepairJob(
        job_id="test_slip_job",
        source_folder=str(sample_folder),
        status="READY_TO_APPLY",
        vm_backend="local_mock_vm",
        verified_zip_path=str(sample_folder / "fake.zip"),
    )
    _REPAIR_JOBS["test_slip_job"] = job

    # Create dummy zip with an escaped path
    zip_path = sample_folder / "fake.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("../../escaped.txt", "malicious payload")

    with pytest.raises(ValueError, match="Blocked unsafe zip path"):
        apply_selective_files_sync("test_slip_job", ["../../escaped.txt"])


@pytest.mark.asyncio
async def test_folder_repair_api_routes(sample_folder: Path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start repair
        resp = await client.post(
            "/api/folder-repair/start",
            json={
                "folder_path": str(sample_folder),
                "screen_width": 1920,
                "screen_height": 1080,
                "dpi_scale_percent": 100,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        job_id = data["job_id"]
        assert data["status"] == "AWAITING_DISPLAY_CHECK"

        # Get job
        resp_get = await client.get(f"/api/folder-repair/{job_id}")
        assert resp_get.status_code == 200
        assert resp_get.json()["job_id"] == job_id

        # Get preview image (SVG)
        resp_prev = await client.get(f"/api/folder-repair/{job_id}/preview")
        assert resp_prev.status_code == 200
        assert "image/svg+xml" in resp_prev.headers["content-type"]
        assert f"Job {job_id}" in resp_prev.text

        # Feedback: not fitting
        resp_fb1 = await client.post(
            f"/api/folder-repair/{job_id}/display-feedback",
            json={"fits_screen": False},
        )
        assert resp_fb1.status_code == 200
        assert resp_fb1.json()["display_preview"]["iteration"] == 2

        # Feedback: fits screen
        resp_fb2 = await client.post(
            f"/api/folder-repair/{job_id}/display-feedback",
            json={"fits_screen": True},
        )
        assert resp_fb2.status_code == 200
        assert resp_fb2.json()["status"] == "READY_TO_APPLY"

        # Download verified zip
        resp_dl = await client.get(f"/api/folder-repair/{job_id}/download-zip")
        assert resp_dl.status_code == 200
        assert resp_dl.headers["content-type"] == "application/zip"
        assert len(resp_dl.content) > 0

        # Apply diff
        resp_apply = await client.post(
            f"/api/folder-repair/{job_id}/apply-diff",
            json={"selected_files": ["silentfix_repair_manifest.json"]},
        )
        assert resp_apply.status_code == 200
        assert "silentfix_repair_manifest.json" in resp_apply.json()["applied_files"]


@pytest.mark.asyncio
async def test_folder_repair_api_404_handling():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Non-existent folder
        resp = await client.post(
            "/api/folder-repair/start",
            json={"folder_path": "c:/path/does/not/exist/99999"},
        )
        assert resp.status_code == 404

        # Non-existent job
        resp_job = await client.get("/api/folder-repair/nonexistent_job_123")
        assert resp_job.status_code == 404
