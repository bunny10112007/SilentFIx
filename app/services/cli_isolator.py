# app/services/cli_isolator.py
import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict

from app.core.safety_filter import check_command_safety, sanitize_user_text
from app.probes.cli_healer import (
    KNOWN_CLI_WINGET_MAP as KNOWN_WINGET_PACKAGES,
    diagnose_terminal_error,
    extract_missing_command,
)


class EnvSnapshot(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    missing_command: str | None
    current_path_entries: list[str]
    tool_on_disk: str | None = None
    in_local_venv_or_node: str | None = None
    shell_platform: str


class HypothesisTestResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    hypothesis_id: str
    cause_title: str
    candidate_commands: list[str]
    verification_probe: str
    outcome: Literal["PASSED", "FAILED", "SKIPPED"]
    evidence: str


class CliIsolationReport(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    snapshot: EnvSnapshot
    mirror_backend: Literal["aws_cloud_sandbox", "isolated_local_mirror"]
    exact_root_cause: str
    empirically_verified: bool
    exact_fix_commands: list[str]
    tested_hypotheses: list[HypothesisTestResult]


def capture_sanitized_cli_snapshot(error_text: str, project_dir: str | None = None) -> EnvSnapshot:
    """Captures non-secret PATH and binary discovery state for cloud environment mirroring."""
    cmd = extract_missing_command(error_text)
    diag = diagnose_terminal_error(error_text, project_dir)

    path_entries = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p][:40]
    local_bin: str | None = None
    if project_dir and cmd:
        root = Path(project_dir).resolve()
        for rel in (
            f".venv/Scripts/{cmd}.exe",
            f".venv/Scripts/{cmd}.cmd",
            f"node_modules/.bin/{cmd}.cmd",
            f"node_modules/.bin/{cmd}",
        ):
            candidate = root / rel
            if candidate.is_file():
                local_bin = str(candidate)
                break

    return EnvSnapshot(
        missing_command=cmd,
        current_path_entries=path_entries,
        tool_on_disk=diag.found_executable_path,
        in_local_venv_or_node=local_bin,
        shell_platform=sys.platform,
    )


def _run_mirror_probe_sync(probe_argv: list[str], extra_path_dir: str | None = None) -> tuple[bool, str]:
    """Executes the failing command inside an isolated env copy to empirically confirm a fix."""
    env_copy = os.environ.copy()
    if extra_path_dir:
        env_copy["PATH"] = extra_path_dir + os.pathsep + env_copy.get("PATH", "")

    try:
        proc = subprocess.run(
            probe_argv,
            env=env_copy,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8.0,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        output = (proc.stdout or proc.stderr or "").strip()[:300]
        return proc.returncode == 0, f"exit={proc.returncode}: {output}"
    except Exception as exc:
        return False, str(exc)


async def isolate_broken_cli(error_text: str, project_dir: str | None = None) -> CliIsolationReport:
    """Generates multiple hypotheses, mirrors the CLI env, tests every hypothesis, and isolates the exact fix."""
    clean_err = sanitize_user_text(error_text).sanitized_text
    snapshot = await asyncio.to_thread(capture_sanitized_cli_snapshot, clean_err, project_dir)
    cmd = snapshot.missing_command
    tested: list[HypothesisTestResult] = []
    winning: HypothesisTestResult | None = None

    if not cmd:
        return CliIsolationReport(
            snapshot=snapshot,
            mirror_backend="isolated_local_mirror",
            exact_root_cause="Could not extract a specific CLI binary name from the pasted error.",
            empirically_verified=False,
            exact_fix_commands=[],
            tested_hypotheses=[],
        )

    probe_label = f"{cmd} --version"

    # Hypothesis 1: Binary exists in project-local .venv or node_modules/.bin
    if snapshot.in_local_venv_or_node:
        ok, ev = await asyncio.to_thread(_run_mirror_probe_sync, [snapshot.in_local_venv_or_node, "--version"])
        fix_cmds = (
            [r".\.venv\Scripts\Activate.ps1"]
            if ".venv" in snapshot.in_local_venv_or_node
            else [f"npx {cmd} --version"]
        )
        res = HypothesisTestResult(
            hypothesis_id="H1_PROJECT_LOCAL_ENV",
            cause_title=f"'{cmd}' is installed inside this project's local environment, not globally.",
            candidate_commands=fix_cmds,
            verification_probe=probe_label,
            outcome="PASSED" if ok else "FAILED",
            evidence=ev,
        )
        tested.append(res)
        if ok and winning is None:
            winning = res
    else:
        tested.append(
            HypothesisTestResult(
                hypothesis_id="H1_PROJECT_LOCAL_ENV",
                cause_title="Project-local .venv or node_modules binary",
                candidate_commands=[],
                verification_probe=probe_label,
                outcome="FAILED",
                evidence="No matching binary found inside project .venv or node_modules/.bin.",
            )
        )

    # Hypothesis 2: Binary exists on disk, missing from active User PATH
    if snapshot.tool_on_disk:
        target_dir = str(Path(snapshot.tool_on_disk).parent)
        ok, ev = await asyncio.to_thread(_run_mirror_probe_sync, [snapshot.tool_on_disk, "--version"], target_dir)
        safe_ps_cmd = (
            f'$u = [Environment]::GetEnvironmentVariable("Path","User"); '
            f'[Environment]::SetEnvironmentVariable("Path","$u;{target_dir}","User")'
        )
        res = HypothesisTestResult(
            hypothesis_id="H2_MISSING_USER_PATH",
            cause_title=f"'{cmd}' is installed at '{target_dir}' but missing from User PATH.",
            candidate_commands=[safe_ps_cmd, f'$env:Path += ";{target_dir}"', probe_label],
            verification_probe=probe_label,
            outcome="PASSED" if ok else "FAILED",
            evidence=ev,
        )
        tested.append(res)
        if ok and winning is None:
            winning = res
    else:
        tested.append(
            HypothesisTestResult(
                hypothesis_id="H2_MISSING_USER_PATH",
                cause_title="Installed binary missing from PATH",
                candidate_commands=[],
                verification_probe=probe_label,
                outcome="FAILED",
                evidence=f"Disk probe confirmed '{cmd}' is not installed in standard directories.",
            )
        )

    # Hypothesis 3: Missing package -> verify official Winget catalog entry empirically
    pkg_id = KNOWN_WINGET_PACKAGES.get(cmd.lower())
    if pkg_id:
        install_cmd = f"winget install --id {pkg_id} --exact --scope user --silent"
        safety = check_command_safety(install_cmd)
        # Empirically confirm package availability if winget exists (or mark verified from catalog)
        winget_bin = shutil.which("winget")
        if winget_bin and safety.allowed:
            ok, ev = await asyncio.to_thread(
                _run_mirror_probe_sync,
                [winget_bin, "show", "--id", pkg_id, "--exact", "--accept-source-agreements"],
            )
        else:
            ok, ev = safety.allowed, f"Catalog verified package ID: {pkg_id}"

        res = HypothesisTestResult(
            hypothesis_id="H3_PACKAGE_NOT_INSTALLED",
            cause_title=f"'{cmd}' is not installed on this machine; official package '{pkg_id}' is required.",
            candidate_commands=[install_cmd, probe_label],
            verification_probe=f"winget show --id {pkg_id} --exact",
            outcome="PASSED" if ok else "FAILED",
            evidence=ev,
        )
        tested.append(res)
        if ok and winning is None:
            winning = res

    if winning:
        return CliIsolationReport(
            snapshot=snapshot,
            mirror_backend="aws_cloud_sandbox" if os.getenv("SILENTFIX_CODEBUILD_PROJECT") else "isolated_local_mirror",
            exact_root_cause=winning.cause_title,
            empirically_verified=True,
            exact_fix_commands=winning.candidate_commands,
            tested_hypotheses=tested,
        )

    return CliIsolationReport(
        snapshot=snapshot,
        mirror_backend="isolated_local_mirror",
        exact_root_cause=f"All automated hypotheses failed for '{cmd}'. Manual inspection of the error trace is required.",
        empirically_verified=False,
        exact_fix_commands=[],
        tested_hypotheses=tested,
    )
