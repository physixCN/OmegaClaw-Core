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

micromamba_platform() {
  case "$(uname -m)" in
    arm64) echo "osx-arm64" ;;
    x86_64) echo "osx-64" ;;
    *)
      echo "Unsupported macOS CPU architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

install_local_toolchain() {
  WORKSPACE="${OMEGACLAW_WORKSPACE:-$HOME/OmegaClaw}"
  BOOTSTRAP_DIR="$WORKSPACE/.bootstrap"
  MAMBA_ROOT="$WORKSPACE/.micromamba"
  MICROMAMBA="$BOOTSTRAP_DIR/bin/micromamba"
  ENV_PREFIX="$MAMBA_ROOT/envs/omegaclaw"
  PLATFORM=$(micromamba_platform)

  echo "Homebrew is not installed or not available on PATH."
  echo "Installing a user-local OmegaClaw toolchain instead."
  echo "No administrator password is required for this path."
  echo "Toolchain location: $ENV_PREFIX"
  echo

  mkdir -p "$BOOTSTRAP_DIR"
  if [ ! -x "$MICROMAMBA" ]; then
    echo "Downloading micromamba for $PLATFORM..."
    ARCHIVE="$BOOTSTRAP_DIR/micromamba.tar.bz2"
    curl -fL "https://micro.mamba.pm/api/micromamba/$PLATFORM/latest" -o "$ARCHIVE"
    tar -xvj -C "$BOOTSTRAP_DIR" -f "$ARCHIVE" bin/micromamba
  fi

  export MAMBA_ROOT_PREFIX="$MAMBA_ROOT"
  PACKAGES="python=3.11 swi-prolog nodejs git cmake pkg-config openblas"
  if [ -x "$ENV_PREFIX/bin/python" ]; then
    echo "Updating local OmegaClaw toolchain..."
    "$MICROMAMBA" install -y -n omegaclaw -c conda-forge $PACKAGES
  else
    echo "Creating local OmegaClaw toolchain..."
    "$MICROMAMBA" create -y -n omegaclaw -c conda-forge $PACKAGES
  fi

  export PATH="$ENV_PREFIX/bin:$PATH"
  exec "$ENV_PREFIX/bin/python" "$CORE_DIR/install/installer_common.py" --workspace "$WORKSPACE"
}

install_homebrew_toolchain() {
  echo "Installing/updating system packages with Homebrew..."
  brew update || return 1
  for package in git python@3.11 swi-prolog node cmake pkg-config openblas; do
    if brew list "$package" >/dev/null 2>&1; then
      echo "$package already installed."
    else
      brew install "$package" || return 1
    fi
  done

  PYTHON_BIN=$(command -v python3.11 || command -v python3)
  exec "$PYTHON_BIN" "$CORE_DIR/install/installer_common.py" --workspace "${OMEGACLAW_WORKSPACE:-$HOME/OmegaClaw}"
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

if command -v brew >/dev/null 2>&1; then
  if install_homebrew_toolchain; then
    exit 0
  fi
  echo "Homebrew could not install the required toolchain; falling back to local micromamba."
fi

install_local_toolchain
