# Local-dev launcher: loads .env into the process environment and starts the
# ChangeProof server. Requires the dev containers (cp-dev-pg on 55432,
# cp-dev-mail on 1025) and a prior `pnpm build` + `pnpm build:ui`.
# Usage from the repo root:  ./scripts/dev-local.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  Write-Error 'Missing .env in the repo root; refusing to start half-wired.'
}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
  $name, $value = $line -split '=', 2
  if ($name -and $value -ne $null) {
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
  }
}
$server = Join-Path $root 'dist/http/start.js'
if (-not (Test-Path $server)) {
  Write-Error 'Missing dist/http/start.js; run `pnpm build` first.'
}
$evidence = [Environment]::GetEnvironmentVariable('CP_EVIDENCE_DIR', 'Process')
if ($evidence -and -not (Test-Path (Join-Path $root $evidence))) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $evidence) | Out-Null
}
Set-Location $root
node $server
