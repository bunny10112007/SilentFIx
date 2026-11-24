# scripts/start-silentfix.ps1
[CmdletBinding()]
param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$WithViteDev
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $RepoRoot

if ($WithViteDev) {
    Write-Host "Starting Vite frontend dev server in background..."
    Start-Process -FilePath "npm" -ArgumentList "run dev" -WorkingDirectory (Join-Path $RepoRoot "frontend") -WindowStyle Hidden
}

Write-Host "Starting SilentFix backend server at http://${HostAddress}:${Port} (no --reload on Windows for ProactorEventLoop)..."
if (-not $NoBrowser) {
    Start-Process "http://${HostAddress}:${Port}" -ErrorAction SilentlyContinue
}

# Launch FastAPI without --reload on Windows so ProactorEventLoop handles asyncio.create_subprocess_exec cleanly
python -m uvicorn app.main:app --host $HostAddress --port $Port
