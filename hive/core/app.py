"""FastAPI application: REST + live events for the UI, agent hub, LLM gateway."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import pathlib
import secrets
import time

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from ..supervisor.drivers import Supervisor
from .config import Settings, load_settings
from .db import now
from .gateway import Gateway, GatewayError
from .hive import Hive, HiveError, token_hash

UI_DIST = pathlib.Path(__file__).resolve().parents[1] / "ui" / "dist"


def _bearer(value):
    value = value or ""
    return value[7:].strip() if value.lower().startswith("bearer ") else ""


def create_app(settings: Settings | None = None, supervisor=None, reconcile_seconds=5.0) -> FastAPI:
    settings = settings or load_settings()
    if not settings.admin_password:
        password_file = settings.data_dir / "admin-password"
        if not password_file.exists():
            password_file.write_text(secrets.token_urlsafe(12))
            password_file.chmod(0o600)
        settings.admin_password = password_file.read_text().strip()
    supervisor = supervisor if supervisor is not None else Supervisor(settings)
    hive = Hive(settings, supervisor=supervisor)
    if supervisor:
        supervisor.attach(hive)
    gateway = Gateway(settings.providers)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        hive.events.bind(asyncio.get_running_loop())
        await hive.restore()
        task = asyncio.create_task(reconcile()) if supervisor and reconcile_seconds else None
        yield
        if task:
            task.cancel()
        if supervisor:
            for row in hive.db.all("SELECT id FROM agents WHERE deleted = 0"):
                await run_in_threadpool(supervisor.stop, row["id"])
        await gateway.client.aclose()

    async def reconcile():
        while True:
            await asyncio.sleep(reconcile_seconds)
            try:
                await run_in_threadpool(supervisor.check)
                await hive.scheduler.tick()
                await hive.goals.expire()
                await hive.shares.expire()
                for agent_id in hive.idle_candidates():
                    await run_in_threadpool(hive.lifecycle, agent_id, "sleep")
            except Exception as exc:  # keep reconciling
                print(f"[hive] reconcile error: {exc}")

    app = FastAPI(title="OmegaDots Hive", version="0.1.0", lifespan=lifespan)
    app.state.hive = hive
    app.state.gateway = gateway
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(HiveError)
    async def hive_error(_, exc: HiveError):
        error = {"code": exc.code, "message": exc.message}
        if getattr(exc, "details", None):
            error.update(exc.details)
        return JSONResponse({"error": error}, status_code=exc.status)

    @app.exception_handler(GatewayError)
    async def gateway_error(_, exc: GatewayError):
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(HTTPException)
    async def http_error(_, exc: HTTPException):
        return JSONResponse({"error": {"code": "http_error", "message": str(exc.detail)}}, status_code=exc.status_code)

    # ---- auth ---------------------------------------------------------------------------

    def operator(request: Request):
        token = _bearer(request.headers.get("authorization")) or request.query_params.get("token", "")
        if not token or not hive.db.one("SELECT 1 FROM sessions WHERE token_hash = ?", (token_hash(token),)):
            raise HiveError(401, "unauthorized", "log in first")

    def agent_from(request: Request):
        agent = hive.authenticate_agent(_bearer(request.headers.get("authorization")))
        if agent is None:
            raise HiveError(401, "unauthorized", "invalid agent token")
        return agent

    async def body(request: Request):
        try:
            data = await request.json()
        except Exception:
            raise HiveError(400, "bad_request", "expected a JSON body")
        if not isinstance(data, dict):
            raise HiveError(400, "bad_request", "expected a JSON object")
        return data

    async def optional_body(request: Request):
        return await body(request) if await request.body() else {}

    @app.post("/api/auth/login")
    async def login(request: Request):
        data = await body(request)
        if not hmac.compare_digest(str(data.get("password", "")), settings.admin_password):
            raise HiveError(401, "unauthorized", "wrong password")
        token = secrets.token_urlsafe(32)
        hive.db.insert("sessions", {"token_hash": token_hash(token), "created_at": now()})
        return {"token": token}

    # ---- hive, models, swarms ---------------------------------------------------------------

    @app.get("/api/hive")
    async def hive_summary(request: Request):
        operator(request)
        return await run_in_threadpool(hive.summary)

    @app.get("/api/models")
    async def models(request: Request):
        operator(request)
        return hive.models()

    @app.get("/api/swarms")
    async def swarms(request: Request):
        operator(request)
        return hive.swarms()

    @app.post("/api/swarms")
    async def create_swarm(request: Request):
        operator(request)
        data = await body(request)
        return hive.create_swarm(data.get("name", ""), data.get("description", ""), data.get("hue"))

    @app.get("/api/swarms/{swarm_id}")
    async def swarm(swarm_id: str, request: Request):
        operator(request)
        return hive.swarm(swarm_id)

    @app.get("/api/swarms/{swarm_id}/beliefs")
    async def beliefs(swarm_id: str, request: Request):
        operator(request)
        return await run_in_threadpool(hive.beliefs, swarm_id)

    @app.get("/api/swarms/{swarm_id}/beliefs/detail")
    async def belief_detail(swarm_id: str, statement: str, request: Request):
        operator(request)
        return await run_in_threadpool(hive.belief, swarm_id, statement)

    @app.get("/api/swarms/{swarm_id}/vocab")
    async def vocab(swarm_id: str, request: Request):
        operator(request)
        hive.swarm(swarm_id)
        return await run_in_threadpool(hive.spaces.vocab, swarm_id)

    @app.post("/api/swarms/{swarm_id}/vocab")
    async def add_vocab(swarm_id: str, request: Request):
        operator(request)
        hive.swarm(swarm_id)
        data = await body(request)
        try:
            return await run_in_threadpool(hive.spaces.add_vocab, swarm_id, list(data.get("terms", [])))
        except ValueError as exc:
            raise HiveError(400, "bad_term", str(exc))

    # ---- agents ---------------------------------------------------------------------------------

    @app.get("/api/agents")
    async def agents(request: Request):
        operator(request)
        return hive.agents()

    @app.post("/api/agents")
    async def create_agent(request: Request):
        operator(request)
        data = await body(request)
        return await run_in_threadpool(
            hive.create_agent, data.get("name", ""), data.get("kind", "omega"), data.get("swarm_id"),
            data.get("model"), data.get("persona", ""), data.get("hue"), data.get("budget_usd", 0),
        )

    @app.get("/api/agents/{agent_id}")
    async def agent(agent_id: str, request: Request):
        operator(request)
        return hive.agent(agent_id)

    @app.patch("/api/agents/{agent_id}")
    async def update_agent(agent_id: str, request: Request):
        operator(request)
        return await run_in_threadpool(hive.update_agent, agent_id, await body(request))

    @app.delete("/api/agents/{agent_id}")
    async def delete_agent(agent_id: str, request: Request):
        operator(request)
        return await run_in_threadpool(hive.delete_agent, agent_id)

    for action in ("start", "stop", "sleep", "wake"):
        async def lifecycle(agent_id: str, request: Request, action=action):
            operator(request)
            return await run_in_threadpool(hive.lifecycle, agent_id, action)

        app.post(f"/api/agents/{{agent_id}}/{action}")(lifecycle)

    @app.get("/api/agents/{agent_id}/messages")
    async def messages(agent_id: str, request: Request, conversation_id: str | None = None, limit: int = 200):
        operator(request)
        return hive.messages(agent_id, conversation_id, limit)

    @app.post("/api/agents/{agent_id}/messages")
    async def post_message(agent_id: str, request: Request):
        operator(request)
        data = await body(request)
        return await hive.send_to_agent(agent_id, data.get("text", ""), data.get("conversation_id"))

    @app.get("/api/agents/{agent_id}/logs")
    async def logs(agent_id: str, request: Request, tail: int = 200):
        operator(request)
        hive.agent(agent_id)
        lines = await run_in_threadpool(supervisor.logs, agent_id, min(int(tail), 2000)) if supervisor else []
        return {"lines": lines}

    @app.get("/api/usage")
    async def usage(request: Request, agent_id: str | None = None, since: str | None = None):
        operator(request)
        return hive.usage(agent_id, since)

    # ---- live events for the UI ---------------------------------------------------------------

    @app.websocket("/api/events")
    async def events(ws: WebSocket):
        token = ws.query_params.get("token", "")
        if not token or not hive.db.one("SELECT 1 FROM sessions WHERE token_hash = ?", (token_hash(token),)):
            await ws.close(code=4401)
            return
        await ws.accept()
        queue = hive.events.subscribe()
        try:
            await ws.send_text(json.dumps({"type": "hello", "at": now(), "hive": await run_in_threadpool(hive.summary)}))

            async def pump():
                while True:
                    await ws.send_text(await queue.get())

            async def listen():
                while True:
                    frame = await ws.receive_text()
                    with contextlib.suppress(ValueError):
                        if json.loads(frame).get("type") == "ping":
                            await ws.send_text(json.dumps({"type": "pong", "at": now()}))

            done, pending = await asyncio.wait([asyncio.create_task(pump()), asyncio.create_task(listen())],
                                               return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
        except WebSocketDisconnect:
            pass
        finally:
            hive.events.unsubscribe(queue)

    # ---- agents: hub, gateway, swarm API ---------------------------------------------------------

    @app.websocket("/agent-hub")
    async def agent_hub(ws: WebSocket):
        agent = hive.authenticate_agent(_bearer(ws.headers.get("authorization")))
        if agent is None:
            await ws.close(code=4401)
            return
        await ws.accept()
        agent_id = agent["id"]
        previous = hive.connections.get(agent_id)
        if previous is not None:
            with contextlib.suppress(Exception):
                await previous.close(code=4000)
        await hive.agent_connected(agent_id, ws)
        try:
            while True:
                try:
                    frame = json.loads(await ws.receive_text())
                except ValueError:
                    await ws.send_text(json.dumps({"type": "error", "code": "bad_json", "message": "frames are JSON"}))
                    continue
                kind = frame.get("type")
                if kind == "resume":
                    await hive.replay(agent_id, frame.get("last_seen_seq"))
                elif kind == "agent_message":
                    message = hive.record_agent_message(agent_id, frame)
                    await ws.send_text(json.dumps({"type": "ack", "seq": None, "client_seq": frame.get("client_seq"),
                                                   "message_id": message["id"]}))
                else:
                    await ws.send_text(json.dumps({"type": "error", "code": "unknown_type", "message": str(kind)}))
        except WebSocketDisconnect:
            pass
        finally:
            hive.agent_disconnected(agent_id, ws)

    @app.post("/llm/v1/chat/completions")
    async def chat_completions(request: Request):
        agent = agent_from(request)
        data = await body(request)
        paid, estimate = gateway.estimate(agent, data, settings.allow_unpriced)
        hive.check_budget(agent, paid, estimate)
        hive.thinking(agent["id"], "llm")
        started = time.monotonic()
        try:
            response, usage = await gateway.chat(agent, data)
        finally:
            hive.thinking(agent["id"], "idle")
        hive.last_llm[agent["id"]] = (int((time.monotonic() - started) * 1000),
                                      usage["prompt_tokens"] + usage["completion_tokens"])
        await run_in_threadpool(hive.record_usage, agent, agent["model"], usage)
        return response

    @app.post("/llm/v1/embeddings")
    async def embeddings(request: Request):
        agent_from(request)
        return await gateway.embeddings(settings.embedding_model, await body(request))

    @app.post("/api/agent/publish")
    async def agent_publish(request: Request):
        agent = agent_from(request)
        data = await body(request)
        return await run_in_threadpool(hive.publish, agent["id"], data.get("statement", ""),
                                       data.get("f", 1.0), data.get("c", 0.9), data.get("evidence"),
                                       bool(data.get("new_evidence")))

    @app.post("/api/agent/query")
    async def agent_query(request: Request):
        agent = agent_from(request)
        data = await body(request)
        return await run_in_threadpool(hive.query, agent["id"], data.get("pattern", ""))

    @app.get("/api/agent/belief")
    async def agent_belief(statement: str, request: Request):
        agent = agent_from(request)
        return await run_in_threadpool(hive.agent_belief, agent["id"], statement)

    # ---- phase 2: policy and approvals ----------------------------------------------------------

    @app.get("/api/policy")
    async def policy_rules(request: Request):
        operator(request)
        return hive.policy.rules()

    @app.post("/api/policy")
    async def add_policy_rule(request: Request):
        operator(request)
        data = await body(request)
        return hive.policy.add_rule(data.get("scope", ""), data.get("skill", ""), data.get("mode", ""), data.get("note", ""))

    @app.delete("/api/policy/{rule_id}")
    async def delete_policy_rule(rule_id: str, request: Request):
        operator(request)
        return hive.policy.delete_rule(rule_id)

    @app.get("/api/approvals")
    async def approvals(request: Request, status: str | None = None):
        operator(request)
        return hive.policy.approvals(status)

    @app.post("/api/approvals/{approval_id}/approve")
    async def approve(approval_id: str, request: Request):
        operator(request)
        try:
            data = await request.json()
        except Exception:
            data = {}
        return await hive.policy.decide_approval(approval_id, True, remember=bool((data or {}).get("remember")))

    @app.post("/api/approvals/{approval_id}/deny")
    async def deny(approval_id: str, request: Request):
        operator(request)
        return await hive.policy.decide_approval(approval_id, False)

    @app.post("/api/hive/stop-all")
    async def stop_all(request: Request):
        operator(request)
        return await run_in_threadpool(hive.stop_all)

    # ---- the Lab: tests and benchmarks --------------------------------------------------------------

    @app.get("/api/lab/suites")
    async def lab_suites(request: Request):
        operator(request)
        return await run_in_threadpool(hive.lab.suites)

    @app.get("/api/lab/runs")
    async def lab_runs(request: Request, suite: str = "", limit: int = 50):
        operator(request)
        return hive.lab.runs(suite or None, min(200, max(1, limit)))

    @app.post("/api/lab/runs")
    async def lab_start(request: Request):
        operator(request)
        data = await body(request)
        return await run_in_threadpool(hive.lab.start, str(data.get("suite", "")))

    @app.get("/api/lab/runs/{run_id}")
    async def lab_run(run_id: str, request: Request):
        operator(request)
        return hive.lab.run(run_id)

    @app.post("/api/lab/runs/{run_id}/cancel")
    async def lab_cancel(run_id: str, request: Request):
        operator(request)
        return hive.lab.cancel(run_id)

    @app.get("/api/lab/scorecard")
    async def lab_scorecard(request: Request):
        operator(request)
        return await run_in_threadpool(hive.lab.scorecard)

    @app.get("/api/lab/history/{suite}")
    async def lab_history(suite: str, request: Request, limit: int = 30):
        operator(request)
        return hive.lab.history(suite, min(100, max(1, limit)))

    # ---- phase 2: goals ----------------------------------------------------------------------------

    @app.get("/api/swarms/{swarm_id}/goals")
    async def goals(swarm_id: str, request: Request):
        operator(request)
        hive.swarm(swarm_id)
        return hive.goals.list(swarm_id)

    @app.post("/api/swarms/{swarm_id}/goals")
    async def create_goal(swarm_id: str, request: Request):
        operator(request)
        data = await body(request)
        return await hive.goals.create(swarm_id, data.get("title", ""), data.get("detail", ""),
                                       data.get("priority", 0.5), data.get("parent_id"),
                                       assignee=data.get("assignee"), binding=data.get("binding"),
                                       deadline_minutes=data.get("deadline_minutes"))

    @app.patch("/api/goals/{goal_id}")
    async def update_goal(goal_id: str, request: Request):
        operator(request)
        goal = hive.goals.update(goal_id, await body(request))
        if goal["status"] == "cancelled":
            await hive.goals.notify_cancelled(goal_id)
        return goal

    # ---- phase 2: traces, wakeups, memory ------------------------------------------------------

    @app.get("/api/agents/{agent_id}/traces")
    async def traces(agent_id: str, request: Request, limit: int = 100):
        operator(request)
        return hive.traces(agent_id, limit)

    @app.get("/api/agents/{agent_id}/wakeups")
    async def wakeups(agent_id: str, request: Request):
        operator(request)
        hive.agent(agent_id)
        return hive.scheduler.list(agent_id)

    @app.post("/api/agents/{agent_id}/wakeups")
    async def create_wakeup(agent_id: str, request: Request):
        operator(request)
        data = await body(request)
        return hive.scheduler.create(agent_id, data.get("cron"), data.get("at"), data.get("tz") or "UTC", data.get("text", ""))

    @app.patch("/api/wakeups/{wakeup_id}")
    async def update_wakeup(wakeup_id: str, request: Request):
        operator(request)
        return hive.scheduler.update(wakeup_id, await body(request))

    @app.delete("/api/wakeups/{wakeup_id}")
    async def delete_wakeup(wakeup_id: str, request: Request):
        operator(request)
        return hive.scheduler.delete(wakeup_id)

    @app.get("/api/agents/{agent_id}/memory")
    async def memory(agent_id: str, request: Request):
        operator(request)
        return await run_in_threadpool(hive.memory_spaces, agent_id)

    @app.get("/api/agents/{agent_id}/memory/{space}")
    async def memory_atoms(agent_id: str, space: str, request: Request, q: str | None = None, limit: int = 200):
        operator(request)
        return await run_in_threadpool(hive.memory_atoms, agent_id, space, q, limit)

    @app.post("/api/agents/{agent_id}/memory/{space}/retire")
    async def retire(agent_id: str, space: str, request: Request):
        operator(request)
        data = await body(request)
        return await run_in_threadpool(hive.retire_atom, agent_id, space, data.get("atom", ""))

    @app.post("/api/agents/{agent_id}/memory/reset")
    async def reset_memory(agent_id: str, request: Request):
        operator(request)
        return hive.queue_control(agent_id, {"op": "reset"})

    # ---- phase 2: agent-facing -----------------------------------------------------------------

    @app.post("/api/agent/authorize")
    async def authorize(request: Request):
        agent = agent_from(request)
        data = await body(request)
        return await run_in_threadpool(hive.policy.authorize, agent, data.get("command", ""))

    @app.post("/api/agent/trace")
    async def agent_trace(request: Request):
        agent = agent_from(request)
        return await run_in_threadpool(hive.record_trace, agent, await body(request))

    @app.get("/api/agent/control")
    async def agent_control(request: Request):
        agent = agent_from(request)
        return hive.take_control(agent["id"])

    @app.get("/api/agent/inbox")
    async def agent_inbox(request: Request, after: int = 0):
        agent = agent_from(request)
        return hive.inbox(agent["id"], after)

    @app.post("/api/agent/messages")
    async def agent_message(request: Request):
        agent = agent_from(request)
        data = await body(request)
        return hive.record_agent_message(agent["id"], data)

    @app.get("/api/agent/goals")
    async def agent_goals(request: Request, status: str | None = "open"):
        agent = agent_from(request)
        if not agent["swarm_id"]:
            return []
        return hive.goals.list(agent["swarm_id"], status or None)

    @app.post("/api/agent/goals")
    async def agent_create_goal(request: Request):
        agent = agent_from(request)
        if not agent["swarm_id"]:
            raise HiveError(400, "no_swarm", "agent is not in a swarm")
        data = await body(request)
        return await hive.goals.create(agent["swarm_id"], data.get("title", ""), data.get("detail", ""),
                                       data.get("priority", 0.5), data.get("parent_id"), created_by=f"agent:{agent['id']}")

    @app.post("/api/agent/goals/{goal_id}/claim")
    async def agent_claim(goal_id: str, request: Request):
        agent = agent_from(request)
        return hive.goals.claim(agent, goal_id)

    @app.post("/api/agent/goals/{goal_id}/heartbeat")
    async def agent_goal_heartbeat(goal_id: str, request: Request):
        return hive.goals.heartbeat(agent_from(request), goal_id)

    @app.post("/api/agent/goals/{goal_id}/result")
    async def agent_result(goal_id: str, request: Request):
        agent = agent_from(request)
        data = await body(request)
        goal = hive.goals.result(agent, goal_id, data.get("status", "done"), data.get("result", ""), data.get("data"))
        await hive.goals.notify_parent(goal)
        return goal

    @app.get("/api/agent/goals/{goal_id}")
    async def agent_goal(goal_id: str, request: Request):
        return hive.goals.for_agent(agent_from(request), goal_id)

    @app.post("/api/agent/goals/{goal_id}/cancel-ack")
    async def agent_goal_cancel_ack(goal_id: str, request: Request):
        return hive.goals.cancel_ack(agent_from(request), goal_id)

    # ---- timed sharing of private memory between dots ---------------------------------------------

    @app.get("/api/agent/shares")
    async def agent_shares(request: Request):
        return hive.shares.mine(agent_from(request))

    @app.post("/api/agent/shares/request")
    async def agent_share_request(request: Request):
        agent, data = agent_from(request), await body(request)
        return await hive.shares.request(agent, data.get("owner"), data.get("space"), data.get("minutes"),
                                         data.get("filter") or data.get("pattern"), data.get("reason", ""))

    @app.post("/api/agent/shares/offer")
    async def agent_share_offer(request: Request):
        agent, data = agent_from(request), await body(request)
        return await hive.shares.offer(agent, data.get("grantee"), data.get("space"), data.get("minutes"),
                                       data.get("filter") or data.get("pattern"), data.get("note", ""))

    @app.post("/api/agent/shares/{share_id}/grant")
    async def agent_share_grant(share_id: str, request: Request):
        agent, data = agent_from(request), await optional_body(request)
        return await hive.shares.grant(agent, share_id, data.get("minutes"))

    @app.post("/api/agent/shares/{share_id}/deny")
    async def agent_share_deny(share_id: str, request: Request):
        agent, data = agent_from(request), await optional_body(request)
        return await hive.shares.deny(agent, share_id, data.get("reason", ""))

    @app.post("/api/agent/shares/{share_id}/revoke")
    async def agent_share_revoke(share_id: str, request: Request):
        return await hive.shares.revoke(share_id, by_agent=agent_from(request))

    @app.get("/api/agent/shares/{share_id}/atoms")
    async def agent_share_read(share_id: str, request: Request, q: str = "", limit: int = 200, offset: int = 0):
        agent = agent_from(request)
        return await run_in_threadpool(hive.shares.read, agent, share_id, q, limit, offset)

    @app.post("/api/agent/exhibits")
    async def agent_exhibit(request: Request):
        agent, data = agent_from(request), await body(request)
        return await hive.shares.exhibit(agent, data.get("title", ""), data.get("to", "swarm"), data.get("minutes"),
                                         data.get("body", ""), data.get("atoms"), data.get("space"),
                                         data.get("filter") or data.get("pattern"))

    @app.get("/api/shares")
    async def shares(request: Request, status: str = "", agent_id: str = ""):
        operator(request)
        return hive.shares.list(status or None, agent_id or None)

    @app.get("/api/shares/{share_id}/reads")
    async def share_reads(share_id: str, request: Request):
        operator(request)
        return hive.shares.reads(share_id)

    @app.post("/api/shares/{share_id}/revoke")
    async def share_revoke(share_id: str, request: Request):
        operator(request)
        return await hive.shares.revoke(share_id)

    # ---- dot programs (hive/PROGRAMS.md) --------------------------------------------------------------

    @app.get("/api/programs")
    async def programs(request: Request):
        operator(request)
        return hive.programs.list()

    @app.post("/api/programs/reload")
    async def programs_reload(request: Request):
        operator(request)
        return await run_in_threadpool(hive.programs.reload)

    @app.get("/api/programs/{program_id}")
    async def program(program_id: str, request: Request):
        operator(request)
        return hive.programs.detail(program_id)

    @app.post("/api/programs/{program_id}/enable")
    async def program_enable(program_id: str, request: Request):
        operator(request)
        return hive.programs.set_enabled(program_id, True)

    @app.post("/api/programs/{program_id}/disable")
    async def program_disable(program_id: str, request: Request):
        operator(request)
        return hive.programs.set_enabled(program_id, False)

    @app.post("/api/programs/{program_id}/view")
    async def program_view(program_id: str, request: Request):
        operator(request)
        data = await body(request)
        return await hive.programs.view(program_id, str(data.get("swarm_id", "")), data.get("focus"), data.get("stage"))

    @app.post("/api/programs/{program_id}/act")
    async def program_act(program_id: str, request: Request):
        operator(request)
        data = await body(request)
        return await hive.programs.act(program_id, str(data.get("swarm_id", "")), str(data.get("action", "")),
                                       data.get("items") or [], data.get("params"), data.get("base_revision"))

    # ---- the web UI ---------------------------------------------------------------------------------

    if UI_DIST.exists():
        @app.get("/{path:path}")
        async def ui(path: str):
            if path.split("/", 1)[0] in ("api", "llm", "agent-hub"):
                raise HiveError(404, "not_found", f"no route /{path}")
            target = (UI_DIST / path).resolve()
            if path and target.is_file() and UI_DIST.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(UI_DIST / "index.html")

    return app
