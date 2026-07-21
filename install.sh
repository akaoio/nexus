#!/bin/sh
# Nexus one-line installer (the access lesson: GitHub is the source of truth,
# the install is a plain deployment, update/uninstall are CLI commands).
#
#   curl -fsSL https://raw.githubusercontent.com/akaoio/nexus/main/install.sh | sh
#
# GitHub first (git clone), tarball second (no git), npm never required.
# User-scoped: no sudo — a dev tool lives in $HOME, not in /usr.
set -e

REPO="https://github.com/akaoio/nexus"
DIR="${NEXUS_HOME:-$HOME/.nexus}"
BIN_DIR="${NEXUS_BIN:-$HOME/.local/bin}"

say() { printf "%s\n" "$*"; }

# ── the one real prerequisite: Node ≥ 22 (node:sqlite) ────────────────────────
if command -v node >/dev/null 2>&1; then
    major=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo 0)
    if [ "$major" -lt 22 ]; then
        say "! Node $major found — Nexus needs Node >= 22 (node:sqlite)."
        say "  Install from https://nodejs.org or your package manager, then re-run."
        exit 1
    fi
else
    say "! Node.js not found — Nexus needs Node >= 22."
    say "  Install from https://nodejs.org or your package manager, then re-run."
    exit 1
fi

# ── fetch the source: git first, tarball fallback ─────────────────────────────
if [ -d "$DIR/.git" ]; then
    # An install directory is a DEPLOYMENT, not a workspace — refreshing it is a
    # hard reset, and re-running this installer must stay idempotent because it
    # is documented as a `curl | sh` one-liner. But that contract is not a
    # licence to destroy work unexamined: if the tree is dirty, say what would
    # be lost and stop.
    #
    # Checked BEFORE the network call, so aborting costs nothing and leaves the
    # installation fully intact (the access lesson). An env var rather than a
    # prompt because a piped installer has no terminal — a safeguard that
    # cannot be answered in the documented invocation is not a safeguard.
    dirty=$(git -C "$DIR" status --porcelain 2>/dev/null || true)
    if [ -n "$dirty" ] && [ "${NEXUS_FORCE:-}" != "1" ]; then
        say "! $DIR has local changes that a refresh would discard:"
        printf "%s\n" "$dirty" | sed 's/^/    /'
        say ""
        say "  Re-run with NEXUS_FORCE=1 to refresh anyway:"
        say "      NEXUS_FORCE=1 sh install.sh"
        exit 1
    fi
    say "Nexus already at $DIR — refreshing to origin/main (the update path)."
    git -C "$DIR" fetch origin main
    git -C "$DIR" reset --hard origin/main
elif command -v git >/dev/null 2>&1; then
    say "Cloning $REPO -> $DIR"
    rm -rf "$DIR"
    git clone --depth 1 "$REPO" "$DIR"
else
    say "git not found — fetching the main tarball instead."
    rm -rf "$DIR"
    mkdir -p "$DIR"
    curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$DIR" --strip-components=1
fi

# ── the dispatcher shim ────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
{
    printf '#!/bin/sh\n'
    printf 'exec node "%s/bin/nexus.js" "$@"\n' "$DIR"
} > "$BIN_DIR/nexus"
chmod +x "$BIN_DIR/nexus"

# ── the install manifest ──────────────────────────────────────────────────────
# What this installer changed, so `nexus uninstall` can undo exactly that and
# nothing else (issue #8 answer 2). Guessing missed the shim whenever NEXUS_BIN
# was set, leaving a `nexus` on PATH pointing at a deleted tree. `units` and
# `cronMarkers` are reserved for the service step and stay empty here.
mkdir -p "$DIR/.state"
channel="tarball"
[ -d "$DIR/.git" ] && channel="git"
cat > "$DIR/.state/install.json" <<MANIFEST
{
  "manifestVersion": 1,
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "channel": "$channel",
  "home": "$DIR",
  "shims": ["$BIN_DIR/nexus"],
  "pathEntries": [],
  "units": [],
  "cronMarkers": []
}
MANIFEST

say ""
say "Nexus installed."
say "  source : $DIR"
say "  command: $BIN_DIR/nexus"
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say "  NOTE   : $BIN_DIR is not in PATH — add: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say ""
say "Next:  nexus create my-app && cd my-app && nexus dev"
say "Later: nexus update · nexus uninstall"
