# Start the isolated sandbox DSH host and print its URL.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox-run.ps1 [-KeepRunning]
param(
  [string]$SandboxHome = 'L:\DSH\work\.dsh-sandbox',
  [switch]$KeepRunning
)
$ErrorActionPreference = 'Stop'
$Exe = 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
$Cli = 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
$RealHome = Join-Path $env:USERPROFILE '.dsh'

# credentials (sandbox needs the account to boot the web app)
$cred = Join-Path $SandboxHome '.credentials.yaml'
if (-not (Test-Path $cred)) {
  Copy-Item (Join-Path $RealHome '.credentials.yaml') $cred -Force -ErrorAction SilentlyContinue
  Write-Host '[sandbox-run] credentials copied'
}

# kill old sandbox hosts only (never the real client)
Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" |
  Where-Object { $_.CommandLine -match '--profile\s+sandbox' } |
  ForEach-Object { Write-Host "[sandbox-run] stop old pid $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$outLog = Join-Path $SandboxHome 'boot.out.log'
$errLog = Join-Path $SandboxHome 'boot.err.log'
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$env:DSH_HOME = $SandboxHome
$env:ELECTRON_RUN_AS_NODE = '1'
$argline = '--expose-internals "' + $Cli + '" --profile sandbox --port 0 --no-open'
$proc = Start-Process -FilePath $Exe -ArgumentList $argline -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
Write-Host "[sandbox-run] host pid $($proc.Id)"

$url = $null
for ($i = 0; $i -lt 60; $i += 1) {
  Start-Sleep -Milliseconds 750
  if (Test-Path $outLog) {
    $text = Get-Content -Raw $outLog -ErrorAction SilentlyContinue
    if ($text) {
      $m = [regex]::Match([string]$text, 'http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9_-]+')
      if ($m.Success) { $url = $m.Value; break }
    }
  }
  if ($proc.HasExited) { Write-Host "[sandbox-run] host exited early: $($proc.ExitCode)"; break }
}
if (-not $url) {
  Write-Host '[sandbox-run] FAILED to get url'
  if (Test-Path $errLog) { Get-Content $errLog -Tail 30 }
  if (Test-Path $outLog) { Get-Content $outLog -Tail 30 }
  exit 1
}
Write-Host "[sandbox-run] URL=$url"
if (-not $KeepRunning) { Write-Host '[sandbox-run] host kept running; close it manually or run stop script' }
