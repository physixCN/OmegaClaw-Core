import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("_hive", Path(__file__).resolve().parents[1] / "_hive.py")
_hive = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_hive)

DESCRIPTION = "List open goals in your swarm, highest priority first."

def run():
    result, error = _hive.call("GET", "/api/agent/goals?status=open")
    if error:
        return error
    return " | ".join(f"{g['id']} p={g['priority']:.2f} {g['title']}" for g in result) or "no open goals"
