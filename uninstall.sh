#!/usr/bin/env bash
#
# secular uninstall script
#
# Usage:
#   ./uninstall.sh              Remove a user install (~/.local)
#   sudo ./uninstall.sh         Remove a system-wide install (/usr/local)

set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
if [ "$(id -u)" -eq 0 ]; then
  PREFIX="/usr/local"
fi

INSTALL_DIR="${SECULAR_INSTALL_DIR:-$PREFIX/lib/secular}"
BIN_DIR="$PREFIX/bin"

removed=0
if [ -L "$BIN_DIR/secular" ] || [ -f "$BIN_DIR/secular" ]; then
  rm -f "$BIN_DIR/secular"
  echo "removed $BIN_DIR/secular"
  removed=1
fi
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "removed $INSTALL_DIR"
  removed=1
fi

if [ "$removed" -eq 0 ]; then
  echo "secular not found at the default locations — nothing to do."
  echo "(If you installed elsewhere, set SECULAR_INSTALL_DIR and PREFIX.)"
fi

# Hint about npm-managed installs
if command -v npm >/dev/null 2>&1; then
  npm ls -g @hahaahhdev/secular >/dev/null 2>&1 && echo "A GitHub-Packages npm copy also exists. Remove it with: npm uninstall -g @hahaahhdev/secular"
  npm ls -g secular >/dev/null 2>&1 && echo "An npm copy also exists. Remove it with: npm uninstall -g secular"
fi
