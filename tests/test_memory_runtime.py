#!/usr/bin/env python3
"""Regression checks for runtime memory boundary helpers."""

import importlib
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


class MemoryRuntimeTests(unittest.TestCase):
    def import_with_memory(self, module_name, memory_dir):
        sys.modules.pop(module_name, None)
        with mock.patch.dict(os.environ, {"OMEGACLAW_MEMORY_DIR": str(memory_dir)}, clear=False):
            return importlib.import_module(module_name)

    def test_context_and_episodes_are_safe_when_live_memory_absent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_dir = pathlib.Path(tmpdir)
            helper_metta = self.import_with_memory("helper_metta", memory_dir)
            helper_history = self.import_with_memory("helper_history", memory_dir)

            self.assertEqual(helper_metta.context_prompt(), "")
            self.assertEqual(helper_metta.context_history_tail(), "")
            self.assertEqual(
                helper_history.episodes_at("2026-05-17 21:00"),
                "EPISODES-NOT-FOUND 2026-05-17 21:00:00",
            )

    def test_runtime_memory_files_and_promotion_db_use_configured_memory_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_dir = pathlib.Path(tmpdir)
            helper_metta = self.import_with_memory("helper_metta", memory_dir)
            helper_promotion = self.import_with_memory("helper_promotion", memory_dir)

            report = helper_metta.ensure_runtime_memory_files("persistent agenda beliefs world events activity")
            self.assertIn("created=persistent,agenda,beliefs,world,events,activity", report)
            for name in ("persistent", "agenda", "beliefs", "world", "events", "activity"):
                self.assertTrue((memory_dir / f"{name}.metta").exists())

            helper_promotion.promotion_open_map()
            helper_promotion.promotion_commit()
            helper_promotion.promotion_close_map()
            self.assertTrue((memory_dir / "promotions.db").exists())

    def test_runtime_memory_files_without_names_does_not_choose_policy(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_dir = pathlib.Path(tmpdir)
            helper_metta = self.import_with_memory("helper_metta", memory_dir)

            report = helper_metta.ensure_runtime_memory_files("")

            self.assertIn("created=", report)
            self.assertFalse(any(memory_dir.glob("*.metta")))

    def test_runtime_memory_files_accept_registered_module_names_not_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_dir = pathlib.Path(tmpdir)
            helper_metta = self.import_with_memory("helper_metta", memory_dir)

            report = helper_metta.ensure_runtime_memory_files("dream assume ../escape nested/path")

            self.assertIn("created=dream,assume", report)
            self.assertIn("rejected=../escape,nested/path", report)
            self.assertTrue((memory_dir / "dream.metta").exists())
            self.assertTrue((memory_dir / "assume.metta").exists())
            self.assertFalse((memory_dir.parent / "escape.metta").exists())

    def test_reboot_note_uses_configured_memory_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_dir = pathlib.Path(tmpdir)
            helper_reboot = self.import_with_memory("helper_reboot", memory_dir)

            trace = helper_reboot.prepare_reboot("test restart")

            self.assertIn("REBOOT-CHECK", trace)
            note = memory_dir / "reboot_note.txt"
            self.assertTrue(note.exists())
            self.assertIn("test restart", note.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
