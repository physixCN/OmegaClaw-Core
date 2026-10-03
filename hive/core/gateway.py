"""LLM gateway: an OpenAI-compatible endpoint in front of every model.

Agents call ``/llm/v1/chat/completions`` and ``/llm/v1/embeddings`` with their
own hive token.  The gateway picks the upstream from the agent's ``model``
(``<provider>/<model>``), injects the provider key, meters tokens and cost,
and refuses calls once the agent's budget is spent.  Keys never reach agents.

``mock/echo`` is a built-in offline model that speaks the Omega skill-line
format, so a hive can be demoed and tested without any provider.
"""

from __future__ import annotations

import hashlib
import math
import re
import time

import httpx

from .config import Provider

EMBED_DIM = 384


class GatewayError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def split_model(model):
    provider, _, name = str(model).partition("/")
    if not name:
        raise GatewayError(400, "bad_model", f"model must be <provider>/<model>, got {model!r}")
    return provider, name


def _completion(model, text, prompt_tokens, completion_tokens):
    return {
        "id": f"hive-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                  "total_tokens": prompt_tokens + completion_tokens},
    }


def _prompt_text(body):
    parts = []
    for message in body.get("messages", []):
        content = message.get("content")
        if isinstance(content, list):
            content = " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
        parts.append(str(content or ""))
    return "\n".join(parts)


def mock_reply(agent_name, prompt):
    """A tiny deterministic 'mind' for offline hives.

    It only answers when the prompt carries a new human message:
      believe <statement> [f c]  -> publish the belief to the swarm and confirm
      ask <pattern>              -> query the swarm commons
      anything else              -> a friendly echo
    """
    if "HUMAN-MSG:" not in prompt:
        return "wait idle"
    tail = prompt.rsplit("HUMAN-MSG:", 1)[1]
    # The CHANNEL_EVENT block may arrive flattened onto one line, so stop at the
    # next key=value field.
    found = re.findall(r"text=(.*?)(?=\s+[a-z_]+=|_newline_|\n|$)", tail)
    text = (found[-1] if found else tail).strip().strip('")')
    text = text.replace('\\"', '"')
    lowered = text.lower()
    if lowered.startswith("believe "):
        body = text[8:].strip()
        match = re.match(r"^(\(.*\))\s*([0-9.]+)?\s*([0-9.]+)?$", body)
        if match:
            statement, f, c = match.group(1), match.group(2) or "0.9", match.group(3) or "0.8"
            return f"hive-publish {statement} {f} {c}\nsend I now believe {statement}"
    if lowered.startswith("ask "):
        return f"hive-query {text[4:].strip()}\nsend Looking that up in our commons"
    return f"send I hear you - \"{text[:300]}\""


def mock_embedding(text):
    """Deterministic unit vector from hashed character trigrams."""
    vector = [0.0] * EMBED_DIM
    text = f"  {text.lower()}  "
    for i in range(len(text) - 2):
        digest = hashlib.blake2b(text[i:i + 3].encode(), digest_size=4).digest()
        vector[int.from_bytes(digest, "little") % EMBED_DIM] += 1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


class Gateway:
    def __init__(self, providers: dict[str, Provider], timeout=600):
        self.providers = providers
        self.client = httpx.AsyncClient(timeout=timeout)

    def provider(self, name) -> Provider:
        provider = self.providers.get(name)
        if provider is None:
            raise GatewayError(400, "unknown_provider", f"no provider {name!r}")
        return provider

    def cost(self, provider, model, prompt_tokens, completion_tokens):
        price_in, price_out = provider.price(model)
        return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000

    async def chat(self, agent, body):
        """Returns (response_json, usage_dict)."""
        provider_name, model = split_model(agent["model"])
        provider = self.provider(provider_name)
        if body.get("stream"):
            raise GatewayError(400, "stream_unsupported", "streaming is not supported yet")
        if provider_name == "mock":
            prompt = _prompt_text(body)
            text = mock_reply(agent["name"], prompt)
            pt, ct = max(1, len(prompt) // 4), max(1, len(text) // 4)
            return _completion(agent["model"], text, pt, ct), {"prompt_tokens": pt, "completion_tokens": ct, "cost_usd": 0.0}
        if not provider.base_url:
            raise GatewayError(500, "provider_unconfigured", f"{provider_name} has no base_url")
        upstream = dict(body, model=model)
        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        response = await self.client.post(f"{provider.base_url.rstrip('/')}/chat/completions", json=upstream, headers=headers)
        if response.status_code >= 400:
            raise GatewayError(response.status_code, "upstream_error", response.text[:500])
        data = response.json()
        usage = data.get("usage") or {}
        pt, ct = int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
        return data, {"prompt_tokens": pt, "completion_tokens": ct, "cost_usd": self.cost(provider, model, pt, ct)}

    async def embeddings(self, embedding_model, body):
        provider_name, model = split_model(embedding_model)
        inputs = body.get("input", "")
        inputs = inputs if isinstance(inputs, list) else [inputs]
        if provider_name == "mock":
            data = [{"object": "embedding", "index": i, "embedding": mock_embedding(str(t))} for i, t in enumerate(inputs)]
            return {"object": "list", "data": data, "model": embedding_model,
                    "usage": {"prompt_tokens": 0, "total_tokens": 0}}
        provider = self.provider(provider_name)
        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        response = await self.client.post(f"{provider.base_url.rstrip('/')}/embeddings",
                                          json=dict(body, model=model), headers=headers)
        if response.status_code >= 400:
            raise GatewayError(response.status_code, "upstream_error", response.text[:500])
        return response.json()
