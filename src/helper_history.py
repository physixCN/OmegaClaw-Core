# Extracted from helper.py to keep OmegaClaw membranes reviewable.
from collections import deque
import os
import pathlib
from datetime import datetime
import re

CORE_ROOT = pathlib.Path(__file__).resolve().parents[1]
MEMORY_DIR = pathlib.Path(os.environ.get("OMEGACLAW_MEMORY_DIR", CORE_ROOT / "memory"))
HISTORY_FILE = MEMORY_DIR / "history.metta"
TS_RE = re.compile(r'^\("(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"')

def extract_timestamp(line):
    m = TS_RE.search(line)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None

def coerce_recall_lines(k, default=20, low=1, high=200):
    try:
        if isinstance(k, (list, tuple)):
            if len(k) == 1:
                k = k[0]
            else:
                return default
        text = str(k).strip()
        if text in {"", "[]", "()", "empty", "None", "[maxEpisodeRecallLines]", "maxEpisodeRecallLines"}:
            return default
        n = int(float(text))
        return max(low, min(high, n))
    except Exception:
        return default

def around_time(needle_time_str, k, filename=None):
    needle_time_str = needle_time_str.replace(r'\"', '').replace('"', '').strip()
    k = coerce_recall_lines(k)
    filename = pathlib.Path(filename) if filename else HISTORY_FILE
    if not filename.exists():
        return None
    target = datetime.strptime(needle_time_str, "%Y-%m-%d %H:%M:%S")
    best_lineno = None
    best_line = None
    best_diff = None
    buffer = []
    best_idx = None
    with filename.open("r", encoding="utf-8", errors="replace") as f:
        for lineno, line in enumerate(f, 1):
            buffer.append((lineno, line))
            ts = extract_timestamp(line)
            if ts is None:
                continue
            diff = abs((ts - target).total_seconds())
            if best_diff is None or diff < best_diff:
                best_diff = diff
                best_lineno = lineno
                best_line = line
                best_idx = len(buffer) - 1
    if best_lineno is None:
        return
    start = max(0, best_idx - k)
    end = min(len(buffer), best_idx + k + 1)
    ret = ""
    for lineno, line in buffer[start:end]:
        ret += f"{lineno}:{line}"
    return ret

def normalize_episode_time(raw, now=None):
    now = now or datetime.now()
    text = str(raw or "").replace(r'\"', '').replace('"', '').strip()
    if not text:
        return None
    formats = [
        ("%Y-%m-%d %H:%M:%S", None),
        ("%Y-%m-%d %H:%M", ":00"),
        ("%Y-%m-%d", " 00:00:00"),
        ("%H:%M:%S", "today"),
        ("%H:%M", "today_seconds"),
    ]
    for fmt, suffix in formats:
        try:
            datetime.strptime(text, fmt)
        except ValueError:
            continue
        if suffix == ":00":
            return text + ":00"
        if suffix == " 00:00:00":
            return text + " 00:00:00"
        if suffix == "today":
            return now.strftime("%Y-%m-%d") + " " + text
        if suffix == "today_seconds":
            return now.strftime("%Y-%m-%d") + " " + text + ":00"
        return text
    return None

def episodes_at(raw, k=20):
    k = coerce_recall_lines(k)
    normalized = normalize_episode_time(raw)
    if not normalized:
        return "EPISODES-FORMAT-ERROR use YYYY-MM-DD HH:MM:SS, YYYY-MM-DD HH:MM, YYYY-MM-DD, or HH:MM"
    result = around_time(normalized, k)
    if not result:
        return f"EPISODES-NOT-FOUND {normalized}"
    return "EPISODES-AT " + normalized + "\n" + result
