"""Audit regression tests locking in fixes for all 11 audited defects."""

import time
from pathlib import Path
import httpx
import pytest
from app.actions import compat_fixer
from app.cloud import aws_sandbox, aws_sync
from app.main import app
from app.probes import cli_healer
from app.routes import compat as compat_route
from app.routes import healer as healer_route
from app.routes import voice as voice_route


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# Test 1: Event loop non-blocking offload
async def test_healer_diagnose_offloads_to_thread(client, monkeypatch):
    called_via_thread = {"flag": False}
    real_to_thread = healer_route.asyncio.to_thread

    async def spy_to_thread(func, *args, **kwargs):
        called_via_thread["flag"] = True
        return await real_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(healer_route.asyncio, "to_thread", spy_to_thread)
    res = await client.post("/api/healer/diagnose", json={"error_text": "'git' is not recognized..."})
    assert res.status_code == 200
    assert called_via_thread["flag"] is True


# Test 2: Never suggest setx PATH
def test_cli_healer_never_suggests_setx_path(tmp_path: Path, monkeypatch):
    git_dir = tmp_path / "Git" / "cmd"
    git_dir.mkdir(parents=True)
    git_exe = git_dir / "git.exe"
    git_exe.write_bytes(b"MZ")
    monkeypatch.setattr(cli_healer, "_search_disk_for_command", lambda _cmd: str(git_exe))
    monkeypatch.setattr(cli_healer.sys, "platform", "win32")
    diag = cli_healer.diagnose_terminal_error("'git' is not recognized...")
    joined_suggestions = " ".join(getattr(diag, "suggested_commands", []) or [])
    assert "setx " not in joined_suggestions.lower()


# Test 3: Return 500 on compat undo registry failure
async def test_compat_undo_returns_500_on_registry_failure(client, monkeypatch):
    token = "test_undo_token_fail_123456"
    compat_route._compat_undo_store[token] = (
        r"C:\Legacy\old_app.exe",
        "~ WIN7RTM",
        time.monotonic() + 300.0,
    )
    monkeypatch.setattr(compat_route, "restore_compatibility_shim", lambda _p, _l: False)
    res = await client.post("/api/compat/undo", json={"undo_token": token})
    assert res.status_code == 500


# Test 4: Prune expired undo tokens
def test_compat_undo_store_prunes_expired_tokens():
    compat_route._compat_undo_store["expired_tok"] = (
        r"C:\a.exe",
        None,
        time.monotonic() - 10.0,
    )
    compat_route._compat_undo_store["active_tok"] = (
        r"C:\b.exe",
        None,
        time.monotonic() + 600.0,
    )
    compat_route._prune_expired_undo_tokens()
    assert "expired_tok" not in compat_route._compat_undo_store
    assert "active_tok" in compat_route._compat_undo_store
    compat_route._compat_undo_store.pop("active_tok", None)


# Test 5: Voice route socket cleanup
async def test_voice_route_closes_client_on_exception(client, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "fake_key_for_test")
    closed = {"flag": False}

    class FailingAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        def build_request(self, *args, **kwargs):
            return object()

        async def send(self, *args, **kwargs):
            raise httpx.ConnectError("Simulated network drop")

        async def aclose(self):
            closed["flag"] = True

    monkeypatch.setattr(voice_route.httpx, "AsyncClient", FailingAsyncClient)
    res = await client.post("/api/voice/speak", json={"text": "Testing fallback."})
    assert res.status_code == 204
    assert closed["flag"] is True


# Test 6: Ignore common error words
@pytest.mark.parametrize("generic_error", ["Cannot open file test.txt", "Failed to connect to database"])
def test_non_command_words_are_not_extracted_as_executables(generic_error: str):
    extracted = cli_healer.extract_missing_command(generic_error)
    assert extracted not in {"cannot", "failed"}


# Test 7: Reject degenerate "~" shim
def test_compat_fixer_rejects_empty_degenerate_layer(tmp_path: Path):
    exe = tmp_path / "legacy.exe"
    exe.write_bytes(b"MZ")
    params = compat_fixer.CompatShimParams(
        executable_path=str(exe),
        os_mode=None,
        display_flags=[],
        run_as_admin=False,
    )
    res = compat_fixer.apply_compatibility_shim(params)
    assert res.success is False
    assert res.applied_layer == ""


# Test 8: Consistent AWS region
def test_aws_modules_share_consistent_default_region(monkeypatch):
    monkeypatch.delenv("AWS_REGION", raising=False)
    sync_region = getattr(aws_sync, "DEFAULT_AWS_REGION", getattr(aws_sync, "AWS_REGION", None))
    sandbox_region = getattr(aws_sandbox, "DEFAULT_AWS_REGION", "ap-south-1")
    assert sync_region == sandbox_region


# Test 9: AWS CodeBuild status polling endpoint (Fix #4)
async def test_sandbox_build_status_polling(client, monkeypatch):
    from app.cloud.aws_sandbox import PretestReportDict, _simulated_runs
    from app.routes import sandbox as sandbox_route

    run_id = "test_run_cb_123"
    _simulated_runs[run_id] = PretestReportDict({
        "run_id": run_id,
        "aws_build_id": "project:build-123",
        "verdict": "RUNNING",
    })

    class FakeCodeBuildClient:
        def batch_get_builds(self, ids):
            return {"builds": [{"buildStatus": "SUCCEEDED"}]}

    monkeypatch.setattr(sandbox_route.boto3, "client", lambda service, **kwargs: FakeCodeBuildClient())
    res = await client.get(f"/api/sandbox/status/{run_id}")
    assert res.status_code == 200
    assert res.json()["verdict"] == "PASSED"
    _simulated_runs.pop(run_id, None)


# Test 10: Package source verification in token eviction (Fix #6)
def test_validate_and_evict_token_enforces_source():
    from app.probes import software_probe
    token = software_probe.mint_probe_token(
        package_id="Git.Git",
        source="https://github.com/git-for-windows/git/releases",
        sha256_hash="4b92cbf54a61b8fbc04de90ef9929845d58f33989c565d7764d36ef9662b249b",
    )
    with pytest.raises(software_probe.HTTPException) as exc_info:
        software_probe.validate_and_evict_token(
            token=token,
            package_id="Git.Git",
            source="https://malicious-source.com/git.exe",
        )
    assert exc_info.value.status_code == 403


# Test 11: Session task lock for concurrent SSE streams (Fix #11)
async def test_session_task_lock_deduplicates_runs():
    import asyncio
    from app.routes.install_stream import get_or_attach_install_task, _active_jobs

    exec_count = 0

    async def sample_job():
        nonlocal exec_count
        exec_count += 1
        await asyncio.sleep(0.05)

    sess_id = "test_concurrent_sess"
    coro1 = sample_job()
    coro2 = sample_job()
    t1 = await get_or_attach_install_task(sess_id, coro1)
    t2 = await get_or_attach_install_task(sess_id, coro2)
    assert t1 is t2
    await t1
    coro2.close()
    assert exec_count == 1
    _active_jobs.pop(sess_id, None)

