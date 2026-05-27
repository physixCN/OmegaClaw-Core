#!/usr/bin/env python3
"""Run MeTTa smoke tests without accidentally touching live the agent memory.

This runner is intentionally conservative.  Many historical smoke files import
the full OmegaClaw runtime, which imports the live memory spaces used by the
running the agent instance.  Default mode only runs smoke files that are classified
as isolated.  Files that may read or mutate live memory are reported and skipped
unless the caller explicitly passes --allow-live-memory.
"""

from __future__ import annotations

import argparse
import dataclasses
import os
import pathlib
import re
import subprocess
import sys
from typing import Iterable


ROOT = pathlib.Path(__file__).resolve().parents[1]
SMOKE_DIR = ROOT / "tests"


def _default_omegaclaw_root() -> pathlib.Path:
    configured = os.environ.get("OMEGACLAW_ROOT")
    if configured:
        return pathlib.Path(configured).expanduser().resolve()
    for candidate in (ROOT, *ROOT.parents):
        if (candidate / "run.sh").exists():
            return candidate
    legacy = ROOT.parents[1] if len(ROOT.parents) > 1 else ROOT
    return legacy


OMEGACLAW_ROOT = _default_omegaclaw_root()

LIVE_SPACE_NAMES = ("persistent", "agenda", "beliefs", "world", "events", "activity", "cleanup", "attention", "assume")

METADATA_RE = re.compile(r"^;\s*smoke-([a-z-]+):\s*(.*?)\s*$", re.MULTILINE)

LIVE_MEMORY_PATTERNS = {
    "imports-full-runtime": re.compile(r"lib_omegaclaw"),
    "mutates-persistent": re.compile(r"(?:add|remove)-atom\s+&persistent|export!\s+&persistent"),
    "mutates-world": re.compile(r"(?:add|remove)-atom\s+&world|export!\s+&world"),
    "mutates-beliefs": re.compile(r"(?:add|remove)-atom\s+&beliefs|export!\s+&beliefs"),
    "mutates-agenda": re.compile(r"(?:add|remove)-atom\s+&agenda|export!\s+&agenda"),
    "mutates-events": re.compile(r"(?:add|remove)-atom\s+&events|export!\s+&events"),
    "mutates-activity": re.compile(r"(?:add|remove)-atom\s+&activity|export!\s+&activity"),
    "mutates-cleanup": re.compile(r"(?:add|remove)-atom\s+&cleanup|export!\s+&cleanup"),
    "mutates-attention": re.compile(r"(?:add|remove)-atom\s+&attention|export!\s+&attention"),
    "mutates-assume": re.compile(r"(?:add|remove)-atom\s+&assume|export!\s+&assume"),
    "writes-files": re.compile(r"\b(?:write-file|append-file|write-file-base64|append-file-base64)\b"),
    "external-action": re.compile(
        r"\b(?:(?<!-)send(?!-)|send-whatsapp|send-telegram|send-file|use-house-affordance|"
        r"reply-whatsapp|mark-whatsapp-read|mark-whatsapp-unread)\b"
    ),
}

MODE_REASONS = {
    "runtime-skill": "requires-runtime-skill-eval",
    "full-runtime": "imports-full-runtime",
    "manual": "manual-smoke",
}


@dataclasses.dataclass(frozen=True)
class SmokeFile:
    path: pathlib.Path
    reasons: tuple[str, ...]
    isolated: bool
    mode: str = "auto"
    purpose: str = ""


def _binds_temp_space(text: str, space: str) -> bool:
    return bool(re.search(rf"bind!\s+&{re.escape(space)}\s+\(new-space\)", text))


def smoke_metadata(text: str) -> dict[str, str]:
    return {match.group(1): match.group(2).strip() for match in METADATA_RE.finditer(text)}


def classify(path: pathlib.Path) -> SmokeFile:
    text = path.read_text(encoding="utf-8", errors="replace")
    meta = smoke_metadata(text)
    mode = meta.get("mode", "auto")
    reasons = [name for name, pattern in LIVE_MEMORY_PATTERNS.items() if pattern.search(text)]
    if mode in MODE_REASONS and MODE_REASONS[mode] not in reasons:
        reasons.append(MODE_REASONS[mode])

    # A file that mutates a space is still isolated if it explicitly rebinds
    # that same space to a fresh MeTTa space, does not import the full runtime,
    # and does not declare a runtime/manual mode.
    unresolved = []
    for reason in reasons:
        if reason.startswith("mutates-") and mode == "auto":
            space = reason.removeprefix("mutates-")
            if not _binds_temp_space(text, space):
                unresolved.append(reason)
        else:
            unresolved.append(reason)

    isolated = not unresolved
    return SmokeFile(
        path=path,
        reasons=tuple(reasons),
        isolated=isolated,
        mode=mode,
        purpose=meta.get("purpose", ""),
    )


def iter_smokes(selected: Iterable[str] | None = None) -> list[SmokeFile]:
    if selected:
        paths = [pathlib.Path(item) for item in selected]
        paths = [p if p.is_absolute() else ROOT / p for p in paths]
    else:
        paths = sorted(SMOKE_DIR.glob("*.metta"))
    return [classify(path) for path in paths]


def run_smoke(smoke: SmokeFile, timeout: int) -> subprocess.CompletedProcess[str]:
    runner = OMEGACLAW_ROOT / "run.sh"
    if not runner.exists():
        raise FileNotFoundError(
            f"run.sh not found under {OMEGACLAW_ROOT}; set OMEGACLAW_ROOT to a runtime checkout"
        )
    env = os.environ.copy()
    env["OMEGACLAW_RUN_INNER"] = "1"
    return subprocess.run(
        [str(runner), str(smoke.path)],
        cwd=str(OMEGACLAW_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        timeout=timeout,
        env=env,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="Optional smoke files to classify/run")
    parser.add_argument("--list", action="store_true", help="Only list classifications")
    parser.add_argument("--allow-live-memory", action="store_true", help="Allow risky live-memory smoke files")
    parser.add_argument("--allow-runtime-skill", action="store_true", help="Allow runtime-skill smokes that call imported skill definitions")
    parser.add_argument("--summary-only", action="store_true", help="Print classifications and final summary, but suppress passing smoke stdout")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args(argv)

    smokes = iter_smokes(args.files)
    exit_code = 0
    for smoke in smokes:
        if smoke.isolated:
            state = "isolated"
        elif "requires-runtime-skill-eval" in smoke.reasons:
            state = "runtime-skill-risk"
        else:
            state = "live-memory-risk"
        reason_text = ",".join(smoke.reasons) if smoke.reasons else "none"
        rel = smoke.path.relative_to(ROOT)
        print(f"{state}\t{rel}\t{reason_text}")
        if args.list:
            continue
        if not smoke.isolated:
            if "requires-runtime-skill-eval" in smoke.reasons and not args.allow_runtime_skill:
                continue
            if not args.allow_live_memory:
                continue
        try:
            result = run_smoke(smoke, args.timeout)
        except subprocess.TimeoutExpired as exc:
            print(f"TIMEOUT\t{rel}\t{exc}")
            exit_code = 1
            continue
        if not args.summary_only or result.returncode != 0 or re.search(r"(?:^|\n)(?:\x1b\[[0-9;]*m)*[A-Z0-9-]*FAILED-[A-Z0-9-]*\b", result.stdout):
            print(result.stdout[-12000:])
        if result.returncode != 0:
            print(f"FAILED\t{rel}\texit={result.returncode}")
            exit_code = 1
        if re.search(r"(?:^|\n)(?:\x1b\[[0-9;]*m)*[A-Z0-9-]*FAILED-[A-Z0-9-]*\b", result.stdout):
            print(f"FAILED\t{rel}\tsemantic-failure-sentinel")
            exit_code = 1
    total = len(smokes)
    isolated_count = sum(1 for smoke in smokes if smoke.isolated)
    runtime_skill_count = sum(1 for smoke in smokes if "requires-runtime-skill-eval" in smoke.reasons)
    live_risk_count = sum(1 for smoke in smokes if (not smoke.isolated and "requires-runtime-skill-eval" not in smoke.reasons))
    print(f"smoke-summary total={total} isolated={isolated_count} runtime_skill={runtime_skill_count} live_memory_or_manual={live_risk_count} exit={exit_code}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
