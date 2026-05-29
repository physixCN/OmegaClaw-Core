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
  SWI_APP_DIR="$WORKSPACE/.local/SWI-Prolog.app"
  SWI_DMG="$BOOTSTRAP_DIR/swipl-stable-macos-fat.dmg"
  SWI_DMG_URL="https://www.swi-prolog.org/download/stable/bin/swipl-latest.fat.dmg"

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
  PACKAGES="python=3.11 nodejs>=20 git cmake pkg-config openblas"
  if [ -x "$ENV_PREFIX/bin/python" ]; then
    echo "Updating local OmegaClaw toolchain..."
    "$MICROMAMBA" install -y -n omegaclaw -c conda-forge $PACKAGES
  else
    echo "Creating local OmegaClaw toolchain..."
    "$MICROMAMBA" create -y -n omegaclaw -c conda-forge $PACKAGES
  fi

  install_swi_prolog_app "$WORKSPACE" "$ENV_PREFIX" "$BOOTSTRAP_DIR" "$SWI_APP_DIR" "$SWI_DMG" "$SWI_DMG_URL"

  export PATH="$ENV_PREFIX/bin:$PATH"
  verify_toolchain_versions "$ENV_PREFIX/bin/python"
  exec "$ENV_PREFIX/bin/python" "$CORE_DIR/install/installer_common.py" --workspace "$WORKSPACE"
}

install_swi_prolog_app() {
  WORKSPACE="$1"
  ENV_PREFIX="$2"
  BOOTSTRAP_DIR="$3"
  SWI_APP_DIR="$4"
  SWI_DMG="$5"
  SWI_DMG_URL="$6"
  SWIPL_WRAPPER="$ENV_PREFIX/bin/swipl"

  mkdir -p "$WORKSPACE/.local" "$ENV_PREFIX/bin"
  if [ ! -d "$SWI_APP_DIR" ]; then
    echo "Downloading official SWI-Prolog macOS bundle..."
    curl -fL "$SWI_DMG_URL" -o "$SWI_DMG"
    MOUNT_DIR="$BOOTSTRAP_DIR/swi-mount"
    rm -rf "$MOUNT_DIR"
    mkdir -p "$MOUNT_DIR"
    hdiutil attach "$SWI_DMG" -readonly -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null
    APP_SOURCE=$(find "$MOUNT_DIR" -maxdepth 2 -name "*.app" -type d | head -n 1)
    if [ -z "$APP_SOURCE" ]; then
      hdiutil detach "$MOUNT_DIR" >/dev/null || true
      echo "Could not find SWI-Prolog.app inside downloaded disk image." >&2
      exit 1
    fi
    rm -rf "$SWI_APP_DIR"
    cp -R "$APP_SOURCE" "$SWI_APP_DIR"
    hdiutil detach "$MOUNT_DIR" >/dev/null
  fi

  if [ ! -x "$SWI_APP_DIR/Contents/MacOS/swipl" ]; then
    echo "SWI-Prolog app bundle did not contain Contents/MacOS/swipl." >&2
    exit 1
  fi

  repair_swi_janus_linkage "$ENV_PREFIX" "$SWI_APP_DIR"

  cat > "$SWIPL_WRAPPER" <<EOF
#!/bin/sh
export DYLD_FALLBACK_LIBRARY_PATH="$ENV_PREFIX/lib\${DYLD_FALLBACK_LIBRARY_PATH:+:\$DYLD_FALLBACK_LIBRARY_PATH}"
export OMEGACLAW_PYTHON_EXECUTABLE="$WORKSPACE/.venv/bin/python"
export PYTHONPATH="$WORKSPACE/repos/OmegaClaw-Core/src:$WORKSPACE/.venv/lib/python3.11/site-packages:$ENV_PREFIX/lib/python3.11/site-packages\${PYTHONPATH:+:\$PYTHONPATH}"
exec "$SWI_APP_DIR/Contents/MacOS/swipl" "\$@"
EOF
  chmod +x "$SWIPL_WRAPPER"
}

repair_swi_janus_linkage() {
  ENV_PREFIX="$1"
  SWI_APP_DIR="$2"
  JANUS_PLUGIN="$SWI_APP_DIR/Contents/PlugIns/swipl/janus.so"
  PYTHON_DYLIB="$ENV_PREFIX/lib/libpython3.11.dylib"
  PYTHON_FRAMEWORK="/Library/Frameworks/Python.framework/Versions/3.11/Python"

  if [ ! -f "$JANUS_PLUGIN" ]; then
    echo "SWI-Prolog Janus plugin was not found: $JANUS_PLUGIN" >&2
    exit 1
  fi
  if [ ! -f "$PYTHON_DYLIB" ]; then
    echo "Local Python dylib was not found: $PYTHON_DYLIB" >&2
    exit 1
  fi

  if otool -L "$JANUS_PLUGIN" | grep -q "$PYTHON_FRAMEWORK"; then
    echo "Patching SWI-Prolog Janus to use local OmegaClaw Python..."
    install_name_tool -change "$PYTHON_FRAMEWORK" "$PYTHON_DYLIB" "$JANUS_PLUGIN"
  fi
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
  verify_toolchain_versions "$PYTHON_BIN" || return 1
  exec "$PYTHON_BIN" "$CORE_DIR/install/installer_common.py" --workspace "${OMEGACLAW_WORKSPACE:-$HOME/OmegaClaw}"
}

verify_toolchain_versions() {
  PYTHON_BIN="$1"
  "$PYTHON_BIN" - <<'PYVERIFY'
import re
import subprocess
import sys

errors = []

if sys.version_info[:2] != (3, 11):
    errors.append(f"Python must be 3.11.x, found {sys.version.split()[0]}")

checks = {
    "git": ["git", "--version"],
    "node": ["node", "--version"],
    "swipl": ["swipl", "--version"],
}
outputs = {}
for name, cmd in checks.items():
    try:
        outputs[name] = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()
    except Exception as exc:
        errors.append(f"{name} is not callable: {exc}")

node = outputs.get("node", "")
match = re.search(r"v(\d+)\.", node)
if not match or int(match.group(1)) < 20:
    errors.append(f"Node.js must be >=20.x, found {node or 'missing'}")

swipl = outputs.get("swipl", "")
match = re.search(r"version\s+(\d+)\.(\d+)", swipl, re.I)
if not match or (int(match.group(1)), int(match.group(2))) < (10, 0):
    errors.append(f"SWI-Prolog must be >=10.0, found {swipl or 'missing'}")

if errors:
    print("OmegaClaw toolchain verification failed:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    raise SystemExit(1)

print("OmegaClaw toolchain verified:")
print(f"  Python {sys.version.split()[0]}")
print(f"  {outputs['node']}")
print(f"  {outputs['git']}")
print(f"  {outputs['swipl']}")
PYVERIFY
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
