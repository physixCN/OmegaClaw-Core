# Internals — `src/loop.metta`

The heart of OmegaClaw. One function, `omegaclaw`, tail-recurses forever.

## Entry

```metta
(= (omegaclaw) (omegaclaw 1))
```

Outer `run.metta` simply calls `(omegaclaw)`.

## On turn 1 (`$k == 1`)

Initializes state:

- `(initLoop)` — configures all loop parameters (see [reference-configuration.md](./reference-configuration.md)).
- `(initMemory)` — configures memory parameters and loads the embedding model.
- `(initChannels)` — opens the active communication channel.

Also creates shared state slots:

- `&prevmsg` — last received human message.
- `&lastresults` — previous turn's skill results, for the next prompt.
- `&loops` — countdown until the agent goes idle.

## Every turn

1. **Decrement `&loops`** (turns > 1 only).
2. **Receive** — `(receive)` via the active channel.
3. **Detect new input** — compare against `&prevmsg`. If different and non-empty, reset `&loops` to `maxNewInputLoops`.
4. **Input-aware recall** — when there is fresh input, `(input-recall $msgnew $msg)` retrieves a small bounded semantic memory hint block for that input. Idle turns receive an empty recall block.
5. **Build the prompt** — `getContext` assembles `PROMPT + SKILLS + LAST_SKILL_USE_RESULTS + HISTORY + INPUT_RECALL + PROMOTED_MEMORY_HINTS + TIME` plus an output-format instruction requiring a tuple of up to 5 skill s-exprs.
6. **Set next wake** — `&nextWakeAt := now + wakeupInterval`.
7. **Call the LLM** — dispatches on `provider`:
   - `OpenAI` → `useGPT`
   - `Anthropic` → `lib_llm_ext.useClaude`
   - `ASICloud` → `lib_llm_ext.useMiniMax`
   - else → `lib_llm_ext.useAsi1`
8. **Repair parentheses** — `helper.balance_parentheses` fixes common mismatches before parsing.
9. **Parse** — `sread` on the repaired string; if it does not start with `(`, the loop feeds back a reminder prompt.
10. **Dispatch skills** — `(superpose $sexpr)` runs each skill, capturing errors via `HandleError`.
11. **Record** — `addToHistory` appends human message + response + any errors to `memory/history.metta`, provided something new happened.
12. **Save last results** — into `&lastresults` for the next turn's prompt.
13. **Sleep** — `(sleep (sleepInterval))`.
14. **Recurse** — `(omegaclaw (+ 1 $k))`.

## Input-Aware Recall

`INPUT_RECALL` is not a second agent and not hidden routing. It is a bounded
retrieval membrane for the current fresh message. The loop supplies the raw
message and explicit limits; the helper embeds the text, queries the existing
long-term memory store, applies the same promotion-aware ranking semantics, and
returns one text value for the prompt.

This gives the cognition provider relevant memory before its first response to a
new message, while keeping choice and action in the MeTTa loop. Idle cycles do
not query by input because there is no fresh input to ground the recall.

## Idle behavior

When `&loops` hits zero and no new message has arrived, the loop skips the LLM call. When `now > &nextWakeAt`, it grants `maxWakeLoops + 1` extra turns so the agent can do self-initiated work (cleanup, summarization, etc.).

## Error handling

Two kinds of error are reported back into `&error`:

- **Parse failure** (`MULTI_COMMAND_FAILURE_...`) — the LLM did not produce a valid s-expression.
- **Per-skill failure** (`SINGLE_COMMAND_FORMAT_ERROR_...`) — one skill call failed.

Errors are appended to the episodic trace so the agent sees them and can self-correct.

## See also

- [introduction.md#architecture](./introduction.md#architecture) — the architecture diagram.
- [reference-internals-skill-dispatch.md](./reference-internals-skill-dispatch.md) — how individual skills resolve.
