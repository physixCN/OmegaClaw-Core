#!/usr/bin/env python3
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import helper  # noqa: E402


class BodySyntaxSmokeTests(unittest.TestCase):
    def assert_metta_ok(self, expression):
        self.assertEqual(helper.test_metta_expression(expression), "METTA-SYNTAX-OK")

    def assert_parse(self, raw, expected):
        actual = helper.signature_balance_parentheses(raw)
        self.assertEqual(actual, expected)
        self.assert_metta_ok(actual)

    def test_body_house_media_and_health_examples(self):
        cases = {
            "observe-glucose Patient": '((observe-glucose "Patient"))',
            "glucose-history Patient 12": '((glucose-history "Patient" 12))',
            "glucose-rings Patient": '((glucose-rings "Patient"))',
            "observe gameboy": '((observe "gameboy"))',
            "observe room Living Room": '((observe "room Living Room"))',
            "observe glucose Patient": '((observe "glucose Patient"))',
            "generate-video a cat playing with a toy: cozy room": '((generate-video "a cat playing with a toy: cozy room"))',
            "I will check now.\nobserve-glucose Patient": '((wait "ignored unknown command head I; use only commands listed in SKILLS; recover: use wait \\"reason\\" for prose/no-action, or query-skill-space \\"topic\\" / choose-skill-for \\"situation\\" for discovery") (observe-glucose "Patient"))',
            "observe-glucose Patient then tell them": '((syntax-error "observe-glucose" "unexpected trailing text: then tell them; card: observe-glucose person - inspect glucose app data; recover: quote text args, use the exact arity, or switch to a rest-text discovery skill" "observe-glucose Patient then tell them"))',
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw[:80]):
                self.assert_parse(raw, expected)

    def test_body_catalog_help(self):
        self.assertIn("observe-glucose person", helper.skill_help("health"))
        self.assertNotIn("observe-house", helper.skill_help("house"))
        self.assertNotIn("use-house-affordance", helper.skill_help("lights"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
