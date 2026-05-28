#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CORE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

echo "OmegaClaw macOS installer"
echo "This installs source dependencies, asks for modules/channel/provider once,"
echo "and writes local configuration under ~/OmegaClaw."
echo

pause_before_exit() {
  echo
  printf "Press Return to close this window. "
  # Terminal.app may close command windows immediately after exit; keep the
  # explanation visible for double-click installs.
  read _answer || true
}

if ! command -v xcode-select >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple Command Line Tools are not installed yet."
  echo
  echo "macOS is about to open Apple's installer dialog. Finish that install first."
  echo "When it completes, run this OmegaClaw installer again and it will continue."
  echo
  xcode-select --install || true
  pause_before_exit
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for SWI-Prolog, Python, Git, and Node."
  echo "Install Homebrew from https://brew.sh/ and re-run this installer."
  pause_before_exit
  exit 1
fi

echo "Installing/updating system packages with Homebrew..."
brew install git python@3.11 swi-prolog node cmake pkg-config openblas || true

PYTHON_BIN=$(command -v python3.11 || command -v python3)
exec "$PYTHON_BIN" "$CORE_DIR/install/installer_common.py" --workspace "$HOME/OmegaClaw"
