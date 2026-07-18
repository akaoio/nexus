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
