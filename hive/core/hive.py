"""The Hive service layer: agents, swarms, messages, beliefs, usage."""

from __future__ import annotations

import asyncio
import collections
import hashlib
import json
import datetime
import pathlib
import random
import re
import secrets
import time

from ..spaces import sexpr
from ..spaces.service import SpaceService
from .config import Settings
from .db import Database, new_id, now
from .events import EventBus
from .goals import Goals
from .lab import Lab
from .policy import Policy
from .schedule import Scheduler

AGENT_KINDS = {"omega", "iter", "module"}
EDITABLE = {"name", "swarm_id", "model", "persona", "hue", "budget_usd", "idle_sleep_minutes"}


class HiveError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def token_hash(token):
    return hashlib.sha256(str(token).encode()).hexdigest()


class Hive:
    def __init__(self, settings: Settings, supervisor=None):
        self.settings = settings
        self.db = Database(settings.data_dir / "hive.db")
        self.spaces = SpaceService(settings.data_dir / "spaces", petta_path=settings.petta_path)
        self.events = EventBus()
        self.supervisor = supervisor
        self.connections: dict[str, object] = {}  # agent_id -> hub websocket
        self.name = "OmegaDots Hive"
        self.policy = Policy(self)
        self.goals = Goals(self)
        self.scheduler = Scheduler(self)
        self.lab = Lab(self)
        self.last_llm = {}  # agent_id -> (latency_ms, tokens) of its latest model call
        self.llm_calls = {}  # agent_id -> monotonic times of its calls in the last minute

    # ---- serialisation ---------------------------------------------------------------

    def agent_view(self, row):
        return {
            "id": row["id"], "name": row["name"], "kind": row["kind"], "swarm_id": row["swarm_id"],
            "model": row["model"], "persona": row["persona"], "hue": row["hue"],
            "status": row["status"], "driver": row["driver"],
            "budget_usd": row["budget_usd"], "spent_usd": round(row["spent_usd"], 6),
            "connected": row["id"] in self.connections,
            "idle_sleep_minutes": row.get("idle_sleep_minutes") or 0,
            "last_error": row.get("last_error"),
            "last_active_at": row["last_active_at"], "created_at": row["created_at"],
        }

    def swarm_view(self, row):
        members = self.db.all("SELECT id FROM agents WHERE swarm_id = ? AND deleted = 0 ORDER BY created_at", (row["id"],))
        return dict(row, member_ids=[m["id"] for m in members])

    def _agent_row(self, agent_id):
        row = self.db.one("SELECT * FROM agents WHERE id = ? AND deleted = 0", (agent_id,))
        if row is None:
            raise HiveError(404, "not_found", f"no agent {agent_id}")
        return row

    def agent(self, agent_id):
        return self.agent_view(self._agent_row(agent_id))

    def emit_agent(self, agent_id):
        self.events.publish("agent.updated", agent=self.agent(agent_id))

    # ---- hive ----------------------------------------------------------------------------

    def summary(self):
        agents = self.db.all("SELECT status, spent_usd FROM agents WHERE deleted = 0")
        swarms = self.db.all("SELECT id FROM swarms")
        beliefs = sum(len(self.spaces.beliefs(s["id"])) for s in swarms)
        return {
            "name": self.name, "version": "0.1.0", "agents": len(agents), "swarms": len(swarms),
            "awake": sum(1 for a in agents if a["status"] == "awake"), "beliefs": beliefs,
            "spent_usd": round(sum(a["spent_usd"] for a in agents), 6),
            "limits": {"goal_lease_minutes": self.settings.goal_lease_minutes,
                       "hive_budget_usd": self.settings.hive_budget_usd,
                       "max_llm_calls_per_minute": self.settings.max_llm_calls_per_minute},
        }

    def models(self):
        out = []
        for provider in self.settings.providers.values():
            if provider.name != "mock" and not provider.local and not provider.api_key:
                continue
            for model in provider.models:
                out.append({"id": f"{provider.name}/{model}", "provider": provider.name,
                            "label": model, "local": provider.local})
        return out

    # ---- swarms -----------------------------------------------------------------------------

    def swarms(self):
        return [self.swarm_view(r) for r in self.db.all("SELECT * FROM swarms ORDER BY created_at")]

    def swarm(self, swarm_id):
        row = self.db.one("SELECT * FROM swarms WHERE id = ?", (swarm_id,))
        if row is None:
            raise HiveError(404, "not_found", f"no swarm {swarm_id}")
        return self.swarm_view(row)

    def create_swarm(self, name, description="", hue=None):
        if not str(name).strip():
            raise HiveError(400, "bad_request", "name is required")
        row = {"id": new_id("s"), "name": str(name).strip(), "description": str(description or ""),
               "hue": int(hue if hue is not None else random.randrange(360)) % 360, "created_at": now()}
        self.db.insert("swarms", row)
        swarm = self.swarm_view(row)
        self.events.publish("swarm.updated", swarm=swarm)
        return swarm

    # ---- agents -------------------------------------------------------------------------------

    def agents(self):
        return [self.agent_view(r) for r in self.db.all("SELECT * FROM agents WHERE deleted = 0 ORDER BY created_at")]

    def create_agent(self, name, kind="omega", swarm_id=None, model=None, persona="", hue=None, budget_usd=0.0):
        if not str(name).strip():
            raise HiveError(400, "bad_request", "name is required")
        if kind not in AGENT_KINDS:
            raise HiveError(400, "bad_request", f"kind must be one of {sorted(AGENT_KINDS)}")
        if swarm_id:
            self.swarm(swarm_id)
        token = secrets.token_urlsafe(32)
        row = {
            "id": new_id("a"), "name": str(name).strip(), "kind": kind, "swarm_id": swarm_id or None,
            "model": model or self.settings.default_model, "persona": str(persona or ""),
            "hue": int(hue if hue is not None else random.randrange(360)) % 360,
            "status": "created", "desired": "stopped", "driver": self.settings.default_driver,
            "budget_usd": float(budget_usd or 0), "spent_usd": 0.0, "token_hash": token_hash(token),
            "created_at": now(),
        }
        self.db.insert("agents", row)
        if swarm_id:
            self.spaces.grant(row["id"], swarm_id)
            self.events.publish("swarm.updated", swarm=self.swarm(swarm_id))
        if self.supervisor:
            self.supervisor.prepare(self.agent(row["id"]), token)
        agent = self.agent(row["id"])
        self.events.publish("agent.updated", agent=agent)
        return dict(agent, token=token)

    def update_agent(self, agent_id, changes):
        row = self._agent_row(agent_id)
        changes = {k: v for k, v in changes.items() if k in EDITABLE}
        if "swarm_id" in changes and changes["swarm_id"] != row["swarm_id"]:
            if changes["swarm_id"]:
                self.swarm(changes["swarm_id"])
            if row["swarm_id"]:
                self.spaces.revoke(agent_id, row["swarm_id"])
            if changes["swarm_id"]:
                self.spaces.grant(agent_id, changes["swarm_id"])
        if "hue" in changes:
            changes["hue"] = int(changes["hue"]) % 360
        if changes:
            self.db.update("agents", agent_id, changes)
        if self.supervisor and ({"model", "persona", "name"} & changes.keys()):
            self.supervisor.reconfigure(self.agent(agent_id))
        for swarm_id in {row["swarm_id"], changes.get("swarm_id")} - {None}:
            self.events.publish("swarm.updated", swarm=self.swarm(swarm_id))
        self.emit_agent(agent_id)
        return self.agent(agent_id)

    def delete_agent(self, agent_id):
        row = self._agent_row(agent_id)
        if self.supervisor:
            self.supervisor.stop(agent_id)
        if row["swarm_id"]:
            self.spaces.revoke(agent_id, row["swarm_id"])
        self.db.update("agents", agent_id, {"deleted": 1, "status": "stopped", "desired": "stopped"})
        self.events.publish("agent.deleted", agent_id=agent_id)
        if row["swarm_id"]:
            self.events.publish("swarm.updated", swarm=self.swarm(row["swarm_id"]))
        return {"ok": True}

    def set_status(self, agent_id, status, desired=None, error=None):
        values = {"status": status, "last_error": error if status == "error" else None}
        if desired:
            values["desired"] = desired
        self.db.update("agents", agent_id, values)
        self.emit_agent(agent_id)

    def lifecycle(self, agent_id, action):
        row = self._agent_row(agent_id)
        if row["kind"] == "module" and action in ("start", "wake"):
            raise HiveError(400, "external_member",
                            "this member runs outside the hive; it connects with its token instead")
        if self.supervisor is None:
            raise HiveError(503, "no_supervisor", "no supervisor configured")
        if action in ("start", "wake"):
            self.set_status(agent_id, "starting", desired="awake")
            self.db.update("agents", agent_id, {"last_active_at": now()})
            self.supervisor.start(agent_id)
        elif action == "stop":
            self.supervisor.stop(agent_id)
            self.set_status(agent_id, "stopped", desired="stopped")
        elif action == "sleep":
            self.supervisor.stop(agent_id)
            self.set_status(agent_id, "asleep", desired="asleep")
        else:
            raise HiveError(400, "bad_request", f"unknown action {action}")
        return self.agent(agent_id)

    def authenticate_agent(self, token):
        if not token:
            return None
        return self.db.one("SELECT * FROM agents WHERE token_hash = ? AND deleted = 0", (token_hash(token),))

    # ---- messages -----------------------------------------------------------------------------

    def message_view(self, row):
        return {k: row[k] for k in ("id", "agent_id", "conversation_id", "direction", "sender", "text", "created_at")}

    def messages(self, agent_id, conversation_id=None, limit=200):
        self._agent_row(agent_id)
        sql = "SELECT * FROM messages WHERE agent_id = ?"
        params = [agent_id]
        if conversation_id:
            sql += " AND conversation_id = ?"
            params.append(conversation_id)
        sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        params.append(int(limit))
        return [self.message_view(r) for r in reversed(self.db.all(sql, params))]

    async def send_to_agent(self, agent_id, text, conversation_id=None, sender="user:operator", extra=None):
        row = self._agent_row(agent_id)
        if not str(text).strip():
            raise HiveError(400, "bad_request", "text is required")
        seq_row = self.db.one("SELECT COALESCE(MAX(hub_seq), 0) AS seq FROM messages WHERE agent_id = ?", (agent_id,))
        seq = seq_row["seq"] + 1
        message = {
            "id": new_id("m"), "agent_id": agent_id, "conversation_id": conversation_id or f"c_{agent_id}",
            "direction": "in", "sender": sender, "text": str(text), "hub_seq": seq, "created_at": now(),
            "extra": json.dumps(extra) if extra else None,
        }
        self.db.insert("messages", message)
        view = self.message_view(message)
        self.events.publish("message", message=view)
        await self.deliver(agent_id, message)
        if row["status"] == "asleep" and self.supervisor:
            self.lifecycle(agent_id, "wake")
        return view

    def envelope(self, message):
        body = {"hive": 1, "sender": message["sender"], "conversation_id": message["conversation_id"],
                "message_id": message["id"], "text": message["text"]}
        if message.get("extra"):
            body.update(json.loads(message["extra"]))
        return json.dumps(body)

    async def deliver(self, agent_id, message):
        ws = self.connections.get(agent_id)
        if ws is None:
            return False
        try:
            await ws.send_text(json.dumps({"type": "user_message", "seq": message["hub_seq"],
                                           "text": self.envelope(message)}))
            return True
        except Exception:
            return False

    async def replay(self, agent_id, last_seen):
        rows = self.db.all(
            "SELECT * FROM messages WHERE agent_id = ? AND direction = 'in' AND hub_seq > ? ORDER BY hub_seq",
            (agent_id, int(last_seen or 0)),
        )
        for row in rows:
            await self.deliver(agent_id, row)

    def record_agent_message(self, agent_id, frame):
        text = str(frame.get("text", ""))
        client_seq = str(frame.get("client_seq") or new_id("cs"))
        existing = self.db.one("SELECT * FROM messages WHERE agent_id = ? AND client_seq = ?", (agent_id, client_seq))
        if existing:
            return self.message_view(existing)
        message = {
            "id": new_id("m"), "agent_id": agent_id,
            "conversation_id": str(frame.get("conversation_id") or f"c_{agent_id}"),
            "direction": "out", "sender": f"agent:{agent_id}", "text": text, "client_seq": client_seq,
            "created_at": now(),
        }
        self.db.insert("messages", message)
        self.db.update("agents", agent_id, {"last_active_at": message["created_at"]})
        view = self.message_view(message)
        self.events.publish("message", message=view)
        return view

    async def agent_connected(self, agent_id, ws):
        self.connections[agent_id] = ws
        row = self._agent_row(agent_id)
        if row["status"] in ("created", "starting", "asleep", "stopped", "error"):
            self.db.update("agents", agent_id, {"status": "awake", "desired": "awake"})
        self.emit_agent(agent_id)

    def agent_disconnected(self, agent_id, ws):
        if self.connections.get(agent_id) is ws:
            del self.connections[agent_id]
            try:
                self.emit_agent(agent_id)
            except HiveError:
                pass

    # ---- beliefs -------------------------------------------------------------------------------

    def _mint_stamp(self, agent_id):
        self.db.execute("UPDATE agents SET evidence_counter = evidence_counter + 1 WHERE id = ?", (agent_id,))
        counter = self.db.one("SELECT evidence_counter FROM agents WHERE id = ?", (agent_id,))["evidence_counter"]
        return [f"ev:{agent_id}:{counter}"]

    def publish(self, agent_id, statement, f, c, evidence=None, new_evidence=False):
        """Publish a belief to the agent's swarm commons.

        Without ``evidence`` the agent's own evidence for this statement is
        reused: saying the same thing again is not a new observation, so it
        cannot inflate confidence by revising with itself.  ``new_evidence``
        mints a fresh id for a genuinely new observation.
        """
        row = self._agent_row(agent_id)
        if not row["swarm_id"]:
            raise HiveError(400, "no_swarm", "agent is not in a swarm")
        if not evidence and not new_evidence:
            try:
                canonical = self.spaces.statement_text(statement)
            except ValueError as exc:
                raise HiveError(400, "bad_statement", str(exc)) from exc
            previous = self.db.one(
                "SELECT stamp FROM assertions WHERE swarm_id = ? AND agent_id = ? AND statement = ? "
                "AND outcome NOT IN ('denied', 'quarantined') ORDER BY id DESC LIMIT 1",
                (row["swarm_id"], agent_id, canonical))
            if previous:
                evidence = [e for e in json.loads(previous["stamp"]) if e.startswith(f"ev:{agent_id}:")] or None
            if not evidence:
                # Repeating what the commons told you is an echo, not a second
                # observation: it inherits the stamp the agent read, so it
                # cannot revise the belief upward.
                seen = self.db.one("SELECT stamp FROM reads WHERE agent_id = ? AND statement = ?",
                                   (agent_id, canonical))
                if seen:
                    evidence = json.loads(seen["stamp"]) or None
        if evidence:
            # Cited evidence must already exist: minted earlier for this agent, or
            # seen in the hive.  Otherwise an agent could fabricate "independent"
            # evidence and inflate confidence through revision.
            for item in evidence:
                kind, _, rest = str(item).partition(":")
                owner, _, number = rest.rpartition(":")
                own = owner == agent_id and number.isdigit() and 0 < int(number) <= row["evidence_counter"]
                seen = self.db.one("SELECT 1 FROM assertions WHERE stamp LIKE ? LIMIT 1", (f'%"{item}"%',))
                if kind != "ev" or not (own or seen):
                    raise HiveError(400, "bad_evidence", f"unknown evidence {item}")
            stamp = list(evidence)
        else:
            stamp = self._mint_stamp(agent_id)
        try:
            result = self.spaces.publish(row["swarm_id"], agent_id, statement, f, c, stamp)
        except ValueError as exc:
            raise HiveError(400, "bad_statement", str(exc)) from exc
        assertion = {
            "swarm_id": row["swarm_id"], "agent_id": agent_id, "statement": result["statement"],
            "f": float(f), "c": float(c), "stamp": json.dumps(stamp), "outcome": result["outcome"],
            "created_at": now(),
        }
        self.db.insert("assertions", assertion)
        self.db.update("agents", agent_id, {"last_active_at": assertion["created_at"]})
        view = self.assertion_view(assertion)
        if "unmapped" in result:
            view["unmapped"] = result["unmapped"]
        self.events.publish("belief.published", swarm_id=row["swarm_id"], assertion=view)
        if result["outcome"] in ("adopted", "revised", "chosen"):
            belief = self.belief(row["swarm_id"], result["statement"], detail=False)
            if belief:
                self.events.publish("belief.updated", belief=belief, outcome=result["outcome"])
        return view

    def assertion_view(self, row):
        return {"agent_id": row["agent_id"], "statement": row["statement"],
                "tv": {"f": row["f"], "c": row["c"]}, "stamp": json.loads(row["stamp"]),
                "outcome": row["outcome"], "created_at": row["created_at"]}

    def beliefs(self, swarm_id):
        self.swarm(swarm_id)
        out = []
        for item in self.spaces.beliefs(swarm_id):
            out.append(self._belief_meta(swarm_id, item))
        return out

    def _belief_meta(self, swarm_id, item):
        last = self.db.one("SELECT created_at FROM assertions WHERE swarm_id = ? AND statement = ? "
                           "ORDER BY id DESC LIMIT 1", (swarm_id, item["statement"]))
        sources = item.get("sources")
        if sources is None:
            detail = self.spaces.belief(swarm_id, item["statement"]) or {}
            sources = detail.get("sources", [])
        return {"swarm_id": swarm_id, "statement": item["statement"], "tv": item["tv"], "stamp": item["stamp"],
                "sources": sources, "updated_at": last["created_at"] if last else now()}

    def belief(self, swarm_id, statement, detail=True):
        try:
            item = self.spaces.belief(swarm_id, statement)
        except ValueError as exc:
            raise HiveError(400, "bad_statement", str(exc)) from exc
        if item is None:
            if detail:
                raise HiveError(404, "not_found", "no such belief")
            return None
        belief = self._belief_meta(swarm_id, item)
        if not detail:
            return belief
        rows = self.db.all("SELECT * FROM assertions WHERE swarm_id = ? AND statement = ? ORDER BY id",
                           (swarm_id, item["statement"]))
        return dict(belief, assertions=[self.assertion_view(r) for r in rows], choices=item["choices"])

    def _note_read(self, row, statement, stamp):
        """Remember which beliefs an agent has read, with the evidence behind them."""
        if not stamp:
            return
        self.db.execute("INSERT INTO reads (agent_id, swarm_id, statement, stamp, created_at) VALUES (?, ?, ?, ?, ?) "
                        "ON CONFLICT(agent_id, statement) DO UPDATE SET stamp = excluded.stamp, "
                        "created_at = excluded.created_at",
                        (row["id"], row["swarm_id"], statement, json.dumps(stamp), now()))

    def query(self, agent_id, pattern):
        row = self._agent_row(agent_id)
        if not row["swarm_id"]:
            return {"results": []}
        try:
            results = self.spaces.query([row["swarm_id"]], pattern)
        except ValueError as exc:
            raise HiveError(400, "bad_pattern", str(exc)) from exc
        for text in results:
            try:
                value = sexpr.parse(text)
            except ValueError:
                continue
            if isinstance(value, list) and len(value) == 4 and value[0] == "Current":
                stamp = [f"ev:{e[1]}:{e[2]}" for e in (value[3] or []) if isinstance(e, list) and len(e) == 3]
                self._note_read(row, sexpr.render(value[1]), stamp)
        return {"results": results}

    def agent_belief(self, agent_id, statement):
        """A belief as an agent reads it; the read is remembered for echo detection."""
        row = self._agent_row(agent_id)
        if not row["swarm_id"]:
            raise HiveError(400, "no_swarm", "agent is not in a swarm")
        belief = self.belief(row["swarm_id"], statement)
        self._note_read(row, belief["statement"], belief["stamp"])
        return belief

    # ---- usage ----------------------------------------------------------------------------------

    def check_budget(self, agent, paid=False, estimate=0.0):
        """Refuse an LLM call before it is made when it could overspend.

        A paid call needs a budget (0 means none, not unlimited) with room for
        the call's worst-case cost, and room under the hive-wide cap.  Every
        call counts against a per-agent calls-per-minute ceiling, which stops a
        loop that keeps re-calling the model from running up a bill.
        """
        limit = self.settings.max_llm_calls_per_minute
        if limit:
            moment = time.monotonic()
            calls = self.llm_calls.setdefault(agent["id"], collections.deque())
            while calls and moment - calls[0] > 60:
                calls.popleft()
            if len(calls) >= limit:
                raise HiveError(429, "rate_limited", f"{agent['name']} made {limit} LLM calls in the last minute")
            calls.append(moment)
        budget, spent = agent["budget_usd"] or 0.0, agent["spent_usd"] or 0.0
        if paid and budget <= 0:
            raise HiveError(402, "no_budget", f"{agent['name']} needs a budget to use {agent['model']}")
        if budget and spent + estimate > budget:
            raise HiveError(402, "budget_exhausted", f"{agent['name']} has spent ${spent:.2f} of its "
                                                     f"${budget:.2f} budget")
        cap = self.settings.hive_budget_usd
        if paid and cap:
            total = self.db.one("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage")["total"]
            if total + estimate > cap:
                raise HiveError(402, "hive_budget_exhausted", f"the hive has spent ${total:.2f} of its ${cap:.2f} cap")

    def record_usage(self, agent, model, usage):
        row = {"agent_id": agent["id"], "model": model, "prompt_tokens": usage["prompt_tokens"],
               "completion_tokens": usage["completion_tokens"], "cost_usd": usage["cost_usd"], "created_at": now()}
        self.db.insert("usage", row)
        self.db.execute("UPDATE agents SET spent_usd = spent_usd + ?, last_active_at = ? WHERE id = ?",
                        (usage["cost_usd"], row["created_at"], agent["id"]))
        self.events.publish("usage", usage=row)
        self.emit_agent(agent["id"])

    def usage(self, agent_id=None, since=None):
        sql, params = "SELECT agent_id, model, prompt_tokens, completion_tokens, cost_usd, created_at FROM usage WHERE 1=1", []
        if agent_id:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        if since:
            sql += " AND created_at >= ?"
            params.append(since)
        return self.db.all(sql + " ORDER BY id DESC LIMIT 5000", params)[::-1]

    def thinking(self, agent_id, phase):
        self.events.publish("agent.thinking", agent_id=agent_id, phase=phase)

    # ---- boot ----------------------------------------------------------------------------------

    async def restore(self):
        """Bring agents back to the state they were in before the hive stopped."""
        if self.supervisor is None:
            return
        for row in self.db.all("SELECT * FROM agents WHERE deleted = 0 AND kind != 'module'"):
            if row["desired"] == "awake":
                self.lifecycle(row["id"], "start")
            elif row["status"] in ("awake", "starting"):
                self.set_status(row["id"], "stopped")
            await asyncio.sleep(0)

    # ---- phase 2: helpers -----------------------------------------------------------------

    @staticmethod
    def error(status, code, message):
        return HiveError(status, code, message)

    def stop_all(self):
        stopped = 0
        for row in self.db.all("SELECT id, status FROM agents WHERE deleted = 0"):
            if self.supervisor:
                self.supervisor.stop(row["id"])
            if row["status"] != "stopped":
                stopped += 1
            self.set_status(row["id"], "stopped", desired="stopped")
        return {"stopped": stopped}

    # ---- traces -------------------------------------------------------------------------------

    def trace_view(self, row):
        return dict(row, commands=json.loads(row["commands"]))

    @staticmethod
    def _commands_from_results(text):
        """[{command, result}] from the loop's (RESULTS: ((COMMAND_RETURN: (cmd result)) ...))."""
        from ..spaces import sexpr

        try:
            value = sexpr.read_result(text)
        except (IndexError, ValueError):
            return []
        out = []

        def walk(node):
            if isinstance(node, list):
                if len(node) == 2 and node[0] == "COMMAND_RETURN:" and isinstance(node[1], list) and node[1]:
                    command, *rest = node[1]
                    out.append({"command": sexpr.render(command),
                                "result": " ".join(sexpr.render(r) for r in rest)})
                    return
                for item in node:
                    walk(item)

        walk(value)
        return out

    def record_trace(self, agent, data):
        commands = []
        items = data.get("commands")
        if items is None and data.get("results"):
            items = self._commands_from_results(data["results"])
        for item in (items or [])[:20]:
            command = str(item.get("command", ""))[:2000]
            entry = {"command": command, "result": str(item.get("result", ""))[:2000]}
            gate = self.policy.gate_of(agent["id"], command)
            if gate:
                entry["gated"] = gate
            commands.append(entry)
        llm_ms, tokens = self.last_llm.get(agent["id"], (None, None))
        row = {"agent_id": agent["id"], "iteration": int(data.get("iteration") or 0),
               "input": (str(data["input"])[:4000] if data.get("input") else None),
               "response": str(data.get("response", ""))[:8000], "commands": json.dumps(commands),
               "llm_ms": llm_ms, "tokens": tokens, "created_at": now()}
        row["id"] = self.db.insert("traces", row)
        self.db.execute("DELETE FROM traces WHERE agent_id = ? AND id <= ?", (agent["id"], row["id"] - 2000))
        trace = self.trace_view(row)
        self.events.publish("agent.trace", trace=trace)
        return trace

    def traces(self, agent_id, limit=100):
        self._agent_row(agent_id)
        rows = self.db.all("SELECT * FROM traces WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
                           (agent_id, min(int(limit), 500)))
        return [self.trace_view(r) for r in rows]

    # ---- private memory: read from disk, change through the agent ----------------------------

    MEMORY_SKIP = {"history.metta"}

    def _memory_dir(self, agent_id):
        self._agent_row(agent_id)
        return self.settings.agents_dir / agent_id / "memory"

    @staticmethod
    def _atoms(text):
        """Split a saved space (one top-level expression per entry) into atom texts."""
        atoms, depth, start, in_string, escape = [], 0, None, False, False
        for i, ch in enumerate(text):
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "(":
                if depth == 0:
                    start = i
                depth += 1
            elif ch == ")" and depth:
                depth -= 1
                if depth == 0 and start is not None:
                    atoms.append(text[start:i + 1])
        return atoms

    def memory_spaces(self, agent_id):
        folder = self._memory_dir(agent_id)
        out = []
        for path in sorted(folder.glob("*.metta")) if folder.exists() else []:
            if path.name in self.MEMORY_SKIP:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            out.append({"name": path.stem, "atoms": len(self._atoms(text)), "bytes": path.stat().st_size})
        return out

    def memory_atoms(self, agent_id, space, q=None, limit=200):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", str(space)):
            raise HiveError(400, "bad_request", "bad space name")
        path = self._memory_dir(agent_id) / f"{space}.metta"
        if not path.exists() or path.name in self.MEMORY_SKIP:
            raise HiveError(404, "not_found", f"no space {space}")
        atoms = self._atoms(path.read_text(encoding="utf-8", errors="replace"))
        rows = [{"index": i, "text": a} for i, a in enumerate(atoms) if not q or str(q).lower() in a.lower()]
        return rows[: min(int(limit), 1000)]

    def queue_control(self, agent_id, op):
        self._agent_row(agent_id)
        self.db.insert("control_ops", {"agent_id": agent_id, "op": json.dumps(op), "created_at": now()})
        return {"queued": True}

    def retire_atom(self, agent_id, space, atom):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", str(space)):
            raise HiveError(400, "bad_request", "bad space name")
        if str(atom) not in {a["text"] for a in self.memory_atoms(agent_id, space, limit=1000)}:
            raise HiveError(404, "not_found", "no such atom in that space")
        return self.queue_control(agent_id, {"op": "retire", "space": space, "atom": str(atom)})

    def take_control(self, agent_id):
        rows = self.db.all("SELECT id, op FROM control_ops WHERE agent_id = ? AND taken = 0 ORDER BY id", (agent_id,))
        for row in rows:
            self.db.execute("UPDATE control_ops SET taken = 1 WHERE id = ?", (row["id"],))
        return {"ops": [json.loads(r["op"]) for r in rows]}

    # ---- HTTP inbox for agents without a socket ------------------------------------------------

    def inbox(self, agent_id, after=0):
        rows = self.db.all("SELECT * FROM messages WHERE agent_id = ? AND direction = 'in' AND hub_seq > ? "
                           "ORDER BY hub_seq LIMIT 100", (agent_id, int(after or 0)))
        self.db.update("agents", agent_id, {"last_active_at": now()})
        return {"messages": [{"seq": r["hub_seq"], "text": self.envelope(r)} for r in rows]}

    # ---- idle sleep ----------------------------------------------------------------------------

    def idle_candidates(self, moment=None):
        moment = moment or datetime.datetime.now(datetime.timezone.utc)
        out = []
        for row in self.db.all("SELECT * FROM agents WHERE deleted = 0 AND status = 'awake' AND idle_sleep_minutes > 0"):
            last = row["last_active_at"] or row["created_at"]
            seen = datetime.datetime.fromisoformat(last.replace("Z", "+00:00"))
            if (moment - seen).total_seconds() >= row["idle_sleep_minutes"] * 60:
                out.append(row["id"])
        return out
