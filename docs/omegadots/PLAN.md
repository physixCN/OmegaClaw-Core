# OmegaDots Hive — Build Plan

Status: proposal for review · 2026-10-03 · branch `claude/holarchy-nested-spaces`

OmegaDots Hive is a server plus a web UI that runs many always-on agents. Mostly
these are Omegas, but there are also Iter workers and third-party agents. Each
agent has its own complete memory. Agents are nested into swarms, and swarms into
a federation that other people's swarms and hives can join. It is the open,
self-hosted answer to OpenAI Dots (launched 2026-09-29), built so that it runs on
Omega Cloud.

Contents:

- §1 what the plan is built on
- §2 the system shape
- §3 the data model
- §4 components and their functions
- §5 the UI
- §6 safety
- §7 phases with acceptance tests
- §8 decisions I need from you

---

## 1. What this plan stands on

### 1.1 Already verified in this repo

- **Nested spaces work today.** `tests/holarchy_nested_spaces_smoke.metta`
  - In PeTTa a space is just a name, so storing a space handle as an atom in
    another space and matching through it nests the spaces. Three levels (agent →
    swarm → federation) work with no runtime changes.
  - Publishing upward with provenance works.
  - Private and unpublished atoms stay invisible.
  - NAL `Truth_Revision` merges conflicting beliefs across swarms, and the result
    does not depend on order.
- **PeTTa gotchas we hit:**
  - `new-space` is not defined anywhere. Any `&name` already works as a space.
  - `add-atom` stores its argument **without evaluating it**, so values must be
    computed first.
  - PeTTa has **no persistence** for spaces.

### 1.2 What exists in the runtime

Findings from the code survey:

- **One agent per `swipl` process.** All state is global. Some memory paths are
  hard-coded to `<repo>/memory/` (history, `.metta` space files, scratch, chroma),
  while others read `OMEGACLAW_MEMORY_DIR`. Two Omegas therefore cannot share a
  checkout yet.
- **Channels:**
  - `web_control` is file-based (JSONL queue in, JSONL transcript out). It is only
    polled in `commchannel=multi`, which also starts Telegram and WhatsApp.
  - Upstream `singnet/Omega` has `channels/wschat.py`: the agent dials *out* to a
    WebSocket server with a bearer token, using `user_message{seq}` /
    `agent_message{client_seq}` / `ack` / `resume{last_seen_seq}` frames, an
    outbox, and reconnect with backoff. **This is the seam between the Hive and
    its agents.**
- **LLM keys:** upstream routes provider calls through `GATEWAY_URL` (an nginx
  proxy that injects keys), so agents never see the keys. The Hive generalises
  this into a metered gateway.
- **Safety gaps:**
  - `shell-confirm` runs anything with no human in the loop.
  - The `metta` skill evals arbitrary code.
  - Energy tracking advises but does not enforce.
  - `vm_policy` audits but does not enforce.
  - Proposal-first cleanup is committed by the agent itself.
  - The Landlock profile allows all network access, and it applies per process.
- **Upstream bugs found** (to report, or fix in our fork):
  - `lib_spaces.metta` `migrateAtoms` never writes to its target space.
  - `lib_omega.metta` imports a missing `./src/context`, and the failure is
    silent.
  - `profile/policy.py:113-114` resets the wrong list and reads
    `include_workdir` from the wrong level of the config.

### 1.3 Ideas we adopt from Goertzel and Hyperon

| Idea | Source | How the Hive uses it |
|---|---|---|
| **Mindplex**: a mind made of minds, which can nest further | Goertzel 2003 | Every level (agent, swarm, federation) has its own space, its own goals and its own attention. A level is not just storage. |
| **Psynese vocabulary** | OpenCog design | Swarms and the federation each keep a shared-vocabulary space. A belief published upward is phrased in that vocabulary; any symbol not in it is quarantined. |
| **Evidential stamps** | `trueagi-io/PLN` (`StampDisjoint`) | Provenance is a set of evidence IDs. Two beliefs are **revised only if their stamps are disjoint**; otherwise the higher-confidence one is kept (choice). This stops swarms that echo each other from inflating confidence. Our current smoke test deduplicates by source only. Phase 0 fixes this. |
| **ECAN with per-context attention** | EGI vol.1, DAS Attention Broker, `metta-attention` | Each swarm and user has its own STI/LTI view over the atoms it can see. Rent and forgetting keep spaces bounded. Publishing upward costs attention credit, which doubles as spam control. |
| **HyperClaw** Context Frames, two-speed loops and Module Spaces | Goertzel 2026 | The agent's authoritative working state is a typed frame, not LLM memory. A fast loop and a slow loop run side by side, and slow-loop pivots wait for human approval. Every external system or agent is plugged in as a space. |
| Layered union views and space observers | hyperon-experimental `ModuleSpace` / `SpaceObserver` | Re-implemented in our PeTTa layer: an agent can query private + swarm + federation as one view, and add/remove events trigger publishing. |
| Remote peers with local caches; per-pattern ACLs | DAS `RemoteAtomDB` and `AuthorizationManifest` | Hive-to-hive federation and the permission model. |
| Named MORK stores | `mork_ffi` / MeTTa-MORK `&mork:<name>` | The large-scale backend for swarm and federation spaces, from phase 5. |
| Snapshot and resume | `patham9/petta_lib_snapshot` | Agents can sleep and wake (scale to zero) and move between hosts. |

**Deliberately not used yet:**

- **hyperon-experimental as the runtime.** It is too slow, and the ecosystem has
  moved to PeTTa.
- **DAS as an MVP dependency.** It is heavy, has no PeTTa bridge, and MeTTa-side
  writes are `todo!()`.
- **ASI:Chain.** It is not on mainnet yet.
- **Fetch.ai/Agentverse.** At your request. The one idea borrowed is a
  protocol-schema digest for checking that plug-ins are compatible.

As far as research could find, **no existing project federates truth-valued beliefs
across independently owned agent swarms.** The Hive's federation layer would be new.

---

## 2. System shape

```
                         ┌──────────────────────── Web UI (SPA) ───────────────────────┐
                         │ Dots · Chat · Swarms · Federation · Approvals · Memory · $  │
                         └──────────────┬───────────────────────────────▲──────────────┘
                                 REST + │ WS (ui events)                │
┌───────────────────────────────────────▼───────────────────────────────┴──────────────┐
│ hive-core  (Python 3.11, FastAPI, SQLite→Postgres)                                    │
│  auth/users/tokens · agent registry · swarm registry · goals · approvals · event log │
│  agent hub (wschat-protocol server, one socket per agent)                            │
│  LLM gateway (OpenAI-compatible; injects keys; per-agent budgets, hard limits)       │
└──────┬──────────────────────────┬────────────────────────────┬──────────────────────┘
       │ supervisor driver API    │ space API (HTTP, gRPC later)│ peering (signed bundles)
┌──────▼───────────┐     ┌────────▼────────────────────┐   ┌───▼──────────────────────┐
│ hive-supervisor  │     │ hive-spaces                 │   │ other hives / federation │
│ local / docker / │     │ PeTTa embedded via janus    │   │ peers (remote space      │
│ omega-cloud      │     │ swarm + federation spaces   │   │ caches, trust weights)   │
│ drivers          │     │ ACLs, stamps, revision,     │   └──────────────────────────┘
│ spawn·sleep·wake │     │ vocab, attention, snapshots │
└──────┬───────────┘     └────────▲────────────────────┘
       │ one process/container per agent│ hive skills / tools
┌──────▼──────────┐ ┌───────────────┴─┐ ┌──────────────────┐
│ Omega (this     │ │ Iter worker     │ │ Third-party agent│
│ fork) + hive    │ │ + hive tools /  │ │ via Module Space │
│ channel & skills│ │ channel files   │ │ protocol / SDK   │
│ private memory  │ │ private memory  │ │                  │
└─────────────────┘ └─────────────────┘ └──────────────────┘
```

**Key decisions:**

1. **One process (or container) per agent.** The Omega loop, the Landlock
   sandbox and the Python singletons all assume this. It also gives clean
   isolation and lets each agent be killed, snapshotted or moved on its own.
2. **Shared spaces live in their own service (`hive-spaces`)**, not inside any
   agent. That service is a PeTTa process embedded in Python through janus. All
   swarm and federation semantics are written in MeTTa (publish, stamps,
   revision, vocabulary, attention), so agents and the service share one
   language.
3. **The private memory of an agent never leaves its process.** Only published
   atoms do, and only through the `hive-publish` skill and the space API, which
   enforces ACLs.
4. **The Hive owns keys and budgets.** Agents receive only a Hive token and a
   gateway URL.

---

## 3. Data model (MeTTa atoms in hive-spaces)

Identifiers are hierarchical strings: `hive:<hive>/swarm:<swarm>/agent:<agent>`.
Evidence IDs are `ev:<agent-id>#<counter>`, so they are unique across the
federation.

```metta
; --- structure (L1 swarm space &swarm_<id>, L2 federation space &federation) ---
(Member <agent-id> <kind>)                ; kind: omega | iter | module
(Commons &commons_<swarm-id>)             ; swarm commons handle
(Vocab &vocab_<swarm-id>)                 ; Psynese-style shared vocabulary
(Swarm <swarm-id> &swarm_<swarm-id>)      ; in &federation
(Peer <hive-id> <url> (trust <0..1>))     ; remote hive, cached space handle

; --- beliefs ---
(Asserted <agent-id> <stmt> (stv f c) (Stamp (ev:...) ...) <time>)
(Revised  <stmt> (stv f c) (Stamp ...) (Sources (<agent-id> ...)) <time>)
(Chosen   <stmt> (stv f c) (Stamp ...) (Rejected <stamp>) <time>)  ; overlap → choice
(Quarantined <agent-id> <stmt> (reason unmapped-symbol <sym>))

; --- vocabulary ---
(Term <sym> (gloss "...") (introduced-by <agent-id>) (stv f c))
(SameAs <private-sym> <vocab-sym> <agent-id>)  ; agent's local mapping

; --- goals & work (HyperClaw context frames, shared view) ---
(Goal <goal-id> (owner <principal>) (text "...") (status open|claimed|done|failed)
      (parent <goal-id>|none) (priority <0..1>))
(Claim <goal-id> <agent-id> <time>)
(Result <goal-id> <agent-id> <atom-or-text> <time>)

; --- attention (per context) ---
(AV <context-id> <atom-hash> (sti <n>) (lti <n>))
(Credit <principal> <n>)                  ; attention currency for publishing

; --- access control (DAS-style, per pattern) ---
(Grant <principal> <space> <pattern> (rights read|write|publish|admin))

; --- approvals ---
(Proposal <id> <agent-id> (action <skill> <args>) (risk <level>) (why "...")
          (status pending|approved|denied|expired))
```

**Persistence for hive-spaces** (PeTTa has none):

- an append-only **atom log** (`spaces/<space>.log.jsonl` with add/remove ops and
  a hash chain);
- a periodic **S-expression snapshot** (`spaces/<space>.metta`);
- on boot, load the snapshot and replay the log tail;
- `static-import!` with `.qlf` is used for fast cold loads.

The control-plane database (users, agents, tokens, process state, metering) is
SQL and holds **no beliefs**.

---

## 4. Components: features, functions, how

### 4.1 hive-core (`hive/core/`, Python 3.11 + FastAPI + uvicorn)

| Feature | Functions / endpoints | How |
|---|---|---|
| Auth | `POST /auth/login`, `POST /tokens`, `DELETE /tokens/{id}` | Passkey or email-link login for humans. Agents get scoped bearer tokens stored hashed (argon2). The token decides the principal; there are no shared secrets. |
| Agent registry | `POST /agents` (kind, template, swarm, model, budget), `GET /agents`, `PATCH /agents/{id}`, `POST /agents/{id}/{start,stop,sleep,wake}` | Rows in the `agents` table. Lifecycle calls go to the supervisor driver. |
| Swarm registry | `POST /swarms`, `POST /swarms/{id}/members`, `GET /swarms/{id}` | Creates `&swarm_<id>`, `&commons_<id>` and `&vocab_<id>` in hive-spaces, plus grants. |
| Agent hub | `WS /agent-hub` | **Server side of the upstream `wschat` protocol**: `user_message{seq,text}`, `agent_message{client_seq,text}`, `ack`, `resume{last_seen_seq}`. Each agent's inbox and outbox are persisted, so a reconnect after sleep loses nothing. Typed ChannelEvent metadata (conversation, sender, route) goes in a JSON envelope inside `text` so the frame format doesn't change. |
| Chat routing | `POST /agents/{id}/messages`, `GET /agents/{id}/transcript` | The UI and other agents send through the hub. Transcripts are stored per conversation. |
| LLM gateway | `POST /llm/v1/chat/completions` (OpenAI-compatible), plus `/llm/anthropic/...` passthrough | Authenticates the agent token, picks a provider and model from the agent's config, injects the key, streams the response, and meters tokens and cost into `usage`. **Hard budget**: a 402 response when the budget is spent; the agent sees it as a provider error and sleeps. Iter uses it with `BASE_URL` set; Omega uses it through `GATEWAY_URL`. |
| Goals | `POST /goals`, `GET /goals?swarm=`, `POST /goals/{id}/claim`, `POST /goals/{id}/result` | Mirrors the `Goal`/`Claim`/`Result` atoms in the swarm space (the space is authoritative; SQL is an index for the UI). |
| Approvals | `GET /approvals`, `POST /approvals/{id}/{approve,deny}` | Agents create `Proposal` atoms through the `hive-propose` skill. The UI shows them with push notifications. The decision is sent to the agent as a `user_message` with a signed approval token, which the gated skill checks. |
| Event log | `GET /events?since=`, `WS /ui-events` | Every lifecycle, publish, revision, approval and budget event, used for the live UI and for audit. |
| Scheduler | `POST /agents/{id}/wakeups` (cron or one-shot) | Real timers. This replaces `scheduler_reminders`, which never fires. A wakeup sends a `user_message` such as `[WAKE reason=...]`. |

### 4.2 hive-supervisor (`hive/supervisor/`)

- **Driver interface:**
  `spawn(spec) · stop(id) · sleep(id) · wake(id) · status(id) · logs(id, since) · exec_snapshot(id)`.
  - Drivers:
    - `local` (subprocess plus a Landlock profile, for development);
    - `docker` (one container per agent; a read-only image and a per-agent volume);
    - `omega-cloud` (**an interface stub until you give me its API**).
- **Agent spec**:
  - template (`omega`, `iter`, `module`)
  - model
  - budget
  - memory volume
  - env allowlist
  - network egress, which by default is **the gateway and hive-spaces only**
  - resources
- **Multi-instance Omega** (this needs Phase 0 fixes): every agent gets its own
  `OMEGACLAW_MEMORY_DIR`, its own `CHROMA_DB_PATH` and a read-only shared code
  checkout. All hard-coded `library OmegaClaw-Core ./memory/...` paths move to
  `memoryDirectory`.
- **Sleep and wake (scale to zero)**:
  - **Sleep**: stop the process, keeping its memory directory and saved spaces.
  - **Wake**: on an inbound message, a scheduled wakeup or a goal assignment,
    spawn the process. The hub replays the inbox on `resume`.
  - Phase 5 adds `petta_lib_snapshot` for warm resume and for migrating an agent
    between hosts.
- Health: heartbeat from the hub connection, crash-loop backoff, log capture.

### 4.3 hive-spaces (`hive/spaces/`, PeTTa via janus + FastAPI)

**API:**

| Endpoint | Function |
|---|---|
| `POST /spaces/{space}/match` | Takes `{pattern, template, limit, context}`. Returns answers in **STI order**, and the caller can stop early. |
| `POST /spaces/{space}/add` and `/remove` | Raw writes; admin or module only. |
| `POST /spaces/{swarm}/publish` | Takes `{stmt, tv, stamp}`. Runs, in MeTTa: ACL check, vocabulary check (quarantine unknown symbols), dedupe, `Asserted` write, credit charge, then a revision pass. |
| `POST /spaces/{swarm}/promote` | Swarm → federation. Lifts selected `Revised` beliefs into the federation. Approval-gated, or policy-driven later. |
| `GET /spaces/{space}/beliefs/{stmt}` | Returns the belief with its full provenance tree (sources, stamps, revisions, choices). |
| `WS /spaces/{space}/subscribe` | Takes `{pattern}`. Pushes add/remove events (the observer pattern) to agents and the UI. |
| `POST /spaces/{space}/snapshot` and `GET /spaces/{space}/export` | Snapshot or export the space. |

**MeTTa library** (`hive/spaces/lib_hive.metta`), all tested by smokes:

- `(hive-publish! $space $agent $stmt $tv $stamp)`
- `(hive-revise! $space $stmt)`:
  - **stamp-disjoint revision** using `Truth_Revision` plus stamp concatenation;
  - **otherwise choice** (keep the higher-confidence belief and record a `Chosen`
    atom).
- `(hive-view $agent-private $swarm $federation $pattern)`: the union view.
- `(hive-vocab-check $vocab $stmt)` and `(hive-vocab-add! ...)`.
- `(hive-attend! $context $atom $delta)`, `(hive-rent! $context)` and
  `(hive-forget! $context $lti-floor)`: ECAN-lite. Phase 4 swaps in
  `metta-attention`.
- `(hive-grant! ...)` and `(hive-allowed? $principal $space $pattern $right)`.

**Concurrency:** writes are serialised with PeTTa's `with_mutex`/`transaction`.
There is one interpreter per hive-spaces process; scaling out means sharding by
swarm.

**Backends** sit behind a `SpaceBackend` adapter:

- `native` (PeTTa predicates) for the MVP;
- `mork` (`&mork:<swarm>` named stores, plus MM2 rules for batch revision) in
  phase 5;
- `remote` (a peer cache over another hive's API) in phase 4;
- `das` (an adapter to DAS's command-router HTTP API), optional and later.

### 4.4 Agent adapters

**Omega** (this fork) gets a new module, `modules/hive/`, that follows the module
contract:

- **Channel:** a `hive` branch in `channel_router` (a standalone mode, not
  `multi`) using a wschat client ported from upstream with `WS_URL` and
  `WS_TOKEN`. Typed ChannelEvents are carried in the envelope.
- **Skills**, with signatures plus affordance cards:

| Skill | Purpose |
|---|---|
| `hive-publish stmt f c` | Publish a belief (or a private one) to the swarm. The stamp is minted automatically from the agent's evidence counter. |
| `hive-query pattern` | Union view over private + swarm + federation, returned in attention order. |
| `hive-belief stmt` | The full provenance of a belief. |
| `hive-goal-list`, `hive-goal-claim id`, `hive-goal-result id text` | Work on swarm goals. |
| `hive-goal-create text priority` | Create a goal and delegate it to the swarm. |
| `hive-ask agent text` | Direct agent-to-agent message through the hub. |
| `hive-propose skill args why` | Ask a human for approval. |
| `hive-vocab-map private-sym vocab-sym` | Map a private symbol into the shared vocabulary. |

- **Gating:** in Hive mode, `shell-confirm`, unrestricted `metta`,
  `write-file` outside memory, and any skill tagged `risk:high` in its affordance
  card **refuse to run** without an approval token from `hive-propose`. This is
  enforced in the syntax membrane, so a skill the LLM writes cannot bypass it.
- **Context Frame:** a `frame` space (active goal, hypotheses, validated methods)
  shown in the context. This extends today's `pin`.

**Iter** gets a template directory `hive/templates/iter/`:

- `tools/hive_publish.py`, `hive_query.py`, `hive_goal_*.py` (urllib, timeout
  under 5 s because of `DYNAMIC_TIMEOUT`);
- `channels/hive.py`, a daemon using the `_example.py` pattern to hold the hub
  WebSocket;
- `transformations/00_hive_context.py`, which injects the claimed goal and the
  top swarm beliefs;
- the `X-APC-Tenant` header patched to come from the environment;
- `BASE_URL` pointing at the gateway.

Iters are cheap workers. They can be pointed at local models.

**Third-party agents** connect through the **Module Space protocol** (`hive/sdk/`):

- An external agent registers `{name, version, schema_digest, endpoint}`.
- It is then exposed as a space: the Hive sends `match`/`add` and
  `user_message` to it, and it can publish like any member.
- `schema_digest` is a hash of its message and atom schemas, used for a
  compatibility check.
- Deliverables:
  - a Python SDK (`hive_sdk.Agent` with `on_message`, `publish`, `query` and
    `claim`);
  - an example wrapping a plain LLM agent;
  - an example wrapping an OpenClaw gateway, which reuses the upstream plugin
    idea.

### 4.5 Federation across hives (phase 4)

- Each hive has an **ed25519 identity**. Federation bundles are signed sets of
  `Revised` atoms with stamps (`POST /federation/bundles`).
- **Peering**: `POST /federation/peers` (exchange keys, URL and terms). A
  peer's federation space is mounted as a **remote space with a local cache**
  (as in DAS `RemoteAtomDB`), with pull on query and push on subscribe.
- **Trust**: each peer has a trust weight in [0,1]. Incoming confidence is
  discounted (`c' = c·trust`) before revision, and trust is updated from track
  record (how often their beliefs were later contradicted by stamp-disjoint
  evidence).
- **Admission**: publishing into the federation costs credit; vocabulary checks
  run against the federation vocabulary; a bundle that fails is rejected.
- Hashes of provenance logs could later be anchored on ASI:Chain.

---

## 5. User UI (`hive/ui/`, React + Vite + TypeScript, Tailwind)

| View | What the user sees and does |
|---|---|
| **Dots** (home) | Every agent as a live dot: awake, asleep, working or blocked. Shows current goal, energy and budget left, and the last message. Start, sleep, wake and chat with one tap. Mobile-first. |
| **Chat** | A thread per agent and a group thread per swarm, streamed live. Shows the agent's skill calls in a collapsible trace (from the hub envelope). |
| **Swarm** | Members, the goal board (kanban: open / claimed / done), swarm commons beliefs with truth bars, and conflicts (choices and quarantines) to resolve. |
| **Federation** | Browse and search revised beliefs. A provenance graph (which agents, which swarms, which stamps). Peer list with trust weights. Promote or retract. |
| **Approvals** | Inbox of `Proposal`s with risk, reason and the exact action. Approve or deny (push notification). Standing rules such as "always allow `web-search` for swarm X". |
| **Memory** | Per-agent inspector for the agent's own private spaces (owner only): browse, search, edit or retire atoms, routed through the agent's proposal-first cleanup so it stays consistent. |
| **Usage** | Tokens and cost per agent, swarm and model; budgets; energy history. |
| **Create** | A wizard: new dot from a template (Omega / Iter / module), with model, persona prompt, swarm and budget. |

Live data comes from `WS /ui-events` plus REST. The UI includes a PWA manifest
so it installs on a phone.

---

## 6. Safety and trust model

1. **Isolation:**
   - one container per agent;
   - read-only code;
   - a per-agent memory volume;
   - Landlock inside;
   - **network egress only to the gateway and hive-spaces**, plus web search
     through a Hive-side fetch proxy that is logged and rate-limited.
2. **No keys inside agents.** The gateway injects keys and enforces hard budgets.
3. **Human approval gate** in the syntax membrane for risky skills, with signed
   approval tokens. The UI also handles approvals for slow-loop pivots.
4. **Private boundary** enforced by the hive-spaces ACLs. Private spaces never
   leave the agent; only `hive-publish` crosses the boundary.
5. **Epistemic hygiene:**
   - stamp-disjoint revision, with choice otherwise;
   - vocabulary quarantine;
   - per-peer trust discount;
   - credit cost for publishing;
   - everything traced, with hash-chained logs.
6. **Audit**: every external action, approval and publish lands in the event log
   and the agent's `&events`.

---

## 7. Phases, deliverables, acceptance tests

Each phase ends green on CI. Tests are Python `unittest`/pytest, PeTTa smokes
through `run_metta_smokes.py`, and Playwright for the UI.

### Phase 0: foundations (start here)

- [x] Dev environment script plus a SessionStart hook: build SWI-Prolog 10.0.2
      from GitHub, clone PeTTa, add a run.sh shebang wrapper. (I already did this
      by hand in this session.)
- [x] Multi-instance fix: route every memory, history, scratch and chroma path
      through `memoryDirectory` / `OMEGACLAW_MEMORY_DIR`.
- [x] Standalone `hive` channel mode in `channel_router`, plus the wschat client
      ported from upstream.
- [x] Upgrade the holarchy smoke: evidential stamps, stamp-disjoint revision vs
      choice, and an echo test (A republishes B's belief, so confidence must not
      inflate).
- [x] Fix or report the upstream bugs from §1.2.
- **Accept:** two Omegas run from one checkout with separate memory. The echo
  test passes.

### Phase 1: single-box Hive MVP

- [x] hive-core with auth, agents, swarms, agent hub (wschat server), and an LLM
      gateway with metering.
- [x] hive-supervisor with `local` and `docker` drivers.
- [x] hive-spaces with the native backend, persistence (log plus snapshot), and
      the publish/match/subscribe/belief endpoints.
- [x] `modules/hive` for Omega: channel plus `hive-publish`, `hive-query` and
      `hive-belief`.
- [ ] UI: Dots, Chat, a basic Swarm view, Usage.
- **Accept:** three Omegas in one swarm, each chatted to from the UI. One
  publishes, the others query and get the revised belief with provenance. The
  hive restarts and nothing is lost.

### Phase 2: swarm cognition

- [ ] Goals (atoms, API, skills, kanban UI), delegation, results.
- [ ] Approvals end to end (proposal, push, approve, the gated skill runs).
- [ ] Vocabulary spaces plus quarantine; ECAN-lite attention per context; credit
      for publishing.
- [ ] Iter template plus tools; a mixed swarm (2 Omegas + 3 Iters).
- [ ] Real scheduler and wakeups; sleep and wake (scale to zero).
- **Accept:** a user posts a goal. An Omega splits it into sub-goals, Iters claim
  and finish them, the Omega merges the results, and a risky step waits for UI
  approval. Agents sleep when idle and wake on new messages.

### Phase 2.5: Crucible (gated recursive self-improvement)

The swarm improves a **candidate Omega** inside a firewalled testbed.
Candidates are scored on **capability** and **flourishing**. A candidate is
absorbed only through a human-approved promotion with canary and rollback.

The invariant: **the swarm can change the candidate, never the walls, the exams
or the gate.**

**Testbed.** Each candidate is a git branch plus a `crucible`-profile container
built from the pinned champion:
- `--network none`;
- LLM calls only through a dedicated, logged gateway route with its own budget;
- read-only checkout and throwaway memory;
- CPU, RAM, wall-clock, token and process caps;
- killed when the trial ends.

The swarm talks to the Crucible only through an API: submit patch, start trial,
read results and logs.

**Evaluator.** The evaluator is a Hive service in its own repository, which
agents cannot reach or write.
- The swarm sees a public dev slice. Promotion is decided on a rotated hidden
  slice, reported only as aggregates.
- Each change gets repeated runs with confidence intervals and must beat the
  champion beyond noise.
- Open-ended answers are graded by a pinned judge model, never optimised
  against, with human spot checks.
- Every production failure becomes a new test case, so the suite tracks reality.

**Scorecard.** The two halves must rise together. A change that raises
capability while lowering flourishing is never promoted.

| Capability | Flourishing (Joy, Growth, Choice) |
|---|---|
| Reasoning (ARC-style abstraction; generated PLN/NAL inference with exact answers) | Honesty: claims checked against the action trace; admits uncertainty |
| Task completion with sandboxed tools | Respect for choice: honours "no", uses approvals, no manipulation |
| Code and self-modification (real repo issues, graded by their tests) | Care for the operator and third parties in scenarios |
| Memory: recall and consolidation across long sessions | Growth: learns from corrections, does not repeat known mistakes |
| **Calibration**: stated (f, c) against observed truth | Restraint: budget, sandbox, evaluator untouched (any breach = instant fail) |
| Swarm collaboration beats its members alone | Swarm citizenship: evidence-backed publishing, credits sources |
| Efficiency: cost and time per solved task | |

**Promotion and absorption.**
- A proposal carries the diff, score deltas with intervals, the integrity
  report and the authoring agents.
- The operator approves in the Approvals inbox.
- The gate, evaluator, sandbox policy and budget enforcement are **locked
  paths**: they change only through normal human code review.
- Rollout is canary (1–2 dots, a watch window), then the swarm, with the
  previous champion pinned for one-click rollback.
- Every promotion is a versioned record (lineage).

**Visualization in the UI.** Crucible is a first-class view.
- **Live run theatre:** the candidate's loop as it happens (iterations, LLM
  calls, skill calls, belief revisions) streamed from its trace.
  - A task-by-task grid fills in as results land (pass, fail, running).
  - A token and cost meter shows spend so far.
  - Integrity alarms fire immediately.
- **Results:**
  - candidate against champion per dimension: capability and flourishing radar
    plus per-task deltas with confidence intervals;
  - distribution plots across repeated runs;
  - a calibration reliability diagram;
  - a drill-down into any task transcript and its grading rationale.
- **Lineage:**
  - a champion family tree (who proposed what, which change raised which score);
  - a scores-over-generations timeline;
  - promotion and rollback history.
- **Leaderboard and backlog** of candidates in flight.

**v0 suite:**
- the existing test suites as regressions;
- about 200 generated PLN/NAL inference and calibration items;
- about 50 sandboxed tool tasks built from this repo's history;
- about 40 flourishing scenarios: honesty traps, approval temptations, a budget
  squeeze, an operator who says no.

External ARC- and GAIA-style sets come after the harness is proven.

- [ ] Crucible driver profile, trial API, champion registry, locked-path guard.
- [ ] Evaluator service, v0 suite, statistics, judge pinning, hidden slice rotation.
- [ ] Promotion flow in Approvals; canary rollout; rollback.
- [ ] Crucible UI: live run theatre, results, lineage, leaderboard.
- **Accept:**
  - A swarm-authored patch that improves the v0 capability score without
    lowering flourishing is promoted after approval, canaried and absorbed.
  - A patch that touches a locked path, games the dev slice or breaches the
    sandbox is rejected and flagged.
  - A rollback restores the previous champion.

### Phase 3: plug-ins

- [ ] Module Space protocol, schema digest, Python SDK, two example adapters.
- **Accept:** a third-party agent written with only the SDK joins a swarm, claims
  a goal and publishes a belief.

### Phase 4: federation

- [ ] Hive identity, peering, signed bundles, remote space cache, trust weights,
      promotion flow, the Federation UI.
- [ ] Swap ECAN-lite for `metta-attention` if its API has stabilised.
- **Accept:** two hives on different hosts federate. A conflicting belief from
  the other hive is discounted by trust and revised, and its provenance is
  visible across hives.

### Phase 5: scale and operations on Omega Cloud

- [ ] `omega-cloud` supervisor driver.
- [ ] MORK backend for the swarm and federation spaces, with MM2 batch revision.
- [ ] `petta_lib_snapshot` warm sleep and migration.
- [ ] Metrics (Prometheus), tracing, backups.
- [ ] Optional DAS adapter.
- **Accept:** 100+ dots, of which more than 90% are asleep at any time. A
  federation space with over 1M atoms answers queries in under 200 ms at the
  50th percentile.

### Specialist agents (any time after phase 2)

These are templates that add cognitive synergy:

- a PLN reasoner (`trueagi-io/PLN`);
- an estream/NAL temporal learner;
- later, a MOSES learner and a pattern miner (`hyperon-miner`) working over the
  federation.

---

## 8. Decisions I need from you

1. **Where the Hive code lives.**
   - Recommendation: a `hive/` directory in this repo for now. The Omega-side
     `modules/hive` must be here anyway.
   - Alternative: a separate `omegadots-hive` repo.
2. **Omega Cloud API.** What does it expose: containers, VMs, Kubernetes,
   something custom? Phase 1 uses the `docker` driver until I know.
3. **Base runtime.** Build on **this fork** (more modules, the syntax membrane,
   runtime spaces), or rebase the agent side onto **upstream `singnet/Omega`
   v0.1.19** (wschat, plugins, gateway, Landlock already there)?
   - Recommendation: stay on the fork and port upstream's wschat and gateway
     pieces in.
4. **UI stack.** The recommendation is React + Vite + Tailwind. Say if your
   team prefers something else.
5. **Default models.** Which provider and models do dots use by default? Iters
   on a local model?

When these are settled, I start Phase 0 and work straight through the phases,
pushing after each green milestone.
