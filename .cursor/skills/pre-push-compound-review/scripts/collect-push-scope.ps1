# Collect git state for pre-push Compound review (Windows PowerShell)
$ErrorActionPreference = "Stop"
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Output "ERROR: Not a git repository"
    exit 1
}
Set-Location $repoRoot

$branch = git branch --show-current
$tracking = ""
$trackLine = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
if ($trackLine) { $tracking = $trackLine }

Write-Output "=== PRE-PUSH SCOPE ==="
Write-Output "repo: $repoRoot"
Write-Output "branch: $branch"
Write-Output "tracking: $(if ($tracking) { $tracking } else { '(none)' })"
Write-Output ""

Write-Output "=== STATUS ==="
git status --short
Write-Output ""

Write-Output "=== STAGED DIFF STAT ==="
git diff --staged --stat 2>$null
Write-Output ""

Write-Output "=== UNSTAGED DIFF STAT ==="
git diff --stat 2>$null
Write-Output ""

if ($tracking) {
    $upstream = $tracking -replace '^[^/]+/', ''
    $remoteBranch = $tracking
    Write-Output "=== UNPUSHED COMMITS (${remoteBranch}..HEAD) ==="
    git log --oneline "${remoteBranch}..HEAD" 2>$null
    Write-Output ""
    Write-Output "=== DIFF STAT (${remoteBranch}..HEAD) ==="
    git diff --stat "${remoteBranch}..HEAD" 2>$null
} else {
    Write-Output "=== NO UPSTREAM - review staged + unstaged only ==="
}

Write-Output ""
Write-Output "=== SECRET / RISK FILE SCAN (staged + modified names) ==="
$names = @()
$names += (git diff --staged --name-only 2>$null)
$names += (git diff --name-only 2>$null)
$names = $names | Where-Object { $_ } | Select-Object -Unique
$risk = $names | Where-Object {
    $_ -match '\.env$|\.env\.|credentials|secret|service.role|backend_errors\.log|__pycache__|\.pyc$'
}
if ($risk) { $risk | ForEach-Object { Write-Output "RISK: $_" } } else { Write-Output "(no obvious risk filenames in diff)" }

Write-Output ""
Write-Output "=== END SCOPE ==="
