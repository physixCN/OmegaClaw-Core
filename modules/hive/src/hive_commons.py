"""Membrane between an Omega agent and its hive's swarm commons (HTTP API)."""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 20


def _call(method, path, payload=None):
    base = os.environ.get("HIVE_API_URL", "").rstrip("/")
    token = os.environ.get("HIVE_WS_TOKEN", "")
    if not base or not token:
        return None, "HIVE-NOT-CONFIGURED set HIVE_API_URL and HIVE_WS_TOKEN"
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(base + path, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode()), None
    except urllib.error.HTTPError as exc:
        try:
            error = json.loads(exc.read().decode()).get("error", {})
            return None, f"HIVE-ERROR {error.get('code', exc.code)}: {error.get('message', '')}"
        except ValueError:
            return None, f"HIVE-ERROR {exc.code}"
    except OSError as exc:
        return None, f"HIVE-UNREACHABLE {exc}"


def _text(value):
    text = str(value).strip()
    if len(text) >= 2 and text[0] == text[-1] == '"':
        text = text[1:-1].replace('\\"', '"')
    return text


def publish(statement, f, c):
    result, error = _call("POST", "/api/agent/publish",
                          {"statement": _text(statement), "f": float(f), "c": float(c)})
    if error:
        return error
    extra = f" unmapped={' '.join(result['unmapped'])}" if result.get("unmapped") else ""
    return (f"HIVE-PUBLISHED outcome={result['outcome']} statement={result['statement']} "
            f"stamp={','.join(result['stamp'])}{extra}")


def query(pattern):
    result, error = _call("POST", "/api/agent/query", {"pattern": _text(pattern)})
    if error:
        return error
    rows = result.get("results", [])
    return "HIVE-QUERY " + (" | ".join(rows[:20]) if rows else "no matches")


def belief(statement):
    result, error = _call("GET", "/api/agent/belief?" + urllib.parse.urlencode({"statement": _text(statement)}))
    if error:
        return error
    tv = result["tv"]
    return (f"HIVE-BELIEF {result['statement']} f={tv['f']} c={tv['c']} "
            f"sources={','.join(result['sources'])} assertions={len(result.get('assertions', []))}")


# ---- policy gate -----------------------------------------------------------------------

# Skills that never leave the agent and the hive: no round trip needed.
LOCAL_ALLOW = {"send", "wait", "pin", "query", "remember", "episodes", "hive-publish", "hive-query",
               "hive-belief", "hive-goals", "hive-goal-claim", "hive-goal-done", "hive-goal-fail",
               "hive-goal-create"}


def _skill(command):
    text = str(command).strip()
    if text.startswith("(") and len(text) > 1:
        head = text[1:].split(None, 1)
        return head[0].rstrip(")") if head else ""
    return ""


def authorize(command):
    """True to run the command, or the message the loop records instead.

    Returns a bool rather than "allow": a Python string can reach MeTTa as a
    symbol, which would never equal the string "allow".  Fails closed: if the
    hive cannot be asked, the command does not run.
    """
    command = _text(command)
    if _skill(command) in LOCAL_ALLOW:
        return True
    result, error = _call("POST", "/api/agent/authorize", {"command": command})
    if error:
        return f"HIVE-GATE-UNAVAILABLE {error}; the command was not run"
    if result.get("decision") == "allow":
        return True
    return result.get("message") or f"HIVE-DENIED {command}"


# ---- traces and control ------------------------------------------------------------------

def trace(iteration, message, response, results):
    """Report one loop iteration to the hive's thinking timeline."""
    payload = {"iteration": int(iteration or 0), "input": _text(message) or None,
               "response": _text(response), "results": str(results)}
    _call("POST", "/api/agent/trace", payload)
    return "HIVE-TRACED"


def _metta_string(text):
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


def take_control():
    """Queued memory operations as MeTTa: ((retire "space" "atom") (reset))."""
    result, error = _call("GET", "/api/agent/control")
    if error or not result:
        return "()"
    ops = []
    for op in result.get("ops", []):
        if op.get("op") == "retire":
            ops.append(f"(retire {_metta_string(op['space'])} {_metta_string(op['atom'])})")
        elif op.get("op") == "reset":
            ops.append("(reset)")
    return "(" + " ".join(ops) + ")"


# ---- goals ---------------------------------------------------------------------------------

def goals():
    result, error = _call("GET", "/api/agent/goals?status=open")
    if error:
        return error
    if not result:
        return "HIVE-GOALS none open"
    return "HIVE-GOALS " + " | ".join(f"{g['id']} p={g['priority']:.2f} {g['title']}" for g in result[:20])


def goal_claim(goal_id):
    result, error = _call("POST", f"/api/agent/goals/{_text(goal_id)}/claim")
    return error or f"HIVE-GOAL-CLAIMED {result['id']} {result['title']}"


def goal_finish(goal_id, status, text):
    result, error = _call("POST", f"/api/agent/goals/{_text(goal_id)}/result",
                          {"status": status, "result": _text(text)})
    return error or f"HIVE-GOAL-{status.upper()} {result['id']}"


def goal_create(parent_id, title):
    parent = _text(parent_id)
    payload = {"title": _text(title)}
    if parent and parent not in ("none", "-"):
        payload["parent_id"] = parent
    result, error = _call("POST", "/api/agent/goals", payload)
    return error or f"HIVE-GOAL-CREATED {result['id']} {result['title']}"
