"""Policy engine and approvals: which agent actions run, which wait for a human.

The Omega loop asks ``authorize(agent, command)`` before running each skill.
Human-only skills are always refused.  Otherwise the most specific matching
rule decides (agent scope, then swarm, then hive; an exact skill name beats a
glob), falling back to the defaults below.  ``ask`` files an Approval; once a
human approves it, that exact command is allowed once.
"""

from __future__ import annotations

import fnmatch
import json

from ..spaces import sexpr
from .db import new_id, now

HUMAN_ONLY = ["change-password", "transfer-funds", "pay*", "purchase*"]

DEFAULT_ALLOW = ["send", "wait", "pin", "hive-*", "query", "remember", "episodes", "search", "web-search",
                 "read-file", "space-find", "space-count", "space-examples", "space-pressure", "skill-*",
                 "beliefs-*", "agenda-*", "events-*", "energy-status", "channel-status"]
DEFAULT_ASK = ["shell", "shell-confirm", "metta", "write-file*", "append-file*", "send-file*", "codex-*",
               "space-transform", "remove-atom", "*-commit", "restart-omega"]

HIGH_RISK = {"shell-confirm", "metta", "space-transform", "remove-atom", "restart-omega"}
SCOPE_RANK = {"agent": 0, "swarm": 1, "hive": 2}


def command_skill(command):
    """Skill name of a command such as (shell "ls"); None if unparseable."""
    try:
        tokens = sexpr.tokenize(str(command))
    except ValueError:
        return None
    if len(tokens) >= 2 and tokens[0] == "(" and isinstance(tokens[1], str) and tokens[1] not in "()":
        return str(tokens[1])
    return None


def _minutes_ago(minutes):
    import datetime
    moment = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _matches(pattern, skill):
    return fnmatch.fnmatchcase(skill, pattern)


class Policy:
    def __init__(self, hive):
        self.hive = hive
        self.db = hive.db
        self.recent = {}  # agent_id -> {command: decision}, for traces

    # ---- rules ----------------------------------------------------------------------

    def rules(self):
        return self.db.all("SELECT * FROM policy_rules ORDER BY created_at")

    def add_rule(self, scope, skill, mode, note=""):
        if mode not in ("allow", "ask", "deny"):
            raise self.hive.error(400, "bad_request", "mode must be allow, ask or deny")
        kind, _, ref = str(scope).partition(":")
        if kind not in SCOPE_RANK or (kind != "hive" and not ref):
            raise self.hive.error(400, "bad_request", "scope must be hive, swarm:<id> or agent:<id>")
        if not str(skill).strip():
            raise self.hive.error(400, "bad_request", "skill is required")
        row = {"id": new_id("r"), "scope": scope, "skill": str(skill).strip(), "mode": mode,
               "note": str(note or ""), "created_at": now()}
        self.db.insert("policy_rules", row)
        self.hive.events.publish("policy.updated", rules=self.rules())
        return row

    def delete_rule(self, rule_id):
        self.db.execute("DELETE FROM policy_rules WHERE id = ?", (rule_id,))
        self.hive.events.publish("policy.updated", rules=self.rules())
        return {"ok": True}

    def decide(self, agent, skill):
        """(mode, reason) for a skill, without approvals."""
        if any(_matches(p, skill) for p in HUMAN_ONLY):
            return "deny", "human-only action"
        scopes = {"hive": 2, f"agent:{agent['id']}": 0}
        if agent.get("swarm_id"):
            scopes[f"swarm:{agent['swarm_id']}"] = 1
        candidates = []
        for rule in self.rules():
            if rule["scope"] in scopes and _matches(rule["skill"], skill):
                exact = 0 if rule["skill"] == skill else 1
                candidates.append((scopes[rule["scope"]], exact, rule))
        if candidates:
            candidates.sort(key=lambda c: (c[0], c[1], c[2]["created_at"]))
            rule = candidates[0][2]
            return rule["mode"], rule["note"] or f"rule {rule['skill']} ({rule['scope']})"
        if any(_matches(p, skill) for p in DEFAULT_ALLOW):
            return "allow", "default"
        if any(_matches(p, skill) for p in DEFAULT_ASK):
            return "ask", "side effects outside the agent need a human"
        return "allow", "default"

    # ---- authorize --------------------------------------------------------------------

    def authorize(self, agent, command):
        command = str(command).strip()
        skill = command_skill(command)
        if skill is None:
            return {"decision": "deny", "message": "HIVE-DENIED unparseable command"}
        mode, reason = self.decide(agent, skill)
        decision = None
        if mode == "deny":
            decision = {"decision": "deny", "message": f"HIVE-DENIED {skill}: {reason}"}
        elif mode == "allow":
            decision = {"decision": "allow"}
        else:
            granted = self.db.one(
                "SELECT * FROM approvals WHERE agent_id = ? AND command = ? AND status = 'approved' "
                "ORDER BY created_at LIMIT 1", (agent["id"], command))
            if granted:
                self.db.execute("UPDATE approvals SET status = 'used' WHERE id = ?", (granted["id"],))
                self.hive.events.publish("approval.updated", approval=self.approval(granted["id"]))
                decision = {"decision": "allow", "approval_id": granted["id"]}
            else:
                pending = self.db.one(
                    "SELECT * FROM approvals WHERE agent_id = ? AND command = ? AND status = 'pending'",
                    (agent["id"], command))
                approval = pending or self._file(agent, skill, command, reason)
                decision = {"decision": "pending", "approval_id": approval["id"],
                            "message": f"HIVE-APPROVAL-PENDING {approval['id']}: a human must approve {command}. "
                                       "You will get a message when it is approved; then issue the same command again."}
        self.recent.setdefault(agent["id"], {})[command] = (
            "ask" if decision["decision"] == "pending" else decision["decision"])
        return decision

    def enforce(self, agent, skill, command):
        """Apply the policy to an action taken directly through the HTTP API.

        The Omega loop asks ``authorize`` before running a skill; external
        members (and any client) call the routes directly, so disclosure routes
        enforce the same rules here. ``deny`` refuses. ``ask`` needs a human:
        either an approval the agent's own gate just used for this skill (one
        redemption each), or an approval of this exact canonical command, filed
        on the first attempt and allowed once after a human approves it.
        """
        mode, reason = self.decide(agent, skill)
        if mode == "allow":
            return
        if mode == "deny":
            raise self.hive.error(403, "policy_denied", f"{skill} is denied for {agent['name']}: {reason}")
        recent = self.db.one(
            "SELECT * FROM approvals WHERE agent_id = ? AND skill = ? AND status = 'used' AND redeemed_at IS NULL "
            "AND decided_at >= ? ORDER BY decided_at DESC LIMIT 1",
            (agent["id"], skill, _minutes_ago(30)))
        gate_used = recent and self.recent.get(agent["id"], {}).get(recent["command"]) is not None
        if gate_used:
            self.db.execute("UPDATE approvals SET redeemed_at = ? WHERE id = ?", (now(), recent["id"]))
            return
        decision = self.authorize(agent, command)
        if decision["decision"] == "allow":
            if decision.get("approval_id"):
                self.db.execute("UPDATE approvals SET redeemed_at = ? WHERE id = ?", (now(), decision["approval_id"]))
            return
        if decision["decision"] == "pending":
            raise self.hive.error(403, "approval_required",
                                  f"{skill} needs a person's approval ({decision['approval_id']}); send the same "
                                  "request again once it is approved", {"approval_id": decision["approval_id"]})
        raise self.hive.error(403, "policy_denied", decision.get("message", f"{skill} is denied"))

    def _file(self, agent, skill, command, reason):
        row = {"id": new_id("p"), "agent_id": agent["id"], "skill": skill, "command": command,
               "reason": reason, "risk": "high" if skill in HIGH_RISK else "medium", "status": "pending",
               "decided_by": None, "created_at": now(), "decided_at": None}
        self.db.insert("approvals", row)
        self.hive.events.publish("approval.created", approval=row)
        return row

    # ---- approvals ------------------------------------------------------------------------

    def approval(self, approval_id):
        row = self.db.one("SELECT * FROM approvals WHERE id = ?", (approval_id,))
        if row is None:
            raise self.hive.error(404, "not_found", f"no approval {approval_id}")
        return row

    def approvals(self, status=None):
        if status:
            return self.db.all("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC", (status,))
        return self.db.all("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 500")

    async def decide_approval(self, approval_id, approve, operator="user:operator", remember=False):
        row = self.approval(approval_id)
        if row["status"] != "pending":
            raise self.hive.error(409, "not_pending", f"approval is {row['status']}")
        status = "approved" if approve else "denied"
        self.db.execute("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
                        (status, operator, now(), approval_id))
        if approve and remember:
            self.add_rule(f"agent:{row['agent_id']}", row["skill"], "allow",
                          f"always allowed when approving {approval_id}")
        updated = self.approval(approval_id)
        self.hive.events.publish("approval.updated", approval=updated)
        note = (f"[APPROVED {approval_id}] {row['command']}" if approve
                else f"[DENIED {approval_id}] {row['command']} - do not retry it")
        await self.hive.send_to_agent(row["agent_id"], note, sender="hive:approvals")
        return updated

    def gate_of(self, agent_id, command):
        return self.recent.get(agent_id, {}).get(str(command).strip())

    @staticmethod
    def dumps(value):
        return json.dumps(value)
