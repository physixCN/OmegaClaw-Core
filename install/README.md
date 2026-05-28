# OmegaClaw Installers

These installers are for source installs from the public repository. They create
a local PeTTa workspace, install Python/runtime dependencies, ask which modules
to enable, ask for the primary communication channel and LLM provider, then save
that configuration so later starts do not ask again.

## macOS

Double-click:

```text
install/macos/Install OmegaClaw.command
```

Requirements:

- macOS command-line tools
- Homebrew

The installer uses Homebrew to install `git`, `python@3.11`, `swi-prolog`,
`node`, `cmake`, `pkg-config`, and `openblas`, then creates `~/OmegaClaw`.

## Windows

Double-click:

```text
install/windows/Install OmegaClaw.cmd
```

OmegaClaw runs on Windows through Ubuntu on WSL. The installer enables/uses WSL,
installs Ubuntu packages, then creates the Linux workspace at `~/OmegaClaw`
inside WSL. If Windows asks for a reboot or asks you to create a Linux user,
finish that step and run the installer again.

## What Gets Written

The installer creates or updates:

- `~/OmegaClaw` as the PeTTa workspace.
- `~/OmegaClaw/repos/OmegaClaw-Core` from this public repository.
- `~/OmegaClaw/repos/petta_lib_chromadb`.
- `~/OmegaClaw/.venv` for Python packages.
- `~/OmegaClaw/.env` for local provider/channel secrets.
- `~/OmegaClaw/repos/OmegaClaw-Core/modules/loader.metta` for selected modules.
- `~/OmegaClaw/start-omegaclaw.sh` and a platform launcher.

Secrets are local runtime configuration. Do not commit `.env`.

## Module Profiles

The installer offers:

- Minimal: selected channel, channel router, scratch space, web search.
- Recommended: minimal plus Assume, publishing, reminders, and senses.
- Full: all modules, including device and advanced modules.

After choosing a profile, each optional module can still be enabled or disabled.
The result is a normal MeTTa module loader file, not hidden Python routing.

## Provider And Channel Choices

Provider setup asks for provider, model, and API key where needed. Channel setup
asks for the selected channel's auth material. On later runs the generated
launcher reads `~/OmegaClaw/.env`; re-run the installer only when changing
modules, channel, or provider.
