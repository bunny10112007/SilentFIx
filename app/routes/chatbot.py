# app/routes/chatbot.py
import asyncio
import json
import os
import re
from typing import Literal
from fastapi import APIRouter
from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from app.actions.compat_fixer import suggest_missing_runtime
from app.ai.brain import deterministic_intent_resolution
from app.core.grounding_guard import (
    VERIFIED_WINGET_PACKAGES,
    collect_verified_context,
    verify_ai_output,
)
from app.core.safety_filter import check_command_safety, sanitize_user_text
from app.probes.cli_healer import diagnose_terminal_error

router = APIRouter(prefix="/api/chatbot", tags=["chatbot"])

IntentKind = Literal[
    "cli_error",
    "install_software",
    "configure_git",
    "legacy_compat",
    "repair_folder",
    "general_help",
]

ActionKind = Literal[
    "none",
    "run_terminal",
    "repair_folder",
    "apply_compat_shim",
    "cloud_pretest",
    "configure_git",
]


class ChatTurn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=3000)


class ChatbotRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    session_id: str = Field(min_length=2, max_length=64)
    message: str = Field(min_length=1, max_length=2500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=24)
    folder_path: str | None = Field(default=None, max_length=400)


class ProposedAction(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    kind: ActionKind = "none"
    label: str = ""
    command: str | None = None
    package_id: str | None = None
    folder_path: str | None = None
    executable_path: str | None = None
    safety_status: Literal["VERIFIED_SAFE", "BLOCKED_UNSAFE", "INFO_ONLY"] = "INFO_ONLY"
    safety_notes: list[str] = Field(default_factory=list)


class ChatbotResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    intent: IntentKind
    needs_clarification: bool
    reply: str
    quick_replies: list[str] = Field(default_factory=list)
    action: ProposedAction | None = None


class _GeminiChatOutput(BaseModel):
    intent: IntentKind
    confidence: Literal["high", "medium", "low"] = Field(
        description="Set to 'low' if the root cause or target path/package is not directly confirmed by Local System Context or User Message."
    )
    grounded_evidence: list[str] = Field(
        default_factory=list,
        description="Exact facts copied from Local System Context or User Message that justify this reply. Leave empty if guessing.",
    )
    needs_clarification: bool = Field(
        description="True whenever critical details are missing or confidence is low."
    )
    reply: str = Field(description="Clear, plain-English explanation or clarifying question based ONLY on verified facts.")
    quick_replies: list[str] = Field(default_factory=list)
    action_kind: ActionKind = "none"
    action_label: str = ""
    terminal_command: str | None = None
    package_id: str | None = None
    executable_path: str | None = None


SYSTEM_PROMPT = f"""You are SilentFix AI, a grounded Windows troubleshooting assistant.

STRICT ANTI-HALLUCINATION RULES:
1. Base every diagnosis ONLY on [Local System Context] and [User Message]. Never invent file paths, installed versions, error logs, or software names.
2. If [Local System Context] shows a tool is null in installed_tools, do NOT claim it is installed. If it shows a real path, use that exact path.
3. For winget installations, prefer verified IDs from this fast-path list:
   {", ".join(sorted(set(VERIFIED_WINGET_PACKAGES.values())))}
   If the user requests another real Windows application, provide its exact official Winget ID (e.g., VideoLAN.VLC) — SilentFix will verify it live against `winget show --id --exact` and reject any invented ID.
4. If the user's message is vague or lacks required details (file path, exact error text, Git name/email), set needs_clarification=true, confidence="low", terminal_command=null, and ask one direct question.
5. Copy the exact supporting facts into grounded_evidence. Never fabricate evidence.
6. Never use emojis. Never emit setx PATH, rm -rf, Invoke-Expression, or multi-line commands.
"""


def _call_gemini_chat_sync(
    sanitized_message: str,
    history: list[ChatTurn],
    context_summary: str,
) -> _GeminiChatOutput | None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    model_id = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
    try:
        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=10000),
        )
        contents: list[types.Content] = []
        for turn in history[-12:]:
            safe_turn = sanitize_user_text(turn.text).sanitized_text
            contents.append(
                types.Content(
                    role="user" if turn.role == "user" else "model",
                    parts=[types.Part.from_text(text=safe_turn)],
                )
            )

        enriched_prompt = f"[Local System Context]\n{context_summary}\n\n[User Message]\n{sanitized_message}"
        contents.append(
            types.Content(role="user", parts=[types.Part.from_text(text=enriched_prompt)])
        )

        resp = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=_GeminiChatOutput,
                temperature=0.0,
            ),
        )
        if not resp.text:
            return None
        return _GeminiChatOutput.model_validate_json(resp.text)
    except Exception as exc:
        print(f"[SilentFix Chatbot] Gemini fallback triggered: {exc}")
        return None


def _offline_intent_fallback(
    message: str,
    folder_path: str | None,
    cli_diag_dict: dict,
    history: list[ChatTurn] | None = None,
) -> _GeminiChatOutput:
    lower = message.lower()
    prior_text = " ".join(t.text.lower() for t in (history or [])[-4:])

    # 1. Missing legacy DLL / Windows 11 compatibility
    missing_dll_pkg = suggest_missing_runtime(message)
    if missing_dll_pkg:
        return _GeminiChatOutput(
            intent="legacy_compat",
            confidence="high",
            grounded_evidence=["Local probe verified missing runtime DLL pattern"],
            needs_clarification=False,
            reply=(
                f"Your app is missing a required Windows runtime library. "
                f"Installing the official package '{missing_dll_pkg}' fixes this cleanly."
            ),
            quick_replies=["Pre-test in AWS Sandbox", "Install runtime now"],
            action_kind="cloud_pretest",
            action_label=f"Pre-Test {missing_dll_pkg} in AWS Sandbox",
            terminal_command=f"winget install --id {missing_dll_pkg} --exact --scope user --silent",
            package_id=missing_dll_pkg,
        )

    exe_match = re.search(r'([A-Za-z]:\\[^\r\n"]+?\.exe)', message, re.IGNORECASE)
    if exe_match and ("compatibility" in prior_text or "blurry" in prior_text or ".exe" in prior_text):
        exe_path = exe_match.group(1).strip()
        return _GeminiChatOutput(
            intent="legacy_compat",
            confidence="high",
            grounded_evidence=[f"User supplied executable path: {exe_path}"],
            needs_clarification=False,
            reply=f"Ready to apply a Windows 7 + High DPI compatibility shim to '{exe_path}' without modifying the binary.",
            quick_replies=["Test in terminal", "Undo compatibility shim later"],
            action_kind="apply_compat_shim",
            action_label="Apply Win11 Compatibility Shim",
            executable_path=exe_path,
        )

    if any(k in lower for k in ("old app", "blurry", "windows 7", "windows xp", "compatibility", ".exe")):
        return _GeminiChatOutput(
            intent="legacy_compat",
            confidence="low",
            grounded_evidence=[],
            needs_clarification=True,
            reply=(
                "I can apply a reversible Windows 11 compatibility shim without altering the executable. "
                "Paste the full path to the .exe file and tell me if it crashes or looks blurry."
            ),
            quick_replies=["App looks blurry (High DPI)", "App crashes on startup (Win 7 mode)"],
            action_kind="none",
        )

    # 2. Configure Git flow (single-turn or multi-turn follow-up)
    in_git_flow = (
        ("git" in lower and any(k in lower for k in ("config", "setup", "set up", "new laptop", "new device")))
        or ("share your full name and email" in prior_text or "configure git" in prior_text)
    )
    if in_git_flow:
        brain_decision = deterministic_intent_resolution(message)
        if brain_decision.action_type == "EXECUTE_GIT_CONFIG" and brain_decision.user_name and brain_decision.user_email:
            safe_name = brain_decision.user_name.replace('"', "")
            safe_email = brain_decision.user_email.replace('"', "")
            return _GeminiChatOutput(
                intent="configure_git",
                confidence="high",
                grounded_evidence=[f"User provided Git identity: {safe_name} <{safe_email}>"],
                needs_clarification=False,
                reply=(
                    f"Ready to configure Git for {safe_name} ({safe_email}) "
                    "and set 'main' as your default branch."
                ),
                quick_replies=["Verify Git config after running"],
                action_kind="run_terminal",
                action_label=f"Configure Git ({safe_name})",
                terminal_command=(
                    f'git config --global user.name "{safe_name}"; '
                    f'git config --global user.email "{safe_email}"; '
                    f"git config --global init.defaultBranch main"
                ),
            )
        return _GeminiChatOutput(
            intent="configure_git",
            confidence="high",
            grounded_evidence=["Local probe verified Git configuration inspection command"],
            needs_clarification=True,
            reply=(
                brain_decision.follow_up_prompt
                or (
                    "To configure Git on this device, share your full name and email address for commits. "
                    "I will also set 'main' as the default branch and enable Windows Credential Manager unless you want different defaults."
                )
            ),
            quick_replies=["Use default branch 'main'", "Check my current Git config"],
            action_kind="run_terminal",
            action_label="Inspect Current Git Config",
            terminal_command="git config --global --list",
        )

    # 3. Broken folder repair
    if any(
        k in lower
        for k in (
            "broken folder",
            "fix folder",
            "broken project",
            "broken dependencies",
            "fix dependencies",
            "won't run",
            "won't start",
        )
    ):
        if folder_path:
            return _GeminiChatOutput(
                intent="repair_folder",
                confidence="high",
                grounded_evidence=[f"Attached folder verified: {folder_path}"],
                needs_clarification=False,
                reply=(
                    f"I can scan '{folder_path}', identify broken packages, and pre-test the fix "
                    "inside the AWS sandbox before touching your machine."
                ),
                quick_replies=["Scan and pre-test folder"],
                action_kind="repair_folder",
                action_label="Scan & AWS Pre-Test Folder",
            )
        return _GeminiChatOutput(
            intent="repair_folder",
            confidence="low",
            grounded_evidence=[],
            needs_clarification=True,
            reply="Attach or paste the full folder path of the broken project so I can inspect its manifests and pre-test a clean fix.",
            quick_replies=["Use current workspace folder"],
            action_kind="none",
        )

    # 4. Terminal CLI unrecognized errors
    status = cli_diag_dict.get("status")
    cmd_name = cli_diag_dict.get("command") or cli_diag_dict.get("missing_command") or ""
    if status == "FOUND_ON_DISK_NEEDS_PATH" and cli_diag_dict.get("directory_to_add"):
        target_dir = cli_diag_dict["directory_to_add"]
        ps_cmd = (
            f'$u = [Environment]::GetEnvironmentVariable("Path","User"); '
            f'[Environment]::SetEnvironmentVariable("Path","$u;{target_dir}","User")'
        )
        return _GeminiChatOutput(
            intent="cli_error",
            confidence="high",
            grounded_evidence=[f"Local probe verified executable directory: {target_dir}"],
            needs_clarification=False,
            reply=cli_diag_dict["summary"],
            quick_replies=["Run PATH repair in terminal", "Verify command version"],
            action_kind="run_terminal",
            action_label=f"Repair User PATH for {cmd_name}",
            terminal_command=ps_cmd,
        )

    pkg = cli_diag_dict.get("recommended_winget_id") or cli_diag_dict.get("winget_package_id")
    if status in {"NOT_INSTALLED_WINGET_AVAILABLE", "AVAILABLE_VIA_WINGET"} and pkg:
        return _GeminiChatOutput(
            intent="install_software",
            confidence="high",
            grounded_evidence=[f"Local probe verified official Winget package: {pkg}"],
            needs_clarification=False,
            reply=cli_diag_dict["summary"],
            quick_replies=[f"Pre-test {pkg} in AWS", "Copy winget command"],
            action_kind="cloud_pretest",
            action_label=f"Pre-Test {pkg} in AWS Sandbox",
            terminal_command=f"winget install --id {pkg} --exact --scope user --silent",
            package_id=pkg,
        )

    if status in {"ALREADY_ON_REGISTRY_PATH", "FOUND_IN_PROJECT_LOCAL", "ALREADY_IN_PATH"}:
        suggested = cli_diag_dict.get("suggested_command") or (
            cli_diag_dict.get("suggested_commands", [None])[0]
            if cli_diag_dict.get("suggested_commands")
            else None
        )
        if not suggested and cmd_name and cmd_name != "unknown":
            suggested = f"{cmd_name} --version"
        return _GeminiChatOutput(
            intent="cli_error",
            confidence="high",
            grounded_evidence=[f"Local probe verified command status: {status}"],
            needs_clarification=False,
            reply=cli_diag_dict["summary"],
            quick_replies=["Run suggested command"] if suggested else [],
            action_kind="run_terminal" if suggested else "none",
            action_label=f"Run {cmd_name}" if suggested else "",
            terminal_command=suggested,
        )

    # 5. General clarifying help
    return _GeminiChatOutput(
        intent="general_help",
        confidence="low",
        grounded_evidence=[],
        needs_clarification=True,
        reply=(
            "Tell me what you are trying to fix—for example, paste a terminal error, ask to configure Git, "
            "share a broken project folder, or describe a legacy app issue on Windows 11."
        ),
        quick_replies=[
            "'git' is not recognized",
            "Configure Git on this PC",
            "Fix a broken project folder",
        ],
        action_kind="none",
    )


@router.post("/message", response_model=ChatbotResponse)
async def chatbot_message(req: ChatbotRequest) -> ChatbotResponse:
    filtered = sanitize_user_text(req.message)
    notes: list[str] = []
    if filtered.pii_redacted:
        notes.append("Sensitive credentials redacted before reasoning")

    if filtered.injection_detected:
        return ChatbotResponse(
            intent="general_help",
            needs_clarification=False,
            reply="That input triggered SilentFix's prompt-injection guard. Describe your technical issue normally and I will prepare a verified fix.",
            quick_replies=["Diagnose a terminal error", "Configure Git safely"],
            action=ProposedAction(
                kind="none",
                label="Blocked Unsafe Prompt",
                safety_status="BLOCKED_UNSAFE",
                safety_notes=["Prompt injection filter triggered"],
            ),
        )

    # 1. Collect real machine facts + local CLI probe off the event loop
    sys_ctx = await asyncio.to_thread(collect_verified_context, req.folder_path)
    cli_diag = await asyncio.to_thread(diagnose_terminal_error, filtered.sanitized_text, req.folder_path)
    cli_dict = cli_diag.model_dump()
    cli_dict["command"] = cli_diag.command
    cli_dict["recommended_winget_id"] = cli_diag.recommended_winget_id
    cli_dict["suggested_command"] = cli_diag.suggested_command

    verified_paths: set[str] = set()
    if sys_ctx.attached_folder and sys_ctx.folder_exists:
        verified_paths.add(sys_ctx.attached_folder)
    for p in sys_ctx.installed_tools.values():
        if p:
            verified_paths.add(p)
    if cli_dict.get("directory_to_add"):
        verified_paths.add(cli_dict["directory_to_add"])
    if cli_dict.get("found_executable_path"):
        verified_paths.add(cli_dict["found_executable_path"])
    if cli_dict.get("executable_path"):
        verified_paths.add(cli_dict["executable_path"])

    context_blob = json.dumps(
        {
            "verified_system": sys_ctx.model_dump(),
            "local_cli_probe": cli_dict,
        },
        indent=2,
    )

    # 2. Gemini grounded reasoning (temperature=0.0) with offline fallback
    ai_out = await asyncio.to_thread(
        _call_gemini_chat_sync,
        filtered.sanitized_text,
        req.history,
        context_blob,
    )
    if ai_out is None:
        ai_out = _offline_intent_fallback(
            filtered.sanitized_text,
            req.folder_path,
            cli_dict,
            req.history,
        )
        notes.append("Deterministic offline engine active")

    # 3. Deterministic Anti-Hallucination Audit (offloaded so live winget never blocks the event loop)
    grounding = await asyncio.to_thread(
        verify_ai_output,
        user_message=filtered.sanitized_text,
        confidence=ai_out.confidence,
        grounded_evidence=ai_out.grounded_evidence,
        terminal_command=ai_out.terminal_command,
        package_id=ai_out.package_id,
        executable_path=ai_out.executable_path,
        verified_paths=verified_paths,
    )

    if grounding.verification_source == "live_winget":
        live_note = f"Verified live via Winget catalog ({grounding.canonical_package_id})"
        if grounding.publisher:
            live_note += f" · Publisher: {grounding.publisher}"
        if grounding.installer_sha256:
            live_note += f" · SHA-256: {grounding.installer_sha256[:12]}..."
        notes.append(live_note)

    if not grounding.is_grounded:
        return ChatbotResponse(
            intent=ai_out.intent,
            needs_clarification=True,
            reply=(
                "I do not have enough verified details from your system to suggest a safe command yet. "
                "Paste the exact error output or full file/folder path so I can verify it first."
            ),
            quick_replies=[
                "Paste full terminal error",
                "Attach broken project folder",
                "Check installed tools",
            ],
            action=ProposedAction(
                kind="none",
                label="Unverified Suggestion Withheld",
                command=None,
                safety_status="INFO_ONLY",
                safety_notes=[*notes, *grounding.violations],
            ),
        )

    # 4. Deterministic Command Safety Filter
    proposed_action: ProposedAction | None = None
    if ai_out.terminal_command or ai_out.action_kind != "none":
        cmd = ai_out.terminal_command
        if cmd:
            safety = check_command_safety(cmd)
            if not safety.allowed:
                return ChatbotResponse(
                    intent=ai_out.intent,
                    needs_clarification=False,
                    reply=f"{ai_out.reply}\n\nNote: SilentFix blocked an unsafe command automatically ({safety.reason}).",
                    quick_replies=["Suggest a safer alternative"],
                    action=ProposedAction(
                        kind="none",
                        label="Blocked Unsafe Command",
                        command=None,
                        safety_status="BLOCKED_UNSAFE",
                        safety_notes=[*notes, safety.reason],
                    ),
                )
            notes.append("Verified grounded & safe")

        proposed_action = ProposedAction(
            kind=ai_out.action_kind,
            label=ai_out.action_label or "Run Verified Action",
            command=cmd,
            package_id=grounding.canonical_package_id or ai_out.package_id,
            folder_path=req.folder_path if ai_out.action_kind == "repair_folder" else None,
            executable_path=ai_out.executable_path,
            safety_status="VERIFIED_SAFE" if cmd else "INFO_ONLY",
            safety_notes=notes,
        )

    return ChatbotResponse(
        intent=ai_out.intent,
        needs_clarification=ai_out.needs_clarification,
        reply=ai_out.reply,
        quick_replies=ai_out.quick_replies[:3],
        action=proposed_action,
    )
