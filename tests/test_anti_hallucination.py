# tests/test_anti_hallucination.py
import httpx
import pytest

from app.main import app
from app.probes import cli_healer
from app.routes import chatbot as chatbot_route


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def _stub_disk_probe(monkeypatch):
    monkeypatch.setattr(cli_healer, "_search_disk_for_command", lambda _cmd: None)


async def test_blocks_hallucinated_winget_package_id(client, monkeypatch):
    fake_output = chatbot_route._GeminiChatOutput(
        intent="install_software",
        confidence="high",
        grounded_evidence=["User asked for magic fixer"],
        needs_clarification=False,
        reply="Install MagicFixer via winget.",
        action_kind="run_terminal",
        action_label="Install MagicFixer",
        terminal_command="winget install --id FakeCorp.MagicFixer99 --exact",
        package_id="FakeCorp.MagicFixer99",
    )
    monkeypatch.setattr(chatbot_route, "_call_gemini_chat_sync", lambda *a, **kw: fake_output)

    res = await client.post(
        "/api/chatbot/message",
        json={"session_id": "s1", "message": "install magic fixer"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["needs_clarification"] is True
    assert body["action"]["command"] is None
    assert body["action"]["safety_status"] == "INFO_ONLY"


async def test_blocks_hallucinated_nonexistent_windows_path(client, monkeypatch):
    fake_output = chatbot_route._GeminiChatOutput(
        intent="cli_error",
        confidence="high",
        grounded_evidence=["Guessed common install folder"],
        needs_clarification=False,
        reply="Add this invented folder to PATH.",
        action_kind="run_terminal",
        action_label="Update PATH",
        terminal_command=r'cd C:\NonExistentHallucinatedFolder_9999\bin',
    )
    monkeypatch.setattr(chatbot_route, "_call_gemini_chat_sync", lambda *a, **kw: fake_output)

    res = await client.post(
        "/api/chatbot/message",
        json={"session_id": "s2", "message": "my tool is missing"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["needs_clarification"] is True
    assert body["action"]["command"] is None


async def test_withholds_low_confidence_ungrounded_command(client, monkeypatch):
    fake_output = chatbot_route._GeminiChatOutput(
        intent="general_help",
        confidence="low",
        grounded_evidence=[],
        needs_clarification=False,
        reply="Try resetting git.",
        action_kind="run_terminal",
        action_label="Guess Fix",
        terminal_command="git status",
    )
    monkeypatch.setattr(chatbot_route, "_call_gemini_chat_sync", lambda *a, **kw: fake_output)

    res = await client.post(
        "/api/chatbot/message",
        json={"session_id": "s3", "message": "something is broken"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["needs_clarification"] is True
    assert body["action"]["command"] is None


async def test_allows_grounded_verified_winget_command(client, monkeypatch):
    fake_output = chatbot_route._GeminiChatOutput(
        intent="install_software",
        confidence="high",
        grounded_evidence=["installed_tools.git is null in verified_system"],
        needs_clarification=False,
        reply="Git is not installed on this machine. Install the official Git package.",
        action_kind="cloud_pretest",
        action_label="Install Git",
        terminal_command="winget install --id Git.Git --exact --scope user --silent",
        package_id="Git.Git",
    )
    monkeypatch.setattr(chatbot_route, "_call_gemini_chat_sync", lambda *a, **kw: fake_output)

    res = await client.post(
        "/api/chatbot/message",
        json={"session_id": "s4", "message": "git is not recognized"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["needs_clarification"] is False
    assert body["action"]["safety_status"] == "VERIFIED_SAFE"
    assert body["action"]["package_id"] == "Git.Git"


def test_verify_ai_output_allows_verified_path_with_spaces():
    from app.core.grounding_guard import verify_ai_output

    verified_dir = r"C:\Program Files\Git\cmd"
    res = verify_ai_output(
        user_message="'git' is not recognized",
        confidence="high",
        grounded_evidence=[f"Found directory: {verified_dir}"],
        terminal_command=f'$u = [Environment]::GetEnvironmentVariable("Path","User"); [Environment]::SetEnvironmentVariable("Path","$u;{verified_dir}","User")',
        package_id=None,
        executable_path=None,
        verified_paths={verified_dir},
    )
    assert res.is_grounded is True
    assert res.violations == []


import subprocess
from app.core import grounding_guard


def test_live_winget_verifies_unlisted_package_and_caches(monkeypatch):
    grounding_guard.clear_winget_cache()
    calls = {"count": 0}

    def fake_run(argv, **kwargs):
        calls["count"] += 1
        assert kwargs.get("shell") is False
        assert "--exact" in argv
        assert "--disable-interactivity" in argv
        return subprocess.CompletedProcess(
            args=argv,
            returncode=0,
            stdout=(
                "Found VLC media player [VideoLAN.VLC]\n"
                "Version: 3.0.21\n"
                "Publisher: VideoLAN\n"
                "Installer SHA256: " + ("a" * 64) + "\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(grounding_guard.shutil, "which", lambda _name: r"C:\Windows\System32\winget.exe")
    monkeypatch.setattr(grounding_guard.subprocess, "run", fake_run)

    first = grounding_guard.verify_winget_package("videolan.vlc")
    second = grounding_guard.verify_winget_package("VideoLAN.VLC")

    assert first.found is True
    assert first.canonical_id == "VideoLAN.VLC"
    assert first.publisher == "VideoLAN"
    assert first.installer_sha256 == "a" * 64
    assert first.source == "live_winget"
    assert second.canonical_id == "VideoLAN.VLC"
    assert calls["count"] == 1  # Second lookup served from TTL cache


def test_live_winget_rejects_flag_injection_without_spawning_subprocess(monkeypatch):
    grounding_guard.clear_winget_cache()

    def should_not_run(*_args, **_kwargs):
        raise AssertionError("subprocess.run must never be called for invalid package IDs")

    monkeypatch.setattr(grounding_guard.subprocess, "run", should_not_run)

    res = grounding_guard.verify_winget_package("--source=evil")
    assert res.found is False
    assert res.source == "rejected"


async def test_chatbot_allows_unlisted_package_verified_by_live_winget(client, monkeypatch):
    grounding_guard.clear_winget_cache()
    monkeypatch.setattr(grounding_guard.shutil, "which", lambda _name: r"C:\Windows\System32\winget.exe")
    monkeypatch.setattr(
        grounding_guard.subprocess,
        "run",
        lambda argv, **kw: subprocess.CompletedProcess(
            args=argv,
            returncode=0,
            stdout="Found VLC media player [VideoLAN.VLC]\nPublisher: VideoLAN\n",
            stderr="",
        ),
    )

    fake_output = chatbot_route._GeminiChatOutput(
        intent="install_software",
        confidence="high",
        grounded_evidence=["User requested VLC installation"],
        needs_clarification=False,
        reply="Install VLC media player using the verified Winget package.",
        action_kind="cloud_pretest",
        action_label="Install VLC",
        terminal_command="winget install --id VideoLAN.VLC --exact --scope user --silent",
        package_id="VideoLAN.VLC",
    )
    monkeypatch.setattr(chatbot_route, "_call_gemini_chat_sync", lambda *a, **kw: fake_output)

    res = await client.post(
        "/api/chatbot/message",
        json={"session_id": "s_vlc", "message": "install vlc"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["needs_clarification"] is False
    assert body["action"]["package_id"] == "VideoLAN.VLC"
    assert body["action"]["safety_status"] == "VERIFIED_SAFE"
    assert any("VideoLAN" in note for note in body["action"]["safety_notes"])


def test_rejects_package_id_mismatch_between_metadata_and_command():
    audit = grounding_guard.verify_ai_output(
        user_message="install git",
        confidence="high",
        grounded_evidence=["git missing"],
        terminal_command="winget install --id Evil.Trojan --exact",
        package_id="Git.Git",
        executable_path=None,
        verified_paths=set(),
        allow_live_winget=False,
    )
    assert audit.is_grounded is False
    assert any("mismatch" in v.lower() for v in audit.violations)
