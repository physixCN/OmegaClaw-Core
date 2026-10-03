"""Hive channel for Iter: polls the hive's HTTP inbox and replies over HTTP.

Iter calls receive() every cycle in a short-lived subprocess, so this keeps no
connection; the last seen sequence number is kept in .hive_seq.
"""

import importlib.util
import json
from pathlib import Path

_spec = importlib.util.spec_from_file_location("_hive", Path(__file__).resolve().parents[1] / "_hive.py")
_hive = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_hive)

SEQ = Path(".hive_seq")
CONVERSATION = Path(".hive_conversation")


def receive():
    after = int(SEQ.read_text() or 0) if SEQ.exists() else 0
    result, error = _hive.call("GET", f"/api/agent/inbox?after={after}")
    if error or not result or not result.get("messages"):
        return ""
    lines = []
    for message in result["messages"]:
        try:
            envelope = json.loads(message["text"])
        except ValueError:
            envelope = {"text": message["text"]}
        if envelope.get("conversation_id"):
            CONVERSATION.write_text(envelope["conversation_id"])
        lines.append(f"{envelope.get('sender', 'unknown')}: {envelope.get('text', '')}")
        after = max(after, int(message["seq"]))
    SEQ.write_text(str(after))
    return "\n".join(lines)


def send(content):
    payload = {"text": str(content)}
    if CONVERSATION.exists():
        payload["conversation_id"] = CONVERSATION.read_text().strip()
    _hive.call("POST", "/api/agent/messages", payload)
