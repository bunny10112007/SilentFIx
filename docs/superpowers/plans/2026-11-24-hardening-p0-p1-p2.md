# SilentFix Hardening Implementation Plan (P0, P1, P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
This plan addresses the three prioritized tiers of reliability and security hardening for SilentFix:
- **P0: Deployment & Trust-Boundary Fixes**:
  - #2 In-Memory Token Volatility (move to SQLite `ephemeral_tokens` table with atomic single-use consume)
  - #3 Catalog Drift & SHA-256 Staleness (allowlist + live winget manifest querying & SQLite cache)
  - #10 AWS Sandbox Default Dry-Run (`UNVERIFIED_SIMULATED` verdict, `SILENTFIX_STRICT_SANDBOX` 503 fail-closed mode, UI warning badge)
- **P1: Windows Runtime & Security Hardening**:
  - #4 UAC Watchdog False Positives (phase-aware status, `consent.exe` inspection, `DOWNLOAD_IN_PROGRESS`, `INSTALLER_SLOW`)
  - #5 Windows Installer Mutex (MSI lock probe on `Global\\_MSIExecute`, exit code 1618 backoff & retry)
  - #1 OS Lock-In & Registry Permissions (`/api/system/capabilities`, `PackageManagerRunner` protocol, `[WinError 5]` .reg fallback)
  - #8 RapidOCR & Injection Guard Bypasses (frame 2x upscaling + CLAHE, Unicode NFKC + zero-width strip + leetspeak normalization, `<untrusted_screen_text>`)
- **P2: Cleanup, Localization & Brain Expansion**:
  - #6 Uninstaller Artifacts (environment snapshot + restore, opt-in orphan folder UI cleanup)
  - #7 Non-English Windows Shell Errors (locale-independent exception tokens, reality checking)
  - #9 AI Brain Scope (discriminated union `ActionPlan`, 2-stage offline intent parser, optional local LLM endpoint)

---

## Task 1: P0 Regression Tests (tests/test_audit_regressions.py)
- [x] Create `tests/test_audit_regressions.py` with failing tests for:
  - Ephemeral tokens persisting across simulated DB connection restarts & atomic `consume_token`.
  - Package manifest validation accepting dynamic live winget manifest and HTTPS domain allowlist.
  - AWS sandbox returning `UNVERIFIED_SIMULATED` when unconfigured and raising 503 when `SILENTFIX_STRICT_SANDBOX=true`.
  - Zero-width Unicode prompt injection detection in screen guard.
- [x] Run pytest to verify the tests fail (RED).

## Task 2: P0 - In-Memory Token Volatility (#2)
- [x] Add `ephemeral_tokens` schema and indices to `app/state/db.py`.
- [x] Implement `store_ephemeral_token`, `consume_token`, and `prune_expired_tokens` in `app/state/db.py`.
- [x] Add `prune_expired_tokens` call to `app/main.py` lifespan startup sweep.
- [x] Update `app/probes/software_probe.py` to use `ephemeral_tokens` for `probe_tokens`.
- [x] Update `app/ai/brain.py` to use `ephemeral_tokens` for execution tokens.
- [x] Update `app/actions/compat_fixer.py` to use `ephemeral_tokens` for undo snapshots.

## Task 3: P0 - Dynamic Manifest Verification (#3)
- [x] Refactor `VERIFIED_PACKAGE_CATALOG` in `app/probes/software_probe.py` to allowlist trusted publisher domain prefixes.
- [x] Add `manifest_cache` table to `app/state/db.py`.
- [x] Implement live dynamic manifest lookup via `winget show --id <pkg> --exact` (with 6h SQLite cache).
- [x] Verify installer URL matches allowlist before issuing `probe_token`.

## Task 4: P0 - AWS Sandbox Unverified Simulated & Fail-Closed Mode (#10)
- [x] Update `SandboxVerdict` in `app/cloud/aws_sandbox.py` to include `UNVERIFIED_SIMULATED`.
- [x] Return `UNVERIFIED_SIMULATED` when `SILENTFIX_CODEBUILD_PROJECT` or AWS credentials are unset.
- [x] Support `SILENTFIX_STRICT_SANDBOX=true` in `app/routes/sandbox.py` to raise 503 Service Unavailable.
- [x] Update `AwsSandboxSection.tsx` to display amber warning badge `Simulated — No Container Executed`.

## Task 5: P0 Verification
- [x] Run `.\.venv\Scripts\python.exe -m pytest -v` to confirm all existing tests + regression tests pass.
- [x] Run `npm --prefix frontend run build` to confirm frontend builds cleanly.

---

## Task 6: P1 - Runtime Capabilities & Registry Permissions (#1)
- [x] Add `GET /api/system/capabilities` in `app/main.py`.
- [x] Wrap package management in `@runtime_checkable` `PackageManagerRunner` protocol and `WingetRunner` in `app/actions/winget_streamer.py`.
- [x] Implement `generate_reg_file_snippet` in `app/actions/compat_fixer.py` and catch `PermissionError` to return `.reg` file content fallback.

## Task 7: P1 - UAC Phase Detection & MSI Mutex Retry (#4, #5)
- [x] Add `is_msi_mutex_locked()` probe for `Global\_MSIExecute` in `app/actions/winget_streamer.py`.
- [x] Add `is_uac_consent_active()` process inspector in `app/actions/winget_streamer.py`.
- [x] Make watchdog phase-aware: suppress UAC during `DOWNLOADING` (emit `DOWNLOAD_IN_PROGRESS`), check `consent.exe` during install (emit `INSTALLER_SLOW` if absent).
- [x] Handle exit code 1618 with `WAITING_OS_INSTALLER` event.

## Task 8: P1 - RapidOCR & Injection Guard Defense (#8)
- [x] Implement `LEETSPEAK_TABLE` and leetspeak translation in `sanitize_text_for_scan`.
- [x] Implement `wrap_untrusted_screen_text` wrapping sanitized OCR output in `<untrusted_screen_text>`.
- [x] Implement `preprocess_frame_for_ocr` upscaling frames <1280px 2x via bicubic resampling in memory.
- [x] Expand PII blur bounding boxes by 10px on each side to prevent character bleed.

## Task 9: P1 Verification
- [x] Run `.\.venv\Scripts\python.exe -m pytest -v` (54/54 passed).
- [x] Run `npm --prefix frontend run build` (passed 0 errors).

---

## Task 10: P2 - Non-Standard Uninstaller Artifacts (#6)
- [x] Create `app/actions/winget_rollback.py` with `capture_user_env_snapshot`, `diff_env_snapshots`, and `restore_user_path_delta`.
- [x] Wire pre-install snapshotting into `app/routes/install_stream.py`.

## Task 11: P2 - Non-English Windows Shell Errors (#7)
- [x] Decouple command extraction from English phrasing with localized stopwords in `app/probes/cli_healer.py`.
- [x] Support PowerShell colon-prefix format, ObjectNotFound exception parsing, and guillemet/curly quotes.

## Task 12: P2 - AI Brain Discriminated Union & 2-Stage Offline Parser (#9)
- [x] Implement tagged discriminated union `ActionPlan` in `app/ai/brain.py` covering `GitConfigPlan`, `WingetInstallPlan`, `CliHealPlan`, `CompatShimPlan`, `NeedsInfoPlan`, and `RejectPlan`.
- [x] Implement `parse_offline_action_plan` lightweight two-stage parser (intent classification + targeted entity extraction).

## Task 13: Full Verification (P0 + P1 + P2)
- [x] Run `.\.venv\Scripts\python.exe -m pytest -v` (57/57 passed).
- [x] Run `npm --prefix frontend run build` (passed 0 errors).
