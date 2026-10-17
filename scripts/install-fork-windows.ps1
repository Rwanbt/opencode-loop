[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$ConfigPath = (Join-Path $HOME '.config\opencode\opencode.jsonc'),
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'OpenCode\custom-plugins\opencode-loop-rwanbt')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
if ($manifest.name -ne '@rwanbt/opencode-loop') { throw 'Expected Rwanbt fork package.' }
$path = $InstallDir.Replace('\','/')
$prior = [IO.File]::ReadAllText($ConfigPath)
$upstream = '@bybrawe/opencode-loop@0.6.8'
if ($prior.Contains($path)) { Write-Output 'Fork already registered; no changes.'; exit 0 }
if (!$prior.Contains($upstream)) { throw 'Expected upstream 0.6.8 registration missing; refusing ambiguous migration.' }
Write-Output "Fork version: $($manifest.version)"
Write-Output "Install directory: $InstallDir"
Write-Output "Configuration: $ConfigPath"
if (!$Apply) { Write-Output 'Preview only; re-run with -Apply to install.'; exit 0 }
$temporary = Join-Path $env:TEMP ('opencode-loop-fork-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $packed = (& npm pack $root --ignore-scripts --json --pack-destination $temporary | Out-String) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'npm pack failed' }
  $tarball = Join-Path $temporary $packed[0].filename
  if (!(Test-Path -LiteralPath $tarball)) { throw 'npm tarball missing' }
  if (Test-Path -LiteralPath (Join-Path $InstallDir 'node_modules\@rwanbt\opencode-loop')) {
    throw 'Existing fork installation detected. Upgrade separately after backup.'
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  & npm install --prefix $InstallDir --ignore-scripts --omit=dev --omit=peer --no-audit --no-fund $tarball
  if ($LASTEXITCODE -ne 0) { throw 'Fork package install failed; official config untouched.' }
  $hostManifest = @{ name='opencode-loop-rwanbt-local'; version=$manifest.version; private=$true; type='module'; main='./index.js'; exports=@{'.'='./index.js'} }
  [IO.File]::WriteAllText((Join-Path $InstallDir 'package.json'), ($hostManifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
  $shim = @"
// OpenCode 2 local package loader; original OpenCode binaries are unchanged.
export { default } from './node_modules/@rwanbt/opencode-loop/src/plugin.js'
export * from './node_modules/@rwanbt/opencode-loop/src/plugin.js'
"@
  [IO.File]::WriteAllText((Join-Path $InstallDir 'index.js'), $shim, (New-Object Text.UTF8Encoding($false)))
  $backup = $ConfigPath + '.pre-rwanbt-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'
  Copy-Item -LiteralPath $ConfigPath -Destination $backup
  if ((Get-FileHash $ConfigPath -Algorithm SHA256).Hash -ne (Get-FileHash $backup -Algorithm SHA256).Hash) { throw 'Backup verification failed' }
  try {
    [IO.File]::WriteAllText($ConfigPath, $prior.Replace($upstream, $path), (New-Object Text.UTF8Encoding($false)))
    & opencode reload | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'OpenCode reload failed' }
    $ready = $false
    for ($i = 0; $i -lt 6; $i++) {
      Start-Sleep -Seconds 2
      try {
        $catalog = (& opencode api GET /api/command | Out-String) | ConvertFrom-Json
        $names = @($catalog.data | ForEach-Object { $_.name })
        if ($names -contains 'daemon' -and $names -contains 'loop') { $ready = $true; break }
      } catch {}
    }
    if (!$ready) { throw 'Fork commands not visible in running OpenCode server' }
    Write-Output "Installed. Backup: $backup"
    Write-Output 'Use /daemon status and /daemon start in a project session.'
  } catch {
    Copy-Item -LiteralPath $backup -Destination $ConfigPath -Force
    & opencode reload | Out-Null
    throw "Activation failed; restored upstream config: $_"
  }
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }