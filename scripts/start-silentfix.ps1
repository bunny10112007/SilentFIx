# scripts/start-silentfix.ps1
[CmdletBinding()]
param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $RepoRoot

Write-Host "Starting SilentFix backend server at http://${HostAddress}:${Port}..."
if (-not $NoBrowser) {
    Start-Process "http://${HostAddress}:${Port}" -ErrorAction SilentlyContinue
}

python -m uvicorn app.main:app --host $HostAddress --port $Port --reload
