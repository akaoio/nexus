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
API="https://api.github.com/repos/akaoio/nexus"
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
    # Resolve the branch to a COMMIT first, and download THAT commit's tarball.
    # Resolving `main` and then downloading `main` are two requests, and a push
    # between them yields a tree that is not the commit you resolved — so the
    # recorded SHA would be approximately true, which is worse than absent.
    #
    # This is NOT signature verification and does not pretend to be: TLS plus
    # GitHub's identity remains the trust root (issue #8 answer 8, ratified —
    # a home-grown signing scheme is key custody and rotation to maintain
    # forever, and a neglected one is worse than none because it looks like
    # protection). What it buys is that a tarball install becomes IDENTIFIABLE.
    commit=$(curl -fsSL -H "Accept: application/vnd.github.sha" "$API/commits/main" 2>/dev/null || true)
    case "$commit" in
        *[!0-9a-f]* | "") commit="" ;;   # anything that is not a plain sha is no sha
    esac
    if [ -n "$commit" ]; then
        url="$REPO/archive/$commit.tar.gz"
        say "  commit $commit"
    else
        # Degrade, do not abort (the access lesson): an unresolvable commit —
        # rate limit, offline mirror — is a reason to install an UNIDENTIFIED
        # tree and say so, not a reason to refuse to install at all.
        url="$REPO/archive/refs/heads/main.tar.gz"
        say "  could not resolve the commit — installing an unidentified tree"
    fi

    rm -rf "$DIR"
    mkdir -p "$DIR"
    # Downloaded to a FILE, not piped into tar. In POSIX sh a pipeline's status
    # is the LAST command's, so `set -e` cannot see a failing curl:
    #     sh -c 'set -e; false | true; echo $?'  →  0
    # A curl that writes a complete-looking stream and then fails therefore
    # leaves tar exiting 0 and the install proceeding on a download that did
    # not succeed. Checking curl's own status removes the ambiguity.
    tarball="$DIR/.nexus-download.tar.gz"
    if ! curl -fsSL "$url" -o "$tarball"; then
        say "! download failed ($url) — nothing was installed."
        rm -rf "$DIR"
        exit 1
    fi
    tar -xzf "$tarball" -C "$DIR" --strip-components=1
    rm -f "$tarball"
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
commit_json="null"
[ -n "${commit:-}" ] && commit_json="\"$commit\""
if [ -d "$DIR/.git" ]; then
    channel="git"
    head=$(git -C "$DIR" rev-parse HEAD 2>/dev/null || true)
    [ -n "$head" ] && commit_json="\"$head\""
fi
cat > "$DIR/.state/install.json" <<MANIFEST
{
  "manifestVersion": 1,
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "channel": "$channel",
  "commit": $commit_json,
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
