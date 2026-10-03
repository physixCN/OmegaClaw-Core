"""Timed, consented sharing of private memory between dots."""

import asyncio
import json

from hive.tests.test_core_api import agent_headers, client, make_swarm_and_agents  # noqa: F401  (fixture)


def write_space(client, agent, name, atoms):
    memory = client.app.state.hive.settings.agents_dir / agent["id"] / "memory"
    memory.mkdir(parents=True, exist_ok=True)
    (memory / f"{name}.metta").write_text("\n".join(atoms) + "\n")


def call(client, agent, method, path, body=None, **params):
    return client.request(method, path, headers=agent_headers(agent), json=body, params=params)


def inbox(client, agent):
    return [json.loads(m["text"]) for m in call(client, agent, "GET", "/api/agent/inbox").json()["messages"]]


THEORY = ['(Theory gravity "mass bends spacetime")', '(Theory light "c is constant")', "(Note todo check units)"]


def test_request_grant_read_and_expire(client):
    _, (a, b) = make_swarm_and_agents(client)
    write_space(client, a, "world", THEORY)
    req = call(client, b, "POST", "/api/agent/shares/request",
               {"owner": a["name"], "space": "world", "minutes": 20, "reason": "checking the light theory"}).json()
    assert req["status"] == "requested" and req["owner_id"] == a["id"]
    assert call(client, b, "POST", "/api/agent/shares/request",
                {"owner": a["name"], "space": "world"}).json()["id"] == req["id"]   # no duplicates
    assert inbox(client, a)[-1]["event"] == "share_request"
    assert call(client, b, "GET", f"/api/agent/shares/{req['id']}/atoms").status_code == 410   # not granted yet
    assert call(client, b, "POST", f"/api/agent/shares/{req['id']}/grant").status_code == 403  # only the owner
    granted = call(client, a, "POST", f"/api/agent/shares/{req['id']}/grant").json()
    assert granted["status"] == "active" and granted["expires_at"]
    assert inbox(client, b)[-1]["event"] == "share_granted"
    read = call(client, b, "GET", f"/api/agent/shares/{req['id']}/atoms", q="theory").json()
    assert read["total"] == 2 and read["owner"] == a["name"]
    assert call(client, a, "GET", f"/api/agent/shares/{req['id']}/atoms").status_code == 403  # owner isn't grantee
    assert client.get(f"/api/shares/{req['id']}/reads").json()[0]["returned"] == 2
    hive = client.app.state.hive
    hive.db.update("shares", req["id"], {"expires_at": "2000-01-01T00:00:00.000Z"})
    assert asyncio.run(hive.shares.expire()) == [req["id"]]
    assert call(client, b, "GET", f"/api/agent/shares/{req['id']}/atoms").status_code == 410
    assert inbox(client, b)[-1]["event"] == "share_expired"


def test_deny_offer_filter_and_revoke(client):
    _, (a, b) = make_swarm_and_agents(client)
    write_space(client, a, "world", THEORY)
    req = call(client, b, "POST", "/api/agent/shares/request", {"owner": a["id"], "space": "world"}).json()
    assert call(client, a, "POST", f"/api/agent/shares/{req['id']}/deny", {"reason": "not ready"}).json()["status"] \
        == "denied"
    offer = call(client, a, "POST", "/api/agent/shares/offer",
                 {"grantee": b["name"], "space": "world", "minutes": 999, "filter": "light"}).json()
    assert offer["status"] == "active" and offer["minutes"] == 240    # capped
    read = call(client, b, "GET", f"/api/agent/shares/{offer['id']}/atoms").json()
    assert read["atoms"] == ['(Theory light "c is constant")']        # the owner's filter always applies
    assert call(client, b, "POST", f"/api/agent/shares/{offer['id']}/revoke").status_code == 403
    assert call(client, a, "POST", f"/api/agent/shares/{offer['id']}/revoke").json()["status"] == "revoked"
    assert call(client, b, "GET", f"/api/agent/shares/{offer['id']}/atoms").status_code == 410


def test_exhibit_to_the_swarm(client):
    _, (a, b, c) = make_swarm_and_agents(client, n=3)
    write_space(client, a, "world", THEORY)
    shown = call(client, a, "POST", "/api/agent/exhibits",
                 {"title": "Unified notes", "to": "swarm", "minutes": 10, "body": "Draft of the theory.",
                  "space": "world", "filter": "Theory", "atoms": ["(Claim x)"]}).json()
    assert shown["atoms"] == 3 and len(shown["shares"]) == 2
    share = next(s for s in shown["shares"] if s["grantee_id"] == c["id"])
    read = call(client, c, "GET", f"/api/agent/shares/{share['id']}/atoms").json()
    assert read["title"] == "Unified notes" and read["body"] == "Draft of the theory." and read["total"] == 3
    assert inbox(client, b)[-1]["event"] == "exhibit"
    big = call(client, a, "POST", "/api/agent/exhibits", {"title": "Huge", "to": "swarm", "body": "x" * 300000})
    assert big.status_code == 413


def test_sharing_stays_inside_the_swarm(client):
    _, (a,) = make_swarm_and_agents(client, n=1)
    _, (stranger,) = make_swarm_and_agents(client, n=1)
    write_space(client, a, "world", THEORY)
    asked = call(client, stranger, "POST", "/api/agent/shares/request", {"owner": a["id"], "space": "world"})
    assert asked.status_code == 404
    assert call(client, a, "POST", "/api/agent/shares/request", {"owner": a["id"], "space": "world"}).status_code \
        == 400  # asking yourself
    missing = call(client, a, "POST", "/api/agent/shares/offer", {"grantee": "nobody", "space": "world"})
    assert missing.status_code == 404
