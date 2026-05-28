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
            self.assertIn("agent name", text.lower())
            self.assertIn("provider", text.lower())
            self.assertIn("channel", text.lower())

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
