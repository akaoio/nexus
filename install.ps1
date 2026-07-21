# Nexus one-line installer for Windows (PowerShell):
#
#   irm https://raw.githubusercontent.com/akaoio/nexus/main/install.ps1 | iex
#
# GitHub first (git clone), zip fallback (no git). User-scoped, no admin.
$ErrorActionPreference = "Stop"

$Repo = "https://github.com/akaoio/nexus"
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
    git -C $Dir fetch origin main
    git -C $Dir reset --hard origin/main
} elseif ($git) {
    Write-Host "Cloning $Repo -> $Dir"
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    git clone --depth 1 $Repo $Dir
} else {
    Write-Host "git not found - fetching the main zip instead."
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    $zip = Join-Path $env:TEMP "nexus-main.zip"
    Invoke-WebRequest "$Repo/archive/refs/heads/main.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath $env:TEMP -Force
    Move-Item (Join-Path $env:TEMP "nexus-main") $Dir
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
$manifest = [ordered]@{
    manifestVersion = 1
    installedAt     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    channel         = $channel
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
