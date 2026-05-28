# OmegaClaw Installers

These installers are for source installs from the public repository. They create
a local PeTTa workspace, install Python/runtime dependencies, ask what to name
the agent, enable default-on modules automatically, ask about optional modules,
ask for the primary communication channel and LLM provider, then save that
configuration so later starts do not ask again.

## macOS

Double-click:

```text
install/macos/Install OmegaClaw.command
```

The installer opens Apple's command-line tools installer if needed. It then
uses Homebrew when Homebrew is already available. If Homebrew is missing or
cannot install the required packages, the installer creates a user-local
micromamba toolchain under
`~/OmegaClaw/.micromamba` and installs `git`, `python=3.11`, `swi-prolog`,
`nodejs`, `cmake`, `pkg-config`, and `openblas` from conda-forge without sudo.

## Windows

Double-click:

```text
install/windows/Install OmegaClaw.cmd
```

OmegaClaw runs on Windows through Ubuntu on WSL. The installer enables/uses WSL,
installs Ubuntu packages, then lets the shared installer add selected module dependencies and creates the Linux workspace at `~/OmegaClaw`
inside WSL. If Windows asks for a reboot or asks you to create a Linux user,
finish that step and run the installer again.

## What Gets Written

The installer creates or updates:

- `~/OmegaClaw` as the PeTTa workspace.
- `~/OmegaClaw/repos/OmegaClaw-Core` from this public repository.
- `~/OmegaClaw/repos/petta_lib_chromadb`.
- `~/OmegaClaw/.venv` for Python packages.
- `~/OmegaClaw/.env` for local provider/channel secrets.
- `~/OmegaClaw/repos/OmegaClaw-Core/memory/prompt.txt` with the chosen agent name.
- `~/OmegaClaw/repos/OmegaClaw-Core/modules/loader.metta` for selected modules.
- `~/OmegaClaw/start-omegaclaw.sh` and a platform launcher.

Secrets are local runtime configuration. Do not commit `.env`.

## Module Selection

Module defaults come from each `modules/*/module.toml`:

- `default_enabled = true` modules are enabled automatically.
- `default_enabled = false` non-channel modules are offered as opt-in questions.
- The selected primary channel is enabled even when its module is normally
  optional.
- Other channel modules stay disabled unless enabled later, so WhatsApp is not
  assumed for users who choose Telegram, web control, mock, IRC, Slack, or
  Mattermost.

The result is a normal MeTTa module loader file, not hidden Python routing.
Selected module dependencies are installed during setup where the platform has
a supported package manager.

## Provider And Channel Choices

Provider setup asks for provider, model, and API key where needed. Channel setup
asks for one primary channel and then only that channel's auth material. The
agent-name step rewrites only the standalone default name `Omega`; `OmegaClaw`
remains the framework name. On later runs the generated launcher reads
`~/OmegaClaw/.env`; re-run the installer only when changing modules, channel,
provider, or agent name.
