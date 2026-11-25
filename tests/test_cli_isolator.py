from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.probes.cli_healer import CliDiagnosis
from app.services.cli_isolator import (
    capture_sanitized_cli_snapshot,
    isolate_broken_cli,
)


def test_capture_snapshot_detects_local_node_bin(tmp_path: Path):
    node_bin = tmp_path / "node_modules" / ".bin"
    node_bin.mkdir(parents=True)
    tool_cmd = node_bin / "vite.cmd"
    tool_cmd.write_text("@echo off\necho 5.0.0\n", encoding="utf-8")

    snap = capture_sanitized_cli_snapshot(
        "'vite' is not recognized as an internal or external command",
        project_dir=str(tmp_path),
    )
    assert snap.missing_command == "vite"
    assert snap.in_local_venv_or_node == str(tool_cmd)


@pytest.mark.asyncio
async def test_isolate_h1_project_local_venv_passes(tmp_path: Path):
    scripts_dir = tmp_path / ".venv" / "Scripts"
    scripts_dir.mkdir(parents=True)
    fake_exe = scripts_dir / "mycli.exe"
    fake_exe.write_bytes(b"dummy")

    with (
        patch("app.services.cli_isolator.diagnose_terminal_error") as mock_diag,
        patch("app.services.cli_isolator._run_mirror_probe_sync") as mock_probe,
    ):
        mock_diag.return_value = CliDiagnosis(
            missing_command="mycli",
            status="NOT_FOUND",
            summary="Not in PATH",
        )
        mock_probe.return_value = (True, "exit=0: mycli 1.2.3")

        report = await isolate_broken_cli(
            "'mycli' is not recognized as an internal or external command",
            project_dir=str(tmp_path),
        )

    assert report.empirically_verified is True
    assert report.exact_fix_commands == [r".\.venv\Scripts\Activate.ps1"]
    assert report.tested_hypotheses[0].hypothesis_id == "H1_PROJECT_LOCAL_ENV"
    assert report.tested_hypotheses[0].outcome == "PASSED"


@pytest.mark.asyncio
async def test_isolate_h2_missing_user_path_passes(tmp_path: Path):
    fake_tool = tmp_path / "Tools" / "kubectl.exe"
    fake_tool.parent.mkdir(parents=True)
    fake_tool.write_bytes(b"dummy")

    with (
        patch("app.services.cli_isolator.diagnose_terminal_error") as mock_diag,
        patch("app.services.cli_isolator._run_mirror_probe_sync") as mock_probe,
    ):
        mock_diag.return_value = CliDiagnosis(
            missing_command="kubectl",
            status="FOUND_ON_DISK_NEEDS_PATH",
            found_executable_path=str(fake_tool),
            directory_to_add=str(fake_tool.parent),
            summary="Found on disk",
        )
        mock_probe.return_value = (True, "exit=0: Client Version: v1.30.0")

        report = await isolate_broken_cli(
            "'kubectl' is not recognized as an internal or external command"
        )

    assert report.empirically_verified is True
    assert any("SetEnvironmentVariable" in cmd for cmd in report.exact_fix_commands)
    assert not any("setx" in cmd.lower() for cmd in report.exact_fix_commands)
    h2 = next(h for h in report.tested_hypotheses if h.hypothesis_id == "H2_MISSING_USER_PATH")
    assert h2.outcome == "PASSED"


@pytest.mark.asyncio
async def test_isolate_h3_winget_catalog_fallback():
    with (
        patch("app.services.cli_isolator.diagnose_terminal_error") as mock_diag,
        patch("app.services.cli_isolator.shutil.which", return_value=None),
    ):
        mock_diag.return_value = CliDiagnosis(
            missing_command="helm",
            status="AVAILABLE_VIA_WINGET",
            winget_package_id="Helm.Helm",
            summary="Available via winget",
        )

        report = await isolate_broken_cli("zsh: command not found: helm")

    assert report.empirically_verified is True
    assert "winget install --id Helm.Helm --exact --scope user --silent" in report.exact_fix_commands
    h3 = next(h for h in report.tested_hypotheses if h.hypothesis_id == "H3_PACKAGE_NOT_INSTALLED")
    assert h3.outcome == "PASSED"


@pytest.mark.asyncio
async def test_isolate_unextractable_and_unknown_commands():
    report_empty = await isolate_broken_cli("error: something went wrong")
    assert report_empty.empirically_verified is False
    assert report_empty.tested_hypotheses == []

    with patch("app.services.cli_isolator.diagnose_terminal_error") as mock_diag:
        mock_diag.return_value = CliDiagnosis(
            missing_command="obscuretool99",
            status="NOT_FOUND",
            summary="Not found",
        )
        report_unknown = await isolate_broken_cli("bash: obscuretool99: command not found")

    assert report_unknown.empirically_verified is False
    assert report_unknown.exact_fix_commands == []
    assert all(h.outcome == "FAILED" for h in report_unknown.tested_hypotheses)


@pytest.mark.asyncio
async def test_cli_isolator_api_route():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with (
            patch("app.services.cli_isolator.diagnose_terminal_error") as mock_diag,
            patch("app.services.cli_isolator.shutil.which", return_value=None),
        ):
            mock_diag.return_value = CliDiagnosis(
                missing_command="terraform",
                status="AVAILABLE_VIA_WINGET",
                winget_package_id="HashiCorp.Terraform",
                summary="Available via winget",
            )
            resp = await client.post(
                "/api/cli-isolator/isolate",
                json={"error_text": "The term 'terraform' is not recognized as the name of a cmdlet"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["empirically_verified"] is True
        assert data["snapshot"]["missing_command"] == "terraform"
        assert "HashiCorp.Terraform" in data["exact_root_cause"]

        # Extra fields forbidden by strict schema
        bad_resp = await client.post(
            "/api/cli-isolator/isolate",
            json={"error_text": "bash: git: command not found", "extra_field": 123},
        )
        assert bad_resp.status_code == 422
