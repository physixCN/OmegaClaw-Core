"""Portability checks for the local mock channel RPC harness."""

import importlib.util
import pathlib
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_rpc():
    path = ROOT / "Autotests" / "mock" / "rpc.py"
    spec = importlib.util.spec_from_file_location("_omegaclaw_mock_rpc", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class MockRpcPortabilityTests(unittest.TestCase):
    def test_pollrdhup_falls_back_to_pollhup_on_macos(self):
        rpc = load_rpc()

        with mock.patch.object(rpc.select, "POLLRDHUP", rpc.select.POLLHUP, create=True):
            self.assertEqual(rpc.pollrdhup_flag(), rpc.select.POLLHUP)


if __name__ == "__main__":
    unittest.main()
