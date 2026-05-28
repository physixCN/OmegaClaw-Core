#!/usr/bin/env python3
"""Installer sanity checks.

These tests avoid running package managers or cloning repositories. They protect
the public install contract: public repo URL, module loader generation, and
launcher files that do not embed private deployment state.
"""

import importlib.util
import pathlib
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_installer_common():
    path = ROOT / "install" / "installer_common.py"
    spec = importlib.util.spec_from_file_location("installer_common", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class InstallerTests(unittest.TestCase):
    def test_public_run_file_uses_public_repo(self):
        run_metta = (ROOT / "run.metta").read_text(encoding="utf-8")
        self.assertIn("https://github.com/physixCN/OmegaClaw-Core.git", run_metta)
        self.assertNotIn("https://github.com/asi-alliance/OmegaClaw-Core.git", run_metta)

    def test_installer_discovers_modules_and_writes_loader(self):
        installer = load_installer_common()
        modules = installer.discover_modules(ROOT)
        self.assertIn("channel_router", modules)
        self.assertIn("scratch_space", modules)
        self.assertIn("web_search", modules)
        self.assertEqual(modules["channel_router"].entrypoint, "entry.metta")

        with tempfile.TemporaryDirectory() as tmp:
            fake_core = pathlib.Path(tmp)
            (fake_core / "modules").mkdir()
            for name in ["channel_router", "scratch_space", "web_search"]:
                (fake_core / "modules" / name).mkdir()
            path = installer.write_loader(
                fake_core,
                modules,
                {"channel_router", "scratch_space", "web_search"},
            )
            text = path.read_text(encoding="utf-8")
            self.assertIn("./modules/channel_router/entry.metta", text)
            self.assertIn("./modules/scratch_space/entry.metta", text)
            self.assertIn("./modules/web_search/entry.metta", text)
            self.assertNotIn("Jon", text)

    def test_install_docs_explain_saved_configuration(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        install_readme = (ROOT / "install" / "README.md").read_text(encoding="utf-8")
        for text in [readme, install_readme]:
            self.assertIn("modules/loader.metta", text)
            self.assertIn(".env", text)
            self.assertIn("default_enabled", text)
            self.assertIn("agent name", text.lower())
            self.assertIn("provider", text.lower())
            self.assertIn("channel", text.lower())

    def test_module_defaults_separate_core_from_device_heavy_modules(self):
        installer = load_installer_common()
        modules = installer.discover_modules(ROOT)
        for name in ["assume", "channel_router", "scratch_space", "web_search"]:
            self.assertTrue(modules[name].default_enabled, name)
        for name in [
            "agentverse",
            "channel_mattermost",
            "channel_telegram",
            "channel_whatsapp",
            "codex_code",
            "gameboy",
            "health_glucose",
            "omega_vm",
            "vm_policy",
        ]:
            self.assertFalse(modules[name].default_enabled, name)

    def test_installer_enables_default_modules_and_asks_only_for_optional(self):
        installer = load_installer_common()
        modules = {
            "channel_router": installer.ModuleInfo("channel_router", "channel_router", "channel", True, "entry.metta", ()),
            "scratch_space": installer.ModuleInfo("scratch_space", "scratch_space", "core", True, "entry.metta", ()),
            "web_search": installer.ModuleInfo("web_search", "web_search", "channel", True, "entry.metta", ()),
            "channel_whatsapp": installer.ModuleInfo("channel_whatsapp", "channel_whatsapp", "channel", False, "entry.metta", ()),
            "agentverse": installer.ModuleInfo("agentverse", "agentverse", "remote", False, "entry.metta", ()),
        }
        asked = []
        original_yes_no = installer.yes_no
        try:
            def fake_yes_no(prompt, default=False):
                asked.append((prompt, default))
                return "agentverse" in prompt

            installer.yes_no = fake_yes_no
            enabled = installer.choose_modules(modules, {"channel_whatsapp"})
        finally:
            installer.yes_no = original_yes_no

        self.assertIn("channel_router", enabled)
        self.assertIn("scratch_space", enabled)
        self.assertIn("web_search", enabled)
        self.assertIn("channel_whatsapp", enabled)
        self.assertIn("agentverse", enabled)
        self.assertEqual(asked, [("Enable optional module agentverse (remote)", False)])

    def test_installer_personalizes_agent_name_without_renaming_framework(self):
        installer = load_installer_common()
        with tempfile.TemporaryDirectory() as tmp:
            fake_core = pathlib.Path(tmp)
            (fake_core / "memory").mkdir()
            (fake_core / "memory" / "prompt.txt").write_text(
                "You are Omega, an OmegaClaw agent. Omega remembers.\n",
                encoding="utf-8",
            )
            installer.write_agent_prompt(fake_core, "Ada")
            text = (fake_core / "memory" / "prompt.txt").read_text(encoding="utf-8")
            self.assertIn("You are Ada", text)
            self.assertIn("OmegaClaw agent", text)
            self.assertIn("Ada remembers", text)
            self.assertNotIn("AdaClaw", text)

    def test_public_prompt_has_no_private_operator_names(self):
        prompt = (ROOT / "memory" / "prompt.txt").read_text(encoding="utf-8")
        for private_name in ["Jon", "Lydia", "Anna", "Suzie", "Dad"]:
            self.assertNotIn(private_name, prompt)


if __name__ == "__main__":
    unittest.main()
