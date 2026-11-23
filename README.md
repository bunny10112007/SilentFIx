# SilentFix Codebase Architecture & Blueprint (v2.0)

> **Deterministic Software Repair, Pre-Flight Trust Gate, AWS Audit Ledger, ElevenLabs Voice & AI Terminal Brain**
>
> `AGENTIC AI FOR EVERYONE` • `ZERO SHELL INJECTION` • `AWS + ELEVENLABS + GEMINI + WINGET` • `CLI HEALER` • `WIN 11 COMPAT ENGINE` • `CLOUD SANDBOX`

---

## 1. System Architecture & Resilience Guarantees

SilentFix resolves the core vulnerability of agentic AI system management: giving an unconstrained LLM direct access to system shells. Instead of executing LLM-generated scripts directly, SilentFix acts as a **deterministic privilege boundary**.

### Core Architectural Safety Invariant
The AI model (Gemini 3.5 Flash Lite) handles user intent translation, follow-up parameter gathering, and structured action planning. All system mutations—package querying, SHA-256 verification, DynamoDB sync, ElevenLabs TTS streaming, Git terminal configuration, and compatibility registry shims—are owned entirely by deterministic Python code with non-shell execution (`shell=False`).

| Layer / Pillar | Component File(s) | Primary Mechanism & Safety Guarantee |
|---|---|---|
| **Pillar 1: CLI Error Healer** | `app/probes/cli_healer.py`<br>`app/routes/healer.py` | 4-Stage System Probe (Active Process, System PATH, Common Binary Trees, Winget Catalog). Zero raw shell invocation; structured diagnosis payload; deterministic 1-click PATH update. |
| **Pillar 2: Win 11 Compat Engine** | `app/actions/compat_fixer.py`<br>`app/routes/compat.py` | Per-user registry layers in `HKCU\...\AppCompatFlags\Layers`. Binary SHA-256 untouched; digital signatures preserved; full 1-click undo token snapshot store. |
| **Pillar 3: AWS Cloud Sandbox** | `app/cloud/aws_sandbox.py`<br>`aws/buildspec-sandbox.yml`<br>`app/routes/sandbox.py` | AWS CodeBuild container dry-run execution with boto3 session discovery. Automatic offline dry-run simulation when AWS credentials or projects are unconfigured. |
| **Pre-Flight Trust Gate** | `app/probes/software_probe.py`<br>`app/routes/install_stream.py` | Enforces HTTPS sources, validates SHA-256 manifest hashes, and issues single-use 5-minute `probe_tokens`. Returns 403 Forbidden if bypassed. |
| **Screen Privacy Guard** | `app/security/screen_guard.py`<br>`app/routes/screen.py` | Captures screen in memory using RapidOCR, applies 16px Gaussian blurs to PII, strips hidden prompt injection rules, and enforces `tier3_guided_only` limits. |
| **State & Cloud Ledger** | `app/state/db.py`<br>`app/cloud/aws_sync.py` | Combines local WAL SQLite with background off-thread AWS DynamoDB audit replication and S3 PII-redacted inspection archiving. |
| **Voice Accessibility** | `app/routes/voice.py`<br>`frontend/src/hooks/useVoiceGuide.ts` | ElevenLabs TTS engine streaming plain-English safety verdicts, UAC prompts, and scam-popup alerts for non-technical or impaired users. |
| **AI Brain & Safe Execution** | `app/ai/brain.py`<br>`app/actions/git_configurator.py`<br>`app/routes/brain.py` | Gemini-powered structured output brain that queries missing setup questions and issues single-use execution tokens for safe `shell=False` terminal tasks. |
| **Crash Recovery Sweep** | `app/core/recovery.py`<br>`app/main.py` | Sweeps SQLite on startup during FastAPI lifespan initialization to safely reconcile power outages or interrupted installer states. |

---

## 2. Directory Structure

```text
SILENTFIX/
├── .env.example                     # Environment template (AWS, ElevenLabs, Gemini)
├── .gitignore                       # Standard ignore rules (.venv, .env, *.db*, etc.)
├── pytest.ini                       # Pytest asyncio configuration
├── requirements.txt                 # Backend dependencies
├── README.md                        # Architecture & quickstart documentation
├── .github/workflows/ci.yml         # CI status checks (pytest-suite & build)
├── aws/
│   └── buildspec-sandbox.yml        # AWS CodeBuild container pre-test specification
├── app/
│   ├── main.py                      # FastAPI entry point, lifespan crash sweep, router mounting
│   ├── actions/
│   │   ├── compat_fixer.py          # Pillar 2: Windows 11 AppCompatFlags registry shim engine
│   │   ├── git_configurator.py      # Non-shell git terminal executor (shell=False)
│   │   └── winget_streamer.py       # Non-shell winget execution & UAC watchdog
│   ├── ai/
│   │   └── brain.py                 # Gemini BrainDecision structured intent engine
│   ├── cloud/
│   │   ├── aws_sandbox.py           # Pillar 3: CodeBuild container dry-run & offline simulation
│   │   └── aws_sync.py              # Off-thread DynamoDB & S3 redacted sync
│   ├── core/
│   │   └── recovery.py              # Startup crash recovery reconciliation
│   ├── probes/
│   │   ├── cli_healer.py            # Pillar 1: 4-Stage terminal command error probe
│   │   └── software_probe.py        # HTTPS enforcement, SHA-256 validation & token gate
│   ├── routes/
│   │   ├── brain.py                 # Brain decision & execution APIs
│   │   ├── compat.py                # Pillar 2: /api/compat (apply, undo)
│   │   ├── healer.py                # Pillar 1: /api/healer (diagnose)
│   │   ├── install_stream.py        # Pre-flight probe, SSE stream, atomic rollback
│   │   ├── recovery.py              # Crash recovery pending & resolve APIs
│   │   ├── sandbox.py               # Pillar 3: /api/sandbox (pretest, runs)
│   │   ├── screen.py                # In-memory screen guard APIs
│   │   └── voice.py                 # ElevenLabs low-latency voice proxy
│   ├── security/
│   │   └── screen_guard.py          # RapidOCR PII Gaussian blur & injection guard
│   └── state/
│       └── db.py                    # SQLite WAL ledger & atomic CAS rollback lock
├── frontend/
│   ├── package.json                 # React 18, Vite, Tailwind CSS, Lucide icons
│   ├── vite.config.ts               # Vite configuration with API proxy
│   ├── dist/                        # Production assets (served by FastAPI)
│   └── src/
│       ├── App.tsx                  # Unified architecture & resilience dashboard
│       ├── components/
│       │   ├── AwsSandboxSection.tsx# Pillar 3 UI: CodeBuild pre-test container runner
│       │   ├── CliHealerSection.tsx # Pillar 1 UI: 4-Stage command error diagnosis & 1-click PATH
│       │   ├── CloudLedgerSection.tsx
│       │   ├── GeminiBrainSection.tsx
│       │   ├── InstallStreamSection.tsx
│       │   ├── RecoveryBanner.tsx
│       │   ├── ScreenGuardSection.tsx
│       │   ├── TrustGateSection.tsx
│       │   ├── VoiceGuidePlayer.tsx
│       │   └── Win11CompatSection.tsx # Pillar 2 UI: AppCompatFlags shims & 1-click undo
│       └── hooks/
│           ├── useInstallStream.ts  # Named-event SSE hook & replay deduplication
│           └── useVoiceGuide.ts     # HTML5 client audio queue & proxy consumer
└── tests/
    ├── test_aws_sandbox.py          # Pillar 3: CodeBuild dispatch & offline simulation
    ├── test_cli_healer.py           # Pillar 1: Multi-shell parsing & 4-stage probe
    ├── test_compat_fixer.py         # Pillar 2: Layer string builder & undo snapshot store
    ├── test_crash_recovery.py       # Lifespan startup crash recovery tests
    ├── test_gemini_brain.py         # Structured output & non-shell execution tests
    ├── test_screen_guard.py         # In-memory PII blurring & injection tests
    ├── test_spa_security.py         # SPA security & route tests
    ├── test_sqlite_ledger.py        # WAL mode & 409 Conflict atomic CAS tests
    ├── test_trust_gate.py           # HTTPS enforcement & token gate 403 tests
    └── test_voice_and_cloud.py      # ElevenLabs 204 fallback & DynamoDB/S3 tests
```

---

## 3. Core Resilience Pillars

### Pillar 1: Terminal CLI Error Healer
- **Regex Multi-Shell Extraction**: Supports Windows CMD (`'x' is not recognized`), PowerShell (`The term 'x' is not recognized`), Bash (`bash: x: command not found`), and Zsh (`zsh: command not found: x`).
- **4-Stage Probe**:
  1. `ALREADY_IN_PATH`: Verifies if binary is present in active PATH.
  2. `FOUND_ON_DISK_NEEDS_PATH`: Scans standard locations (`Program Files`, `msys64`, `cygwin64`, `AppData`, `.cargo/bin`, `go/bin`). Emits deterministic `setx PATH` / `export PATH` commands.
  3. `AVAILABLE_VIA_WINGET`: Matches known CLI map (`git`, `node`, `docker`, `kubectl`, `terraform`, `aws`, `az`, `gh`, `cargo`, `jq`, `ffmpeg`, etc.) and provides non-interactive Winget commands.
  4. `NOT_FOUND`: Gracefully informs user when binary cannot be identified.

### Pillar 2: Windows 11 Compatibility Shim Engine
- **Non-Destructive Per-User Registry**: Applies shims to `HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers`.
- **Integrity Guarantee**: Executable binary bytes, SHA-256 hashes, and digital signatures remain **completely untouched**.
- **Supported Shims**: OS emulation (`WIN8RTM`, `WIN7RTM`, `VISTASP2`, `WINXPSP3`), High-DPI flags (`HIGHDPIAWARE`, `DPIUNAWARE`, `GDIDPISCALING`, `640X480`, `256COLOR`), and `RUNASADMIN`.
- **1-Click Undo Token Store**: On application, mints an unguessable 16-byte `undo_token`. Calling `/api/compat/undo` restores previous registry settings immediately and evicts the token.

### Pillar 3: AWS Cloud Pre-Test Sandbox
- **CodeBuild Container Dry-Run**: Dispatches uninstalled packages to isolated AWS CodeBuild Windows containers (`aws/buildspec-sandbox.yml`) to test silent unattended installs before touching user machines.
- **Offline Simulation Fallback**: When AWS credentials or CodeBuild projects are unconfigured, automatically executes deterministic offline pre-test simulations with `backend="offline_simulated"`.

---

## 4. Verification & Test Execution Suite (44/44 Passing)

All 44 automated tests across all 9 modules and 3 resilience pillars pass cleanly:

```text
============================= test session starts =============================
platform win32 -- Python 3.14.8, pytest-9.2.0, pluggy-1.7.0
plugins: anyio-4.15.1, asyncio-1.5.0
asyncio: mode=Mode.AUTO, asyncio_default_fixture_loop_scope=function

tests/test_aws_sandbox.py::test_cloud_pretest_offline_simulation PASSED
tests/test_aws_sandbox.py::test_cloud_pretest_request_validation PASSED
tests/test_aws_sandbox.py::test_sandbox_api_endpoints PASSED
tests/test_cli_healer.py::test_extract_missing_command_various_shells PASSED
tests/test_cli_healer.py::test_diagnose_terminal_error_winget_fallback PASSED
tests/test_cli_healer.py::test_diagnose_terminal_error_unknown_command PASSED
tests/test_cli_healer.py::test_healer_diagnoses_missing_git PASSED
tests/test_compat_fixer.py::test_build_layer_string PASSED
tests/test_compat_fixer.py::test_apply_shim_rejects_non_exe PASSED
tests/test_compat_fixer.py::test_apply_shim_rejects_non_existent_file PASSED
tests/test_compat_fixer.py::test_compat_api_apply_and_undo_flow PASSED
tests/test_crash_recovery.py::test_startup_crash_recovery_sweep_detects_interrupted_sessions PASSED
tests/test_crash_recovery.py::test_resolve_recovery_via_rollback PASSED
tests/test_crash_recovery.py::test_resolve_recovery_via_dismiss PASSED
tests/test_gemini_brain.py::test_missing_parameters_transitions_to_needs_info PASSED
tests/test_gemini_brain.py::test_complete_intent_resolves_and_mints_token PASSED
tests/test_gemini_brain.py::test_intent_prioritization_and_comma_separated_name PASSED
tests/test_gemini_brain.py::test_reject_insecure_intent PASSED
tests/test_gemini_brain.py::test_safe_non_shell_git_execution PASSED
tests/test_gemini_brain.py::test_name_extraction_supports_hyphens_and_accents PASSED
tests/test_gemini_brain.py::test_authorized_brain_execution_with_token PASSED
tests/test_screen_guard.py::test_detect_injections_catches_malicious_commands PASSED
tests/test_screen_guard.py::test_detect_pii_identifies_sensitive_entities PASSED
tests/test_screen_guard.py::test_process_screen_image_in_memory_applies_gaussian_blur PASSED
tests/test_screen_guard.py::test_sample_screen_inspection_generation PASSED
tests/test_screen_guard.py::test_process_screen_handles_inverted_coordinates PASSED
tests/test_spa_security.py::test_spa_directory_traversal_blocked PASSED
tests/test_spa_security.py::test_spa_does_not_swallow_api_404 PASSED
tests/test_sqlite_ledger.py::test_sqlite_wal_mode_configured PASSED
tests/test_sqlite_ledger.py::test_session_lifecycle_and_event_logging PASSED
tests/test_sqlite_ledger.py::test_atomic_rollback_lock_cas_and_409_conflict PASSED
tests/test_trust_gate.py::test_enforce_https_source_success PASSED
tests/test_trust_gate.py::test_enforce_https_source_rejects_http PASSED
tests/test_trust_gate.py::test_validate_sha256_string PASSED
tests/test_trust_gate.py::test_probe_token_issuance_and_single_use_eviction PASSED
tests/test_trust_gate.py::test_probe_token_blocks_package_substitution PASSED
tests/test_trust_gate.py::test_verify_package_manifest_known_catalog PASSED
tests/test_trust_gate.py::test_verify_package_manifest_rejects_catalog_hash_mismatch PASSED
tests/test_trust_gate.py::test_verify_package_manifest_requires_hash_for_unknown_package PASSED
tests/test_trust_gate.py::test_probe_token_blocks_source_substitution PASSED
tests/test_voice_and_cloud.py::test_elevenlabs_voice_returns_204_when_no_api_key PASSED
tests/test_voice_and_cloud.py::test_off_thread_dynamodb_fallback_without_cloud_credentials PASSED
tests/test_voice_and_cloud.py::test_privacy_preserving_s3_archive_telemetry PASSED
tests/test_voice_and_cloud.py::test_cloud_audit_endpoint_and_session_token PASSED

============================= 44 passed in 8.77s ==============================
```

---

## 5. Quickstart

To run the unified application (FastAPI serving APIs and the production React SPA):

```bash
# Start backend on localhost:8000
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
Navigate to `http://127.0.0.1:8000` to interact with the full SilentFix architecture and all resilience pillars.
