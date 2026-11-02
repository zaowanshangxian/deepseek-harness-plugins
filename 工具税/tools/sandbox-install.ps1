# Sandbox install: install local tarball into an isolated DSH_HOME sandbox profile.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox-install.ps1
param(
  [string]$SandboxHome = 'L:\work\.dsh-sandbox',
  [string]$Tarball = 'L:\work\.release\dsh-plugin-tool-tax-0.1.0.tgz'
)
$ErrorActionPreference = 'Stop'
$Exe = 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
$Cli = 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'

$env:DSH_HOME = $SandboxHome
$env:ELECTRON_RUN_AS_NODE = '1'
Write-Host "[sandbox-install] DSH_HOME=$SandboxHome"
Write-Host "[sandbox-install] add $Tarball"
$out = & $Exe --expose-internals $Cli plugin --profile sandbox add $Tarball 2>&1
$out | Select-Object -Last 12
if ($LASTEXITCODE -ne 0) { throw "plugin add failed (exit $LASTEXITCODE)" }

$pkgPath = Join-Path $SandboxHome 'profiles\sandbox\package.json'
$pkg = Get-Content -Raw -Encoding UTF8 $pkgPath | ConvertFrom-Json
$has = $pkg.dependencies.PSObject.Properties.Name -contains 'dsh-plugin-tool-tax'
Write-Host "[sandbox-install] dependency present: $has"
if (-not $has) { throw 'dependency missing after add' }

$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-plugin-tool-tax') {
  $pkg.dsh.profile.bundles = $bundles + 'dsh-plugin-tool-tax'
  $pkg | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $pkgPath
  Write-Host '[sandbox-install] bundle row appended'
}
Write-Host '[sandbox-install] done'
