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
  budget_usd: number;    // hard cap, 0 = unlimited
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
