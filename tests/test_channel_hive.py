"""Hive channel daemon and agent-side facade against a local agent hub."""

import importlib.util
import json
import os
import pathlib
import queue
import shutil
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "modules" / "channel_hive" / "src" / "hive_channel.py"
ROUTER_SRC = ROOT / "modules" / "channel_router" / "src"

try:
    from websockets.sync.server import serve
except ImportError:  # pragma: no cover
    serve = None


def load_channel():
    spec = importlib.util.spec_from_file_location("hive_channel_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


class FakeHub:
    """Minimal agent hub: records frames, lets the test push user messages."""

    def __init__(self, port=0):
        self.received = queue.Queue()
        self.tokens = []
        self.connections = []
        self.server = serve(self._handler, "127.0.0.1", port)
        self.port = self.server.socket.getsockname()[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def _handler(self, ws):
        self.tokens.append(ws.request.headers.get("Authorization"))
        self.connections.append(ws)
        try:
            for raw in ws:
                self.received.put(json.loads(raw))
        except Exception:
            pass

    def push(self, seq, text):
        self.connections[-1].send(json.dumps({"type": "user_message", "seq": seq, "text": text}))

    def next_frame(self, timeout=10.0):
        return self.received.get(timeout=timeout)

    def drop_clients(self):
        for ws in list(self.connections):
            try:
                ws.close()
            except Exception:
                pass

    def shutdown(self):
        self.drop_clients()
        self.server.shutdown()


@unittest.skipIf(serve is None, "websockets is not installed")
class HiveChannelTests(unittest.TestCase):
    def setUp(self):
        self.memory = tempfile.mkdtemp(prefix="hive-channel-mem-")
        self._old_memory = os.environ.get("OMEGACLAW_MEMORY_DIR")
        os.environ["OMEGACLAW_MEMORY_DIR"] = self.memory
        self.channel = load_channel()
        self.hub = FakeHub()
        self.url = f"ws://127.0.0.1:{self.hub.port}"

    def tearDown(self):
        self.channel.stop_hive()
        pid_file = pathlib.Path(self.memory) / "hive" / "daemon.pid"
        if pid_file.exists():
            pid = json.loads(pid_file.read_text())["pid"]
            wait_for(lambda: not self.channel._pid_alive(pid), timeout=5)
        self.hub.shutdown()
        if self._old_memory is None:
            os.environ.pop("OMEGACLAW_MEMORY_DIR", None)
        else:
            os.environ["OMEGACLAW_MEMORY_DIR"] = self._old_memory
        shutil.rmtree(self.memory, ignore_errors=True)

    def connect(self, expected_resume=None):
        self.assertIn("HIVE-CHANNEL-STARTED", self.channel.start_hive(self.url, "agent-token"))
        self.assertEqual(self.hub.next_frame(), {"type": "resume", "last_seen_seq": expected_resume})
        self.assertTrue(wait_for(lambda: "connected=true" in self.channel.status()))

    def test_disabled_without_url(self):
        os.environ.pop("HIVE_WS_URL", None)
        self.assertIn("HIVE-CHANNEL-DISABLED", self.channel.start_hive("", ""))

    def test_bearer_token_resume_and_single_daemon(self):
        self.connect()
        self.assertEqual(self.hub.tokens[-1], "Bearer agent-token")
        self.assertIn("HIVE-CHANNEL-ALREADY-RUNNING", self.channel.start_hive(self.url, "agent-token"))

    def test_plain_messages_are_batched_and_deduplicated(self):
        self.connect()
        self.hub.push(1, "hello")
        self.hub.push(2, "again")
        self.hub.push(2, "again")  # replayed duplicate
        self.hub.push(1, "old replay")
        self.assertTrue(wait_for(lambda: "received=2" in self.channel.status()))
        time.sleep(0.3)
        self.assertEqual(self.channel.getLastMessage(), "hello\n\nagain")
        self.assertEqual(self.channel.getLastMessage(), "")

    def test_envelope_becomes_channel_event_and_reply_carries_conversation(self):
        sys.path.insert(0, str(ROUTER_SRC))
        try:
            self.connect()
            envelope = {"hive": 1, "sender": "user:jon", "conversation_id": "c-42", "text": "status?"}
            self.hub.push(1, json.dumps(envelope))
            self.assertTrue(wait_for(lambda: "received=1" in self.channel.status()))
            block = self.channel.getLastMessage()
            self.assertTrue(block.startswith("CHANNEL_EVENT"), block)
            self.assertIn("channel=hive", block)
            self.assertIn("sender=user:jon", block)
            self.assertIn("text=status?", block)

            self.assertEqual(self.channel.send_message("all good"), "HIVE-MESSAGE-QUEUED")
            reply = self.hub.next_frame()
            self.assertEqual(reply["type"], "agent_message")
            self.assertEqual(reply["text"], "all good")
            self.assertEqual(reply["conversation_id"], "c-42")
            self.assertTrue(reply["client_seq"])
        finally:
            sys.path.remove(str(ROUTER_SRC))

    def test_messages_queued_while_disconnected_are_flushed_after_resume(self):
        self.connect()
        self.hub.push(5, "before drop")
        self.assertTrue(wait_for(lambda: "received=1" in self.channel.status()))
        self.assertEqual(self.channel.getLastMessage(), "before drop")

        self.hub.drop_clients()
        self.assertTrue(wait_for(lambda: "connected=false" in self.channel.status()))
        self.channel.send_message("queued while offline")

        self.assertEqual(self.hub.next_frame(timeout=15), {"type": "resume", "last_seen_seq": 5})
        self.assertEqual(self.hub.next_frame()["text"], "queued while offline")

    def test_restarted_daemon_resumes_from_persisted_sequence(self):
        self.connect()
        self.hub.push(7, "seen before sleep")
        self.assertTrue(wait_for(lambda: "received=1" in self.channel.status()))
        self.channel.stop_hive()
        self.assertTrue(wait_for(lambda: "daemon=down" in self.channel.status()))

        self.connect(expected_resume=7)
        self.assertEqual(self.channel.getLastMessage(), "seen before sleep")

    def test_daemon_left_by_another_agent_process_is_replaced(self):
        self.connect()
        folder = pathlib.Path(self.memory) / "hive"
        record = json.loads((folder / "daemon.pid").read_text())
        record["owner"] = 1  # pretend a previous agent process started it
        (folder / "daemon.pid").write_text(json.dumps(record))
        started = self.channel.start_hive(self.url, "agent-token")
        self.assertIn("HIVE-CHANNEL-STARTED", started)
        self.assertFalse(self.channel._pid_alive(record["pid"]))
        self.assertTrue(wait_for(lambda: "connected=true" in self.channel.status(), timeout=10))


if __name__ == "__main__":
    unittest.main()
