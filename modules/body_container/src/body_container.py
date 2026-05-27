"""Grounded body-container observation membrane for the agent."""

from __future__ import annotations

import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import time

CORE_ROOT = pathlib.Path(__file__).resolve().parents[3]
STATE_DIR = CORE_ROOT / "memory" / "runtime" / "body_container"
TRACE_FILE = STATE_DIR / "trace.jsonl"
DEFAULT_CONFIG = STATE_DIR / "host.json"
MAX_TRACE_LINES = 5

sys.modules.setdefault("body_container", sys.modules[__name__])

SELF_ATOMS = [
    "(BodyContainer omega-runtime-body)",
    "(Embodies omega-runtime-body agent-self)",
    "(ContainerType omega-runtime-body runtime-host-container)",
    "(GroundingConfiguredBy omega-runtime-body \"OMEGACLAW_BODY_CONTAINER_CONFIG\")",
    "(Contains omega-runtime-body omega-loop)",
]

DEFAULT_PROCESS_PATTERNS = {
    "omega_loop": r"swipl --stack_limit=8g.*run.metta",
}


def _ensure_state_dir() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _append_trace(event: str, **data) -> None:
    _ensure_state_dir()
    record = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event, **data}
    with TRACE_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def _config_path() -> pathlib.Path:
    configured = os.environ.get("OMEGACLAW_BODY_CONTAINER_CONFIG")
    if configured:
        path = pathlib.Path(configured)
        return path if path.is_absolute() else CORE_ROOT / path
    return DEFAULT_CONFIG


def _load_launcher_config() -> dict:
    path = _config_path()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "missing", "path": str(path)}
    except Exception as exc:
        return {"status": "invalid", "path": str(path), "error": str(exc)}


def _run(command: list[str], timeout: int = 2) -> str:
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", timeout=timeout)
        return (result.stdout or "").strip()
    except Exception as exc:
        return f"{type(exc).__name__}:{exc}"


def _first_line(path: str) -> str:
    try:
        return pathlib.Path(path).read_text(encoding="utf-8", errors="replace").splitlines()[0].strip()
    except Exception:
        return "unknown"


def _process_count(pattern: str) -> int:
    out = _run(["pgrep", "-fc", pattern])
    try:
        return int(out.splitlines()[-1])
    except Exception:
        return 0


def _configured_process_patterns(config: dict) -> dict:
    patterns = config.get("process_patterns") if isinstance(config, dict) else None
    if isinstance(patterns, dict):
        clean = {str(name): str(pattern) for name, pattern in patterns.items() if str(name).strip() and str(pattern).strip()}
        if clean:
            return clean
    return dict(DEFAULT_PROCESS_PATTERNS)


def _resource_snapshot() -> dict:
    total, used, free = shutil.disk_usage(str(CORE_ROOT))
    meminfo = pathlib.Path("/proc/meminfo").read_text(encoding="utf-8", errors="replace") if pathlib.Path("/proc/meminfo").exists() else ""
    mem = {}
    for line in meminfo.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].rstrip(":") in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
            mem[parts[0].rstrip(":")] = int(parts[1])
    return {
        "disk_total_gb": round(total / 1024**3, 2),
        "disk_free_gb": round(free / 1024**3, 2),
        "mem_total_mb": round(mem.get("MemTotal", 0) / 1024, 1),
        "mem_available_mb": round(mem.get("MemAvailable", 0) / 1024, 1),
        "swap_free_mb": round(mem.get("SwapFree", 0) / 1024, 1),
    }


def body_container_status():
    launcher = _load_launcher_config()
    virt = _run(["systemd-detect-virt"]) or "unknown"
    hostname = platform.node() or _first_line("/etc/hostname")
    machine_id = _first_line("/etc/machine-id")
    resources = _resource_snapshot()
    process_patterns = _configured_process_patterns(launcher)
    processes = {name: _process_count(pattern) for name, pattern in process_patterns.items()}
    _append_trace(
        "BodyContainerObserved",
        hostname=hostname,
        virt=virt,
        machine_id=machine_id,
        launcher_status=launcher.get("status", "present"),
        processes=processes,
        resources=resources,
    )
    return (
        f"BODY-CONTAINER-STATUS body=omega-runtime-body virt={virt} hostname={hostname} machine_id={machine_id} "
        f"launcher={launcher.get('launcher', launcher.get('status', 'unconfigured'))} "
        f"configured_processes={json.dumps(processes, sort_keys=True)} "
        f"mem_available_mb={resources['mem_available_mb']} disk_free_gb={resources['disk_free_gb']}"
    )


def body_container_self():
    _append_trace("BodyContainerObserved", view="self-atoms")
    return "BODY-CONTAINER-SELF\n" + "\n".join(SELF_ATOMS)


def body_container_launcher():
    config = _load_launcher_config()
    _append_trace("BodyContainerLauncherSeen", config=config)
    return "BODY-CONTAINER-LAUNCHER " + json.dumps(config, sort_keys=True)


def body_container_last_trace():
    try:
        lines = TRACE_FILE.read_text(encoding="utf-8").splitlines()[-MAX_TRACE_LINES:]
    except FileNotFoundError:
        return "BODY-CONTAINER-TRACE empty"
    return "\n".join(lines) if lines else "BODY-CONTAINER-TRACE empty"
