"""Compatibility shim for the optional Agentverse remote-agent module.

New code should import ``modules/agentverse/entry.metta`` and call the module
surface. This file remains so older OmegaClaw deployments that still py-call
``agentverse.tavily_search`` or ``agentverse.technical_analysis`` do not break.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_IMPL = ROOT / "modules" / "agentverse" / "src" / "agentverse_organ.py"


def _impl():
    module = sys.modules.get("agentverse_organ")
    if module is not None:
        return module
    spec = importlib.util.spec_from_file_location("agentverse_organ", MODULE_IMPL)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Agentverse module implementation not found: {MODULE_IMPL}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["agentverse_organ"] = module
    spec.loader.exec_module(module)
    return module


def agentverse_status():
    return _impl().agentverse_status()


def agentverse_remote_agents():
    return _impl().agentverse_remote_agents()


def agentverse_discover_atoms(query: str, limit: int = 5):
    return _impl().agentverse_discover_atoms(query, limit)


def agentverse_record_agent(name: str, address: str, schema: str, capability: str):
    return _impl().agentverse_record_agent(name, address, schema, capability)


def agentverse_ask(destination: str, schema: str, payload: str, timeout: int = 60):
    return _impl().agentverse_ask(destination, schema, payload, timeout)


def agentverse_trace(limit: int = 20):
    return _impl().agentverse_trace(limit)


def tavily_search(search_query: str, timeout: int = 60) -> str:
    return _impl().tavily_search(search_query, timeout)


def technical_analysis(ticker: str, timeout: int = 60) -> str:
    return _impl().technical_analysis(ticker, timeout)
