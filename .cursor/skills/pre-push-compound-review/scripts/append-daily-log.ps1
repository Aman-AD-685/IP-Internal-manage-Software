param(
    [Parameter(Mandatory = $true)]
    [string]$Section,
    [Parameter(Mandatory = $true)]
    [string]$Message
)

$ErrorActionPreference = "Stop"
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

$skillDir = ".cursor/skills/pre-push-compound-review/daily-journal"
$today = Get-Date -Format "yyyy-MM-dd"
$journalPath = Join-Path $skillDir "$today.md"
$templatePath = Join-Path $skillDir "_template.md"

if (-not (Test-Path $journalPath)) {
    if (Test-Path $templatePath) {
        $t = Get-Content $templatePath -Raw
        $t = $t -replace "YYYY-MM-DD", $today
        Set-Content $journalPath $t.TrimEnd()
    } else {
        Set-Content $journalPath "# Daily journal - $today"
    }
}

$lines = Get-Content $journalPath
$heading = "## $Section"
$bullet = "- $(Get-Date -Format 'HH:mm') $Message"
$idx = [array]::IndexOf($lines, $heading)

if ($idx -ge 0) {
    $insertAt = $idx + 1
    while ($insertAt -lt $lines.Count -and $lines[$insertAt] -notmatch '^## ') {
        $insertAt++
    }
    $before = $lines[0..($insertAt - 1)]
    $after = if ($insertAt -lt $lines.Count) { $lines[$insertAt..($lines.Count - 1)] } else { @() }
    $newLines = $before + $bullet + $after
} else {
    $newLines = $lines + "" + $heading + "" + $bullet
}

Set-Content $journalPath $newLines
Write-Output ("Appended to " + $journalPath + " section " + $Section)
