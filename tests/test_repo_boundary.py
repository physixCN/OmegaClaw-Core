#!/usr/bin/env python3
"""Repository boundary checks for local runtime state.

Memories, logs, auth material, and private device state belong to a
running instance. They must remain local even when source patches are shared.
"""

import pathlib
import re
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def git_lines(*args):
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


class RepositoryBoundaryTests(unittest.TestCase):
    def test_runtime_memory_and_auth_state_are_not_tracked(self):
        tracked = git_lines("ls-files")
        forbidden_exact = {
            "memory/history.metta",
            "memory/prompt.txt",
            "memory/promoted_memories.metta",
            "memory/home_assistant.json",
            "memory/librelinkup.json",
            "memory/librelinkup_cache.json",
            "memory/web/admin_token.txt",
            "memory/web/sessions.json",
            "memory/web/users.json",
        }
        forbidden_prefixes = (
            "memory/inbox/",
            "memory/outbox/",
            "memory/web/public/",
            "channels/whatsapp_bridge/auth",
        )
        leaked = [
            path
            for path in tracked
            if path in forbidden_exact or any(path.startswith(prefix) for prefix in forbidden_prefixes)
        ]
        self.assertEqual(leaked, [])

    def test_tracked_text_files_do_not_contain_obvious_secret_tokens(self):
        tracked = git_lines("ls-files")
        secret_patterns = [
            re.compile(r"sk-or-v1-[A-Za-z0-9_-]+"),
            re.compile(r"xai-[A-Za-z0-9_-]+"),
            re.compile(r"ghp_[A-Za-z0-9_]+"),
            re.compile(r"github_pat_[A-Za-z0-9_]+"),
            re.compile(r"HOME_ASSISTANT_TOKEN[ \t]*=(?![ \t]*\{)[ \t]*\S+"),
            re.compile(r"LIBRE_LINK_UP_PASSWORD[ \t]*=(?![ \t]*\{)[ \t]*\S+"),
        ]
        offenders = []
        for rel in tracked:
            path = ROOT / rel
            if not path.is_file() or path.stat().st_size > 1_000_000:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if any(pattern.search(text) for pattern in secret_patterns):
                offenders.append(rel)
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
