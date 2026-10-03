"""OmegaDots Hive channel: this agent's connection to the hive agent hub.

The WebSocket lives in a separate daemon process (``python hive_channel.py
--daemon``).  Under janus, Python threads inside the agent only run while
Prolog is in a py-call, so an in-process socket would stall whenever the loop
sleeps: no keepalives, no reconnects, no inbound messages.  The daemon talks
to the agent through files in ``$OMEGACLAW_MEMORY_DIR/hive/``:

  inbox.jsonl     daemon appends {"seq", "text"}; agent reads past inbox.offset
  outbox.jsonl    agent appends agent_message frames; daemon sends past outbox.offset
  state.json      daemon: last_seen_seq (survives restarts, so resume after a
                  sleep/wake replays only what the agent has not seen)
  status.json     daemon: connected, counters
  daemon.pid

Wire protocol (same frames as upstream singnet/Omega channels/wschat.py):

  hub -> agent   {"type": "user_message", "seq": <int>, "text": <str>}
                 {"type": "ack", ...} / {"type": "error", "code", "message"}
  agent -> hub   {"type": "resume", "last_seen_seq": <int|null>}  (every connect)
                 {"type": "agent_message", "client_seq": <hex>, "text": <str>,
                  "conversation_id": <str, optional>}

Hive extension: a user_message ``text`` may be a JSON envelope
``{"hive": 1, "sender", "conversation_id", "text", ...}``.  The agent sees it
as a CHANNEL_EVENT block, and replies carry that conversation_id.
"""

from __future__ import annotations

import json
import os
import pathlib
import random
import shutil
import signal
import subprocess
import sys
import time
import uuid

POLL_SECONDS = 0.1


# ---- shared file layout ------------------------------------------------------

def channel_dir(memory_dir=None) -> pathlib.Path:
    base = memory_dir or os.environ.get("OMEGACLAW_MEMORY_DIR") or (
        pathlib.Path(__file__).resolve().parents[3] / "memory"
    )
    path = pathlib.Path(base) / "hive"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _read_json(path, default):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write_json(path, value):
    tmp = pathlib.Path(f"{path}.tmp")
    tmp.write_text(json.dumps(value), encoding="utf-8")
    os.replace(tmp, path)


def _append_jsonl(path, value):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(value) + "\n")


def _read_new_lines(path, offset_path):
    """Return complete JSONL records past the stored byte offset and advance it."""
    offset = int(_read_json(offset_path, 0) or 0)
    try:
        with open(path, "rb") as handle:
            handle.seek(offset)
            data = handle.read()
    except FileNotFoundError:
        return []
    end = data.rfind(b"\n")
    if end < 0:
        return []
    records = []
    for line in data[: end + 1].splitlines():
        if line.strip():
            try:
                records.append(json.loads(line))
            except ValueError:
                pass
    _write_json(offset_path, offset + end + 1)
    return records


def _pid_alive(pid):
    try:
        pid = int(pid)
    except (ValueError, TypeError):
        return False
    try:
        # Reap the daemon if it is our exited child; a zombie still answers kill(0).
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return False
    except ChildProcessError:
        pass
    except OSError:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


# ---- agent side (called from MeTTa via py-call) ---------------------------------

def _python_executable():
    # Embedded in SWI-Prolog via janus, sys.executable is the swipl binary.
    configured = os.environ.get("HIVE_PYTHON")
    if configured:
        return configured
    if pathlib.Path(sys.executable).name.startswith("python"):
        return sys.executable
    return shutil.which("python3") or shutil.which("python") or "python3"


_reply_conversation = ""


def start_hive(ws_url="", ws_token=""):
    url = str(ws_url or os.environ.get("HIVE_WS_URL", "")).strip()
    token = str(ws_token or os.environ.get("HIVE_WS_TOKEN", "")).strip()
    if not url:
        return "HIVE-CHANNEL-DISABLED missing HIVE_WS_URL"
    folder = channel_dir()
    pid = _read_json(folder / "daemon.pid", None)
    if pid and _pid_alive(pid):
        return f"HIVE-CHANNEL-ALREADY-RUNNING pid={pid}"
    env = dict(os.environ, HIVE_WS_URL=url, HIVE_WS_TOKEN=token, HIVE_CHANNEL_DIR=str(folder))
    process = subprocess.Popen(
        [_python_executable(), str(pathlib.Path(__file__).resolve()), "--daemon", str(os.getpid())],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=open(folder / "daemon.log", "a"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    _write_json(folder / "daemon.pid", process.pid)
    return f"HIVE-CHANNEL-STARTED {url} pid={process.pid}"


def stop_hive():
    folder = channel_dir()
    pid = _read_json(folder / "daemon.pid", None)
    if pid and _pid_alive(pid):
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError:
            pass
    return "HIVE-CHANNEL-STOPPED"


def _event_text(text):
    """A hive envelope becomes a CHANNEL_EVENT block; plain text passes through."""
    global _reply_conversation
    try:
        envelope = json.loads(text)
    except (ValueError, TypeError):
        return text
    if not isinstance(envelope, dict) or envelope.get("hive") != 1:
        return text
    conversation = str(envelope.get("conversation_id") or "")
    if conversation:
        _reply_conversation = conversation
    event = {
        "event": envelope.get("event", "message"),
        "channel": "hive",
        "route": envelope.get("route", "primary"),
        "conversation_id": conversation,
        "message_id": envelope.get("message_id", ""),
        "sender": envelope.get("sender", "unknown"),
        "text": envelope.get("text", ""),
    }
    try:
        import router

        block = router.normalize_channel_event(event)
        if block:
            return block
    except Exception:
        pass
    return "\n".join(["CHANNEL_EVENT"] + [f"{k}={v}" for k, v in event.items() if v != ""])


def getLastMessage():
    folder = channel_dir()
    records = _read_new_lines(folder / "inbox.jsonl", folder / "inbox.offset")
    return "\n\n".join(_event_text(str(r.get("text", ""))) for r in records)


def send_message(text):
    message = str(text).replace("\\n", "\n").replace("\r", "")
    if not message:
        return ""
    payload = {"type": "agent_message", "client_seq": uuid.uuid4().hex, "text": message}
    if _reply_conversation:
        payload["conversation_id"] = _reply_conversation
    _append_jsonl(channel_dir() / "outbox.jsonl", payload)
    return "HIVE-MESSAGE-QUEUED"


def status():
    folder = channel_dir()
    state = _read_json(folder / "status.json", {})
    pid = _read_json(folder / "daemon.pid", None)
    return (
        f"HIVE-CHANNEL connected={str(bool(state.get('connected'))).lower()} "
        f"daemon={'alive' if pid and _pid_alive(pid) else 'down'} url={state.get('url', '')} "
        f"last_seen_seq={state.get('last_seen_seq')} received={state.get('received', 0)} "
        f"sent={state.get('sent', 0)} reconnects={state.get('reconnects', 0)}"
    )


# ---- daemon side -------------------------------------------------------------------

class _Daemon:
    def __init__(self, folder, url, token, parent_pid):
        self.folder = pathlib.Path(folder)
        self.url = url
        self.token = token
        self.parent_pid = parent_pid
        self.running = True
        self.last_seen_seq = _read_json(self.folder / "state.json", {}).get("last_seen_seq")
        self.stats = {"received": 0, "sent": 0, "reconnects": 0}
        self.connected = False

    def write_status(self):
        _write_json(
            self.folder / "status.json",
            dict(self.stats, connected=self.connected, url=self.url, last_seen_seq=self.last_seen_seq),
        )

    def parent_gone(self):
        return self.parent_pid and not _pid_alive(self.parent_pid)

    def deliver(self, frame):
        kind = frame.get("type")
        if kind == "user_message":
            seq, text = frame.get("seq"), frame.get("text")
            if not isinstance(seq, int) or not isinstance(text, str):
                return
            if self.last_seen_seq is not None and seq <= self.last_seen_seq:
                return
            _append_jsonl(self.folder / "inbox.jsonl", {"seq": seq, "text": text})
            self.last_seen_seq = seq
            _write_json(self.folder / "state.json", {"last_seen_seq": seq})
            self.stats["received"] += 1
            self.write_status()
        elif kind == "error":
            print(f"hive error {frame.get('code')}: {frame.get('message')}", flush=True)

    def flush_outbox(self, ws):
        """Send queued agent messages; the offset only advances past sent ones."""
        offset_path = self.folder / "outbox.offset"
        offset = int(_read_json(offset_path, 0) or 0)
        try:
            with open(self.folder / "outbox.jsonl", "rb") as handle:
                handle.seek(offset)
                data = handle.read()
        except FileNotFoundError:
            return
        for line in data.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                break
            if line.strip():
                ws.send(line.decode("utf-8").strip())
                self.stats["sent"] += 1
            offset += len(line)
            _write_json(offset_path, offset)
            self.write_status()

    def session(self):
        from websockets.sync.client import connect

        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        with connect(self.url, additional_headers=headers, open_timeout=15,
                     ping_interval=20, ping_timeout=20, max_size=64 * 1024) as ws:
            self.connected = True
            ws.send(json.dumps({"type": "resume", "last_seen_seq": self.last_seen_seq}))
            self.write_status()
            while self.running and not self.parent_gone():
                self.flush_outbox(ws)
                try:
                    raw = ws.recv(timeout=POLL_SECONDS)
                except TimeoutError:
                    continue
                try:
                    frame = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(frame, dict):
                    self.deliver(frame)

    def run(self):
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "running", False))
        backoff = 1.0
        self.write_status()
        while self.running and not self.parent_gone():
            try:
                self.session()
                backoff = 1.0
            except Exception as exc:
                print(f"hive connection error: {exc}", flush=True)
            self.connected = False
            self.write_status()
            if not self.running or self.parent_gone():
                break
            self.stats["reconnects"] += 1
            delay = min(backoff, 30.0) * (1.0 + random.uniform(0.0, 0.2))
            end = time.time() + delay
            while time.time() < end and self.running and not self.parent_gone():
                time.sleep(POLL_SECONDS)
            backoff = min(backoff * 2.0, 30.0)
        self.write_status()


def _daemon_main(argv):
    parent = int(argv[0]) if argv and argv[0].isdigit() else 0
    folder = os.environ.get("HIVE_CHANNEL_DIR") or str(channel_dir())
    _Daemon(folder, os.environ.get("HIVE_WS_URL", ""), os.environ.get("HIVE_WS_TOKEN", ""), parent).run()


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--daemon":
    _daemon_main(sys.argv[2:])
