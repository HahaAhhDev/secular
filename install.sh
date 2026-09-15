#!/usr/bin/env bash
#
# secular install script
#
# Usage:
#   ./install.sh              Install for the current user (~/.local)
#   sudo ./install.sh         System-wide install (/usr/local)
#
# Requires Node.js >= 18. Clones the repo, builds it, and puts the `secular`
# command on your PATH.

set -euo pipefail

REPO="HahaAhhDev/secular"
PREFIX="${PREFIX:-$HOME/.local}"
if [ "$(id -u)" -eq 0 ]; then
  PREFIX="/usr/local"
fi

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required: https://git-scm.com"
command -v node >/dev/null 2>&1 || fail "Node.js >= 18 is required: https://nodejs.org"

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js >= 18 required, found $(node --version)"

INSTALL_DIR="${SECULAR_INSTALL_DIR:-$PREFIX/lib/secular}"
BIN_DIR="$PREFIX/bin"

say "Installing secular to $INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  say "Existing install found — updating"
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
fi

( cd "$INSTALL_DIR" && npm install >/dev/null && npm run build >/dev/null && npm prune --omit=dev >/dev/null )

mkdir -p "$BIN_DIR"
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
