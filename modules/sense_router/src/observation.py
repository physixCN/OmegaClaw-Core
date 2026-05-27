"""General observation membrane for situated OmegaClaw bodies.

Route meanings live in ../routes.metta as MeTTa-visible atoms. This membrane
normalizes input, dispatches the selected module function, and fails closed when
no symbolic route matches.
"""

from __future__ import annotations

import importlib
import pathlib
import re


ROUTES_FILE = pathlib.Path(__file__).resolve().parents[1] / "routes.metta"
QUOTED = r'"((?:\\.|[^"\\])*)"'


def _unescape(value):
    return bytes(value, "utf-8").decode("unicode_escape")


def _norm(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _drop_prefix(text, *prefixes):
    raw = str(text or "").strip()
    lowered = raw.lower()
    for prefix in prefixes:
        prefix = prefix.lower().strip()
        if lowered == prefix:
            return ""
        if lowered.startswith(prefix + " "):
            return raw[len(prefix):].strip()
    return raw


def _route_atoms(kind):
    if not ROUTES_FILE.exists():
        return []
    text = ROUTES_FILE.read_text(encoding="utf-8")
    pattern = re.compile(rf"\({kind}\s+{QUOTED}\s+{QUOTED}\s+{QUOTED}(?:\s+{QUOTED})?\)")
    rows = []
    for match in pattern.finditer(text):
        rows.append(tuple(_unescape(group) for group in match.groups() if group is not None))
    return rows


def _unknown_examples():
    if not ROUTES_FILE.exists():
        return []
    text = ROUTES_FILE.read_text(encoding="utf-8")
    pattern = re.compile(rf"\(ObservationUnknownExample\s+{QUOTED}\)")
    return [_unescape(match.group(1)) for match in pattern.finditer(text)]


def _call(module_name, function_name, *args):
    module = importlib.import_module(module_name)
    return getattr(module, function_name)(*args)


def _unknown(target):
    examples = _unknown_examples()
    hint = " | ".join(examples[:10]) if examples else "observe target"
    return (
        "OBSERVE-UNKNOWN-TARGET "
        f"target={target!r} "
        f"try: {hint}"
    )


def observe(target):
    """Route a general observation request to the relevant sense/app organ."""
    raw = str(target or "").strip().strip('"')
    normalized = _norm(raw)
    if not normalized:
        return _unknown(raw)

    for alias, module_name, function_name in _route_atoms("ObservationExactRoute"):
        if normalized == _norm(alias):
            return _call(module_name, function_name)

    for alias, module_name, function_name, question in _route_atoms("ObservationQuestionRoute"):
        if normalized == _norm(alias):
            return _call(module_name, function_name, question)

    for prefix, module_name, function_name in _route_atoms("ObservationPrefixRoute"):
        normalized_prefix = _norm(prefix)
        if normalized == normalized_prefix:
            return _unknown(raw)
        if normalized.startswith(normalized_prefix + " "):
            argument = _drop_prefix(raw, prefix)
            if not argument:
                return _unknown(raw)
            return _call(module_name, function_name, argument)

    return _unknown(raw)
