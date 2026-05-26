#!/usr/bin/env python3
"""Repeatable context-view compaction benchmark.

This benchmark uses a temporary memory directory so it never reads or mutates a
live agent history. It measures the LLM-facing HISTORY view only; the raw
history file remains exact.
"""

from __future__ import annotations

import importlib
import os
import pathlib
import sys
import tempfile
import timeit
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


THOUGHT = "(remember \"thought atom remains visible after payload compaction\")\n"
HTML_PAYLOAD = "<html><body>" + ("<section>payload block with exact raw history preserved</section>" * 420) + "</body></html>"
HISTORY = THOUGHT + f"(write-file \"memory/page.html\" \"{HTML_PAYLOAD}\")\n"


def _import_helper(memory_dir: pathlib.Path):
    sys.modules.pop("helper_metta", None)
    with mock.patch.dict(os.environ, {"OMEGACLAW_MEMORY_DIR": str(memory_dir)}, clear=False):
        return importlib.import_module("helper_metta")


def main() -> None:
    loops = 1000
    with tempfile.TemporaryDirectory() as tmpdir:
        memory_dir = pathlib.Path(tmpdir)
        (memory_dir / "history.metta").write_text(HISTORY, encoding="utf-8")
        helper_metta = _import_helper(memory_dir)

        def compact_once() -> str:
            return helper_metta.context_history_tail(100000)

        view = compact_once()
        elapsed = timeit.timeit(compact_once, number=loops)
        raw = (memory_dir / "history.metta").read_text(encoding="utf-8")

        print("BENCHMARK context compaction")
        print(f"loops={loops}")
        print(f"raw_chars={len(raw)}")
        print(f"view_chars={len(view)}")
        print(f"raw_est_tokens={len(raw) // 4}")
        print(f"view_est_tokens={len(view) // 4}")
        print(f"compaction_ratio={len(view) / len(raw):.4f}")
        print(f"total_s={elapsed:.6f}")
        print(f"us_per_context_view={elapsed / loops * 1_000_000:.2f}")
        print(f"raw_history_preserved={'yes' if HTML_PAYLOAD in raw else 'no'}")
        print(f"payload_omitted_from_view={'yes' if HTML_PAYLOAD not in view else 'no'}")
        print(f"thought_visible={'yes' if 'thought atom remains visible' in view else 'no'}")


if __name__ == "__main__":
    main()
