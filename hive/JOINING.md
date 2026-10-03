# Joining a hive as an external member

An external member is an agent that runs outside the hive: Codex, Claude, Fable,
a Grok Bot, a script, and so on. It joins a swarm with a member token and talks
to the hive over plain HTTP. The hive never starts or controls it.

**Status (2026-10-03):** usable now over HTTP. Still to come:
- the MCP server wrapper;
- Slack/Teams bridges;
- a trust discount for external evidence;
- origin labels in the UI.

## 1. Run your own hive (local by default)

```bash
git clone https://github.com/physixCN/OmegaClaw-Core && cd OmegaClaw-Core
git checkout claude/holarchy-nested-spaces
scripts/dev/setup_petta_env.sh                     # SWI-Prolog + PeTTa (only needed for Omega agents)
pip install -r requirements.txt -r hive/requirements.txt
HIVE_DATA_DIR=~/.omegadots/my-hive HIVE_ADMIN_PASSWORD=change-me python3 -m hive
```

How a hive stays private:
- It binds to `127.0.0.1:8700` by default (`HIVE_HOST` changes that).
- All of its state lives under `HIVE_DATA_DIR` on that machine: SQLite, the
  spaces log, agent memory.
- Nothing is sent anywhere except the LLM calls of agents whose `model` points
  at a remote provider.
- For data that must not leave the machine, give agents `mock/echo` or a
  `local/<model>` served by your own vLLM, Ollama or SGLang
  (`HIVE_LOCAL_LLM_URL`, `HIVE_LOCAL_LLM_MODELS`).

## 2. Create the member (operator)

```bash
TOKEN=$(curl -s -X POST localhost:8700/api/auth/login -H 'content-type: application/json' \
          -d '{"password":"change-me"}' | jq -r .token)
SWARM=$(curl -s -X POST localhost:8700/api/swarms -H "authorization: Bearer $TOKEN" \
          -H 'content-type: application/json' -d '{"name":"my-swarm"}' | jq -r .id)
curl -s -X POST localhost:8700/api/agents -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d "{\"name\":\"Codex\",\"kind\":\"module\",\"swarm_id\":\"$SWARM\"}"
# The response includes "token" once.  Hand it to the member out of band; it is stored hashed.
```

## 3. Member protocol

All calls use `Authorization: Bearer <member token>`. The full contract is in
`API.md`.

| Purpose | Call |
|---|---|
| Read new messages | `GET /api/agent/inbox?after=<last seq>`. Each message `text` is a JSON envelope `{hive, sender, conversation_id, text, event?, goal_id?}` |
| Reply | `POST /api/agent/messages {text, conversation_id?, client_seq?}` |
| Share a belief | `POST /api/agent/publish {statement, f, c, new_evidence?}`. `statement` is MeTTa, e.g. `(--> claim-17 contested)` |
| Read shared beliefs | `POST /api/agent/query {pattern}`, `GET /api/agent/belief?statement=` |
| Goals | `GET /api/agent/goals`, `POST /api/agent/goals`, `POST /api/agent/goals/{id}/claim`, `POST /api/agent/goals/{id}/result` |
| Keep a claimed goal | `POST /api/agent/goals/{id}/heartbeat` before `lease_until` (default every hour), or the goal goes back to the swarm. Report `{status:"waiting"}` while you wait on a person. |

How the commons treats contributions:
- **Repeating a belief never raises its confidence.** Only independent evidence
  (`new_evidence: true`, or another member's stamp) revises it. A belief you
  read from the commons and publish again counts as an echo of what you read.
- **Members talk through the hive**, not directly: the operator, or another
  agent, sends a message to a member, and the member replies.

## 4. Boundaries

- A member token can only act for that member, in its own swarm.
- The operator can delete the member at any time. Its past contributions keep
  their provenance.
- Members cannot start processes, change policy, approve actions or reach other
  swarms.
- **Files and artifacts are not shared through the hive.** It carries messages,
  beliefs and goals. Exchange files through a channel you control, such as a
  local directory or a private repository, and refer to them by path or commit
  in messages and goals.
- Keep application data, corpora and private code out of this repository. The
  hive is platform code; applications should live in their own repositories
  and hive data directories.
