#!/usr/bin/env bash
#
# secular install script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/HahaAhhDev/secular/master/install.sh | bash
#   ./install.sh              Install for the current user (~/.local)
#   sudo ./install.sh         System-wide install (/usr/local)
#   SECULAR_VERSION=v1.3.0 ./install.sh   Pin a specific version
#
# Requires Node.js >= 18 — no npm auth, no git, no build needed.
# Downloads the prebuilt tarball from GitHub Releases. Falls back to a
# git clone + build if the release asset is unavailable.
#
# Windows: run from Git Bash / WSL. Or use npx directly (see README).

set -euo pipefail

REPO="HahaAhhDev/secular"
PREFIX="${PREFIX:-$HOME/.local}"
if [ "$(id -u)" -eq 0 ]; then
  PREFIX="/usr/local"
fi

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js >= 18 is required: https://nodejs.org"

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js >= 18 required, found $(node --version)"

# --- pick a download tool ---
DL=""
if command -v curl >/dev/null 2>&1; then DL="curl"
elif command -v wget >/dev/null 2>&1; then DL="wget"
else
  # No curl/wget — we will need git for the fallback path.
  command -v git >/dev/null 2>&1 || fail "either curl or wget is required (or git for source install)"
fi

fetch() { # fetch <url> <outfile>
  case "$DL" in
    curl) curl -fsSL "$1" -o "$2" ;;
    wget) wget -qO "$2" "$1" ;;
  esac
}

INSTALL_DIR="${SECULAR_INSTALL_DIR:-$PREFIX/lib/secular}"
BIN_DIR="$PREFIX/bin"
VERSION="${SECULAR_VERSION:-latest}"

mkdir -p "$BIN_DIR"

install_from_release() {
  say "Fetching latest release version"
  local tag url
  if [ "$VERSION" = "latest" ]; then
    tag="$(fetch "https://api.github.com/repos/$REPO/releases/latest" - |
      node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.tag_name||"")})')" || return 1
    [ -n "$tag" ] || return 1
  else
    tag="$VERSION"
  fi
  say "Downloading secular $tag"
  url="https://github.com/$REPO/releases/download/$tag/secular-$tag.tar.gz"
  local tmp; tmp="$(mktemp -d)"
  fetch "$url" "$tmp/secular.tar.gz" || { rm -rf "$tmp"; return 1; }
  tar -xzf "$tmp/secular.tar.gz" -C "$tmp" || { rm -rf "$tmp"; return 1; }
  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$tmp/secular-$tag" "$INSTALL_DIR"
  rm -rf "$tmp"
  RELEASE_TAG="$tag"
  return 0
}

install_from_source() {
  say "Release asset unavailable — falling back to git clone + build"
  command -v git >/dev/null 2>&1 || fail "git is required for source install: https://git-scm.com"
  if [ -d "$INSTALL_DIR/.git" ]; then
    say "Existing install found — updating"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  fi
  ( cd "$INSTALL_DIR" && npm install >/dev/null && npm run build >/dev/null && npm prune --omit=dev >/dev/null )
}

if ! install_from_release; then
  install_from_source
fi

# Symlink the CLI — use a real path (no $HOME inside) so it works for all users.
ln -sfn "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/secular"
chmod +x "$INSTALL_DIR/dist/cli.js"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "Note: $BIN_DIR is not on your PATH"
    say "Add it with:  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
    ;;
esac

say "Verifying..."
"$BIN_DIR/secular" --version

echo
say "Done. Try it out:"
echo "  secular scan /path/to/project"
