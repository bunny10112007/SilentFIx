# SilentFix Codebase Architecture & Blueprint

> **Deterministic Software Repair, Pre-Flight Trust Gate, AWS Audit Ledger, ElevenLabs Voice & AI Terminal Brain**
>
> `AGENTIC AI FOR EVERYONE` • `ZERO SHELL INJECTION` • `AWS + ELEVENLABS + GEMINI + WINGET`

---

## 1. System Architecture & Invariants

SilentFix resolves the core vulnerability of agentic AI system management: giving an unconstrained LLM direct access to system shells. Instead of executing LLM-generated scripts directly, SilentFix acts as a **deterministic privilege boundary**.

### Core Architectural Safety Invariant
The AI model (Gemini 3.5 Flash Lite) handles user intent translation, follow-up parameter gathering, and structured action planning. All system mutations—package querying, SHA-256 verification, DynamoDB sync, ElevenLabs TTS streaming, and Git terminal configuration—are owned entirely by deterministic Python code with non-shell execution (`shell=False`).

| Layer | Component File(s) | Primary Responsibility & Security Function |
|---|---|---|
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
├── app/
│   ├── __init__.py
│   ├── main.py                      # FastAPI entry point & lifespan crash sweep
│   ├── actions/
│   │   ├── __init__.py
│   │   ├── git_configurator.py      # Non-shell git terminal executor (shell=False)
│   │   └── winget_streamer.py       # Non-shell winget execution & UAC watchdog
│   ├── ai/
│   │   ├── __init__.py
│   │   └── brain.py                 # Gemini BrainDecision structured intent engine
│   ├── cloud/
│   │   ├── __init__.py
│   │   └── aws_sync.py              # Off-thread DynamoDB & S3 redacted sync
│   ├── core/
│   │   ├── __init__.py
│   │   └── recovery.py              # Startup crash recovery reconciliation
│   ├── probes/
│   │   ├── __init__.py
│   │   └── software_probe.py        # HTTPS enforcement, SHA-256 validation & token gate
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── brain.py                 # Brain decision & execution APIs
│   │   ├── install_stream.py        # Pre-flight probe, SSE stream, atomic rollback
│   │   ├── recovery.py              # Crash recovery pending & resolve APIs
│   │   ├── screen.py                # In-memory screen guard APIs
│   │   └── voice.py                 # ElevenLabs low-latency voice proxy
│   ├── security/
│   │   ├── __init__.py
│   │   └── screen_guard.py          # RapidOCR PII Gaussian blur & injection guard
│   └── state/
│       ├── __init__.py
│       └── db.py                    # SQLite WAL ledger & atomic CAS rollback lock
├── frontend/
│   ├── package.json                 # React 18, Vite, Tailwind CSS, Lucide icons
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── App.tsx                  # Complete single-page architecture dashboard
│       ├── index.css
│       ├── main.tsx
│       ├── components/
│       │   ├── CloudLedgerSection.tsx
│       │   ├── GeminiBrainSection.tsx
│       │   ├── InstallStreamSection.tsx
│       │   ├── RecoveryBanner.tsx
│       │   ├── ScreenGuardSection.tsx
│       │   ├── TrustGateSection.tsx
│       │   └── VoiceGuidePlayer.tsx
│       └── hooks/
│           ├── useInstallStream.ts  # Named-event SSE hook & replay deduplication
│           └── useVoiceGuide.ts     # HTML5 client audio queue & proxy consumer
└── tests/
    ├── __init__.py
    ├── test_crash_recovery.py       # Startup crash sweep tests
    ├── test_gemini_brain.py         # Structured output & non-shell execution tests
    ├── test_screen_guard.py         # In-memory PII blurring & injection tests
    ├── test_sqlite_ledger.py        # WAL mode & 409 Conflict atomic CAS tests
    ├── test_trust_gate.py           # HTTPS enforcement & token gate 403 tests
    └── test_voice_and_cloud.py      # ElevenLabs 204 fallback & DynamoDB/S3 tests
```

---

## 3. Core Security Invariants Verified

1. **Pre-Flight Trust Gate (`app/probes/software_probe.py`)**:
   - Rejects unencrypted HTTP sources with `400 Bad Request`.
   - Validates 64-character SHA-256 manifest hash.
   - Issues 18-byte URL-safe `probe_token` with 5-minute TTL.
   - Single-use eviction: token is consumed on initial execution; reuse or direct calls without a token return `403 Forbidden`.

2. **Atomic Rollback Compare-and-Swap (`app/state/db.py`)**:
   - Uses `BEGIN IMMEDIATE` transaction locking on SQLite WAL.
   - Concurrent rollback race conditions reject subsequent callers with `409 Conflict`.

3. **Safe Non-Shell Subprocess Execution (`app/actions/winget_streamer.py`, `app/actions/git_configurator.py`)**:
   - Subprocesses launched strictly with `shell=False` via `asyncio.create_subprocess_exec`.
   - Arguments passed as explicit lists; prevents command string injection attacks.

4. **Screen Privacy Guard (`app/security/screen_guard.py`)**:
   - Screen inspection executes entirely in RAM (zero disk writes of unredacted data).
   - Detects prompt injection signatures (`ignore previous instructions`, `powershell -enc`, etc.) and restricts execution to `tier3_guided_only`.
   - Applies 16px Gaussian blur directly onto image memory for emails, payment cards, and authentication tokens.

5. **Voice Accessibility & Graceful Fallback (`app/routes/voice.py`)**:
   - Streams speech using ElevenLabs `eleven_flash_v2_5`.
   - Returns clean HTTP `204 No Content` if `ELEVENLABS_API_KEY` is not provided, maintaining silent UI execution.

6. **Off-Thread Cloud Audit Replication (`app/cloud/aws_sync.py`)**:
   - Offloads DynamoDB and S3 replication to worker threads (`asyncio.to_thread`), preventing network jitter from blocking the local async event loop.

---

## 4. Running the System

### Prerequisites
- Python 3.10+ (tested on Python 3.14)
- Node.js 18+ and npm

### Backend Setup
```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend Setup
```bash
cd frontend
npm install
npm run build
```
When built, FastAPI automatically serves the SPA at `http://127.0.0.1:8000/`.
For interactive live frontend development with hot-reloading:
```bash
npm run dev
# Open http://localhost:5173
```

### Running Test Suite
```bash
pytest -v
```
All 23 automated security and architecture invariant tests execute and pass in under 5 seconds.
