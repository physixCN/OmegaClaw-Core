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
