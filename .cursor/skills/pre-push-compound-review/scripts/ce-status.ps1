# Reports whether Compound Engineering is enabled for this workspace.
# Exit 0 = enabled; exit 1 = disabled or settings missing.
$ErrorActionPreference = 'Stop'
$root = (git rev-parse --show-toplevel 2>$null)
if (-not $root) { $root = (Get-Location).Path }
$settingsPath = Join-Path $root '.cursor/settings.json'
if (-not (Test-Path $settingsPath)) {
    Write-Output 'CE_STATUS=disabled'
    Write-Output 'CE_REASON=no .cursor/settings.json'
    exit 1
}
$json = Get-Content -Raw -Path $settingsPath | ConvertFrom-Json
$enabled = $false
if ($json.plugins -and $json.plugins.'compound-engineering') {
    $enabled = [bool]$json.plugins.'compound-engineering'.enabled
}
if ($enabled) {
    Write-Output 'CE_STATUS=enabled'
    Write-Output 'CE_SKILL=ce-code-review'
    Write-Output 'CE_INVOCATION=Read and follow ce-code-review skill with: mode:report-only base:origin/<tracking-branch>'
    exit 0
}
Write-Output 'CE_STATUS=disabled'
Write-Output 'CE_REASON=compound-engineering plugin not enabled in .cursor/settings.json'
exit 1
