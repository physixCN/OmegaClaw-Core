"""Swarm goals: posted by people or dots, claimed and finished by dots.

Anti-drift rules (docs/omegadots/DRIFT.md):
- A claim is a lease.  The claimer renews it with a heartbeat; when it lapses
  the goal goes back to the swarm, and after MAX_ATTEMPTS lapses it is
  ``stalled`` until a person looks at it, instead of being re-tried forever.
- ``waiting`` means "delivered, waiting on a person": not failing, so the
  claimer does not keep re-sending, and its lease is paused.
- ``done`` needs a result that says what was done.
- Splitting is bounded in depth and fan-out, so one goal cannot spawn an
  unbounded tree of subgoals.
"""

from __future__ import annotations

import datetime
import json

from .db import new_id, now

STATUSES = {"open", "claimed", "waiting", "stalled", "done", "failed", "cancelled"}
UNFINISHED = ("open", "claimed", "waiting", "stalled")
MAX_ATTEMPTS = 3
MAX_DEPTH = 4
MAX_CHILDREN = 12


def _later(minutes):
    moment = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=minutes)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


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

    def depth(self, goal):
        depth = 0
        while goal["parent_id"] and depth < MAX_DEPTH + 1:
            goal = self.get(goal["parent_id"])
            depth += 1
        return depth

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
            if self.depth(parent) + 1 >= MAX_DEPTH:
                raise self.hive.error(400, "too_deep", f"goals can be split at most {MAX_DEPTH - 1} levels deep")
            children = self.db.one("SELECT COUNT(*) AS n FROM goals WHERE parent_id = ?", (parent_id,))["n"]
            if children >= MAX_CHILDREN:
                raise self.hive.error(400, "too_many_subgoals", f"a goal can have at most {MAX_CHILDREN} subgoals")
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
        # One conditional UPDATE, so two dots claiming at once cannot both win.
        cursor = self.db.execute(
            "UPDATE goals SET status = 'claimed', claimed_by = ?, lease_until = ?, attempts = attempts + 1, "
            "updated_at = ? WHERE id = ? AND status = 'open'",
            (agent["id"], _later(self.hive.settings.goal_lease_minutes), now(), goal_id))
        if cursor.rowcount != 1:
            goal = self.get(goal_id)
            raise self.hive.error(409, "not_open", f"goal is {goal['status']}"
                                  + (f" by {goal['claimed_by']}" if goal["claimed_by"] else ""))
        return self._emit(goal_id)

    def heartbeat(self, agent, goal_id):
        """Renew the claimer's lease; also resumes a goal that was waiting on a person."""
        goal = self.get(goal_id)
        if goal["claimed_by"] != agent["id"] or goal["status"] not in ("claimed", "waiting"):
            raise self.hive.error(409, "not_claimed", "you do not hold this goal")
        self.db.update("goals", goal_id, {"status": "claimed", "updated_at": now(),
                                          "lease_until": _later(self.hive.settings.goal_lease_minutes)})
        return self._emit(goal_id)

    def result(self, agent, goal_id, status, result):
        goal = self.get(goal_id)
        if goal["claimed_by"] != agent["id"]:
            raise self.hive.error(403, "forbidden", "only the dot that claimed a goal can finish it")
        if goal["status"] not in ("claimed", "waiting"):
            raise self.hive.error(409, "not_claimed", f"goal is {goal['status']}")
        if status not in ("done", "failed", "waiting"):
            raise self.hive.error(400, "bad_request", "status must be done, failed or waiting")
        text = str(result or "").strip()
        if status == "done" and not text:
            raise self.hive.error(400, "no_result", "say what was done: a goal is not done without a result")
        values = {"status": status, "result": text[:4000], "updated_at": now()}
        if status == "waiting":
            values["lease_until"] = None
        self.db.update("goals", goal_id, values)
        return self._emit(goal_id)

    async def expire(self, moment=None):
        """Release claims whose lease lapsed; stall goals that keep lapsing."""
        moment = moment or now()
        released = []
        for goal in self.db.all("SELECT * FROM goals WHERE status = 'claimed' AND lease_until IS NOT NULL "
                                "AND lease_until < ?", (moment,)):
            if goal["attempts"] >= MAX_ATTEMPTS:
                self.db.update("goals", goal["id"], {"status": "stalled", "lease_until": None, "updated_at": now(),
                                                     "result": f"stalled: {goal['attempts']} claims lapsed "
                                                               f"without a result (last {goal['claimed_by']})"})
                self._emit(goal["id"])
            else:
                self.db.update("goals", goal["id"], {"status": "open", "claimed_by": None, "lease_until": None,
                                                     "updated_at": now()})
                await self.announce(self._emit(goal["id"]))
            released.append(goal["id"])
        return released

    async def notify_parent(self, goal):
        """When the last subgoal finishes, tell whoever holds the parent, with the results."""
        if not goal["parent_id"]:
            return
        parent = self.get(goal["parent_id"])
        children = self.db.all("SELECT * FROM goals WHERE parent_id = ?", (parent["id"],))
        if parent["status"] != "claimed" or any(c["status"] in UNFINISHED for c in children):
            return
        summary = "; ".join(f"{c['title']}: {c['status']} - {c['result'] or ''}".strip(" -") for c in children)
        await self.hive.send_to_agent(parent["claimed_by"], f"[SUBGOALS-DONE {parent['id']}] {summary}",
                                      sender="hive:goals", extra={"event": "subgoals_done", "goal_id": parent["id"]})

    @staticmethod
    def dumps(value):
        return json.dumps(value)
