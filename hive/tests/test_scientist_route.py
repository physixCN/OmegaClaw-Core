"""The Scientist route: a program asks a named dot to analyse a revision-bound snapshot.

1. The program shows the snapshot to the Scientist as an exhibit (the hive
   computes its digest) and posts a goal assigned to the Scientist, bound to
   {request_id, base_revision, snapshot_digest, share_ids}.
2. The Scientist reads the goal and its binding, claims it (no one else
   can), reads the snapshot and checks the digest.
3. It returns a proposal. The result must echo the binding (or its digest),
   or it is refused.
4. On cancellation the snapshot share is revoked, the Scientist is told, its
   late result is refused, and it acknowledges.
"""

import json
import textwrap

from hive.tests.test_core_api import agent_headers, client  # noqa: F401  (fixture)

PROGRAM = textwrap.dedent('''
    SNAPSHOT = {"revision": "r3", "atoms": ["(supports e1 c1)", "(contradicts e3 c1)", "(origin e1 council)"]}

    def describe():
        return {"contract": "0.1", "kinds": [{"id": "claim", "label": "Claim", "role": "claim"}],
                "relations": [], "actions": [{"id": "request-analysis", "label": "Ask the Scientist",
                                              "applies_to": ["claim"]},
                                             {"id": "collect", "label": "Collect", "applies_to": ["claim"]},
                                             {"id": "cancel", "label": "Cancel", "applies_to": ["claim"]}]}

    def view(ctx, focus, stage):
        return {"revision": SNAPSHOT["revision"], "items": [{"id": "c1", "kind": "claim", "label": "claim"}]}

    async def act(ctx, action, items, params):
        if action == "request-analysis":
            shown = await ctx.exhibit("Snapshot r3 for c1", ["Scientist"], 20, body="revision r3",
                                      atoms=SNAPSHOT["atoms"])
            binding = {"request_id": params["request_id"], "base_revision": SNAPSHOT["revision"],
                       "snapshot_digest": shown["digest"], "share_ids": [s["id"] for s in shown["shares"]]}
            goal = await ctx.create_goal("Analyse c1 at r3", "read the snapshot exhibit", assignee="Scientist",
                                         binding=binding)
            return {"status": "started", "task": {"id": goal["id"], "kind": "goal", "status": goal["status"]},
                    "detail": {"binding": binding}}
        if action == "collect":
            goal = ctx.goal(params["goal_id"])
            return {"status": "done", "detail": {"status": goal["status"], "proposal": goal["result_data"],
                                                 "binding_digest": goal["binding_digest"]}}
        if action == "cancel":
            goal = await ctx.cancel_goal(params["goal_id"])
            return {"status": "done", "detail": {"status": goal["status"]}}
        return {"status": "refused"}
''')


def call(client, agent, method, path, body=None, **params):
    return client.request(method, path, headers=agent_headers(agent), json=body, params=params)


def setup(client, tmp_path, monkeypatch):
    folder = tmp_path / "requester"
    folder.mkdir()
    (folder / "plugin.json").write_text(json.dumps({"id": "requester", "name": "Requester",
                                                    "capabilities": ["goals:read", "goals:write", "exhibits:write"]}))
    (folder / "program.py").write_text(PROGRAM)
    monkeypatch.setenv("HIVE_PLUGIN_DIRS", str(folder))
    client.post("/api/programs/reload")
    swarm = client.post("/api/swarms", json={"name": "Lab"}).json()
    scientist = client.post("/api/agents", json={"name": "Scientist", "kind": "module", "swarm_id": swarm["id"]}).json()
    other = client.post("/api/agents", json={"name": "Other", "kind": "module", "swarm_id": swarm["id"]}).json()
    return swarm, scientist, other


def act(client, swarm, action, **params):
    return client.post("/api/programs/requester/act", json={"swarm_id": swarm["id"], "action": action,
                                                            "items": ["c1"], "params": params}).json()


def test_bound_request_claim_snapshot_and_proposal(client, tmp_path, monkeypatch):
    swarm, scientist, other = setup(client, tmp_path, monkeypatch)
    started = act(client, swarm, "request-analysis", request_id="req-1")
    assert started["status"] == "started"
    goal_id, binding = started["task"]["id"], started["detail"]["binding"]
    inbox = [json.loads(m["text"]) for m in call(client, scientist, "GET", "/api/agent/inbox").json()["messages"]]
    assert {m.get("event") for m in inbox} >= {"goal", "exhibit"}
    assert not [m for m in call(client, other, "GET", "/api/agent/inbox").json()["messages"]
                if json.loads(m["text"]).get("event") == "goal"]               # announced to the assignee only
    goal = call(client, scientist, "GET", f"/api/agent/goals/{goal_id}").json()
    assert goal["binding"] == binding and goal["assignee"] == scientist["id"] and goal["binding_digest"]
    assert call(client, other, "POST", f"/api/agent/goals/{goal_id}/claim").json()["error"]["code"] == "not_assigned"
    assert call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/claim").json()["status"] == "claimed"
    snapshot = call(client, scientist, "GET", f"/api/agent/shares/{binding['share_ids'][0]}/atoms").json()
    assert snapshot["digest"] == binding["snapshot_digest"] and snapshot["complete"] is True
    wrong = call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/result", {
        "status": "done", "result": "proposal", "data": {"binding": dict(binding, base_revision="r2"),
                                                         "proposal": {"assessment": "contested"}}})
    assert wrong.status_code == 409 and wrong.json()["error"]["code"] == "binding_mismatch"
    done = call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/result", {
        "status": "done", "result": "proposal for c1 at r3",
        "data": {"binding_digest": goal["binding_digest"], "proposal": {"assessment": "contested",
                                                                       "checks": ["shared origin e1/e2"]}}})
    assert done.status_code == 200 and done.json()["status"] == "done"
    collected = act(client, swarm, "collect", goal_id=goal_id)
    assert collected["detail"]["proposal"]["proposal"]["assessment"] == "contested"


def test_cancellation_revokes_the_snapshot_and_is_acknowledged(client, tmp_path, monkeypatch):
    swarm, scientist, _ = setup(client, tmp_path, monkeypatch)
    started = act(client, swarm, "request-analysis", request_id="req-2")
    goal_id, binding = started["task"]["id"], started["detail"]["binding"]
    call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/claim")
    assert act(client, swarm, "cancel", goal_id=goal_id)["detail"]["status"] == "cancelled"
    inbox = [json.loads(m["text"]) for m in call(client, scientist, "GET", "/api/agent/inbox").json()["messages"]]
    assert inbox[-1]["event"] == "goal_cancelled"
    assert call(client, scientist, "GET", f"/api/agent/shares/{binding['share_ids'][0]}/atoms").status_code == 410
    late = call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/result",
                {"status": "done", "result": "late", "data": {"binding": binding}})
    assert late.status_code == 409 and late.json()["error"]["code"] == "goal_cancelled"
    acked = call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/cancel-ack").json()
    assert acked["cancel_ack_at"] and acked["cancel_ack_by"] == scientist["id"]
    operator_cancel = client.post(f"/api/swarms/{swarm['id']}/goals", json={
        "title": "manual", "assignee": "Scientist", "binding": {"request_id": "req-3"}}).json()
    client.patch(f"/api/goals/{operator_cancel['id']}", json={"status": "cancelled"})
    assert call(client, scientist, "POST", f"/api/agent/goals/{operator_cancel['id']}/cancel-ack").status_code == 200


def test_identical_retry_is_accepted_and_deadlines_close_bound_goals(client, tmp_path, monkeypatch):
    import asyncio
    swarm, scientist, _ = setup(client, tmp_path, monkeypatch)
    started = act(client, swarm, "request-analysis", request_id="req-4")
    goal_id, binding = started["task"]["id"], started["detail"]["binding"]
    call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/claim")
    body = {"status": "done", "result": "p", "data": {"binding": binding, "proposal": {"x": 1}}}
    assert call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/result", body).status_code == 200
    assert call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/result", body).status_code == 200  # retry
    changed = dict(body, data={"binding": binding, "proposal": {"x": 2}})
    assert call(client, scientist, "POST", f"/api/agent/goals/{goal_id}/result", changed).status_code == 409
    timed = client.post(f"/api/swarms/{swarm['id']}/goals", json={
        "title": "timed", "assignee": "Scientist", "deadline_minutes": 5,
        "binding": {"request_id": "req-5", "share_ids": binding["share_ids"]}}).json()
    hive = client.app.state.hive
    hive.db.update("goals", timed["id"], {"deadline_at": "2000-01-01T00:00:00.000Z"})
    assert timed["id"] in asyncio.run(hive.goals.expire())
    late = call(client, scientist, "POST", f"/api/agent/goals/{timed['id']}/claim")
    assert late.status_code == 409
    inbox = [json.loads(m["text"]) for m in call(client, scientist, "GET", "/api/agent/inbox").json()["messages"]]
    assert inbox[-1]["event"] == "goal_expired"
    assert call(client, scientist, "POST", f"/api/agent/goals/{timed['id']}/cancel-ack").status_code == 200


def test_app_identity_is_validated_data(client, tmp_path, monkeypatch):
    from hive.core.programs import check_app
    app, warnings = check_app({"theme": {"accent": "#ff7a59", "surface": "#101418", "ink": "#f4efe6",
                                         "type": "editorial", "motif": "strata"}, "home": "q1",
                                "open_stage": "map", "tagline": "Evidence, mapped."})
    assert not warnings and app["theme"]["motif"] == "strata" and app["open_stage"] == "map"
    unreadable, warnings = check_app({"theme": {"ink": "#222222", "surface": "#111111", "font": "Comic"}})
    assert unreadable["theme"]["ink"] == "#e8eaf6" and len(warnings) == 2
    listed = {p["id"]: p for p in client.get("/api/programs").json()}
    assert listed["contract-fixture"]["app"]["open_stage"] == "unfold"
