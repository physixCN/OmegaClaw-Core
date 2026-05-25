#!/usr/bin/env python3
"""Contract checks for input-aware recall in the cognition loop."""

from __future__ import annotations

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class InputContextContractTests(unittest.TestCase):
    def test_loop_receives_before_building_input_aware_context(self):
        loop = (ROOT / "src" / "loop.metta").read_text(encoding="utf-8")
        body = loop[loop.index("(= (omegaclaw $k)") :]

        receive_at = body.index("(receive)")
        input_recall_at = body.index("(input-recall $msgnew $msg)")
        get_context_at = body.index("(getContext $inputctx)")
        send_at = body.index("(py-str ($prompt :-:-:-: $lastmessage))")

        self.assertLess(receive_at, input_recall_at)
        self.assertLess(input_recall_at, get_context_at)
        self.assertLess(get_context_at, send_at)
        self.assertNotIn("(let $prompt (getContext)", body[:receive_at])

    def test_context_has_backwards_compatible_and_input_aware_forms(self):
        loop = (ROOT / "src" / "loop.metta").read_text(encoding="utf-8")
        self.assertIn('(= (getContext)\n   (getContext ""))', loop)
        self.assertIn('(= (getContext $inputctx)', loop)
        self.assertIn('" INPUT_RECALL: " $inputctx', loop)

    def test_input_recall_queries_only_for_fresh_input(self):
        memory = (ROOT / "src" / "memory.metta").read_text(encoding="utf-8")
        match = re.search(r"\(= \(input-recall \$msgnew \$msg\).*?\n\n\(=", memory, re.S)
        self.assertIsNotNone(match)
        body = match.group(0)
        self.assertIn("(if $msgnew", body)
        self.assertIn("helper.context_input_recall_text", body)
        self.assertIn("(string-safe $msg)", body)
        self.assertNotIn("(embed $msg)", body)
        self.assertNotIn("(takeK (maxInputRecallItems) (query $msg))", body)
        self.assertIn('""', body)

    def test_input_recall_has_bounded_context_budget(self):
        memory = (ROOT / "src" / "memory.metta").read_text(encoding="utf-8")
        self.assertIn("(= (maxInputRecallItems) (empty))", memory)
        self.assertIn("(configure maxInputRecallItems 8)", memory)
        self.assertIn("(maxInputRecallItems)", memory)
        self.assertIn("helper.context_input_recall_text", memory)


if __name__ == "__main__":
    unittest.main()
