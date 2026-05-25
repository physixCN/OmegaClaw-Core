# Deterministic memory recall helpers for context construction.
#
# These functions do not decide what the agent should think or do. They provide
# a bounded retrieval membrane over Chroma/promotions so the MeTTa loop can add
# relevant memory hints without creating a nondeterministic query surface.

from __future__ import annotations

import time
from typing import Any

try:
    from . import helper_promotion as promotion
except Exception:  # pragma: no cover - direct script import fallback
    import helper_promotion as promotion


def _as_int(value: Any, default: int, minimum: int = 1, maximum: int = 200) -> int:
    try:
        parsed = int(float(value))
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


def _promotion_score(item_id: str, current_time: float) -> float:
    try:
        value = promotion.promotion_get_value(item_id, 0.0) or 0.0
    except Exception:
        return 0.0
    if value <= 0.0:
        return 0.0
    try:
        last_time = promotion.promotion_get_lasttime(item_id, 0.0) or 0.0
    except Exception:
        last_time = 0.0
    age_days = max(0.0, (current_time - float(last_time)) / 86400.0)
    return float(value) * ((1.0 + age_days) ** -0.7)


def context_input_recall(
    query_embedding: list[float],
    max_items: int = 8,
    promotion_inflation_factor: int = 10,
    max_recall_items: int = 20,
    current_time: float | None = None,
) -> str:
    """Return a bounded, deterministic text block of relevant memory hints.

    The underlying memory store remains Chroma plus the promotion map. This
    helper only performs retrieval/ranking for prompt context; it does not create
    beliefs, mutate memories, or choose actions.
    """
    import lib_chromadb

    k = _as_int(max_items, 8, 0, 50)
    if k <= 0:
        return ""

    recall_items = _as_int(max_recall_items, 20, 1, 200)
    inflation = _as_int(promotion_inflation_factor, 10, 1, 50)
    query_count = max(k, recall_items * inflation)
    now = float(current_time if current_time is not None else time.time())

    rows = lib_chromadb.query_with_ids_and_dists(query_embedding, query_count)
    if not rows:
        return ""

    promoted = sorted(
        (row for row in rows if _promotion_score(row[0], now) > 0.0),
        key=lambda row: (-_promotion_score(row[0], now), float(row[3])),
    )
    closest = sorted(rows, key=lambda row: float(row[3]))

    selected: list[tuple[str | None, str]] = []
    seen: set[str] = set()
    for row in [*promoted, *closest]:
        item_id, timestamp, content, _distance = row
        if item_id in seen:
            continue
        seen.add(item_id)
        selected.append((timestamp, content))
        if len(selected) >= k:
            break

    return repr(selected)


def context_input_recall_text(
    query_text: str,
    max_items: int = 8,
    promotion_inflation_factor: int = 10,
    max_recall_items: int = 20,
    current_time: float | None = None,
) -> str:
    """Embed text and return bounded memory hints as one deterministic value."""
    import lib_llm_ext

    if not isinstance(query_text, str) or not query_text.strip():
        return ""
    try:
        embedding = lib_llm_ext.useLocalEmbedding(query_text)
    except RuntimeError:
        lib_llm_ext.initLocalEmbedding()
        embedding = lib_llm_ext.useLocalEmbedding(query_text)
    return context_input_recall(
        embedding,
        max_items=max_items,
        promotion_inflation_factor=promotion_inflation_factor,
        max_recall_items=max_recall_items,
        current_time=current_time,
    )
