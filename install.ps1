# Nexus one-line installer for Windows (PowerShell):
#
#   irm https://raw.githubusercontent.com/akaoio/nexus/main/install.ps1 | iex
#
# GitHub first (git clone), zip fallback (no git). User-scoped, no admin.
$ErrorActionPreference = "Stop"

$Repo = "https://github.com/akaoio/nexus"
$Api = "https://api.github.com/repos/akaoio/nexus"
$Dir = if ($env:NEXUS_HOME) { $env:NEXUS_HOME } else { Join-Path $env:LOCALAPPDATA "nexus" }
$BinDir = Join-Path $Dir "shims"

# the one real prerequisite: Node >= 22 (node:sqlite)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "! Node.js not found - Nexus needs Node >= 22. Install from https://nodejs.org and re-run."
    exit 1
}
$major = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($major -lt 22) {
    Write-Host "! Node $major found - Nexus needs Node >= 22. Update Node and re-run."
    exit 1
}

# fetch the source: git first, zip fallback
$git = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $Dir ".git")) {
    Write-Host "Nexus already at $Dir - refreshing to origin/main."
    # Never destroy unexamined work — the same contract install.sh enforces.
    # An install directory is a deployment, not a workspace, but that is not a
    # licence to discard local edits silently. Checked BEFORE the network call
    # so aborting leaves the installation fully intact. An env var rather than a
    # prompt, because this is documented as an `irm … | iex` one-liner and a
    # prompt cannot be answered in that invocation.
    $dirty = (git -C $Dir status --porcelain) -join "`n"
    if ($dirty -and $env:NEXUS_FORCE -ne "1") {
        Write-Host "! $Dir has local changes that a refresh would discard:"
        $dirty -split "`n" | ForEach-Object { Write-Host "    $_" }
        Write-Host ""
        Write-Host "  Re-run with NEXUS_FORCE=1 to refresh anyway."
        exit 1
    }
    git -C $Dir fetch origin main
    git -C $Dir reset --hard origin/main
} elseif ($git) {
    Write-Host "Cloning $Repo -> $Dir"
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    git clone --depth 1 $Repo $Dir
} else {
    Write-Host "git not found - fetching the main zip instead."
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    # Resolve the branch to a COMMIT and download THAT commit, so the manifest
    # can say which tree this is (issue #8 answer 8). Resolving `main` and then
    # downloading `main` are two requests; a push between them yields a tree
    # that is not the commit recorded. Not signature verification, and not
    # claiming to be — TLS plus GitHub identity remains the trust root.
    #
    # Unlike install.sh, no pipeline hole to close here: Invoke-WebRequest
    # already writes to a file and $ErrorActionPreference = "Stop" aborts on
    # failure. The POSIX side had to stop piping curl into tar.
    $commit = $null
    try {
        $commit = (Invoke-WebRequest "$Api/commits/main" -Headers @{ Accept = "application/vnd.github.sha" } -UseBasicParsing).Content.Trim()
    } catch { $commit = $null }
    if ($commit -notmatch '^[0-9a-f]{7,40}$') { $commit = $null }

    $zip = Join-Path $env:TEMP "nexus-download.zip"
    if ($commit) {
        Write-Host "  commit $commit"
        Invoke-WebRequest "$Repo/archive/$commit.zip" -OutFile $zip
        $extracted = Join-Path $env:TEMP "nexus-$commit"
    } else {
        # Degrade, do not abort: an unresolvable commit installs an
        # UNIDENTIFIED tree and says so, rather than refusing to install.
        Write-Host "  could not resolve the commit - installing an unidentified tree"
        Invoke-WebRequest "$Repo/archive/refs/heads/main.zip" -OutFile $zip
        $extracted = Join-Path $env:TEMP "nexus-main"
    }
    Expand-Archive $zip -DestinationPath $env:TEMP -Force
    Move-Item $extracted $Dir
    Remove-Item $zip
}

# the dispatcher shim
New-Item -ItemType Directory -Force $BinDir | Out-Null
$shim = Join-Path $BinDir "nexus.cmd"
"@echo off`r`nnode `"$Dir\bin\nexus.js`" %*" | Out-File -FilePath $shim -Encoding ascii

# user PATH (append once)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$addedPath = $false
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$BinDir", "User")
    $addedPath = $true
    Write-Host "Added $BinDir to your user PATH (new terminals pick it up)."
}

# the install manifest — what this installer changed, so `nexus uninstall` can
# undo exactly that (issue #8 answer 2). Windows needs it most: the PATH entry
# appended above is the one thing uninstall could never find.
$state = Join-Path $Dir ".state"
New-Item -ItemType Directory -Force $state | Out-Null
$channel = if (Test-Path (Join-Path $Dir ".git")) { "git" } else { "zip" }
if ($channel -eq "git") { $commit = (git -C $Dir rev-parse HEAD) }
$manifest = [ordered]@{
    manifestVersion = 1
    installedAt     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    channel         = $channel
    commit          = $commit
    home            = $Dir
    shims           = @($shim)
    pathEntries     = $(if ($addedPath) { @($BinDir) } else { @() })
    units           = @()
    cronMarkers     = @()
}
$manifest | ConvertTo-Json | Out-File -FilePath (Join-Path $state "install.json") -Encoding utf8

Write-Host ""
Write-Host "Nexus installed."
Write-Host "  source : $Dir"
Write-Host "  command: $shim"
Write-Host ""
Write-Host "Next:  nexus create my-app; cd my-app; nexus dev"
Write-Host "Later: nexus update / nexus uninstall"
