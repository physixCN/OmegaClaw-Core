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

    def test_affordance_files_do_not_contain_local_private_names(self):
        source = _text("skill_affordance*.metta") + _text("skill_catalog_affordance.metta")
        forbidden = ["Jon", "Omega", "Grovey", "WhatsApp", "Home Assistant"]
        leaked = [word for word in forbidden if word in source]
        self.assertEqual(leaked, [])


if __name__ == "__main__":
    unittest.main()
