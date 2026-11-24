# scripts/prep-demo.ps1
[CmdletBinding()]
param(
    [switch]$SkipSeed,
    [switch]$SkipBuild,
    [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $RepoRoot

Write-Host "[1/5] Stopping any stale SilentFix processes..."
if (Test-Path ".\scripts\stop-silentfix.ps1") {
    & .\scripts\stop-silentfix.ps1
}

Write-Host "[2/5] Checking .env configuration (keys masked)..."
$EnvFile = Join-Path $RepoRoot ".env"
if (Test-Path $EnvFile) {
    $EnvContent = Get-Content -LiteralPath $EnvFile -Raw
    foreach ($key in @("GEMINI_API_KEY", "ELEVENLABS_API_KEY", "AWS_ACCESS_KEY_ID", "SILENTFIX_CODEBUILD_PROJECT")) {
        $present = $EnvContent -match "(?m)^${key}=.+"
        $status = if ($present) { "CONFIGURED" } else { "OFFLINE FALLBACK" }
        Write-Host "  - ${key}: $status"
    }
} else {
    Write-Warning "No .env file found. SilentFix will run in local-only / offline fallback mode."
}

Write-Host "[3/5] Running full offline pytest suite..."
& uv run pytest -q
if ($LASTEXITCODE -ne 0) {
    throw "Pytest failed! Fix failing tests before going on stage."
}

if (-not $SkipBuild) {
    Write-Host "[4/5] Verifying frontend production build..."
    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        npm run build | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Vite build failed." }
    } finally {
        Pop-Location
    }
}

if (-not $SkipSeed) {
    Write-Host "[5/5] Seeding 1 simulated crash-recovery row in silentfix_state.db..."
    $SeedPy = @'
import sqlite3, json
from datetime import datetime, timezone

conn = sqlite3.connect("silentfix_state.db")
conn.execute("PRAGMA journal_mode=WAL;")
now = datetime.now(timezone.utc).isoformat()
conn.execute("""
    CREATE TABLE IF NOT EXISTS install_executions (
        exec_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        source TEXT NOT NULL,
        scope TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL,
        exit_code_hex TEXT,
        detail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
""")
conn.execute("DELETE FROM install_executions WHERE exec_id = 'exec_demo_crash'")
conn.execute(
    """
    INSERT INTO install_executions
    (exec_id, session_id, package_id, source, scope, snapshot_json, status, exit_code_hex, detail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    (
        "exec_demo_crash",
        "sess_demo_crash",
        "7zip.7zip",
        "winget",
        "user",
        json.dumps({"was_already_installed": False}),
        "EXECUTING",
        None,
        "Simulated power loss during installation for live recovery demo.",
        now,
        now,
    ),
)
conn.commit()
conn.close()
print("  Seeded exec_demo_crash (7zip.7zip -> EXECUTING).")
'@
    $SeedFile = Join-Path $env:TEMP "seed_demo_crash.py"
    Set-Content -LiteralPath $SeedFile -Value $SeedPy
    try {
        uv run python $SeedFile
    } finally {
        Remove-Item -LiteralPath $SeedFile -Force -ErrorAction SilentlyContinue
    }
}

if (-not $NoLaunch) {
    Write-Host "Launching SilentFix for live demo..."
    & .\scripts\start-silentfix.ps1
} else {
    Write-Host "SilentFix demo prep complete. Run .\scripts\start-silentfix.ps1 to start."
}
