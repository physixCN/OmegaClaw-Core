"""Swarm goals: posted by people or dots, claimed and finished by dots."""

from __future__ import annotations

import json

from .db import new_id, now

STATUSES = {"open", "claimed", "done", "failed", "cancelled"}


class Goals:
    def __init__(self, hive):
        self.hive = hive
        self.db = hive.db

    def get(self, goal_id):
        row = self.db.one("SELECT * FROM goals WHERE id = ?", (goal_id,))
        if row is None:
            raise self.hive.error(404, "not_found", f"no goal {goal_id}")
        return row

    def list(self, swarm_id, status=None):
        sql, params = "SELECT * FROM goals WHERE swarm_id = ?", [swarm_id]
        if status:
            sql += " AND status = ?"
            params.append(status)
        return self.db.all(sql + " ORDER BY priority DESC, created_at", params)

    def _emit(self, goal_id):
        goal = self.get(goal_id)
        self.hive.events.publish("goal.updated", goal=goal)
        return goal

    async def create(self, swarm_id, title, detail="", priority=0.5, parent_id=None, created_by="user:operator"):
        self.hive.swarm(swarm_id)
        if not str(title).strip():
            raise self.hive.error(400, "bad_request", "title is required")
        if parent_id:
            parent = self.get(parent_id)
            if parent["swarm_id"] != swarm_id:
                raise self.hive.error(400, "bad_request", "parent goal is in another swarm")
            author = created_by.removeprefix("agent:")
            if created_by.startswith("agent:") and parent["claimed_by"] != author:
                raise self.hive.error(403, "forbidden", "only the dot that claimed a goal can split it")
        stamp = now()
        row = {"id": new_id("g"), "swarm_id": swarm_id, "parent_id": parent_id or None,
               "title": str(title).strip()[:300], "detail": str(detail or "")[:4000],
               "priority": max(0.0, min(1.0, float(priority if priority is not None else 0.5))),
               "status": "open", "created_by": created_by, "claimed_by": None, "result": None,
               "created_at": stamp, "updated_at": stamp}
        self.db.insert("goals", row)
        goal = self._emit(row["id"])
        await self.announce(goal)
        return goal

    async def announce(self, goal):
        """Tell the swarm's awake members, except whoever posted it."""
        author = goal["created_by"].removeprefix("agent:")
        envelope_text = (f"New goal {goal['id']} (priority {goal['priority']:.2f}): {goal['title']}"
                         + (f" - {goal['detail']}" if goal["detail"] else ""))
        for member in self.db.all("SELECT id, status FROM agents WHERE swarm_id = ? AND deleted = 0",
                                  (goal["swarm_id"],)):
            if member["id"] == author or member["status"] not in ("awake", "starting"):
                continue
            await self.hive.send_to_agent(member["id"], envelope_text, sender="hive:goals",
                                          extra={"event": "goal", "goal_id": goal["id"]})

    def update(self, goal_id, changes):
        goal = self.get(goal_id)
        values = {}
        if "status" in changes:
            if changes["status"] not in STATUSES:
                raise self.hive.error(400, "bad_request", f"status must be one of {sorted(STATUSES)}")
            values["status"] = changes["status"]
        if "priority" in changes:
            values["priority"] = max(0.0, min(1.0, float(changes["priority"])))
        for key in ("title", "detail"):
            if key in changes:
                values[key] = str(changes[key])
        if values:
            values["updated_at"] = now()
            self.db.update("goals", goal["id"], values)
        return self._emit(goal_id)

    def claim(self, agent, goal_id):
        goal = self.get(goal_id)
        if goal["swarm_id"] != agent["swarm_id"]:
            raise self.hive.error(403, "forbidden", "goal is in another swarm")
        if goal["status"] != "open":
            raise self.hive.error(409, "not_open", f"goal is {goal['status']}"
                                  + (f" by {goal['claimed_by']}" if goal["claimed_by"] else ""))
        self.db.update("goals", goal_id, {"status": "claimed", "claimed_by": agent["id"], "updated_at": now()})
        return self._emit(goal_id)

    def result(self, agent, goal_id, status, result):
        goal = self.get(goal_id)
        if goal["claimed_by"] != agent["id"]:
            raise self.hive.error(403, "forbidden", "only the dot that claimed a goal can finish it")
        if status not in ("done", "failed"):
            raise self.hive.error(400, "bad_request", "status must be done or failed")
        self.db.update("goals", goal_id, {"status": status, "result": str(result or "")[:4000], "updated_at": now()})
        return self._emit(goal_id)

    async def notify_parent(self, goal):
        """When the last subgoal finishes, tell whoever holds the parent, with the results."""
        if not goal["parent_id"]:
            return
        parent = self.get(goal["parent_id"])
        children = self.db.all("SELECT * FROM goals WHERE parent_id = ?", (parent["id"],))
        if parent["status"] != "claimed" or any(c["status"] in ("open", "claimed") for c in children):
            return
        summary = "; ".join(f"{c['title']}: {c['status']} - {c['result'] or ''}".strip(" -") for c in children)
        await self.hive.send_to_agent(parent["claimed_by"], f"[SUBGOALS-DONE {parent['id']}] {summary}",
                                      sender="hive:goals", extra={"event": "subgoals_done", "goal_id": parent["id"]})

    @staticmethod
    def dumps(value):
        return json.dumps(value)
