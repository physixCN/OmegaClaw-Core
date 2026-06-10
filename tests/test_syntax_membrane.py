"""Syntax membrane contract tests (stage 1).

The membrane replaces free-form parenthesis repair with signature-driven,
fail-closed parsing: model output is plain prose plus one command per line;
every command is validated against src/skill_signatures*.metta; failures
return compact recovery hints instead of guessed mutations.
"""

import base64
import pathlib
import sys
import tempfile
import unittest

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import helper_command_parser as parser  # noqa: E402
import helper_metta_syntax as syntax  # noqa: E402


def parse(text):
    return parser.signature_balance_parentheses(text)


class CleanCommandTests(unittest.TestCase):
    def test_every_declared_head_loads(self):
        for head in (
            "send", "pin", "remember", "query", "episodes", "wait", "shell",
            "read-file", "write-file", "append-file", "search",
            "tavily-search", "technical-analysis", "get", "metta", "test-metta",
        ):
            self.assertIn(head, parser.SIGNATURE_COMMANDS, head)

    def test_quoted_send(self):
        self.assertEqual(parse('send "Hello there"'), '((send "Hello there"))')

    def test_unquoted_rest_text_is_accepted(self):
        self.assertEqual(parse("remember Jon prefers autumn"),
                         '((remember "Jon prefers autumn"))')

    def test_multiple_commands_one_per_line(self):
        out = parse('send "hi"\npin "working on the report"')
        self.assertEqual(out, '((send "hi") (pin "working on the report"))')

    def test_prose_mixed_with_commands_keeps_commands(self):
        out = parse('I will greet first.\nsend "hi"')
        self.assertIn('(send "hi")', out)

    def test_technical_analysis_single_token(self):
        self.assertEqual(parse("technical-analysis NVDA"),
                         "((technical-analysis \"NVDA\"))")


class RawMettaTests(unittest.TestCase):
    def test_nal_expression_passes_through(self):
        nal = 'metta (|- ((--> garfield animal) (stv 1.0 0.9)))'
        out = parse(nal)
        self.assertIn('(metta "(|- ((--> garfield animal) (stv 1.0 0.9)))")', out)

    def test_unbalanced_metta_is_refused_with_hint(self):
        out = parse("metta (|- ((--> garfield animal)")
        self.assertIn("syntax-error", out)
        self.assertNotIn("(metta ", out.replace("(metta-syntax", ""))


class NoActionTests(unittest.TestCase):
    def test_plain_prose_becomes_no_action(self):
        out = parse("Good morning, just thinking out loud.")
        self.assertIn("wait", out)
        self.assertNotIn("(send ", out)

    def test_markdown_fences_never_execute(self):
        out = parse("```python\nprint(1)\n```")
        self.assertNotIn("(shell", out)
        self.assertNotIn("(metta", out)

    def test_unknown_head_is_safe(self):
        out = parse("frobnicate the widgets")
        self.assertNotIn("(frobnicate", out)


class WriteSurfaceTests(unittest.TestCase):
    def test_multiline_write_lowers_to_base64_and_round_trips(self):
        body = "line one\nline two with \"quotes\"\nline three"
        out = parse(f'write-file /tmp/membrane-test.txt """{body}"""')
        self.assertIn("write-file-base64", out)
        payload = out.split('"')[-2]
        self.assertEqual(base64.b64decode(payload).decode(), body)

    def test_write_surface_decodes_and_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = pathlib.Path(tmp) / "out.txt"
            payload = base64.b64encode(b"hello membrane").decode()
            result = syntax.write_file_base64(str(target), payload)
            self.assertIn("SUCCESS", result)
            self.assertEqual(target.read_text(), "hello membrane")

    def test_invalid_base64_fails_closed(self):
        result = syntax.write_file_base64("/tmp/never.txt", "***not-base64***")
        self.assertIn("ERROR", result)


class RecoveryTests(unittest.TestCase):
    def test_missing_argument_refused_with_hint(self):
        out = parse("read-file")
        self.assertIn("syntax-error", out)

    def test_output_is_always_a_balanced_command_list(self):
        def balanced_outside_strings(text):
            depth = 0
            in_str = esc = False
            for ch in text:
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth < 0:
                        return False
            return depth == 0 and not in_str

        for text in ("send \"x\"", "gibberish", "", "(((", "metta (foo"):
            out = parse(text)
            self.assertTrue(out.startswith("("), repr(out))
            self.assertTrue(balanced_outside_strings(out), repr(out))


if __name__ == "__main__":
    unittest.main()
