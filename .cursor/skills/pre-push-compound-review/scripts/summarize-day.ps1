# Git + repo activity summary for today's daily journal (Windows PowerShell)
$ErrorActionPreference = "SilentlyContinue"
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { Write-Output "ERROR: Not a git repository"; exit 1 }
Set-Location $repoRoot

$today = Get-Date -Format "yyyy-MM-dd"
$since = (Get-Date).Date.ToString("yyyy-MM-dd HH:mm:ss")

Write-Output "=== DAILY SUMMARY FOR JOURNAL ($today) ==="
Write-Output "journal_file: .cursor/skills/pre-push-compound-review/daily-journal/$today.md"
Write-Output ""

Write-Output "=== BRANCH ==="
git branch --show-current
Write-Output ""

Write-Output "=== COMMITS TODAY (all authors) ==="
git log --since="midnight" --oneline --no-walk=sorted 2>$null
git log --since="midnight" --oneline 2>$null
Write-Output ""

Write-Output "=== FILES CHANGED TODAY (committed) ==="
$commits = git log --since="midnight" --format="%H" 2>$null
if ($commits) {
    $files = @()
    foreach ($c in $commits) {
        $files += git diff-tree --no-commit-id --name-only -r $c 2>$null
    }
    $files | Where-Object { $_ } | Sort-Object -Unique | ForEach-Object { Write-Output $_ }
} else {
    Write-Output "(no commits yet today)"
}
Write-Output ""

Write-Output "=== CURRENT UNCOMMITTED ==="
git status --short
Write-Output ""

Write-Output "=== SUGGESTED JOURNAL BULLETS (paste under Git activity) ==="
$log = git log --since="midnight" --oneline 2>$null
if ($log) {
    $log | ForEach-Object { Write-Output "- $_" }
} else {
    Write-Output "- (no commits yet - describe work-in-progress manually)"
}
Write-Output ""
Write-Output "=== END ==="
