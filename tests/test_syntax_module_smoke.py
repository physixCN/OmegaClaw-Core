#!/usr/bin/env python3
"""Syntax smoke tests for optional module-provided command signatures."""

import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import helper  # noqa: E402


class ModuleSyntaxSmokeTests(unittest.TestCase):
    def assert_metta_ok(self, expression):
        self.assertEqual(helper.test_metta_expression(expression), "METTA-SYNTAX-OK")

    def assert_parse(self, raw, expected):
        actual = helper.signature_balance_parentheses(raw)
        self.assertEqual(actual, expected)
        self.assert_metta_ok(actual)

    def test_module_rest_text_signatures_accept_natural_language_tasks(self):
        cases = {
            "codex-code-readonly list the files in the current directory and briefly describe what this repo does":
                '((codex-code-readonly "list the files in the current directory and briefly describe what this repo does"))',
            "codex-code fix the parser test and explain residual risk":
                '((codex-code "fix the parser test and explain residual risk"))',
            "codex-code-readonly-start inspect the scratch space without blocking the loop":
                '((codex-code-readonly-start "inspect the scratch space without blocking the loop"))',
            "codex-code-start add a small test and report residual risk":
                '((codex-code-start "add a small test and report residual risk"))',
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assert_parse(raw, expected)

    def test_scratch_raw_atom_signatures_accept_draft_atoms(self):
        cases = {
            "scratch-status": '((scratch-status))',
            "scratch-add (ScratchDraft reboot-test \"scratch organ available after reboot\")":
                '((scratch-add (ScratchDraft reboot-test "scratch organ available after reboot") 3))',
            "scratch-add (ScratchDraft reboot-test ok) 2":
                "((scratch-add (ScratchDraft reboot-test ok) 2))",
            'scratch-add "(ScratchDraft" "reboot-test" "ok)" "2"':
                "((scratch-add (ScratchDraft reboot-test ok) 2))",
            "scratch-find (ScratchDraft reboot-test $x)":
                "((scratch-find (ScratchDraft reboot-test $x)))",
            'scratch-find "(ScratchDraft" "reboot-test" "$x)"':
                "((scratch-find (ScratchDraft reboot-test $x)))",
            "scratch-promote (ScratchDraft reboot-test ok) verified after smoke":
                '((scratch-promote (ScratchDraft reboot-test ok) "verified after smoke"))',
            'scratch-promote "(ScratchDraft" "reboot-test" "ok)" verified after smoke':
                '((scratch-promote (ScratchDraft reboot-test ok) "verified after smoke"))',
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assert_parse(raw, expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
