#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CORE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

echo "OmegaClaw macOS installer"
echo "This installs source dependencies, asks for modules/channel/provider once,"
echo "and writes local configuration under ~/OmegaClaw."
echo

if ! command -v xcode-select >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; then
  echo "Installing Apple command line tools. Re-run this installer when that finishes."
  xcode-select --install || true
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for SWI-Prolog, Python, Git, and Node."
  echo "Install Homebrew from https://brew.sh/ and re-run this installer."
  exit 1
fi

echo "Installing/updating system packages with Homebrew..."
brew install git python@3.11 swi-prolog node cmake pkg-config openblas || true

PYTHON_BIN=$(command -v python3.11 || command -v python3)
exec "$PYTHON_BIN" "$CORE_DIR/install/installer_common.py" --workspace "$HOME/OmegaClaw"
