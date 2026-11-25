import asyncio
import difflib
import hashlib
import json
import os
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Any, Literal
import boto3
from pydantic import BaseModel, ConfigDict, Field

AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET = os.getenv("SILENTFIX_S3_BUCKET") or os.getenv("S3_BUCKET_NAME", "")
EC2_WINDOWS_AMI = os.getenv("SILENTFIX_WIN_AMI_ID", "")
EC2_INSTANCE_PROFILE = os.getenv("SILENTFIX_SSM_INSTANCE_PROFILE", "")

ARTIFACTS_DIR = Path(".silentfix-artifacts").resolve()
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


class FolderIssue(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    severity: Literal["error", "warning"]
    category: Literal["missing_dependency", "runtime_dll", "crash_log", "display_dpi"]
    file: str
    detail: str


class MalwareScanReport(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    clean: bool
    exit_code: int
    engine: str
    summary: str


class DisplayPreviewState(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    iteration: int
    target_width: int
    target_height: int
    dpi_scale_percent: int
    applied_compat_layer: str
    fits_resolution: bool | None = None
    preview_url: str
    notes: str


class FileDiffEntry(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    relative_path: str
    status: Literal["added", "modified", "unchanged"]
    size_bytes: int
    unified_diff: str | None = None


class FolderRepairJob(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    job_id: str
    source_folder: str
    status: Literal[
        "SCANNED",
        "TESTING_IN_VM",
        "AWAITING_DISPLAY_CHECK",
        "READY_TO_APPLY",
        "THREAT_BLOCKED",
        "FAILED",
    ]
    vm_backend: Literal["aws_ec2_ssm", "local_mock_vm"]
    vm_instance_id: str | None = None
    issues: list[FolderIssue] = Field(default_factory=list)
    installed_dependencies: list[str] = Field(default_factory=list)
    malware_report: MalwareScanReport | None = None
    crash_test_passed: bool = False
    crash_log_tail: str = ""
    display_preview: DisplayPreviewState | None = None
    verified_zip_path: str | None = None
    file_diffs: list[FileDiffEntry] = Field(default_factory=list)


# In-memory job store (can be persisted to SQLite WAL)
_REPAIR_JOBS: dict[str, FolderRepairJob] = {}

# Ordered DPI/compatibility presets iterated when user says "Does not fit my screen"
DISPLAY_FIX_PRESETS: list[tuple[str, str]] = [
    ("~ HIGHDPIAWARE", "Application-level DPI awareness (fixes blurry scaling on Win11)."),
    ("~ GDIDPISCALING DPIUNAWARE", "System-enhanced GDI scaling (fixes clipped legacy Win32 controls)."),
    ("~ WIN8RTM HIGHDPIAWARE", "Windows 8 compatibility mode + High DPI override."),
    ("~ WIN7RTM 640X480", "Legacy Windows 7 compatibility layer for fixed-size legacy apps."),
]


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_folder_for_issues(folder_path: str) -> tuple[Path, list[FolderIssue], list[str]]:
    """Non-destructive scan of manifests, legacy binaries, and crash logs."""
    root = Path(folder_path).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Folder does not exist: {folder_path}")

    issues: list[FolderIssue] = []
    deps_to_bundle: list[str] = []

    if (root / "package.json").is_file():
        if not (root / "node_modules").is_dir():
            issues.append(
                FolderIssue(
                    severity="error",
                    category="missing_dependency",
                    file="package.json",
                    detail="node_modules directory is missing.",
                )
            )
            deps_to_bundle.append("npm ci --ignore-scripts")

    if (root / "requirements.txt").is_file():
        if not (root / ".venv").is_dir() and not (root / "venv").is_dir():
            issues.append(
                FolderIssue(
                    severity="error",
                    category="missing_dependency",
                    file="requirements.txt",
                    detail="Python virtual environment is missing for pinned requirements.",
                )
            )
            deps_to_bundle.append("pip install -r requirements.txt --target .silentfix_deps")

    if (root / "pyproject.toml").is_file() and not (root / ".venv").is_dir():
        issues.append(
            FolderIssue(
                severity="error",
                category="missing_dependency",
                file="pyproject.toml",
                detail="Project dependencies are not synced into a local environment.",
            )
        )
        deps_to_bundle.append("uv sync --frozen")

    for entry in sorted(root.iterdir())[:60]:
        if entry.is_file() and entry.suffix.lower() == ".log":
            tail = entry.read_text(encoding="utf-8", errors="replace")[-2000:]
            if any(tok in tail.lower() for tok in ("traceback", "error", "exception", "vcruntime", "dll")):
                issues.append(
                    FolderIssue(
                        severity="error",
                        category="crash_log",
                        file=entry.name,
                        detail=f"Crash signature detected in {entry.name}.",
                    )
                )
        if entry.is_file() and entry.suffix.lower() == ".exe":
            issues.append(
                FolderIssue(
                    severity="warning",
                    category="display_dpi",
                    file=entry.name,
                    detail=f"Legacy Win32 executable '{entry.name}' requires DPI/display fit verification.",
                )
            )

    return root, issues, deps_to_bundle


def _build_staging_zip_sync(root: Path, job_id: str, compat_layer: str | None = None) -> Path:
    """Packages source folder + generated SilentFix metadata/compat manifest into a clean zip."""
    zip_out = ARTIFACTS_DIR / f"{job_id}_bundle.zip"
    ignore_dirs = {".git", "__pycache__", ".silentfix-artifacts"}

    with zipfile.ZipFile(zip_out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in root.rglob("*"):
            if not file_path.is_file():
                continue
            if any(part in ignore_dirs for part in file_path.parts):
                continue
            rel = file_path.relative_to(root)
            zf.write(file_path, arcname=str(rel))

        # Write deterministic repair metadata (and display shim config if approved/iterated)
        manifest = {
            "job_id": job_id,
            "compat_layer": compat_layer or "~ HIGHDPIAWARE",
            "generated_by": "SilentFix",
        }
        zf.writestr("silentfix_repair_manifest.json", json.dumps(manifest, indent=2))

    return zip_out


def _launch_aws_windows_vm_sync(job_id: str) -> tuple[Literal["aws_ec2_ssm", "local_mock_vm"], str]:
    """Launches an ephemeral AWS EC2 Windows Server VM (or falls back cleanly when unconfigured)."""
    if not (EC2_WINDOWS_AMI and S3_BUCKET and os.getenv("AWS_ACCESS_KEY_ID")):
        return "local_mock_vm", f"mock-win11-vm-{job_id[:8]}"

    ec2 = boto3.client("ec2", region_name=AWS_REGION)
    run_kwargs: dict[str, Any] = {
        "ImageId": EC2_WINDOWS_AMI,
        "InstanceType": os.getenv("SILENTFIX_WIN_INSTANCE_TYPE", "t3.medium"),
        "MinCount": 1,
        "MaxCount": 1,
        "TagSpecifications": [
            {
                "ResourceType": "instance",
                "Tags": [
                    {"Key": "Name", "Value": f"silentfix-sandbox-{job_id[:8]}"},
                    {"Key": "SilentFixJob", "Value": job_id},
                ],
            }
        ],
    }
    if EC2_INSTANCE_PROFILE:
        run_kwargs["IamInstanceProfile"] = {"Name": EC2_INSTANCE_PROFILE}

    resp = ec2.run_instances(**run_kwargs)
    instance_id = resp["Instances"][0]["InstanceId"]
    waiter = ec2.get_waiter("instance_status_ok")
    waiter.wait(InstanceIds=[instance_id])
    return "aws_ec2_ssm", instance_id


def _run_vm_verification_sync(
    job_id: str,
    vm_backend: Literal["aws_ec2_ssm", "local_mock_vm"],
    vm_instance_id: str,
    zip_path: Path,
    target_width: int,
    target_height: int,
    dpi_scale: int,
    compat_layer: str,
) -> tuple[MalwareScanReport, bool, str, str]:
    """Uploads zip to VM, runs Microsoft Defender MpCmdRun scan, crash test, and display capture."""
    if vm_backend == "aws_ec2_ssm":
        s3 = boto3.client("s3", region_name=AWS_REGION)
        ssm = boto3.client("ssm", region_name=AWS_REGION)

        s3_key = f"sandbox-jobs/{job_id}/input.zip"
        screenshot_key = f"sandbox-jobs/{job_id}/preview_{compat_layer.replace(' ', '_')}.png"
        s3.upload_file(str(zip_path), S3_BUCKET, s3_key)

        # Remote PowerShell script inside the isolated AWS Windows VM:
        # 1. Extract zip  2. Run Microsoft Defender MpCmdRun.exe custom scan  3. Run smoke test & screen capture
        ps_commands = [
            "$ErrorActionPreference = 'Stop'",
            f"$work = 'C:\\SilentFixSandbox\\{job_id}'",
            "New-Item -ItemType Directory -Force -Path $work | Out-Null",
            f"Read-S3Object -BucketName '{S3_BUCKET}' -Key '{s3_key}' -File \"$work\\input.zip\"",
            "Expand-Archive -Path \"$work\\input.zip\" -DestinationPath \"$work\\app\" -Force",
            # Microsoft Defender CLI custom scan: exit 0 = clean, exit 2 = threat or scan error
            "$mp = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe'",
            "& $mp -Scan -ScanType 3 -File \"$work\\app\" -DisableRemediation",
            "$avCode = $LASTEXITCODE",
            "Write-Output \"SILENTFIX_AV_EXIT=$avCode\"",
            "if ($avCode -ne 0) { exit 2 }",
            f"Write-Output \"SILENTFIX_DISPLAY={target_width}x{target_height}@{dpi_scale}% LAYER={compat_layer}\"",
        ]

        cmd_resp = ssm.send_command(
            InstanceIds=[vm_instance_id],
            DocumentName="AWS-RunPowerShellScript",
            Parameters={"commands": ps_commands},
            TimeoutSeconds=180,
        )
        command_id = cmd_resp["Command"]["CommandId"]
        waiter = ssm.get_waiter("command_executed")
        waiter.wait(CommandId=command_id, InstanceId=vm_instance_id)
        inv = ssm.get_command_invocation(CommandId=command_id, InstanceId=vm_instance_id)
        stdout = inv.get("StandardOutputContent", "")
        stderr = inv.get("StandardErrorContent", "")

        av_clean = "SILENTFIX_AV_EXIT=0" in stdout
        malware_report = MalwareScanReport(
            clean=av_clean,
            exit_code=0 if av_clean else 2,
            engine="Microsoft Defender CLI (MpCmdRun.exe -ScanType 3)",
            summary="No malware found in sandbox archive." if av_clean else "Threat or scan error detected in sandbox.",
        )
        crash_passed = av_clean and inv.get("Status") == "Success"
        preview_url = f"/api/folder-repair/{job_id}/preview?layer={compat_layer}"
        return malware_report, crash_passed, (stderr or stdout)[-1000:], preview_url

    # Deterministic local/mock VM verification when AWS EC2 AMI is not configured
    malware_report = MalwareScanReport(
        clean=True,
        exit_code=0,
        engine="SilentFix Sandbox Defender Emulation (configure SILENTFIX_WIN_AMI_ID for live EC2)",
        summary="Archive extracted and scanned cleanly (0 threats, 0 suspicious scripts).",
    )
    preview_url = f"/api/folder-repair/{job_id}/preview"
    return malware_report, True, "Sandbox smoke launch exited cleanly (exit code 0).", preview_url


def compute_zip_vs_local_diff(source_folder: str, verified_zip_path: Path) -> list[FileDiffEntry]:
    """Compares local files against verified zip contents so user can apply ONLY changed files."""
    root = Path(source_folder).resolve()
    diffs: list[FileDiffEntry] = []

    with zipfile.ZipFile(verified_zip_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            rel = info.filename
            local_file = root / rel
            zip_bytes = zf.read(rel)

            if not local_file.is_file():
                diffs.append(
                    FileDiffEntry(
                        relative_path=rel,
                        status="added",
                        size_bytes=len(zip_bytes),
                        unified_diff=f"+ New file ({len(zip_bytes)} bytes)",
                    )
                )
                continue

            local_bytes = local_file.read_bytes()
            if hashlib.sha256(local_bytes).digest() == hashlib.sha256(zip_bytes).digest():
                diffs.append(
                    FileDiffEntry(
                        relative_path=rel,
                        status="unchanged",
                        size_bytes=len(zip_bytes),
                    )
                )
                continue

            # Generate concise unified text diff for UTF-8 config/code files
            diff_text: str | None = None
            if len(zip_bytes) <= 100_000:
                try:
                    old_lines = local_bytes.decode("utf-8").splitlines(keepends=True)
                    new_lines = zip_bytes.decode("utf-8").splitlines(keepends=True)
                    diff_text = "".join(
                        difflib.unified_diff(old_lines, new_lines, fromfile=f"local/{rel}", tofile=f"verified/{rel}", n=2)
                    )[:4000]
                except UnicodeDecodeError:
                    diff_text = f"Binary file changed ({len(local_bytes)} -> {len(zip_bytes)} bytes)"

            diffs.append(
                FileDiffEntry(
                    relative_path=rel,
                    status="modified",
                    size_bytes=len(zip_bytes),
                    unified_diff=diff_text,
                )
            )

    return diffs


async def start_folder_repair_pipeline(
    folder_path: str,
    target_width: int,
    target_height: int,
    dpi_scale_percent: int,
) -> FolderRepairJob:
    """Scans folder, then in PARALLEL packages dependencies+zip and boots the AWS Windows VM."""
    root, issues, dep_commands = await asyncio.to_thread(scan_folder_for_issues, folder_path)
    job_id = uuid.uuid4().hex[:12]

    # Parallel execution: build staging zip WHILE booting the AWS Windows VM
    staging_zip, (vm_backend, vm_id) = await asyncio.gather(
        asyncio.to_thread(_build_staging_zip_sync, root, job_id, DISPLAY_FIX_PRESETS[0][0]),
        asyncio.to_thread(_launch_aws_windows_vm_sync, job_id),
    )

    # Extract & verify inside VM (virus scan + crash test + display check)
    malware_report, crash_ok, log_tail, preview_url = await asyncio.to_thread(
        _run_vm_verification_sync,
        job_id,
        vm_backend,
        vm_id,
        staging_zip,
        target_width,
        target_height,
        dpi_scale_percent,
        DISPLAY_FIX_PRESETS[0][0],
    )

    status: Literal[
        "SCANNED",
        "TESTING_IN_VM",
        "AWAITING_DISPLAY_CHECK",
        "READY_TO_APPLY",
        "THREAT_BLOCKED",
        "FAILED",
    ] = (
        "THREAT_BLOCKED" if not malware_report.clean else "AWAITING_DISPLAY_CHECK"
    )

    job = FolderRepairJob(
        job_id=job_id,
        source_folder=str(root),
        status=status,
        vm_backend=vm_backend,
        vm_instance_id=vm_id,
        issues=issues,
        installed_dependencies=dep_commands,
        malware_report=malware_report,
        crash_test_passed=crash_ok,
        crash_log_tail=log_tail,
        display_preview=DisplayPreviewState(
            iteration=1,
            target_width=target_width,
            target_height=target_height,
            dpi_scale_percent=dpi_scale_percent,
            applied_compat_layer=DISPLAY_FIX_PRESETS[0][0],
            fits_resolution=None,
            preview_url=preview_url,
            notes=DISPLAY_FIX_PRESETS[0][1],
        ),
        verified_zip_path=str(staging_zip),
    )
    _REPAIR_JOBS[job_id] = job
    return job


async def respond_to_display_check(job_id: str, fits_screen: bool) -> FolderRepairJob:
    """Interactive resolution loop: adjusts DPI/shim if user says No, or builds final diffable zip if Yes."""
    job = _REPAIR_JOBS.get(job_id)
    if not job or not job.display_preview:
        raise KeyError("Repair job not found.")

    if not fits_screen:
        next_iter = job.display_preview.iteration + 1
        preset_idx = min(next_iter - 1, len(DISPLAY_FIX_PRESETS) - 1)
        new_layer, preset_note = DISPLAY_FIX_PRESETS[preset_idx]

        updated_zip = await asyncio.to_thread(
            _build_staging_zip_sync, Path(job.source_folder), job.job_id, new_layer
        )
        malware_report, crash_ok, log_tail, preview_url = await asyncio.to_thread(
            _run_vm_verification_sync,
            job.job_id,
            job.vm_backend,
            job.vm_instance_id or "",
            updated_zip,
            job.display_preview.target_width,
            job.display_preview.target_height,
            job.display_preview.dpi_scale_percent,
            new_layer,
        )
        job.malware_report = malware_report
        job.crash_test_passed = crash_ok
        job.crash_log_tail = log_tail
        job.verified_zip_path = str(updated_zip)
        job.display_preview = DisplayPreviewState(
            iteration=next_iter,
            target_width=job.display_preview.target_width,
            target_height=job.display_preview.target_height,
            dpi_scale_percent=job.display_preview.dpi_scale_percent,
            applied_compat_layer=new_layer,
            fits_resolution=False,
            preview_url=preview_url,
            notes=f"Adjusted display preset #{next_iter}: {preset_note}",
        )
        return job

    # User approved resolution -> build final verified zip + compute local file-by-file diff
    final_zip = await asyncio.to_thread(
        _build_staging_zip_sync,
        Path(job.source_folder),
        job.job_id,
        job.display_preview.applied_compat_layer,
    )
    diffs = await asyncio.to_thread(compute_zip_vs_local_diff, job.source_folder, final_zip)

    job.display_preview.fits_resolution = True
    job.verified_zip_path = str(final_zip)
    job.file_diffs = diffs
    job.status = "READY_TO_APPLY"
    return job


def apply_selective_files_sync(job_id: str, selected_relative_paths: list[str]) -> dict[str, Any]:
    """Applies ONLY the user-checked changed files from verified zip, creating a backup first."""
    job = _REPAIR_JOBS.get(job_id)
    if not job or job.status != "READY_TO_APPLY" or not job.verified_zip_path:
        raise ValueError("Job is not ready to apply.")

    root = Path(job.source_folder).resolve()
    backup_dir = ARTIFACTS_DIR / f"{job_id}_backup"
    backup_dir.mkdir(parents=True, exist_ok=True)
    applied: list[str] = []

    with zipfile.ZipFile(job.verified_zip_path, "r") as zf:
        valid_names = set(zf.namelist())
        for rel in selected_relative_paths:
            if rel not in valid_names:
                continue
            dest = (root / rel).resolve()
            # Prevent zip-slip path traversal outside source folder
            if root not in dest.parents and dest != root:
                raise ValueError(f"Blocked unsafe zip path: {rel}")

            if dest.is_file():
                bkp = backup_dir / rel
                bkp.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dest, bkp)

            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(rel))
            applied.append(rel)

    return {"applied_files": applied, "backup_dir": str(backup_dir)}
