"""Per-agent workspace on disk, shared by every driver.

    <data>/agents/<id>/
      run.metta            entry file (PeTTa resolves imports against its dir)
      repos/OmegaClaw-Core -> the shared checkout (git-import! finds it here)
      repos/petta_lib_chromadb
      memory/              OMEGACLAW_MEMORY_DIR: spaces, history, hive channel files
      memory/prompt.txt    base prompt + persona
      token                the agent's hive token (0600)
      agent.log
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess

RUN_METTA = """!(import! &self (library lib_import))
!(git-import! "https://github.com/asi-alliance/OmegaClaw-Core.git")
!(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw))))
!(omegaclaw)
"""

CHROMADB_LIB_URL = "https://github.com/patham9/petta_lib_chromadb.git"

HIVE_PROMPT = """

## You are {name}, a dot in an OmegaDots Hive
You run continuously. People and other dots reach you through the hive channel;
reply with `send`. You belong to a swarm that shares a commons of beliefs:
- `hive-publish <statement> <f> <c>` shares a belief, e.g. `hive-publish (--> sky blue) 0.9 0.8`.
  Statements are MeTTa expressions; f is how true, c how confident (0 < c < 1).
- `hive-query <pattern>` searches the commons, e.g. `hive-query (Current (--> sky $x) $tv $stamp)`.
- `hive-belief <statement>` shows a shared belief with its sources.
Beliefs from independent evidence are merged by revision; repeating what another
dot told you does not make it more certain.
"""


class Workspace:
    def __init__(self, settings):
        self.settings = settings

    def path(self, agent_id) -> pathlib.Path:
        return self.settings.agents_dir / agent_id

    def chromadb_lib(self) -> pathlib.Path:
        lib = self.settings.data_dir / "libs" / "petta_lib_chromadb"
        if not (lib / "lib_chromadb.metta").exists():
            lib.parent.mkdir(parents=True, exist_ok=True)
            source = os.environ.get("HIVE_CHROMADB_LIB")
            if source and pathlib.Path(source).exists():
                shutil.copytree(source, lib, dirs_exist_ok=True)
            else:
                subprocess.run(["git", "clone", "-q", "--depth", "1", CHROMADB_LIB_URL, str(lib)], check=True)
        return lib

    def base_prompt(self):
        prompt = self.settings.core_root / "memory" / "prompt.txt"
        return prompt.read_text(encoding="utf-8") if prompt.exists() else "You are Omega, an always-on agent."

    def write_prompt(self, agent):
        memory = self.path(agent["id"]) / "memory"
        memory.mkdir(parents=True, exist_ok=True)
        text = self.base_prompt().replace("Omega", agent["name"])
        text += HIVE_PROMPT.format(name=agent["name"])
        if agent.get("persona"):
            text += f"\n## Persona\n{agent['persona'].strip()}\n"
        (memory / "prompt.txt").write_text(text, encoding="utf-8")

    def create(self, agent, token):
        root = self.path(agent["id"])
        (root / "repos").mkdir(parents=True, exist_ok=True)
        (root / "run.metta").write_text(RUN_METTA, encoding="utf-8")
        links = {"OmegaClaw-Core": self.settings.core_root, "petta_lib_chromadb": self.chromadb_lib()}
        for name, target in links.items():
            link = root / "repos" / name
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(pathlib.Path(target).resolve())
        token_file = root / "token"
        token_file.write_text(token, encoding="utf-8")
        token_file.chmod(0o600)
        self.write_prompt(agent)
        return root

    def token(self, agent_id):
        return (self.path(agent_id) / "token").read_text(encoding="utf-8").strip()

    def env(self, agent, hub_url, api_url, memory_dir=None):
        """Environment for an Omega agent talking to this hive."""
        token = self.token(agent["id"])
        memory = memory_dir or str(self.path(agent["id"]) / "memory")
        llm = f"{api_url.rstrip('/')}/llm/v1"
        return {
            "LANG": "C.UTF-8",
            "commchannel": "hive",
            "HIVE_WS_URL": hub_url,
            "HIVE_WS_TOKEN": token,
            "HIVE_API_URL": api_url,
            "HIVE_AGENT_ID": agent["id"],
            "OMEGACLAW_MEMORY_DIR": memory,
            "provider": "Hive",
            "HIVE_LLM_URL": llm,
            "HIVE_LLM_TOKEN": token,
            "OPENAI_BASE_URL": llm,
            "OPENAI_API_KEY": token,
            "embeddingprovider": "OpenAI",
        }
