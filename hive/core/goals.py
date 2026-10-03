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
import hashlib
import json

from .db import new_id, now

STATUSES = {"open", "claimed", "waiting", "stalled", "done", "failed", "cancelled"}
UNFINISHED = ("open", "claimed", "waiting", "stalled")
MAX_ATTEMPTS = 3
MAX_DEPTH = 4
MAX_CHILDREN = 12
MAX_BINDING_BYTES = 16 * 1024
MAX_RESULT_DATA_BYTES = 256 * 1024
BINDING_KEYS = ("request_id", "base_revision", "snapshot_digest")


def binding_digest(binding):
    """A stable digest of a goal's binding, so a proposal can prove which request it answers."""
    return "sha256:" + hashlib.sha256(json.dumps(binding, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


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

    @staticmethod
    def view(row):
        out = dict(row)
        for key in ("binding", "result_data"):
            out[key] = json.loads(row[key]) if row.get(key) else None
        out["binding_digest"] = binding_digest(out["binding"]) if out["binding"] else None
        return out

    def list(self, swarm_id, status=None):
        sql, params = "SELECT * FROM goals WHERE swarm_id = ?", [swarm_id]
        if status:
            sql += " AND status = ?"
            params.append(status)
        return [self.view(r) for r in self.db.all(sql + " ORDER BY priority DESC, created_at", params)]

    def for_agent(self, agent, goal_id):
        goal = self.get(goal_id)
        if goal["swarm_id"] != agent["swarm_id"]:
            raise self.hive.error(403, "forbidden", "goal is in another swarm")
        return self.view(goal)

    def depth(self, goal):
        depth = 0
        while goal["parent_id"] and depth < MAX_DEPTH + 1:
            goal = self.get(goal["parent_id"])
            depth += 1
        return depth

    def _emit(self, goal_id):
        goal = self.view(self.get(goal_id))
        self.hive.events.publish("goal.updated", goal=goal)
        return goal

    async def create(self, swarm_id, title, detail="", priority=0.5, parent_id=None, created_by="user:operator",
                     assignee=None, binding=None, deadline_minutes=None):
        self.hive.swarm(swarm_id)
        if not str(title).strip():
            raise self.hive.error(400, "bad_request", "title is required")
        assignee_id = None
        if assignee:
            rows = self.db.all("SELECT id, name FROM agents WHERE swarm_id = ? AND deleted = 0", (swarm_id,))
            match = [r for r in rows if r["id"] == assignee] or [r for r in rows if r["name"].lower() == str(assignee).lower()]
            if not match:
                raise self.hive.error(404, "not_found", f"no dot {assignee!r} in this swarm to assign")
            assignee_id = match[0]["id"]
        if binding is not None:
            if not isinstance(binding, dict):
                raise self.hive.error(400, "bad_request", "binding must be an object")
            if len(json.dumps(binding)) > MAX_BINDING_BYTES:
                raise self.hive.error(413, "too_large", "a binding is limited to 16 KB")
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
               "assignee": assignee_id, "binding": json.dumps(binding) if binding is not None else None,
               "deadline_at": _later(float(deadline_minutes)) if deadline_minutes else None,
               "created_at": stamp, "updated_at": stamp}
        self.db.insert("goals", row)
        goal = self._emit(row["id"])
        await self.announce(goal)
        return goal

    async def announce(self, goal):
        """Tell the swarm's awake members (or only the assignee), except whoever posted it."""
        author = goal["created_by"].removeprefix("agent:")
        envelope_text = (f"New goal {goal['id']} (priority {goal['priority']:.2f}): {goal['title']}"
                         + (f" - {goal['detail']}" if goal["detail"] else ""))
        if goal.get("assignee"):
            envelope_text = f"Assigned to you: {envelope_text}"
        for member in self.db.all("SELECT id, status, kind FROM agents WHERE swarm_id = ? AND deleted = 0",
                                  (goal["swarm_id"],)):
            if goal.get("assignee") and member["id"] != goal["assignee"]:
                continue
            if member["id"] == author or (member["kind"] != "module" and member["status"] not in ("awake", "starting")):
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
            if changes["status"] == "open":
                # Re-opening (e.g. a stalled goal) is a fresh start: no holder, no lapses.
                values.update(claimed_by=None, lease_until=None, attempts=0)
        if "priority" in changes:
            values["priority"] = max(0.0, min(1.0, float(changes["priority"])))
        for key in ("title", "detail"):
            if key in changes:
                values[key] = str(changes[key])
        if values:
            values["updated_at"] = now()
            self.db.update("goals", goal["id"], values)
        return self._emit(goal_id)

    async def notify_cancelled(self, goal_id):
        """Tell whoever holds (or was assigned) a cancelled goal, so it stops and acknowledges."""
        goal = self.get(goal_id)
        if goal["status"] != "cancelled":
            return
        await self._close_bound(goal, "GOAL-CANCELLED", "goal_cancelled")

    async def _close_bound(self, goal, tag, event):
        """Revoke a bound goal's snapshot shares and tell its holder or assignee to stop."""
        binding = json.loads(goal["binding"]) if goal.get("binding") else {}
        for share_id in binding.get("share_ids") or []:
            try:
                await self.hive.shares.revoke(share_id)   # the snapshot stops being readable
            except Exception as exc:  # already closed shares are fine
                if getattr(exc, "status", None) not in (404, 409):
                    raise
        for agent_id in {goal["claimed_by"], goal.get("assignee")} - {None}:
            await self.hive.send_to_agent(agent_id, f"[{tag} {goal['id']}] {goal['title']} - stop and "
                                                    f"acknowledge with cancel-ack", sender="hive:goals",
                                          extra={"event": event, "goal_id": goal["id"]})

    def cancel_ack(self, agent, goal_id):
        goal = self.get(goal_id)
        expired = goal["status"] == "failed" and goal.get("deadline_at") and goal["deadline_at"] < now()
        if goal["status"] != "cancelled" and not expired:
            raise self.hive.error(409, "not_cancelled", f"goal is {goal['status']}")
        if agent["id"] not in (goal["claimed_by"], goal.get("assignee")):
            raise self.hive.error(403, "forbidden", "only the holder or assignee acknowledges a cancellation")
        if not goal.get("cancel_ack_at"):
            self.db.update("goals", goal_id, {"cancel_ack_at": now(), "cancel_ack_by": agent["id"]})
        return self._emit(goal_id)

    def claim(self, agent, goal_id):
        goal = self.get(goal_id)
        if goal["swarm_id"] != agent["swarm_id"]:
            raise self.hive.error(403, "forbidden", "goal is in another swarm")
        if goal.get("assignee") and goal["assignee"] != agent["id"]:
            raise self.hive.error(403, "not_assigned", "this goal is assigned to another dot")
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

    def result(self, agent, goal_id, status, result, data=None):
        goal = self.get(goal_id)
        if goal["status"] == "cancelled":
            raise self.hive.error(409, "goal_cancelled", "this goal was cancelled; acknowledge with cancel-ack")
        if goal.get("deadline_at") and goal["deadline_at"] < now() and goal["status"] not in ("done", "failed"):
            raise self.hive.error(409, "goal_expired", "this goal's deadline has passed")
        if goal["claimed_by"] != agent["id"]:
            raise self.hive.error(403, "forbidden", "only the dot that claimed a goal can finish it")
        if data is not None:
            if not isinstance(data, dict):
                raise self.hive.error(400, "bad_request", "data must be an object")
            if len(json.dumps(data)) > MAX_RESULT_DATA_BYTES:
                raise self.hive.error(413, "too_large", "result data is limited to 256 KB")
        if goal.get("binding"):
            binding = json.loads(goal["binding"])
            echoed = (data or {}).get("binding")
            if status == "done" and echoed != binding and (data or {}).get("binding_digest") != binding_digest(binding):
                raise self.hive.error(409, "binding_mismatch",
                                      "a result for a bound goal must echo its binding (or binding_digest) exactly")
        text_in = str(result or "").strip()
        if goal["status"] in ("done", "failed") and goal["status"] == status and len(text_in) <= 4000 \
                and (goal.get("result") or "") == text_in \
                and (json.loads(goal["result_data"]) if goal.get("result_data") else None) == data:
            return self.view(goal)   # an identical retry (e.g. after a lost response) is accepted once more
        if goal["status"] not in ("claimed", "waiting"):
            raise self.hive.error(409, "not_claimed", f"goal is {goal['status']}")
        if status not in ("done", "failed", "waiting"):
            raise self.hive.error(400, "bad_request", "status must be done, failed or waiting")
        text = str(result or "").strip()
        if status == "done" and not text:
            raise self.hive.error(400, "no_result", "say what was done: a goal is not done without a result")
        values = {"status": status, "result": text[:4000], "updated_at": now()}
        if data is not None:
            values["result_data"] = json.dumps(data)
        if status == "waiting":
            values["lease_until"] = None
        self.db.update("goals", goal_id, values)
        return self._emit(goal_id)

    async def expire(self, moment=None):
        """Release claims whose lease lapsed; stall goals that keep lapsing."""
        moment = moment or now()
        released = []
        # A deadline is a hard time budget: past it the goal fails, its snapshot shares are revoked and the
        # holder is told, whatever state it is in.
        for goal in self.db.all("SELECT * FROM goals WHERE deadline_at IS NOT NULL AND deadline_at < ? "
                                "AND status IN ('open', 'claimed', 'waiting', 'stalled')", (moment,)):
            self.db.update("goals", goal["id"], {"status": "failed", "lease_until": None, "updated_at": now(),
                                                 "result": "deadline passed before a result arrived"})
            await self._close_bound(goal, "GOAL-EXPIRED", "goal_expired")
            self._emit(goal["id"])
            released.append(goal["id"])
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
