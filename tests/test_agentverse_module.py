#!/usr/bin/env python3
"""Regression checks for the optional Agentverse remote-agent module."""

import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import helper_command_parser as parser  # noqa: E402
import helper_metta_syntax as metta  # noqa: E402


def skill_implementation_source():
    files = [ROOT / "src" / "skills.metta"]
    files.extend(sorted((ROOT / "src").glob("skills_*.metta")))
    return "\n".join(path.read_text(encoding="utf-8") for path in files)


class AgentverseModuleTests(unittest.TestCase):
    def test_agentverse_remote_skills_are_modular_optional_surface(self):
        core = (ROOT / "lib_omegaclaw.metta").read_text(encoding="utf-8")
        loader = (ROOT / "modules" / "loader.metta").read_text(encoding="utf-8")
        skills = skill_implementation_source()
        module_entry = (ROOT / "modules" / "agentverse" / "entry.metta").read_text(encoding="utf-8")
        module_skills = (ROOT / "modules" / "agentverse" / "skills.metta").read_text(encoding="utf-8")
        module_affordance = (ROOT / "modules" / "agentverse" / "affordance.metta").read_text(encoding="utf-8")
        module_impl = (ROOT / "modules" / "agentverse" / "src" / "agentverse_bridge.py").read_text(encoding="utf-8")
        listener_impl = (ROOT / "modules" / "agentverse" / "src" / "agentverse_listener.py").read_text(encoding="utf-8")
        module_toml = (ROOT / "modules" / "agentverse" / "module.toml").read_text(encoding="utf-8")
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")

        self.assertFalse((ROOT / "src" / "agentverse.py").exists())
        self.assertIn("./modules/loader.metta", core)
        self.assertNotIn("./modules/agentverse/entry.metta", core)
        self.assertNotIn("./src/agentverse.py", core)
        self.assertNotIn("./modules/agentverse/entry.metta", loader)
        self.assertIn("(Module omegaclaw.remote.agentverse)", module_entry)
        self.assertIn("(Space agentverse)", module_entry)
        self.assertIn("(RuntimeOrgan \"agentverse\" (initAgentverseOrgan))", module_entry)
        self.assertIn("(ModuleOptional omegaclaw.remote.agentverse True)", module_entry)
        self.assertIn("(ModuleDefaultEnabled omegaclaw.remote.agentverse False)", module_entry)
        self.assertIn("./modules/agentverse/src/agentverse_bridge.py", module_entry)
        self.assertIn("(Provides omegaclaw.remote.agentverse (Skill agentverse-discover))", module_entry)
        self.assertIn("(Provides omegaclaw.remote.agentverse (Skill agentverse-call))", module_entry)
        self.assertIn("(Provides omegaclaw.remote.agentverse (Skill agentverse-listener-start))", module_entry)
        self.assertIn("(Provides omegaclaw.remote.agentverse (Skill agentverse-inbox))", module_entry)
        self.assertIn("default_enabled = false", module_toml)
        self.assertNotIn("(= (agentverse-discover $query)", skills)
        self.assertNotIn("(= (agentverse-register-agent $name $address $schema $capability)", skills)
        self.assertIn('(register-space-persistence "agentverse" (library OmegaClaw-Core ./memory/agentverse.metta) runtime-state)', module_skills)
        self.assertIn("(= (agentverse-discover $query $limit)", module_skills)
        self.assertIn("(= (agentverse-discover $query)", module_skills)
        self.assertIn("(= (agentverse-register-agent $name $address $schema $capability)", module_skills)
        self.assertIn("RemoteAgentAlreadyRegistered", module_skills)
        self.assertIn("(= (agentverse-call $name $payload)", module_skills)
        self.assertIn("agentverse_bridge.agentverse_call", module_skills)
        self.assertIn("(= (agentverse-listener-start)", module_skills)
        self.assertIn("(= (agentverse-inbox)", module_skills)
        self.assertIn("(RemoteAgent $name $address $schema $capability)", module_skills)
        self.assertIn("agentverse_bridge.agentverse_status", module_skills)
        self.assertNotIn("(py-call (agentverse.", module_skills)
        self.assertIn('(SkillCardLine "agentverse-register-agent"', module_affordance)
        self.assertIn('(SkillCardLine "agentverse-trace"', module_affordance)
        self.assertIn("AgentChatProtocol", module_impl)
        self.assertIn("ChatMessage", module_impl)
        self.assertIn("ChatAcknowledgement", module_impl)
        self.assertIn("AGENTVERSE-ACK", module_impl)
        self.assertIn("AGENTVERSE-QUEUED", module_impl)
        self.assertIn("OMEGACLAW_AGENTVERSE_ENDPOINT", module_impl)
        self.assertIn("chat_protocol_spec", listener_impl)
        self.assertIn("AgentverseInbound", listener_impl)
        self.assertIn('"User-Agent": "OmegaClaw-Agentverse-Bridge/0.1"', module_impl)
        for old_surface in [
            "TAVILY_SEARCH_AGENT_ADDRESS",
            "TECHNICAL_ANALYSIS_AGENT_ADDRESS",
            "tavily_search",
            "technical_analysis",
            "WebSearchRequest",
            "TechAnalysisRequest",
        ]:
            self.assertNotIn(old_surface, module_entry)
            self.assertNotIn(old_surface, module_skills)
            self.assertNotIn(old_surface, module_impl)
        self.assertIn("uagents", requirements)

    def test_agentverse_signature_rejects_prose_as_limit(self):
        old_state = (
            parser.SIGNATURE_COMMANDS,
            parser.SIGNATURE_KNOWN_SPACES,
            parser.SIGNATURE_MULTILINE_LOWERING,
            parser.SIGNATURE_NO_ACTION_HEADS,
            parser.SIGNATURE_SHORTHANDS,
            parser.SIGNATURE_RECOVERY_HINTS,
            parser.SIGNATURE_SKILL_CARDS,
        )
        try:
            parser.reload_signature_commands(ROOT / "modules" / "agentverse" / "signatures.metta")
            cases = {
                'agentverse-discover "weather" 5': '((agentverse-discover "weather" 5))',
                'agentverse-discover "weather forecast"': '((agentverse-discover "weather forecast" 5))',
            }
            for raw, expected in cases.items():
                actual = parser.signature_balance_parentheses(raw)
                self.assertEqual(actual, expected)
                self.assertEqual(metta.test_metta_expression(actual), "METTA-SYNTAX-OK")
            self.assertIn(
                '(syntax-error "agentverse-discover" "limit must be number',
                parser.signature_balance_parentheses('agentverse-discover "weather" report text'),
            )
        finally:
            (
                parser.SIGNATURE_COMMANDS,
                parser.SIGNATURE_KNOWN_SPACES,
                parser.SIGNATURE_MULTILINE_LOWERING,
                parser.SIGNATURE_NO_ACTION_HEADS,
                parser.SIGNATURE_SHORTHANDS,
                parser.SIGNATURE_RECOVERY_HINTS,
                parser.SIGNATURE_SKILL_CARDS,
            ) = old_state


if __name__ == "__main__":
    unittest.main()
