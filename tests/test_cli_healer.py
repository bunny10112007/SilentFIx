"""Tests for Pillar 1: Terminal CLI Error Healer."""

import pytest
import pytest_asyncio
import httpx
from app.main import app
from app.probes.cli_healer import (
    extract_missing_command,
    diagnose_terminal_error,
)


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def test_extract_missing_command_various_shells():
    """Verify regex patterns for Windows CMD, PowerShell, Bash, and Zsh."""
    # Windows CMD single quote
    assert extract_missing_command("'git' is not recognized as an internal or external command") == "git"
    # Windows CMD double quote
    assert extract_missing_command('"node.exe" is not recognized as an internal or external command') == "node"
    # PowerShell cmdlet
    assert extract_missing_command("The term 'kubectl' is not recognized as the name of a cmdlet") == "kubectl"
    # Bash
    assert extract_missing_command("bash: terraform: command not found") == "terraform"
    # Zsh
    assert extract_missing_command("zsh: command not found: docker") == "docker"
    # Raw token
    assert extract_missing_command("helm") == "helm"


def test_diagnose_terminal_error_winget_fallback():
    """Commands not present on disk fallback to known Winget catalog."""
    res = diagnose_terminal_error("bash: terraform: command not found")
    assert res.missing_command == "terraform"
    assert res.status in ["FOUND_ON_DISK_NEEDS_PATH", "AVAILABLE_VIA_WINGET"]
    if res.status == "AVAILABLE_VIA_WINGET":
        assert res.winget_package_id == "HashiCorp.Terraform"


def test_diagnose_terminal_error_unknown_command():
    """Non-existent commands return NOT_FOUND."""
    res = diagnose_terminal_error("command not found: random_unknown_tool_xyz")
    assert res.missing_command == "random_unknown_tool_xyz"
    assert res.status == "NOT_FOUND"


@pytest.mark.asyncio
async def test_healer_diagnoses_missing_git(client):
    """Specification test: Diagnose missing git via HTTP API endpoint."""
    res = await client.post(
        "/api/healer/diagnose",
        json={"error_text": "'git' is not recognized as an internal or external command"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["missing_command"] == "git"
    assert body["status"] in ["FOUND_ON_DISK_NEEDS_PATH", "AVAILABLE_VIA_WINGET", "ALREADY_IN_PATH"]
