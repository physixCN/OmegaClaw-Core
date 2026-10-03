# Dot program contract v0.1 (provisional, frozen)

A **dot program** supplies the meaning of a piece of work as a **work graph**.
The **host** (the OmegaDots UI and server) turns it into an experience that
adapts to what the person is doing. This document is the boundary between the
two.

- v0.1 is frozen.
- Changes come as v0.2 and later, and a program declares which version it
  speaks.
- The contract is plain JSON. It does not depend on MeTTa, a particular truth
  calculus, or any earlier Omega architecture.

```
   person
     │  asks · follows · compares · inspects · acts
     ▼
 ┌──────────────────────────── HOST (platform owns) ─────────────────────────────┐
 │ layout · stage transitions (unfold / map / compare / detail) · accessibility   │
 │ navigation trail · back with state restored · always-visible sources and       │
 │ uncertainty · permission checks · task status · rendering text only, no code   │
 └───────────────▲──────────────────────────────────────────────┬────────────────┘
       WorkGraph │ (data)                       describe/view/act│ (intent)
 ┌───────────────┴──────────────────────────────────────────────▼────────────────┐
 │ PROGRAM (application owns): meaning, kinds, evidence model, assessments,      │
 │ corrections, its private records and store, workflows (e.g. a Scientist)       │
 └────────────────────────────────────────────────────────────────────────────────┘
        loaded from the owner's local workspace (HIVE_PLUGIN_DIRS); data stays there
```

## Status

| Part | State |
|---|---|
| Server host: discovery, manifest, capability-limited context, graph and result validation, routes below | **implemented** (`hive/core/programs.py`) and tested (`hive/tests/test_programs_api.py`) |
| Standalone checker: `python -m hive.programs_check <dir>` | **implemented**. Needs no hive, no UI, no network |
| Public fixture program | **implemented** (`hive/plugins/contract_fixture/`) |
| Adaptive UI host: stages, morphing, trail, back, source and uncertainty chrome | **being built**. Layout is not part of the contract, so programs do not wait on it |
| Deltas, program-owned tasks, out-of-process programs, rendering hints | **later** (v0.2 and after) |

**What a program team can do now, independent of host layout:** write
`describe()`, `view()` and `act()` over its own store, and run the checker
against its directory until it prints `COMPATIBLE`. Everything the host
renders comes from these returns.

## 1. Signatures and lifecycle

```python
def describe() -> Description                                   # once at load, and on reload
def view(ctx, focus: str | None, stage: str) -> WorkGraph       # every time the person looks
def act(ctx, action: str, items: list[str], params: dict) -> Result   # sync or async
```

1. **Load.** The host reads `plugin.json`, imports the module and calls
   `describe()`. A failure marks the program as errored, with the reason; it
   never crashes the hive.
2. **View.** On each navigation the host calls `view(focus, stage)`. `stage`
   is one of `unfold`, `map`, `compare`, `detail`. `focus` is an item id, or
   None for the program's starting view. The return is **always a full
   snapshot** in v0.1.
3. **Act.** The person picks an action on some items. The host checks
   permission, then calls `act` with `params.base_revision` set to the
   revision the person was looking at.
4. **Reload.** `POST /api/programs/reload` re-reads the code. Enable and
   disable are operator switches.

## 2. Shapes

```jsonc
// Description
{ "contract": "0.1",
  "kinds":     [{ "id": "evidence", "label": "Evidence", "role": "evidence" }],
  "relations": [{ "id": "contradicts", "label": "contradicts", "polarity": "oppose" }],
  "actions":   [{ "id": "inspect-source", "label": "Open source", "applies_to": ["evidence"],
                  "stage": "detail?", "params": { "name": "what it means" } }] }
```

- `role` is one of `question`, `claim`, `evidence`, `hypothesis`,
  `assessment`, `explanation`, `gap`, `source` or `other`. Roles drive shared
  styling. Kinds are the program's own; several kinds may share a role.
- `polarity` is one of `support`, `oppose`, `qualify` or `neutral`. Polarity
  drives the compare stage. Relation ids are the program's own: for example
  `supports`, `contradicts`, `qualifies` and `depends_on`.

```jsonc
// WorkGraph: a full snapshot
{ "revision": "r7",                    // REQUIRED, opaque; changes whenever content changes
  "focus": "q1", "title": "...", "suggested_stage": "unfold",
  "items": [{
     "id": "e3",                       // REQUIRED, stable across revisions; never reused for something else
     "kind": "evidence", "label": "short", "text": "optional longer text",
     "status": "current",              // current | corrected | superseded | retracted
     "flags": ["affected-by-correction"],
     "uncertainty": { "method": "nal", "f": 0.9, "c": 0.8 },   // OPTIONAL; see below
     "sources": [{
        "id": "s-blog", "label": "Structural engineering blog post", "kind": "document",
        "url": "https://…", "local_ref": "optional path or record id in the owner's store",
        "date": "2025-11-20", "locator": "section 'Load rating'",
        "status": "retrieved",         // retrieved | inspected | cited | unavailable
        "origin": "independent-engineer"   // shared by sources with a common origin
     }],
     "revisions": [{ "revision": "r6", "label": "previous wording", "note": "why", "at": "ISO" }],
     "at": "ISO time", "weight": 0.6,
     "meta": {},                       // anything program-specific; the host shows nothing from it by default
     "atom": "(optional MeTTa expression for programs that keep one)"
  }],
  "links":  [{ "id": "l5", "from": "e3", "to": "c1", "rel": "contradicts", "weight": 0.6 }],
  "groups": [{ "id": "conflict", "label": "Points to a lower rating", "items": ["e3", "h1"] }],
  "notes":  ["caveats the host always shows"] }
```

Validation rules, applied by both the server and the checker:
- Ids are unique.
- Every link and group points at items in the same graph.
- A link id defaults to `from|rel|to`.
- Kinds and relations must come from `describe()`.
- At most 400 items and 1200 links per view. A bigger view is refused, never
  cut short: narrow it instead.

**Uncertainty is optional and labelled with its method.** The host never
converts one method into another or into a single probability.
- `{"method": "nal", "f", "c"}`
- `{"method": "pln", "strength", "confidence"}`
- `{"method": "qualitative", "status": "contested"}`
- any other `method` with a `label`

Values are checked to lie in [0, 1] only for `nal` and `pln`. A missing
uncertainty means unassessed, which is different from zero.

**Groups may overlap and are never merged.** In the compare stage they keep
contradictory evidence and alternatives side by side. Disagreement is shown,
not collapsed.

**References are not access.** A `url` or `local_ref` is shown as a
reference. Opening it is up to the person, or happens through the program's
`inspect-source` action, and the host fetches nothing by itself.

## 3. Actions, results and updates

```jsonc
// Result
{ "status": "done | started | needs_input | stale | refused | error",
  "graph": { /* full WorkGraph snapshot, optional */ },
  "task":  { "id": "g_ab12", "kind": "goal", "status": "open" },   // required when status = started
  "needs": { "param": "what is missing" },                          // with needs_input
  "detail": { /* action-specific, e.g. { "sources": [...] } for inspect-source */ },
  "message": "shown to the person" }
```

| Status | Meaning |
|---|---|
| `done` | The action finished. If `graph` is present it replaces the view. |
| `started` | Long-running. `task.id` is a **swarm goal**, so its lifecycle is the goals lifecycle: open → claimed → waiting (needs a person) → done / failed / stalled / cancelled. Cancelling is `PATCH /api/goals/{id} {status:"cancelled"}`. |
| `needs_input` | Call again with the named `params`. |
| `stale` | `params.base_revision` is no longer current. Nothing changed. Return the current graph so the host can reconcile. |
| `refused` | The program declined, for example because the action doesn't apply. |
| `error` | The program failed cleanly, with a message. |

- **Incremental updates in v0.1 are full snapshots.** The host keeps focus
  and trail by item id across revisions.
- **Corrections:** a correction keeps the item id and sets `status`. It
  appends the prior state to `revisions`, flags dependent conclusions with
  `affected-by-correction`, and bumps `revision`.
- Deltas come in v0.2.

Recommended action ids, so hosts can place them consistently:
`inspect-source`, `challenge`, `compare`, `investigate-gap` and `correct`.
Programs may add their own.

## 4. Mounting and discovery

- **Built-in programs:** `hive/plugins/<dir>/plugin.json` and the module.
- **Private programs:** set `HIVE_PLUGIN_DIRS=/path/to/workspace/programs` on
  the owner's local hive. It accepts a directory of program directories, or
  one program directory.
- Nothing is copied into this repository. The program's store, records and
  references stay wherever the program keeps them.

```json
{ "id": "my-program", "name": "My program", "version": "0.1.0", "contract": "0.1",
  "module": "program.py", "capabilities": ["goals:write"], "icon": "spark" }
```

## 5. Permissions, errors and cancellation

- **The view is data.** The host renders text as text. A program cannot
  inject markup or code into the UI.
- **Program code is trusted server code,** loaded by the hive's owner. v0.1
  runs it inside the hive process. Capabilities only limit which hive APIs the
  context offers. They are **not** a sandbox: in-process Python can still
  reach the filesystem and network as the hive's user. Out-of-process
  isolation is planned.
- **Capabilities** limit the context. The program gets errors for anything it
  did not declare:
  - `commons:read` gives `beliefs()`, `belief(s)` and `agents()`;
  - `goals:read` gives `goals()`;
  - `goals:write` gives `create_goal(title, detail)`.

  A program's own store is its own business.
- **Scope:** each call is limited to one swarm, the one the person is in.
- **The routes are operator-only today:** a person drives a program. Agent
  calls are not supported yet. When they come, they will be an explicit,
  separate route, and each action will go through the policy gate as skill
  `program:<id>:<action>`.
- **Errors:**

  | Code | Meaning |
  |---|---|
  | 400 `bad_graph` / `bad_result` | The return broke the contract; the message says how |
  | 403 `capability_missing` | The program called a method it did not declare |
  | 409 `program_disabled` | An operator turned the program off |
  | 500 `program_error` | An exception in the program, with its last lines |

  A failing program never takes the hive down.
- **Cancellation:** v0.1 tasks are goals, so cancel the goal. Program-owned
  tasks with their own cancel are v0.2.

## 6. Compatibility test

```bash
python -m hive.programs_check path/to/your_program                 # structural checks; read-only
python -m hive.programs_check path/to/fixture --scenario --allow-mutation
```

**Always run:**
- `describe()`, and `view()` in every stage, are valid;
- ids and the revision are stable across repeated views;
- `inspect-source` (if offered) returns `detail.sources`.

**Only on request:**
- `--scenario` requires a question with one supporting and one opposing link.
  That is a check on a **test scenario**. A real investigation never has to
  contain, or invent, counterevidence to be compatible.
- `--allow-mutation` runs `correct`. It checks that `correct` keeps every id,
  records the prior revision, bumps the revision and returns `stale` on an old
  base. **`correct` changes data.** Run it only against a disposable fixture
  or a throwaway copy of the store, never against real records.

The public example is `hive/plugins/contract_fixture/`, a synthetic question:
"Is the Riverside footbridge rated for 5-tonne loads?" It has:
- two supporting reports with a common origin;
- independent counterevidence;
- a rival hypothesis, an assessment and a gap;
- all five recommended actions.

The fixture runs through the real API in `hive/tests/test_programs_api.py`.

## 7. HTTP routes (operator)

| Method & path | Body → Response |
|---|---|
| `GET /api/programs` | → `[{id, name, version, description, icon, capabilities, source, enabled, error}]` |
| `GET /api/programs/{id}` | → that plus `describe` |
| `POST /api/programs/{id}/view` | `{swarm_id, focus?, stage?}` → `WorkGraph` (validated, with `contract`, `program`, `stage` added) |
| `POST /api/programs/{id}/act` | `{swarm_id, action, items, params?, base_revision?}` → `Result` |
| `POST /api/programs/{id}/enable` · `/disable` · `POST /api/programs/reload` | operator switches |
