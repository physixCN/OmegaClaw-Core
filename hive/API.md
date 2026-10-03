# OmegaDots Hive — API contract (Phase 1)

The contract between `hive/core` (server), `hive/ui` (web app) and agents.
JSON over HTTP and WebSocket. Times are ISO-8601 UTC strings. IDs are short
URL-safe strings.

## Auth

- **Humans**
  - `POST /api/auth/login {"password"}` → `{"token"}`.
  - Send the token as `Authorization: Bearer <token>`, or as `?token=` on
    WebSocket URLs.
  - Phase 1 has a single operator. The password comes from `HIVE_ADMIN_PASSWORD`.
- **Agents**
  - Each agent gets its own token when it is created. The token is shown once
    and stored hashed.
  - Agents use it on `/agent-hub`, `/llm/*` and `/api/agent/*`.

## Resources

```ts
type AgentKind = "omega" | "iter" | "module";
type AgentStatus = "created" | "starting" | "awake" | "asleep" | "stopped" | "error";

interface Agent {
  id: string;            // "a_7f3k2q"
  name: string;          // "Vega"
  kind: AgentKind;
  swarm_id: string | null;
  model: string;         // "<provider>/<model>", e.g. "anthropic/claude-sonnet-5-5", "mock/echo"
  persona: string;       // system prompt text
  hue: number;           // 0-359, the agent's colour everywhere in the UI
  status: AgentStatus;
  driver: string;        // "local" | "docker" | ...
  budget_usd: number;    // hard cap; 0 = none, so free (mock/local) models only
  spent_usd: number;
  connected: boolean;    // live hub connection
  last_error: string | null;  // why status is "error"
  last_active_at: string | null;
  created_at: string;
}

interface Swarm {
  id: string;            // "s_alpha"
  name: string;
  description: string;
  hue: number;
  member_ids: string[];
  created_at: string;
}

interface Message {
  id: string;
  agent_id: string;
  conversation_id: string;
  direction: "in" | "out";   // in = to the agent, out = from the agent
  sender: string;            // "user:operator" | "agent:<id>"
  text: string;
  created_at: string;
}

interface TruthValue { f: number; c: number }   // frequency, confidence in [0,1]

interface Belief {                // current belief for a statement in a commons
  swarm_id: string;
  statement: string;              // MeTTa text, e.g. "(--> sky blue)"
  tv: TruthValue;
  stamp: string[];                // evidence ids, e.g. ["ev:a_7f3k2q:1"]
  sources: string[];              // agent ids whose evidence supports it
  updated_at: string;
}

interface Assertion {             // one published contribution
  agent_id: string;
  statement: string;
  tv: TruthValue;
  stamp: string[];
  outcome: "adopted" | "revised" | "chosen" | "kept" | "duplicate" | "quarantined" | "denied";
  created_at: string;
}

interface BeliefDetail extends Belief {
  assertions: Assertion[];        // full provenance, oldest first
  choices: { kept: string[]; rejected: string[] }[];
}

interface Usage {
  agent_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  created_at: string;
}

interface ModelOption { id: string; provider: string; label: string; local: boolean }
```

## REST

| Method & path | Body → Response |
|---|---|
| `POST /api/auth/login` | `{password}` → `{token}` |
| `GET /api/hive` | → `{name, version, agents, swarms, awake, beliefs, spent_usd}` |
| `GET /api/models` | → `ModelOption[]` |
| `GET /api/swarms` | → `Swarm[]` |
| `POST /api/swarms` | `{name, description?, hue?}` → `Swarm` |
| `GET /api/swarms/{id}` | → `Swarm` |
| `GET /api/swarms/{id}/beliefs` | → `Belief[]` |
| `GET /api/swarms/{id}/beliefs/detail?statement=` | → `BeliefDetail` |
| `GET /api/swarms/{id}/vocab` | → `string[]` |
| `POST /api/swarms/{id}/vocab` | `{terms: string[]}` → `string[]` |
| `GET /api/agents` | → `Agent[]` |
| `POST /api/agents` | `{name, kind, swarm_id?, model, persona?, hue?, budget_usd?}` → `Agent & {token}` |
| `GET /api/agents/{id}` | → `Agent` |
| `PATCH /api/agents/{id}` | partial `{name, swarm_id, model, persona, hue, budget_usd}` → `Agent` |
| `DELETE /api/agents/{id}` | → `{ok: true}` (stops it, keeps memory on disk) |
| `POST /api/agents/{id}/start` · `/stop` · `/sleep` · `/wake` | → `Agent` |
| `GET /api/agents/{id}/messages?conversation_id=&limit=` | → `Message[]` (oldest first) |
| `POST /api/agents/{id}/messages` | `{text, conversation_id?}` → `Message` |
| `GET /api/agents/{id}/logs?tail=200` | → `{lines: string[]}` |
| `GET /api/usage?agent_id=&since=` | → `Usage[]` |

Errors are `{"error": {"code", "message"}}` with a 4xx/5xx status.

## Live events: `WS /api/events?token=`

The server pushes `{"type", "at", ...}` frames. The client may send
`{"type":"ping"}`.

- An invalid or missing token closes the socket with code `4401`.
- A message sent without a `conversation_id` uses the agent's default
  conversation, `c_<agent_id>`.

| type | payload |
|---|---|
| `hello` | `{hive: {...GET /api/hive}}` on connect |
| `agent.updated` | `{agent: Agent}` (status, connected, spent, …) |
| `agent.deleted` | `{agent_id}` |
| `swarm.updated` | `{swarm: Swarm}` |
| `message` | `{message: Message}` |
| `agent.thinking` | `{agent_id, phase: "llm" \| "skills" \| "idle"}` |
| `belief.published` | `{swarm_id, assertion: Assertion}` |
| `belief.updated` | `{belief: Belief, outcome: "adopted" \| "revised" \| "chosen"}` |
| `usage` | `{usage: Usage}` |
| `log` | `{agent_id, line}` |

## Agent-facing

- **`WS /agent-hub`** with header `Authorization: Bearer <agent token>`. The
  frames are those of upstream Omega `channels/wschat.py` (see
  `modules/channel_hive/src/hive_channel.py`):
  - `resume`, `user_message{seq,text}`, `agent_message{client_seq,text,conversation_id?}`, `ack`, `error`;
  - the hub sends `text` as a hive envelope
    `{"hive":1,"sender","conversation_id","text"}`.
- **`POST /llm/v1/chat/completions`** is OpenAI-compatible and takes the agent
  token. The gateway picks the provider and model from the agent's `model`,
  injects the key, meters the usage, and enforces `budget_usd` (402 once the
  budget is spent).
- **`POST /api/agent/publish`** `{statement, f, c, evidence?}` → `Assertion`. The
  stamp is minted by the hive when `evidence` is omitted.
- **`POST /api/agent/query`** `{pattern}` → `{results: string[]}`, the union view
  of the agent's swarm commons and the federation.
- **`GET /api/agent/belief?statement=`** → `BeliefDetail`.
- **`GET /api/agent/inbox?after=<seq>`** → `{messages: [{seq, text}]}`. This
  is an HTTP alternative to the hub for agents that cannot hold a WebSocket:
  Iter workers and external agents. `text` is the same hive envelope the hub
  sends. Acknowledgement is implicit: the next call passes the highest `seq`
  seen.
- **`POST /api/agent/messages`** `{text, conversation_id?, client_seq?}` →
  `Message`. Replies over HTTP; deduplicated by `client_seq`.

---

# Phase 2 additions

## Types

```ts
type PolicyMode = "allow" | "ask" | "deny";

interface PolicyRule {
  id: string;
  scope: "hive" | `swarm:${string}` | `agent:${string}`;  // most specific scope wins
  skill: string;           // glob over skill names: "shell*", "write-file", "*"
  mode: PolicyMode;
  note: string;
  created_at: string;
}

type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "used";

interface Approval {
  id: string;              // "p_..."
  agent_id: string;
  skill: string;           // e.g. "shell-confirm"
  command: string;         // full MeTTa command text, e.g. (shell-confirm "ls /")
  reason: string;          // why it needs a human: rule note or "human-only"
  risk: "low" | "medium" | "high";
  status: ApprovalStatus;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

type GoalStatus = "open" | "claimed" | "done" | "failed" | "cancelled";

interface Goal {
  id: string;              // "g_..."
  swarm_id: string;
  parent_id: string | null;
  title: string;
  detail: string;
  priority: number;        // 0..1
  status: GoalStatus;
  created_by: string;      // "user:operator" | "agent:<id>"
  claimed_by: string | null;   // agent id
  result: string | null;
  created_at: string;
  updated_at: string;
}

interface TraceCommand { command: string; result: string; gated?: "allow" | "ask" | "deny" }

interface Trace {          // one loop iteration that called the model
  id: number;
  agent_id: string;
  iteration: number;
  input: string | null;    // the new message that triggered it (null for autonomous turns)
  response: string;        // raw model output
  commands: TraceCommand[];
  llm_ms: number | null;   // gateway latency of the model call
  tokens: number | null;
  created_at: string;
}

interface Wakeup {
  id: string;              // "w_..."
  agent_id: string;
  cron: string | null;     // 5-field cron, e.g. "0 9 * * 1-5"
  at: string | null;       // one-shot ISO time (exactly one of cron/at)
  tz: string;              // IANA zone, default "UTC"
  text: string;            // what the agent is told when it wakes
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
}

interface MemorySpace { name: string; atoms: number; bytes: number }
interface MemoryAtom { index: number; text: string }

// Agent gains:
//   idle_sleep_minutes: number   (0 = never auto-sleep)
```

## REST

| Method & path | Body → Response |
|---|---|
| `GET /api/policy` | → `PolicyRule[]` |
| `POST /api/policy` | `{scope, skill, mode, note?}` → `PolicyRule` |
| `DELETE /api/policy/{id}` | → `{ok}` |
| `GET /api/approvals?status=` | → `Approval[]` (newest first) |
| `POST /api/approvals/{id}/approve` | `{remember?: boolean}` → `Approval`. `remember` also adds an `allow` rule for this agent and skill. |
| `POST /api/approvals/{id}/deny` | → `Approval` |
| `GET /api/swarms/{id}/goals` | → `Goal[]` |
| `POST /api/swarms/{id}/goals` | `{title, detail?, priority?, parent_id?}` → `Goal` |
| `PATCH /api/goals/{id}` | `{status?, priority?, title?, detail?}` → `Goal` |
| `GET /api/agents/{id}/traces?limit=` | → `Trace[]` (newest first) |
| `GET /api/agents/{id}/wakeups` | → `Wakeup[]` |
| `POST /api/agents/{id}/wakeups` | `{cron? \| at?, tz?, text}` → `Wakeup` |
| `PATCH /api/wakeups/{id}` | `{enabled?, cron?, at?, tz?, text?}` → `Wakeup` |
| `DELETE /api/wakeups/{id}` | → `{ok}` |
| `GET /api/agents/{id}/memory` | → `MemorySpace[]` (the agent's private spaces, read from disk) |
| `GET /api/agents/{id}/memory/{space}?q=&limit=` | → `MemoryAtom[]` |
| `POST /api/agents/{id}/memory/{space}/retire` | `{atom}` → `{queued: true}`. The agent removes it on its next loop. |
| `POST /api/agents/{id}/memory/reset` | → `{queued: true}`. Clears all private spaces. |
| `POST /api/hive/stop-all` | → `{stopped: n}`. Global kill switch: every agent is stopped and its desired state set to stopped. |

## Events (added)

| type | payload |
|---|---|
| `approval.created` | `{approval: Approval}` |
| `approval.updated` | `{approval: Approval}` |
| `policy.updated` | `{rules: PolicyRule[]}` |
| `goal.updated` | `{goal: Goal}` |
| `agent.trace` | `{trace: Trace}` |
| `wakeup.updated` | `{wakeup: Wakeup}` |
| `wakeup.fired` | `{wakeup_id, agent_id}` |

## Agent-facing (added)

- **`POST /api/agent/authorize`** `{command}` → `{decision: "allow" | "deny" | "pending", approval_id?, message?}`.
  - The Omega loop calls it before running a skill.
  - An `ask` rule creates an `Approval` and returns `pending`.
  - Once the operator approves, the same command (same text) is allowed
    **once**, and the agent is told by a hub message
    `[APPROVED p_x] <command>`.
- **`POST /api/agent/trace`** `{iteration, input, response, commands}`. The
  hive fills in `llm_ms` and `tokens` from the gateway's last call.
- **`GET /api/agent/control`** → `{ops: [{op: "retire", space, atom} | {op: "reset"}]}`.
  The queued memory operations, polled each loop.
- **Goals:**
  - `GET /api/agent/goals?status=open` → `Goal[]` (the agent's swarm);
  - `POST /api/agent/goals` `{title, detail?, priority?, parent_id?}` → `Goal`;
  - `POST /api/agent/goals/{id}/claim` → `Goal` (409 if already claimed).
    A claim is a lease: `lease_until` is set `HIVE_GOAL_LEASE_MINUTES` (default
    60) ahead;
  - `POST /api/agent/goals/{id}/heartbeat` → `Goal`. The claimer renews its
    lease; also resumes a `waiting` goal (409 if you don't hold it);
  - `POST /api/agent/goals/{id}/result` `{status: "done" | "failed" | "waiting", result}`
    → `Goal`.
    - `done` needs a non-empty `result` (400 `no_result`).
    - `waiting` means "delivered, waiting on a person" and pauses the lease.
  - A lapsed lease puts the goal back to `open` and re-announces it. After 3
    lapses the goal is `stalled` until a person acts.
  - Splitting is limited to 3 levels and 12 subgoals per goal (400 `too_deep`,
    `too_many_subgoals`).
  - Goal statuses: `open`, `claimed`, `waiting`, `stalled`, `done`, `failed`,
    `cancelled`. `Goal` gains `lease_until` and `attempts`.
- **New goals** are announced to the swarm's awake members as hub envelopes
  with `event: "goal"` and `goal_id`.
- **Reads count.** When an agent reads a belief (`/api/agent/query`,
  `/api/agent/belief`) and then publishes the same statement without citing
  evidence, the publish inherits the stamp it read. It is an echo and does not
  revise the belief.
- **LLM spend is checked before the call.**
  - 402 `no_budget`: a paid model with `budget_usd` 0.
  - 402 `unpriced_model`: a remote model with no price; `HIVE_ALLOW_UNPRICED=1`
    allows it.
  - 402 `budget_exhausted`: spent plus the call's worst-case cost would pass
    the budget.
  - 402 `hive_budget_exhausted`: the call would pass `HIVE_BUDGET_USD`.
  - 429 `rate_limited`: more than `HIVE_MAX_LLM_CALLS_PER_MINUTE` calls (default
    60) in a minute.

## Default policy

These apply when no rule matches.

| Skills | Mode | Why |
|---|---|---|
| `send`, `wait`, `pin`, `hive-*`, `query`, `remember`, `episodes`, `search`, `web-search`, `read-file`, space reads | `allow` | No side effects outside the agent and the hive |
| `shell`, `shell-confirm`, `metta`, `write-file*`, `append-file*`, `send-file*`, `codex-*`, `space-transform`, `remove-atom`, any `*-commit` | `ask` | Side effects on the machine or on durable memory |
| (human-only) `change-password`, `transfer-funds`, `pay*`, `purchase*` | `deny` to agents | These always need a human to act; no rule can open them |

## The Lab: tests and benchmarks

Each run is a child process (`python -m hive.bench run <suite>`). Its hives
use scratch data, so a run never touches this hive's dots or commons.

| Method & path | Body → Response |
|---|---|
| `GET /api/lab/suites` | → `Suite[]` `{id, kind: "tests" \| "bench", title, description, estimate_s, needs, missing, runnable, last_run}` |
| `GET /api/lab/runs?suite=&limit=` | → `RunSummary[]` newest first `{id, suite, status, started_at, finished_at, duration_ms, passed, failed, skipped, errors, commit_sha}` |
| `POST /api/lab/runs` | `{suite}` → `Run`. Errors: 409 `already_running`, 400 `missing_requirements` |
| `GET /api/lab/runs/{id}` | → `Run` = `RunSummary & {log, cases: Case[]}` |
| `POST /api/lab/runs/{id}/cancel` | → `{cancelling: true}` |
| `GET /api/lab/history/{suite}?limit=` | → `{suite, runs, metrics: [{case_id, case, metric, unit, better, target, points: [{run_id, at, value, ok}]}]}` |

`Case` = `{run_id, id, name, group, status, duration_ms, message, notes, metrics: Metric[], series: Series[]}`.
- `Metric` = `{name, value, unit, better: "lower" | "higher" | "equal", target, ok}`. A metric with no target is informational.
- `Series` = `{name, unit, kind: "line" | "bar" | "step", x, points: [[x, y]]}`.

Events: `lab.run {run}`, `lab.case {case}`, `lab.log {run_id, text}`.

| Suite | What it runs |
|---|---|
| `tests-hive` | Server tests against real PeTTa spaces |
| `tests-runtime` | Omega runtime tests |
| `tests-memory` | Boots Omega: memory isolation, protected atoms, atomic saves |
| `tests-e2e` | Real Omegas end to end: Phase 1 and Phase 2 acceptance |
| `tests-ui` | Web UI tests (vitest) |
| `bench-core` | Commons, gate, hub and gateway latency; revision accuracy; claim races |
| `bench-drift` | Echo storm, corroboration, self-repetition, retry storm, spend runaway, abandoned goals, subgoal explosion, refusals |
| `bench-epistemic` | Epistemic Resolve (Crawford & Hammer, AGI-26) through the swarm commons, next to the paper's calibration mocks. Step polarity is hand-annotated; this tests the update discipline, not language understanding |
| `bench-swarm` | Three live Omegas on the offline model: boot, reply latency, belief propagation, loop health |

From a shell: `python -m hive.bench list`, `python -m hive.bench run bench-drift`,
`python -m hive.bench record --out results.json [suites…]`.
