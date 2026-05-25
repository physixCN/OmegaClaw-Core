#!/usr/bin/env python3
"""Contract checks for input-aware recall in the cognition loop."""

from __future__ import annotations

import pathlib
import re
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


class InputContextContractTests(unittest.TestCase):
    def test_loop_receives_before_building_input_aware_context(self):
        loop = (ROOT / "src" / "loop.metta").read_text(encoding="utf-8")
        body = loop[loop.index("(= (omegaclaw $k)") :]

        receive_at = body.index("(receive)")
        input_recall_at = body.index("(input-recall $msgnew $msg)")
        skill_recall_at = body.index("(skill-recall $msgnew $msg)")
        get_context_at = body.index("(getContext $inputctx $skillctx)")
        send_at = body.index("(py-str ($prompt :-:-:-: $lastmessage))")

        self.assertLess(receive_at, input_recall_at)
        self.assertLess(input_recall_at, skill_recall_at)
        self.assertLess(skill_recall_at, get_context_at)
        self.assertLess(get_context_at, send_at)
        self.assertNotIn("(let $prompt (getContext)", body[:receive_at])

    def test_context_has_backwards_compatible_and_input_aware_forms(self):
        loop = (ROOT / "src" / "loop.metta").read_text(encoding="utf-8")
        self.assertIn('(= (getContext)\n   (getContext ""))', loop)
        self.assertIn('(= (getContext $inputctx)', loop)
        self.assertIn('(= (getContext $inputctx $skillctx)', loop)
        self.assertIn('" INPUT_RECALL: " $inputctx', loop)
        self.assertIn('" SKILL_RECALL: " $skillctx', loop)

    def test_prompt_explains_input_recall_is_hint_not_memory_check(self):
        prompt = (ROOT / "memory" / "prompt.txt").read_text(encoding="utf-8")

        self.assertIn("Always check memory before responding confidently to a fresh human message", prompt)
        self.assertIn("Automatic INPUT_RECALL is only a hint, not the check", prompt)
        self.assertIn("query first and wait/pin the reply-debt", prompt)
        self.assertIn("Fresh inbound human messages are open conversations", prompt)
        self.assertNotIn("Jon", prompt)
        self.assertNotIn("WhatsApp", prompt)

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

    def test_skill_recall_is_symbolic_attention_not_python_router(self):
        loop = (ROOT / "src" / "loop.metta").read_text(encoding="utf-8")
        affordance = (ROOT / "src" / "skills_affordance.metta").read_text(encoding="utf-8")
        helper = (ROOT / "src" / "helper_skill_recall.py").read_text(encoding="utf-8")

        self.assertIn("(skill-recall $msgnew $msg)", loop)
        self.assertIn("SkillRecall", affordance)
        self.assertIn("SkillTrigger", affordance)
        self.assertIn("helper.input_skill_signals_expr", affordance)
        self.assertNotIn("(SkillCardLine", helper)
        self.assertNotIn("(SkillTrigger", helper)

    def test_skill_signal_extraction_is_factual_not_skill_selection(self):
        import helper_skill_recall

        signals = helper_skill_recall.input_skill_signals(
            "Can you inspect src/loop.metta and explain the MeTTa syntax (metta $x)?"
        )

        self.assertIn("has-question", signals)
        self.assertIn("has-file-reference", signals)
        self.assertIn("has-code-shape", signals)
        self.assertIn("mentions-word:metta", signals)
        self.assertIn("mentions-word:syntax", signals)
        self.assertNotIn("read-file", signals)
        self.assertNotIn("test-metta", signals)
        self.assertNotIn("query-skill-space", signals)


if __name__ == "__main__":
    unittest.main()
