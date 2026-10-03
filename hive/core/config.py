"""Hive configuration from the environment (and an optional providers file)."""

from __future__ import annotations

import dataclasses
import json
import os
import pathlib

CORE_ROOT = pathlib.Path(__file__).resolve().parents[2]


@dataclasses.dataclass
class Provider:
    """An OpenAI-compatible upstream.  ``mock`` is built in and needs no key."""

    name: str
    base_url: str = ""
    key_env: str = ""
    local: bool = False
    # USD per million tokens, by model name; "*" is the provider default.
    prices: dict = dataclasses.field(default_factory=dict)
    models: list = dataclasses.field(default_factory=list)

    @property
    def api_key(self):
        return os.environ.get(self.key_env, "") if self.key_env else ""

    def price(self, model):
        entry = self.prices.get(model) or self.prices.get("*") or {}
        return float(entry.get("in", 0.0)), float(entry.get("out", 0.0))

    def priced(self, model):
        return bool(self.prices.get(model) or self.prices.get("*"))


DEFAULT_PROVIDERS = [
    Provider("mock", models=["echo"], local=True),
    Provider("anthropic", "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY",
             models=["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
             prices={"claude-opus-5-5": {"in": 15, "out": 75},
                     "claude-sonnet-5-5": {"in": 3, "out": 15},
                     "claude-haiku-4-5-20251001": {"in": 1, "out": 5}}),
    Provider("openai", "https://api.openai.com/v1", "OPENAI_API_KEY", models=["gpt-6.1", "gpt-5.4"]),
    Provider("openrouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", models=["z-ai/glm-5.1"]),
    # Self-hosted OpenAI-compatible servers (vLLM, SGLang, Ollama, llama.cpp).
    Provider("local", os.environ.get("HIVE_LOCAL_LLM_URL", "http://127.0.0.1:8000/v1"),
             "HIVE_LOCAL_LLM_KEY", local=True, models=[]),
]


@dataclasses.dataclass
class Settings:
    data_dir: pathlib.Path
    admin_password: str
    public_url: str
    petta_path: str
    core_root: pathlib.Path
    default_driver: str
    providers: dict
    default_model: str
    embedding_model: str
    # Spend guards (docs/omegadots/DRIFT.md): a cap for the whole hive (0 = none)
    # and a per-agent ceiling on LLM calls per minute, which stops retry storms.
    hive_budget_usd: float = 0.0
    max_llm_calls_per_minute: int = 60
    allow_unpriced: bool = False
    # A claimed goal goes back to the swarm when its claimer stops renewing it.
    goal_lease_minutes: float = 60.0

    @property
    def agents_dir(self):
        return self.data_dir / "agents"


def _load_providers():
    providers = {p.name: p for p in DEFAULT_PROVIDERS}
    path = os.environ.get("HIVE_PROVIDERS_FILE")
    if path and pathlib.Path(path).exists():
        for raw in json.loads(pathlib.Path(path).read_text()):
            provider = Provider(**raw)
            providers[provider.name] = provider
    local_models = os.environ.get("HIVE_LOCAL_LLM_MODELS", "")
    if local_models:
        providers["local"].models = [m.strip() for m in local_models.split(",") if m.strip()]
    return providers


def load_settings(**overrides) -> Settings:
    data_dir = pathlib.Path(os.environ.get("HIVE_DATA_DIR", pathlib.Path.home() / ".omegadots" / "hive"))
    values = dict(
        data_dir=data_dir,
        admin_password=os.environ.get("HIVE_ADMIN_PASSWORD", ""),
        public_url=os.environ.get("HIVE_PUBLIC_URL", "http://127.0.0.1:8700"),
        petta_path=os.environ.get("PETTA_PATH", str(pathlib.Path.home() / "PeTTa")),
        core_root=pathlib.Path(os.environ.get("HIVE_CORE_ROOT", CORE_ROOT)),
        default_driver=os.environ.get("HIVE_DRIVER", "local"),
        providers=_load_providers(),
        default_model=os.environ.get("HIVE_DEFAULT_MODEL", "mock/echo"),
        embedding_model=os.environ.get("HIVE_EMBEDDING_MODEL", "mock/hash"),
        hive_budget_usd=float(os.environ.get("HIVE_BUDGET_USD", "0") or 0),
        max_llm_calls_per_minute=int(os.environ.get("HIVE_MAX_LLM_CALLS_PER_MINUTE", "60") or 0),
        allow_unpriced=os.environ.get("HIVE_ALLOW_UNPRICED", "") == "1",
        goal_lease_minutes=float(os.environ.get("HIVE_GOAL_LEASE_MINUTES", "60") or 60),
    )
    values.update(overrides)
    settings = Settings(**values)
    settings.data_dir = pathlib.Path(settings.data_dir)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.agents_dir.mkdir(parents=True, exist_ok=True)
    return settings
