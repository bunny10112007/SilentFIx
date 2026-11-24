# scripts/test-silentfix.ps1
[CmdletBinding()]
param(
    [switch]$VerboseOutput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $RepoRoot

Write-Host "Running SilentFix offline test suite with pytest..."
if ($VerboseOutput) {
    & uv run pytest -v
} else {
    & uv run pytest -q
}
if ($LASTEXITCODE -ne 0) {
    throw "Pytest failed with exit code $LASTEXITCODE."
}
Write-Host "All tests passed successfully."
