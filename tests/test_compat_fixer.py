"""Tests for Pillar 2: Windows 11 Compatibility Shim Engine."""

import sys
from pathlib import Path
import pytest
import pytest_asyncio
import httpx
from app.main import app
from app.actions.compat_fixer import (
    CompatShimParams,
    build_layer_string,
    apply_compatibility_shim,
)


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def test_build_layer_string():
    """Verify registry layer string generation."""
    params = CompatShimParams(
        executable_path=r"C:\Tools\legacy_app.exe",
        os_mode="WIN7RTM",
        display_flags=["HIGHDPIAWARE", "GDIDPISCALING"],
        run_as_admin=True,
    )
    layer = build_layer_string(params)
    assert layer == "~ RUNASADMIN HIGHDPIAWARE GDIDPISCALING WIN7RTM"


def test_apply_shim_rejects_non_exe():
    """Safety check: Non-exe files or directories are strictly rejected."""
    params = CompatShimParams(
        executable_path=r"C:\Windows\System32\drivers\etc\hosts",
    )
    res = apply_compatibility_shim(params)
    assert res.success is False
    assert "must be an existing .exe file" in res.detail


def test_apply_shim_rejects_non_existent_file():
    """Safety check: Missing files are rejected."""
    params = CompatShimParams(
        executable_path=r"C:\NonExistentDirectory\FakeApp_12345.exe",
    )
    res = apply_compatibility_shim(params)
    assert res.success is False
    assert "must be an existing .exe file" in res.detail


@pytest.mark.asyncio
async def test_compat_api_apply_and_undo_flow(client, tmp_path):
    """Verify HTTP API apply & undo snapshot token store."""
    # Create a dummy exe for validation test
    dummy_exe = tmp_path / "dummy_game.exe"
    dummy_exe.write_bytes(b"MZ\x90\x00\x03\x00\x00\x00")

    res = await client.post(
        "/api/compat/apply",
        json={
            "executable_path": str(dummy_exe),
            "os_mode": "WIN7RTM",
            "display_flags": ["HIGHDPIAWARE"],
            "run_as_admin": False,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["result"]["success"] is True
    assert body["undo_token"] is not None
    undo_token = body["undo_token"]

    # Undo operation using single-use undo token
    undo_res = await client.post(
        "/api/compat/undo",
        json={"undo_token": undo_token},
    )
    assert undo_res.status_code == 200
    assert undo_res.json()["restored"] is True

    # Duplicate undo attempt must return 404 (Single-use token invariant)
    dup_res = await client.post(
        "/api/compat/undo",
        json={"undo_token": undo_token},
    )
    assert dup_res.status_code == 404
