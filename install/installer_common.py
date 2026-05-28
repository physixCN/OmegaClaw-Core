#!/usr/bin/env python3
"""Interactive OmegaClaw source installer.

This script is intentionally boring: it prepares files, dependencies, and local
configuration. It does not make cognitive choices for OmegaClaw. Module loading
remains visible in modules/loader.metta and runtime secrets stay in .env.
"""

from __future__ import annotations

import argparse
import getpass
import os
import pathlib
import re
import shutil
import subprocess
import sys
import textwrap
from dataclasses import dataclass


PUBLIC_CORE_URL = "https://github.com/physixCN/OmegaClaw-Core.git"
PETTA_URL = "https://github.com/trueagi-io/PeTTa.git"
CHROMA_URL = "https://github.com/patham9/petta_lib_chromadb.git"
FABRICPC_URL = "https://github.com/trueagi-io/FabricPC.git"

BASE_PIP = [
    "sentence-transformers",
    "chromadb",
    "janus-swi",
    "openai",
    "uagents",
    "requests",
    "websocket-client",
]

OPTIONAL_PIP = {
    "assume": ["jax", "optax"],
    "gameboy": ["pyboy", "pillow"],
}

FORCED_MODULES = {
    "channel_router",
    "scratch_space",
}

RECOMMENDED_MODULES = {
    "web_search",
    "assume",
    "publishing",
    "scheduler_reminders",
    "sense_router",
    "sense_vision",
    "sense_webcam",
    "sense_audio",
    "media_imagegen",
    "media_videogen",
}

ADVANCED_MODULES = {
    "agentverse",
    "body_container",
    "codex_code",
    "gameboy",
    "health_glucose",
    "home_assistant",
    "omega_vm",
    "vm_policy",
}

CHANNEL_MODULES = {
    "irc": "channel_irc",
    "telegram": "channel_telegram",
    "slack": "channel_slack",
    "mattermost": "channel_mattermost",
    "mock": "channel_mock",
    "whatsapp": "channel_whatsapp",
    "web_control": "channel_web_control",
}

PROVIDERS = {
    "1": ("OpenRouter", "OPENROUTER_API_KEY", "z-ai/glm-5.1"),
    "2": ("OpenAI", "OPENAI_API_KEY", "gpt-4.1"),
    "3": ("Anthropic", "ANTHROPIC_API_KEY", "claude-opus-4-6"),
    "4": ("ASICloud", "ASI_API_KEY", "minimax"),
    "5": ("ASIOne", "ASIONE_API_KEY", "asi1-mini"),
    "6": ("Ollama-local", "OLLAMA_API_KEY", "qwen3.5:9b"),
}


@dataclass(frozen=True)
class ModuleInfo:
    name: str
    module_id: str
    kind: str
    default_enabled: bool
    entrypoint: str
    requires: tuple[str, ...]


def run(cmd: list[str], cwd: pathlib.Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print("$ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=check)


def ask(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default is not None else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return default if value == "" and default is not None else value


def yes_no(prompt: str, default: bool = False) -> bool:
    default_label = "Y/n" if default else "y/N"
    while True:
        value = input(f"{prompt} [{default_label}]: ").strip().lower()
        if not value:
            return default
        if value in {"y", "yes"}:
            return True
        if value in {"n", "no"}:
            return False
        print("Please answer yes or no.")


def ask_agent_name() -> str:
    print("\nAgent identity")
    print("This names the running agent in the local prompt. The framework remains OmegaClaw.")
    while True:
        name = ask("Agent name", "Omega").strip()
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9 _'-]{0,39}", name):
            return " ".join(name.split())
        print("Use 1-40 characters: letters first, then letters/numbers/spaces/_/'/-.")


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Missing required command: {name}")


def clone_or_update(url: str, path: pathlib.Path) -> None:
    if path.exists():
        if (path / ".git").exists():
            run(["git", "pull", "--ff-only"], cwd=path)
            return
        if any(path.iterdir()):
            raise SystemExit(f"Refusing to overwrite non-git directory: {path}")
        path.rmdir()
    path.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", url, str(path)])


def restore_generated_repo_files(core: pathlib.Path) -> None:
    if not (core / ".git").exists():
        return
    for rel in ["memory/prompt.txt", "modules/loader.metta"]:
        run(["git", "restore", rel], cwd=core, check=False)


def parse_bool(text: str, key: str, default: bool) -> bool:
    match = re.search(rf"^{re.escape(key)}\s*=\s*(true|false)\s*$", text, re.M)
    return default if not match else match.group(1) == "true"


def parse_string(text: str, key: str, default: str) -> str:
    match = re.search(rf"^{re.escape(key)}\s*=\s*\"([^\"]*)\"\s*$", text, re.M)
    return default if not match else match.group(1)


def parse_requires(text: str) -> tuple[str, ...]:
    match = re.search(r"^requires\s*=\s*\[(.*?)\]", text, re.M | re.S)
    if not match:
        return ()
    return tuple(re.findall(r'"([^"]+)"', match.group(1)))


def discover_modules(core: pathlib.Path) -> dict[str, ModuleInfo]:
    modules: dict[str, ModuleInfo] = {}
    for module_file in sorted((core / "modules").glob("*/module.toml")):
        text = module_file.read_text(encoding="utf-8")
        name = module_file.parent.name
        modules[name] = ModuleInfo(
            name=name,
            module_id=parse_string(text, "id", name),
            kind=parse_string(text, "kind", "module"),
            default_enabled=parse_bool(text, "default_enabled", False),
            entrypoint=parse_string(text, "entrypoint", "entry.metta"),
            requires=parse_requires(text),
        )
    return modules


def choose_provider() -> dict[str, str]:
    print("\nLLM provider")
    for key, (provider, env_name, model) in PROVIDERS.items():
        print(f"  {key}) {provider} ({model})")
    while True:
        choice = ask("Choose provider", "1")
        if choice in PROVIDERS:
            break
        print("Choose 1-6.")
    provider, env_name, model = PROVIDERS[choice]
    model = ask("Model name", model)
    values = {
        "provider": provider,
        "LLM": model,
        "embeddingprovider": "OpenAI" if provider == "OpenAI" else "Local",
    }
    if provider == "Ollama-local":
        values["LLM_SERVER_LOCAL_URL"] = ask("Ollama URL", "http://localhost:11434")
        values[env_name] = os.environ.get(env_name, "ollama-local")
    else:
        existing = os.environ.get(env_name, "")
        token = getpass.getpass(f"{env_name} (leave empty to keep env-only): ").strip()
        if token:
            values[env_name] = token
        elif existing:
            values[env_name] = existing
    return values


def choose_channel() -> tuple[str, dict[str, str], set[str]]:
    print("\nPrimary channel")
    choices = ["irc", "telegram", "slack", "mattermost", "mock", "whatsapp", "web_control"]
    for index, name in enumerate(choices, 1):
        print(f"  {index}) {name}")
    while True:
        raw = ask("Choose primary channel", "1")
        if raw.isdigit() and 1 <= int(raw) <= len(choices):
            channel = choices[int(raw) - 1]
            break
        if raw in choices:
            channel = raw
            break
        print("Choose by number or name.")

    env: dict[str, str] = {"commchannel": channel}
    enabled = {CHANNEL_MODULES[channel]}
    if channel == "irc":
        env["IRC_channel"] = ask("IRC channel", "##omegaclaw")
    elif channel == "telegram":
        env["TG_BOT_TOKEN"] = getpass.getpass("Telegram bot token: ").strip()
        env["TG_CHAT_ID"] = ask("Telegram chat id; empty enables auto-bind", "")
        env["TG_POLL_TIMEOUT"] = ask("Telegram poll timeout", "20")
    elif channel == "slack":
        env["SL_BOT_TOKEN"] = getpass.getpass("Slack bot token: ").strip()
        env["SL_CHANNEL_ID"] = ask("Slack channel id; empty enables auto-bind", "")
        env["SL_POLL_INTERVAL"] = ask("Slack poll interval", "10")
    elif channel == "mattermost":
        env["MM_URL"] = ask("Mattermost URL", "https://chat.singularitynet.io")
        env["MM_CHANNEL_ID"] = ask("Mattermost channel id")
        env["MM_BOT_TOKEN"] = getpass.getpass("Mattermost bot token: ").strip()
    elif channel == "whatsapp":
        env["WA_PORT"] = ask("WhatsApp bridge port", "3055")
        env["WA_PRIMARY_JID"] = ask("Primary WhatsApp JID; can be set later", "")
        env["WA_TARGET_JID"] = env["WA_PRIMARY_JID"]
    elif channel == "web_control":
        env["OMEGACLAW_AUTH_SECRET"] = ask("Local auth secret", "change-me")
    return channel, env, enabled


def choose_modules(modules: dict[str, ModuleInfo], channel_modules: set[str]) -> set[str]:
    print("\nModule profile")
    print("  1) Minimal: selected channel, channel router, scratch space, web search")
    print("  2) Recommended: minimal plus Assume, publishing, reminders, and senses")
    print("  3) Full: all modules; may require device credentials and extra tools")
    choice = ask("Choose profile", "2")
    if choice == "1":
        enabled = set(FORCED_MODULES) | channel_modules | {"web_search"}
    elif choice == "3":
        enabled = set(modules)
    else:
        enabled = set(FORCED_MODULES) | channel_modules | set(RECOMMENDED_MODULES)

    print("\nOptional modules")
    for name, info in modules.items():
        if name in FORCED_MODULES or name in channel_modules:
            continue
        default = name in enabled
        prompt = f"Enable {name} ({info.kind})"
        if yes_no(prompt, default):
            enabled.add(name)
        else:
            enabled.discard(name)
    return {name for name in enabled if name in modules}


def quote_env(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def write_env(workspace: pathlib.Path, values: dict[str, str]) -> pathlib.Path:
    env_path = workspace / ".env"
    auth_secret = values.get("OMEGACLAW_AUTH_SECRET") or os.urandom(18).hex()
    values["OMEGACLAW_AUTH_SECRET"] = auth_secret
    lines = ["# Local OmegaClaw runtime configuration. Do not commit this file."]
    for key in sorted(values):
        lines.append(f"{key}={quote_env(values[key])}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        env_path.chmod(0o600)
    except OSError:
        pass
    return env_path


def write_loader(core: pathlib.Path, modules: dict[str, ModuleInfo], enabled: set[str]) -> pathlib.Path:
    loader = core / "modules" / "loader.metta"
    lines = [
        "; Enabled modules for this OmegaClaw deployment.",
        "; Generated by install/installer_common.py. Re-run the installer to change this list.",
        "; Module identity, skills, signatures, risks, effects, and trace remain declared in each module.",
    ]
    for name in sorted(enabled):
        info = modules[name]
        lines.append(f"!(import! &self (library OmegaClaw-Core ./modules/{name}/{info.entrypoint}))")
    loader.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return loader


def write_root_run(workspace: pathlib.Path) -> None:
    (workspace / "run.metta").write_text(
        textwrap.dedent(
            f"""
            !(import! &self (library lib_import))
            !(git-import! "{PUBLIC_CORE_URL}")
            !(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_no_agentverse))))
            !(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_attention))))
            !(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_body))))

            !(omegaclaw)
            """
        ).lstrip(),
        encoding="utf-8",
    )


def write_agent_prompt(core: pathlib.Path, agent_name: str) -> pathlib.Path:
    prompt_path = core / "memory" / "prompt.txt"
    result = subprocess.run(
        ["git", "show", "HEAD:memory/prompt.txt"],
        cwd=str(core),
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    text = result.stdout if result.returncode == 0 else prompt_path.read_text(encoding="utf-8")
    # Replace the default agent name only as a standalone word. OmegaClaw remains
    # the framework name and should not be rewritten.
    text = re.sub(r"\bOmega\b", agent_name, text)
    prompt_path.write_text(text, encoding="utf-8")
    return prompt_path


def write_start_scripts(workspace: pathlib.Path) -> None:
    start_sh = workspace / "start-omegaclaw.sh"
    start_sh.write_text(
        textwrap.dedent(
            """
            #!/usr/bin/env bash
            set -euo pipefail
            cd "$(dirname "$0")"
            if [ -f .env ]; then
              set -a
              . ./.env
              set +a
            fi
            if [ -f .venv/bin/activate ]; then
              . ./.venv/bin/activate
            fi
            exec ./run.sh run.metta "$@"
            """
        ).lstrip(),
        encoding="utf-8",
    )
    start_sh.chmod(0o755)

    start_command = workspace / "Start OmegaClaw.command"
    start_command.write_text(
        textwrap.dedent(
            """
            #!/bin/sh
            DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
            exec "$DIR/start-omegaclaw.sh"
            """
        ).lstrip(),
        encoding="utf-8",
    )
    start_command.chmod(0o755)


def pip_install(workspace: pathlib.Path, enabled: set[str]) -> None:
    python = workspace / ".venv" / "bin" / "python"
    if not python.exists():
        run([sys.executable, "-m", "venv", str(workspace / ".venv")])
    packages = list(BASE_PIP)
    for module in sorted(enabled):
        packages.extend(OPTIONAL_PIP.get(module, []))
    run([str(python), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(python), "-m", "pip", "install", *packages])


def install_node_deps(core: pathlib.Path, enabled: set[str]) -> None:
    if not ({"channel_whatsapp", "codex_code"} & enabled):
        return
    require_tool("npm")
    if "channel_whatsapp" in enabled:
        bridge = core / "modules" / "channel_whatsapp" / "src" / "whatsapp_bridge"
        if (bridge / "package.json").exists():
            run(["npm", "install"], cwd=bridge)
    if "codex_code" in enabled and yes_no("Install @openai/codex globally for codex_code", False):
        run(["npm", "install", "-g", "@openai/codex@0.133.0"])


def install_fabricpc(workspace: pathlib.Path, enabled: set[str], env_values: dict[str, str]) -> None:
    if "assume" not in enabled:
        return
    fabric = workspace / "repos" / "FabricPC"
    if yes_no("Clone/install FabricPC for Assume", True):
        clone_or_update(FABRICPC_URL, fabric)
        python = workspace / ".venv" / "bin" / "python"
        run([str(python), "-m", "pip", "install", "-e", str(fabric)])
        env_values["FABRICPC_REPO"] = str(fabric)
        env_values["FABRICPC_PYTHON"] = str(python)


def prepare_workspace(workspace: pathlib.Path, repo_url: str) -> pathlib.Path:
    require_tool("git")
    clone_or_update(PETTA_URL, workspace)
    repos = workspace / "repos"
    restore_generated_repo_files(repos / "OmegaClaw-Core")
    clone_or_update(repo_url, repos / "OmegaClaw-Core")
    clone_or_update(CHROMA_URL, repos / "petta_lib_chromadb")
    write_root_run(workspace)
    return repos / "OmegaClaw-Core"


def main() -> int:
    parser = argparse.ArgumentParser(description="Install OmegaClaw from source.")
    parser.add_argument("--workspace", default=str(pathlib.Path.home() / "OmegaClaw"))
    parser.add_argument("--repo-url", default=PUBLIC_CORE_URL)
    parser.add_argument("--non-interactive", action="store_true")
    args = parser.parse_args()

    if args.non_interactive:
        raise SystemExit("Non-interactive install is not implemented yet; use the interactive installer.")

    workspace = pathlib.Path(args.workspace).expanduser().resolve()
    print(f"OmegaClaw workspace: {workspace}")
    core = prepare_workspace(workspace, args.repo_url)
    modules = discover_modules(core)

    agent_name = ask_agent_name()
    provider_env = choose_provider()
    channel, channel_env, channel_modules = choose_channel()
    enabled = choose_modules(modules, channel_modules)
    enabled |= FORCED_MODULES
    enabled.add(CHANNEL_MODULES[channel])

    env_values = {**provider_env, **channel_env, "OMEGACLAW_AGENT_NAME": agent_name}
    pip_install(workspace, enabled)
    install_fabricpc(workspace, enabled, env_values)
    install_node_deps(core, enabled)
    write_loader(core, modules, enabled)
    prompt_path = write_agent_prompt(core, agent_name)
    env_path = write_env(workspace, env_values)
    write_start_scripts(workspace)

    print("\nOmegaClaw install complete.")
    print(f"Config: {env_path}")
    print(f"Modules: {core / 'modules' / 'loader.metta'}")
    print(f"Prompt: {prompt_path}")
    print(f"Start script: {workspace / 'start-omegaclaw.sh'}")
    print(f"Auth secret: {env_values['OMEGACLAW_AUTH_SECRET']}")
    print("Run again later with the generated Start OmegaClaw launcher; it will reuse .env.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
