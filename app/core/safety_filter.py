# app/core/safety_filter.py
import re
from pydantic import BaseModel, ConfigDict

# Patterns blocked before any command can reach the UI or PowerShell runner
BLOCKED_COMMAND_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\brm\s+-[a-z]*r[a-z]*f\b", re.IGNORECASE), "Recursive force delete is blocked."),
    (re.compile(r"\bremove-item\b.*-recurse.*-force", re.IGNORECASE), "Recursive PowerShell deletion is blocked."),
    (re.compile(r"\bdel\s+/[sqf]", re.IGNORECASE), "Forced directory deletion is blocked."),
    (re.compile(r"\b(format-volume|diskpart|bcdedit|cipher\s+/w)\b", re.IGNORECASE), "Disk or boot modification is blocked."),
    (re.compile(r"\bsetx\s+path\b", re.IGNORECASE), "setx PATH is blocked due to the 1024-character Windows truncation bug."),
    (re.compile(r"(\|\s*(iex|invoke-expression|sh|bash|powershell))|\b(iex|invoke-expression)\s*\(", re.IGNORECASE), "Pipe-to-shell remote execution is blocked."),
    (re.compile(r"\bpowershell(\.exe)?\b.*-(e|enc|encodedcommand)\b", re.IGNORECASE), "Obfuscated encoded PowerShell commands are blocked."),
    (re.compile(r"\breg\s+delete\b", re.IGNORECASE), "Raw registry deletion is blocked."),
    (re.compile(r"\bnet\s+(user|localgroup)\b", re.IGNORECASE), "Account privilege modification is blocked."),
    (re.compile(r"\bgit\b.*(\s-c\s|--upload-pack|--exec-path|fsmonitor)", re.IGNORECASE), "Unsafe Git execution hook injection is blocked."),
]

PROMPT_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"reveal\s+(your\s+)?system\s+prompt", re.IGNORECASE),
    re.compile(r"bypass\s+(safety|security|trust\s*gate)", re.IGNORECASE),
]

PII_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY]"),
    (re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bsk_[A-Za-z0-9]{20,}\b"), "[REDACTED_SECRET_KEY]"),
]


class CommandSafetyResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    allowed: bool
    command: str
    reason: str


class PromptFilterResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    sanitized_text: str
    pii_redacted: bool
    injection_detected: bool


def sanitize_user_text(raw_text: str) -> PromptFilterResult:
    """Masks accidental API keys/secrets and flags prompt-injection patterns."""
    cleaned = raw_text
    pii_found = False
    for pattern, replacement in PII_PATTERNS:
        if pattern.search(cleaned):
            cleaned = pattern.sub(replacement, cleaned)
            pii_found = True

    injection = any(p.search(cleaned) for p in PROMPT_INJECTION_PATTERNS)
    return PromptFilterResult(
        sanitized_text=cleaned,
        pii_redacted=pii_found,
        injection_detected=injection,
    )


def check_command_safety(command: str) -> CommandSafetyResult:
    """Deterministic filter applied to both Gemini-generated and user-pasted commands."""
    cmd = command.strip()
    if not cmd:
        return CommandSafetyResult(allowed=False, command=cmd, reason="Empty command.")
    if "\n" in cmd or "\r" in cmd:
        return CommandSafetyResult(
            allowed=False,
            command=cmd,
            reason="Multi-line command injection is blocked. Run one command at a time.",
        )

    for pattern, reason in BLOCKED_COMMAND_PATTERNS:
        if pattern.search(cmd):
            return CommandSafetyResult(allowed=False, command=cmd, reason=reason)

    return CommandSafetyResult(allowed=True, command=cmd, reason="Passed deterministic safety filter.")
