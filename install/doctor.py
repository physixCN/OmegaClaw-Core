#!/usr/bin/env python3
"""OmegaClaw install/runtime doctor.

This is deployment plumbing, not cognition. It checks that the local workspace
composition matches the saved config before the MeTTa loop starts.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

try:
    import installer_common
except Exception:  # pragma: no cover - direct execution fallback
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import installer_common


def _run_text(cmd: list[str], cwd: pathlib.Path | None = None, timeout: int = 8) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
        return completed.returncode, completed.stdout.strip()
    except Exception as exc:
        return 1, f"{type(exc).__name__}: {exc}"


def _check(condition: bool, label: str, ok: str, bad: str, rows: list[tuple[str, str, str]]) -> bool:
    rows.append(("OK" if condition else "FAIL", label, ok if condition else bad))
    return condition


def _contains_module(loader_text: str, module: str) -> bool:
    return f"./modules/{module}/entry.metta" in loader_text


def _ordered(text: str, *needles: str) -> bool:
    offset = -1
    for needle in needles:
        found = text.find(needle)
        if found <= offset:
            return False
        offset = found
    return True


def diagnose(workspace: pathlib.Path, include_remote: bool = False) -> tuple[bool, list[tuple[str, str, str]]]:
    workspace = workspace.expanduser().resolve()
    core = workspace / "repos" / "OmegaClaw-Core"
    env_path = workspace / ".env"
    run_path = workspace / "run.metta"
    launcher_path = workspace / "Start OmegaClaw.command"
    start_path = workspace / "start-omegaclaw.sh"
    loader_path = workspace / "local" / "modules-loader.metta"
    prompt_path = workspace / "local" / "prompt.txt"

    rows: list[tuple[str, str, str]] = []
    ok = True

    env = installer_common.parse_env_file(env_path)
    channel = env.get("commchannel") or env.get("OMEGACLAW_PRIMARY_CHANNEL") or ""
    expected_channel_module = installer_common.CHANNEL_MODULES.get(channel, "")

    ok &= _check(core.exists() and (core / ".git").exists(), "core clone", str(core), "missing Git clone", rows)
    if core.exists() and (core / ".git").exists():
        rc, head = _run_text(["git", "rev-parse", "--short", "HEAD"], cwd=core)
        rows.append(("INFO" if rc == 0 else "WARN", "core commit", head or "unknown"))
        if include_remote:
            rc, remote = _run_text(["git", "ls-remote", "https://github.com/physixCN/OmegaClaw-Core.git", "HEAD"])
            rows.append(("INFO" if rc == 0 else "WARN", "public HEAD", remote.split()[0][:12] if remote else "unavailable"))

    ok &= _check(env_path.exists(), ".env", str(env_path), "missing install config", rows)
    ok &= _check(bool(channel), "primary channel", channel or "<none>", "commchannel/OMEGACLAW_PRIMARY_CHANNEL unset", rows)
    ok &= _check(run_path.exists(), "root run.metta", str(run_path), "missing root run.metta", rows)
    if run_path.exists():
        run_text = run_path.read_text(encoding="utf-8", errors="replace")
        ok &= _check("./local/modules-loader.metta" in run_text, "root module loader", "workspace-local loader imported", "root run.metta does not import ./local/modules-loader.metta", rows)
        ok &= _check("lib_omegaclaw_no_agentverse" in run_text, "root core import", "core substrate imported", "core substrate import missing", rows)
        ok &= _check(
            _ordered(run_text, "lib_omegaclaw_no_agentverse", "./local/modules-loader.metta", "lib_omegaclaw_attention", "(omegaclaw)"),
            "composition order",
            "core -> local modules -> attention -> loop",
            "root run.metta must import core before local modules and start loop last",
            rows,
        )
        ok &= _check("lib_omegaclaw_body" not in run_text, "old body loader", "not imported by generated root", "generated root still imports old body loader path", rows)

    ok &= _check(loader_path.exists(), "local module loader", str(loader_path), "missing local/modules-loader.metta", rows)
    if loader_path.exists():
        loader_text = loader_path.read_text(encoding="utf-8", errors="replace")
        ok &= _check(_contains_module(loader_text, "channel_router"), "channel router", "enabled", "channel_router missing", rows)
        if expected_channel_module:
            ok &= _check(_contains_module(loader_text, expected_channel_module), "selected channel module", expected_channel_module, f"{expected_channel_module} missing", rows)
        enabled = sorted(set(re.findall(r"\./modules/([^/\s()]+)/entry\.metta", loader_text)))
        rows.append(("INFO", "enabled modules", ", ".join(enabled) if enabled else "<none>"))

    ok &= _check(prompt_path.exists(), "local prompt", str(prompt_path), "missing local prompt", rows)
    env_prompt = env.get("OMEGACLAW_PROMPT_FILE", "")
    prompt_matches = False
    if env_prompt:
        try:
            prompt_matches = pathlib.Path(env_prompt).expanduser().resolve() == prompt_path
        except Exception:
            prompt_matches = env_prompt == str(prompt_path)
    ok &= _check(prompt_matches, "prompt env", "points at local prompt", "OMEGACLAW_PROMPT_FILE does not point at local prompt", rows)
    ok &= _check(start_path.exists(), "start script", str(start_path), "missing start-omegaclaw.sh", rows)
    ok &= _check(launcher_path.exists(), "launcher", str(launcher_path), "missing Start OmegaClaw.command", rows)

    loop_path = core / "src" / "loop.metta"
    if loop_path.exists():
        loop_text = loop_path.read_text(encoding="utf-8", errors="replace")
        ok &= _check("(change-state! &loops 0)" in loop_text, "listen-mode boot", "no-input boot does not call LLM", "loop does not set &loops 0 at boot", rows)
        ok &= _check("(CHARS_SENT: (string_length $send) $send)" not in loop_text, "prompt leak guard", "prompt body is not printed", "loop still prints full prompt body", rows)

    if channel == "telegram":
        ok &= _check(bool(env.get("TG_BOT_TOKEN")), "Telegram token", "configured", "TG_BOT_TOKEN missing", rows)
        rows.append(("INFO", "Telegram bind mode", "fixed chat" if env.get("TG_CHAT_ID") else "auth/auto-bind"))

    return ok, rows


def print_rows(rows: list[tuple[str, str, str]]) -> None:
    width = max([len(label) for _, label, _ in rows] + [10])
    for status, label, detail in rows:
        print(f"{status:4} {label:<{width}} {detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check an OmegaClaw source install.")
    parser.add_argument("--workspace", default=str(pathlib.Path.home() / "OmegaClaw"))
    parser.add_argument("--startup-check", action="store_true", help="Run only local checks suitable for launcher startup.")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--remote", action="store_true", help="Also query public GitHub HEAD.")
    args = parser.parse_args()

    ok, rows = diagnose(pathlib.Path(args.workspace), include_remote=args.remote and not args.startup_check)
    if not args.quiet:
        print_rows(rows)
    if not ok:
        if args.quiet:
            failed = [f"{label}: {detail}" for status, label, detail in rows if status == "FAIL"]
            print("OmegaClaw startup check failed: " + "; ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
