$port = 8899
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

# Check if already running
$existing = Get-Process -Id (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Starting dev server on port $port ..."
    Start-Process -WindowStyle Hidden -FilePath $python -ArgumentList "-m http.server $port --directory `"$dir`""
    Start-Sleep 1
}
Write-Host "Opening browser..."
Start-Process "http://localhost:$port/index.html"
Write-Host "Preview: http://localhost:$port/index.html"
