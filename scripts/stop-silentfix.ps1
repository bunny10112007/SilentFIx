# scripts/stop-silentfix.ps1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping any running SilentFix backend and frontend instances..."

# Find processes listening on port 8000 (backend) or 5173 (Vite dev)
foreach ($port in @(8000, 5173)) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($p in $pids) {
            if ($p -and $p -ne 0) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                Write-Host "Terminated process on port $port (PID: $p)"
            }
        }
    }
}

# Stop any dangling processes running app.main:app
Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%app.main:app%'" -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "Terminated stale process (PID: $($_.ProcessId))"
}
