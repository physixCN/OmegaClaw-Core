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

ensure_brew_shellenv() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

while ! command -v xcode-select >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; do
  echo "Apple Command Line Tools are not installed yet."
  echo
  echo "macOS is about to open Apple's installer dialog. Finish that install first."
  echo "When it completes, return to this window and press Return to continue."
  echo
  xcode-select --install || true
  printf "Press Return after Apple Command Line Tools finishes, or type q to quit: "
  read _answer || true
  case "${_answer:-}" in
    q|Q|quit|QUIT)
      pause_before_exit
      exit 1
      ;;
  esac
done

if ! command -v brew >/dev/null 2>&1; then
  ensure_brew_shellenv
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed. Installing Homebrew now."
  echo "Homebrew is used to install SWI-Prolog, Python, Git, Node, and build tools."
  echo
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ensure_brew_shellenv
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew installation finished but brew is still not on PATH."
  echo "Open a new Terminal window and re-run this installer."
  pause_before_exit
  exit 1
fi

echo "Installing/updating system packages with Homebrew..."
brew update
for package in git python@3.11 swi-prolog node cmake pkg-config openblas; do
  if brew list "$package" >/dev/null 2>&1; then
    echo "$package already installed."
  else
    brew install "$package"
  fi
done

PYTHON_BIN=$(command -v python3.11 || command -v python3)
exec "$PYTHON_BIN" "$CORE_DIR/install/installer_common.py" --workspace "$HOME/OmegaClaw"
