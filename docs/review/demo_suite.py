#!/usr/bin/env python3
"""Reviewer-facing demos for OmegaClaw v0.01a.

Benchmarks answer "how much?". This suite answers "what does the patch do?"
with deterministic, sanitized demonstrations that do not spend LLM tokens and do
not require private runtime memory. Optional engines such as FabricPC are run
when available and reported as skipped otherwise.
"""

from __future__ import annotations

import argparse
import base64
import importlib
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass


ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "src"


@dataclass
class DemoSection:
    title: str
    status: str
    lines: list[str]


def _token_est(chars: int) -> int:
    return max(1, round(chars / 4)) if chars else 0


def _status(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def syntax_membrane_demo() -> DemoSection:
    sys.path.insert(0, str(SRC))
    import helper_command_parser as parser

    rich_text = "Line one: colon survives\nLine two with (parentheses) and symbols"
    rich_payload = base64.b64encode(rich_text.encode("utf-8")).decode("ascii")
    cases = [
        ("colon chat", "send Status: alive and checking context", "send"),
        ("multiline file write", f'write-file memory/demo.txt """\n{rich_text}\n"""', "write-file-base64"),
        ("agentverse default limit", 'agentverse-discover "word counter agent"', "agentverse-discover"),
        ("bad numeric arg", "set-loop-energy awake 20 3 120 because I forgot the number", "syntax-error"),
    ]
    rows = []
    ok = True
    for name, raw, expected in cases:
        parsed = parser.signature_balance_parentheses(raw)
        found = expected in parsed
        if name == "multiline file write":
            found = found and rich_payload in parsed
        ok = ok and found
        preview = parsed.replace("\n", " ")[:180]
        rows.append(f"| {name} | `{expected}` | {'yes' if found else 'no'} | `{preview}` |")
    return DemoSection(
        "Syntax Membrane",
        _status(ok),
        [
            "The command membrane accepts natural-ish command text and lowers risky shapes into explicit skill calls.",
            "",
            "| Scenario | Expected surface | Passed | Parsed preview |",
            "|---|---|---:|---|",
            *rows,
        ],
    )


def _large_html_payload() -> str:
    blocks = []
    for i in range(180):
        blocks.append(
            "<section class=demo-block>"
            f"<h2>Omega context payload block {i}</h2>"
            "<p>Sanitized page body: symbolic thoughts before and after this payload should remain visible. "
            "This imitates a real Omega webpage/write payload without private names, routes, or secrets.</p>"
            "<ul><li>trace remains exact</li><li>context view is compact</li><li>file content is not summarized</li></ul>"
            "</section>"
        )
    return "<!doctype html><html><body>" + "\n".join(blocks) + "</body></html>"


def _import_helpers_with_memory(memory_dir: pathlib.Path):
    os.environ["OMEGACLAW_MEMORY_DIR"] = str(memory_dir)
    for name in ("helper_metta", "helper_history"):
        sys.modules.pop(name, None)
    sys.path.insert(0, str(SRC))
    return importlib.import_module("helper_metta"), importlib.import_module("helper_history")


def context_payload_demo() -> DemoSection:
    with tempfile.TemporaryDirectory() as tmpdir:
        memory_dir = pathlib.Path(tmpdir)
        payload = _large_html_payload()
        before_marker = "VISIBLE_BEFORE_PAYLOAD_THOUGHT"
        after_marker = "VISIBLE_AFTER_PAYLOAD_THOUGHT"
        history = (
            f'("2026-05-27 10:00:00"\n ((remember "{before_marker}: choose action after checking prior goal atoms"))\n "RESULTS: " "ok"\n)\n'
            f'("2026-05-27 10:01:00"\n ((write-file "memory/web/demo.html" "{payload}"))\n "RESULTS: " "WRITE-FILE-SUCCESS"\n)\n'
            f'("2026-05-27 10:02:00"\n ((remember "{after_marker}: report that raw file content remains intact"))\n "RESULTS: " "ok"\n)\n'
        )
        history_path = memory_dir / "history.metta"
        history_path.write_text(history, encoding="utf-8")
        helper_metta, _ = _import_helpers_with_memory(memory_dir)

        raw_tail_view = history[-30000:]
        compacted = helper_metta.context_recent_history_entries(30000, 12)
        placeholder = re.search(r"<context-omitted-payload chars=(\d+) raw-history-preserved>", compacted)
        raw = history_path.read_text(encoding="utf-8")
        payload_probe = payload[:120]

        rows = [
            ("uncompacted tail view", len(raw_tail_view), _token_est(len(raw_tail_view)), before_marker in raw_tail_view, payload_probe in raw_tail_view),
            ("candidate compacted view", len(compacted), _token_est(len(compacted)), before_marker in compacted, payload_probe in compacted),
            ("raw history on disk", len(raw), _token_est(len(raw)), before_marker in raw, payload_probe in raw),
        ]
        table = ["| View | Chars | Token est. | Before thought visible | Payload start visible |", "|---|---:|---:|---:|---:|"]
        for label, chars, tokens, before_visible, payload_visible in rows:
            table.append(
                f"| {label} | {chars} | {tokens} | {'yes' if before_visible else 'no'} | {'yes' if payload_visible else 'no'} |"
            )
        ok = bool(placeholder) and before_marker in compacted and after_marker in compacted and payload in raw and payload_probe not in compacted
        omitted_chars = int(placeholder.group(1)) if placeholder else 0
        reduction = 1 - (len(compacted) / max(1, len(raw_tail_view)))
        return DemoSection(
            "Context Payload Compaction",
            _status(ok),
            [
                "A sanitized Omega-history-shaped file-write payload is preserved exactly in raw history while the LLM-facing history view gets a mechanical placeholder.",
                "",
                *table,
                "",
                "- Omitted from context: only the bulky payload argument of a skill whose MeTTa metadata declares `SkillContextView compact-payload`.",
                "- Kept in context: command head, target path/label, surrounding top-level history entries, thought atoms, and result metadata.",
                "- Why omitted: generated artifacts can dominate the attention window and hide nearby cognition; the raw trace remains the audit source.",
                "- Placeholder shape: `<context-omitted-payload chars=N raw-history-preserved>`",
                f"- Placeholder recorded command chars: `{omitted_chars}`",
                f"- Prompt-view reduction versus a raw 30k tail: `{reduction:.1%}`",
                "- No semantic summary is produced; the placeholder is mechanical and says raw history is preserved.",
            ],
        )


def episodes_demo() -> DemoSection:
    with tempfile.TemporaryDirectory() as tmpdir:
        memory_dir = pathlib.Path(tmpdir)
        long_token = "A" * 2600
        history = (
            f'("2026-05-27 00:01:00"\n ((write-file-base64 "/tmp/big" "{long_token}"))\n "RESULTS: " "ok"\n)\n'
            '("2026-05-27 01:55:14"\n "HUMAN_MESSAGE: " WHATSAPP: Operator: Omega?\n ((reply-whatsapp-to "123@lid" "I used marker here"))\n "RESULTS: " "ok"\n)\n'
        )
        (memory_dir / "history.metta").write_text(history, encoding="utf-8")
        _, helper_history = _import_helpers_with_memory(memory_dir)
        date_view = helper_history.episodes_at("2026-05-27", k=20, max_chars=1200)
        precise_view = helper_history.episodes_at("2026-05-27 01:55", k=20, max_chars=1200)
        ok = "EPISODES-ON 2026-05-27" in date_view and "<long-token chars=2600>" in date_view and "EPISODES-AT 2026-05-27 01:55:00" in precise_view
        return DemoSection(
            "Bounded Episode Recall",
            _status(ok),
            [
                "Date-only recall returns an index-style view, while precise recall returns a bounded nearby trace window.",
                "",
                f"- Date-only header: `{date_view.splitlines()[0]}`",
                f"- Long token compacted: `{'yes' if '<long-token chars=2600>' in date_view else 'no'}`",
                f"- Precise lookup header: `{precise_view.splitlines()[0]}`",
            ],
        )


def module_surface_demo() -> DemoSection:
    modules = sorted(path.parent.name for path in (ROOT / "modules").glob("*/module.toml"))
    loader_path = ROOT / "modules" / "loader.metta"
    loader = loader_path.read_text(encoding="utf-8") if loader_path.exists() else ""
    enabled = sorted(re.findall(r"\.\/modules\/([^/]+)\/entry\.metta", loader))
    signature_count = sum(
        1
        for path in ROOT.glob("**/signatures.metta")
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
        if line.strip().startswith("(SkillSignature ")
    )
    skill_count = sum(
        1
        for path in ROOT.glob("**/affordance.metta")
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
        if "(Skill " in line
    )
    shown_modules = ", ".join(enabled[:12]) + (", ..." if len(enabled) > 12 else "")
    ok = len(modules) >= 20 and len(enabled) >= 1 and signature_count > 100
    return DemoSection(
        "Module And Skill Surface",
        _status(ok),
        [
            "The patch moves abilities into module-owned contracts and exposes skills through symbolic metadata.",
            "",
            f"- Module manifests: `{len(modules)}`",
            f"- Enabled by loader: `{len(enabled)}`",
            f"- Enabled examples: `{shown_modules}`",
            f"- Skill signatures found: `{signature_count}`",
            f"- Affordance skill declarations found: `{skill_count}`",
        ],
    )


def agentverse_surface_demo() -> DemoSection:
    module = ROOT / "modules" / "agentverse"
    signatures = (module / "signatures.metta").read_text(encoding="utf-8", errors="replace")
    skills = re.findall(r"\(SkillSignature\s+([^\s()]+)", signatures)
    required = {
        "agentverse-status",
        "agentverse-discover",
        "agentverse-register-agent",
        "agentverse-call",
        "agentverse-listener-start",
        "agentverse-inbox",
        "agentverse-trace",
    }
    ok = required.issubset(set(skills)) and (module / "src" / "agentverse_bridge.py").exists()
    return DemoSection(
        "AgentVerse Module Surface",
        _status(ok),
        [
            "The remote-agent bridge is module-owned; this demo checks the inspectable surface without making a live network call.",
            "",
            f"- Signature count: `{len(skills)}`",
            f"- Required commands present: `{len(required.intersection(skills))}/{len(required)}`",
            f"- Commands: `{', '.join(skills)}`",
        ],
    )


def assume_story_demo() -> DemoSection:
    env = dict(os.environ)
    fabric_repo = pathlib.Path(env.get("FABRICPC_REPO", "/home/jon/OmegaClaw/repos/FabricPC"))
    fabric_python = pathlib.Path(env.get("FABRICPC_PYTHON", str(fabric_repo / ".venv" / "bin" / "python")))
    if fabric_python.exists():
        env["FABRICPC_REPO"] = str(fabric_repo)
        env["FABRICPC_PYTHON"] = str(fabric_python)
    proc = subprocess.run(
        [sys.executable, str(ROOT / "tests" / "assume_demo_story.py")],
        cwd=ROOT,
        timeout=180,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    output = proc.stdout.strip()
    if proc.returncode == 77:
        return DemoSection(
            "Assume / FabricPC Story",
            "SKIP",
            ["FabricPC is not configured in this environment.", "", "```text", output[-2000:], "```"],
        )
    ok = proc.returncode == 0 and "PREDICT_BEFORE" in output and "WRITEBACK" in output and "PREDICT_AFTER" in output
    interesting = []
    for line in output.splitlines():
        if line.startswith(("LOAD", "PREDICT_", "AUDIT_", "LEARN", "WRITEBACK", "PERSIST", "RELOAD", "DELTA")):
            interesting.append(line)
    return DemoSection(
        "Assume / FabricPC Story",
        _status(ok),
        [
            "A sanitized smart-habitat graph is loaded, predicted, audited, learned against explicit targets, written back symbolically, and reloaded.",
            "",
            "```text",
            *interesting[:40],
            "```",
        ],
    )


def build_report(sections: list[DemoSection]) -> str:
    passed = sum(1 for section in sections if section.status == "PASS")
    skipped = sum(1 for section in sections if section.status == "SKIP")
    failed = sum(1 for section in sections if section.status == "FAIL")
    lines = [
        "# v0.01a Demo Suite Results",
        "",
        "These demos are reviewer-facing examples, not runtime cognition. They use sanitized fixtures and local code paths so reviewers can see what the patch family does without private Omega Live memory.",
        "",
        f"Summary: `{passed}` passed, `{skipped}` skipped, `{failed}` failed.",
        "",
        "| Demo | Status |",
        "|---|---:|",
    ]
    for section in sections:
        lines.append(f"| {section.title} | {section.status} |")
    for section in sections:
        lines.extend(["", f"## {section.title}", "", f"Status: `{section.status}`", "", *section.lines])
    lines.extend([
        "",
        "## How To Rerun",
        "",
        "```bash",
        "PYTHONPATH=src python3 docs/review/demo_suite.py --output docs/review/v0.01a-demo-results.md",
        "```",
    ])
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", help="optional markdown path to write")
    args = parser.parse_args(argv)
    sections = [
        syntax_membrane_demo(),
        context_payload_demo(),
        episodes_demo(),
        module_surface_demo(),
        agentverse_surface_demo(),
        assume_story_demo(),
    ]
    report = build_report(sections)
    if args.output:
        pathlib.Path(args.output).write_text(report, encoding="utf-8")
    print(report)
    return 1 if any(section.status == "FAIL" for section in sections) else 0


if __name__ == "__main__":
    raise SystemExit(main())
