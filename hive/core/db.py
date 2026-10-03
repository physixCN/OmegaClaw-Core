"""SQLite control-plane store.  Beliefs live in hive-spaces, not here."""

from __future__ import annotations

import datetime
import json
import secrets
import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS swarms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  hue INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, swarm_id TEXT,
  model TEXT NOT NULL, persona TEXT NOT NULL DEFAULT '', hue INTEGER NOT NULL,
  status TEXT NOT NULL, desired TEXT NOT NULL DEFAULT 'stopped', driver TEXT NOT NULL,
  budget_usd REAL NOT NULL DEFAULT 0, spent_usd REAL NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL, evidence_counter INTEGER NOT NULL DEFAULT 0,
  hub_last_seen INTEGER, last_active_at TEXT, created_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL,
  hub_seq INTEGER, client_seq TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_agent ON messages(agent_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_seq ON messages(agent_id, client_seq);
CREATE TABLE IF NOT EXISTS assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, swarm_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  statement TEXT NOT NULL, f REAL NOT NULL, c REAL NOT NULL, stamp TEXT NOT NULL,
  outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assertions_stmt ON assertions(swarm_id, statement);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_agent ON usage(agent_id, created_at);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
"""


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(prefix):
    return f"{prefix}_{secrets.token_hex(4)}"


class Database:
    def __init__(self, path):
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def execute(self, sql, params=()):
        with self._lock:
            return self._conn.execute(sql, params)

    def one(self, sql, params=()):
        with self._lock:
            row = self._conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def all(self, sql, params=()):
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def insert(self, table, values):
        cols = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        with self._lock:
            cur = self._conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(values.values()))
            return cur.lastrowid

    def update(self, table, key, values):
        sets = ", ".join(f"{k} = ?" for k in values)
        with self._lock:
            self._conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*values.values(), key))

    @staticmethod
    def dumps(value):
        return json.dumps(value)
