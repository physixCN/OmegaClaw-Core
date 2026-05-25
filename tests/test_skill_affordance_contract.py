#!/usr/bin/env python3
"""Static contract checks for symbolic skill affordance declarations."""

from __future__ import annotations

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


def _text(pattern: str) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(SRC.glob(pattern)))


def _help_topics() -> set[str]:
    topics: set[str] = set()
    for match in re.finditer(r'\(SkillHelp\s+"([^"]+)"\s+', _text("skill_catalog*.metta")):
        topics.add(match.group(1))
    return topics


def _context_hints() -> list[tuple[str, str]]:
    return [
        (match.group(1), match.group(2))
        for match in re.finditer(
            r'\(SkillContextHint\s+"([^"]+)"\s+"([^"]+)"\)', _text("skill_catalog*.metta")
        )
    ]


def _affordance_topics() -> set[str]:
    topics: set[str] = set()
    for match in re.finditer(r'\(SkillTopic\s+"[^"]+"\s+"([^"]+)"\)', _text("skill_affordance*.metta")):
        topics.add(match.group(1))
    return topics


def _affordance_signatures() -> set[str]:
    source = (SRC / "skill_signatures_affordance.metta").read_text(encoding="utf-8")
    return set(re.findall(r"\(SkillSignature\s+([^\s()]+)", source))


def _affordance_implementations() -> set[str]:
    source = (SRC / "skills_affordance.metta").read_text(encoding="utf-8")
    return set(re.findall(r"\(=\s+\(([^\s()]+)", source))


class SkillAffordanceContractTests(unittest.TestCase):
    def test_affordance_commands_are_implemented(self):
        self.assertLessEqual(_affordance_signatures(), _affordance_implementations())

    def test_help_topics_are_discoverable_through_affordance_topics(self):
        missing = sorted(_help_topics() - _affordance_topics())
        self.assertEqual(missing, [])

    def test_affordance_declarations_are_loaded_by_composition_after_space_exists(self):
        declaration_files = [
            "skill_affordance_core.metta",
            "skill_affordance_memory.metta",
            "skill_affordance_reasoning.metta",
            "skill_affordance_affordance.metta",
        ]
        organ = (SRC / "skills_affordance.metta").read_text(encoding="utf-8")
        for filename in declaration_files:
            self.assertNotIn(filename, organ)

        for relative in ["src/skills.metta", "lib_omegaclaw.metta"]:
            source = (ROOT / relative).read_text(encoding="utf-8")
            organ_index = source.index("skills_affordance.metta")
            for filename in declaration_files:
                self.assertGreater(source.index(filename), organ_index)

    def test_getskills_is_context_bootstrap_not_full_catalogue(self):
        source = (SRC / "skill_catalog.metta").read_text(encoding="utf-8")
        getskills_body = re.search(r"\(=\s+\(getSkills\).*?\n\n\(=", source, re.S)
        self.assertIsNotNone(getskills_body)
        self.assertIn("SkillContextHint", getskills_body.group(0))
        self.assertNotIn("SkillCatalog", getskills_body.group(0))
        self.assertIsNotNone(re.search(r"\(=\s+\(getFullSkills\).*SkillCatalog", source, re.S))

        hints = _context_hints()
        domains = [domain for domain, _line in hints]
        self.assertIn("core", domains)
        self.assertIn("affordance", domains)
        self.assertEqual(len(hints), len(set(hints)))
        self.assertLess(sum(len(line) for _domain, line in hints), 700)

    def test_context_hints_only_reference_loaded_help_topics(self):
        missing = sorted({domain for domain, _line in _context_hints()} - _help_topics())
        self.assertEqual(missing, [])



    def test_attention_trigger_surface_is_symbolic(self):
        source = (SRC / "skills_affordance.metta").read_text(encoding="utf-8")
        declarations = (SRC / "skill_affordance_affordance.metta").read_text(encoding="utf-8")
        signatures = _affordance_signatures()
        expected = {
            "skill-suggestions-for",
            "suggest-skill-trigger",
            "add-skill-trigger",
            "promote-skill-trigger",
            "skill-trigger-candidates",
        }
        self.assertLessEqual(expected, signatures)
        for atom in ["SkillTrigger", "CandidateSkillTrigger", "AttentionSkillSuggestion"]:
            self.assertIn(atom, source + declarations)
        self.assertNotIn("import helper_command_parser", source)

    def test_affordance_files_do_not_contain_deployment_secrets(self):
        source = _text("skill_affordance*.metta") + _text("skill_catalog_affordance.metta")
        forbidden_patterns = {
            "api token": (
                r"\b(?:" + "|".join(["sk", "g" + "hp", "github" + "_pat"]) + r")_[A-Za-z0-9_\-]{12,}"
            ),
            "private key block": r"BEGIN [A-Z ]*PRIVATE KEY",
            "email address": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
            "user home path": r"/(?:home|Users)/[^\s\"()]+",
            "phone-like number": r"\b0\d{10}\b",
        }
        leaked = [name for name, pattern in forbidden_patterns.items() if re.search(pattern, source)]
        self.assertEqual(leaked, [])


if __name__ == "__main__":
    unittest.main()
