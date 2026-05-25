# Tutorial 03 — Writing a Custom Skill

**Goal:** add a new skill the agent can call, end-to-end.

## Prerequisites

- A local clone of OmegaClaw-Core (so you can edit MeTTa source).
- Familiarity with running the agent — see [Usage](/README.md#usage).

## The anatomy of a skill

A skill is three things:

1. **A MeTTa definition** of how the skill executes. Pure-MeTTa skills are written directly; skills that need system access delegate to Python or Prolog.
2. **A `SkillSignature` declaration** so the syntax membrane knows the command shape.
3. **Skill documentation atoms**: `SkillCatalog` / `SkillHelp` for full help, and optionally `SkillContextHint` only for tiny always-on bootstrap hints. Most skills should be discovered through the symbolic skill directory rather than injected into every loop prompt.
4. **Optional Python/Prolog glue** imported through `py-call` or `translatePredicate`.

## Example: a `word-count` skill

We'll add `(word-count "some text")` that returns the number of whitespace-separated tokens.

### Step 1 — Define the implementation

Add the executable MeTTa definition in the appropriate skill file, for example `src/skills_core.metta`:

```metta
(= (word-count $str)
   (progn (translatePredicate (split_string $str " " "" $parts))
          (length $parts)))
```

If you prefer Python, register a function in a `.py` module and call `(py-call (mymodule.word_count $str))`.

### Step 2 — Declare the command shape and help

Add a signature beside the skill's organ, for example in a `skill_signatures_*.metta` file:

```metta
(SkillSignature word-count (Arg 1 string text))
```

Add full help in the matching `skill_catalog_*.metta` file:

```metta
(SkillCatalog "Text utilities: word-count text")
(SkillHelp "text" "word-count text - count whitespace-separated words")
```

Only add `SkillContextHint` when a command must be part of the tiny always-on bootstrap. Ordinary skills should be discoverable through `skill-help`, `query-skill-space`, `choose-skill-for`, `explain-skill`, or `skill-card`.

## Module form

For a capability that should be removable or shareable, put the same pieces in a
module:

```text
modules/text-utils/
  module.toml
  entry.metta
  skills.metta
  signatures.metta
  catalog.metta
```

`modules/text-utils/entry.metta` should import the runtime skill file:

```metta
!(import! &self (library OmegaClaw-Core ./modules/text-utils/skills.metta))
```

Then enable the module in `modules/loader.metta`:

```metta
!(import! &self (library OmegaClaw-Core ./modules/text-utils/entry.metta))
```

The loader import is what makes the module active. A folder under `modules/`
that is not imported by the loader remains inert: its runtime is not loaded and
its signatures/catalog are not exposed.

Optional attention trigger: if a factual input signal often makes the skill relevant, add a symbolic trigger in the skill affordance declarations:

```metta
!(add-atom &skills (SkillTrigger "word-count" "mentions-word:count" 0.65 "count requests may need word-count"))
```

This is only an attention suggestion. It should help the agent notice the skill, not force routing or action.

Optional trace contract: if the module can write verbose traces, declare them in
`module.toml` and make them runtime-controlled. Potentially large or private
traces should be off by default:

```toml
[env]
OMEGACLAW_TEXT_UTILS_TRACE = { required = false, default = "0" }

[trace]
default_enabled = false
writes = ["TextUtilityTrace"]
```

Then mirror that availability in `entry.metta`:

```metta
(RuntimeConfig omegaclaw.module.text-utils OMEGACLAW_TEXT_UTILS_TRACE "optional-default-off")
(TraceAvailable omegaclaw.module.text-utils TextUtilityTrace)
```

The skill return value should remain compact enough for
`LAST_SKILL_USE_RESULTS`; full raw traces are for explicit audit/debug modes.

### Step 3 — Test

Restart the agent. Ask:

```
how many words are in "the quick brown fox"?
```

The LLM should emit `(word-count "the quick brown fox")` and respond with `4`.

## Conventions

- Skill names are lowercase, hyphen-separated.
- Every argument is a string literal in quotes. Variables are forbidden in LLM-generated skill calls (the loop rejects them in `getContext`).
- Return a value that is safe to render into the `LAST_SKILL_USE_RESULTS` context — the loop runs the result through `helper.normalize_string`.
- If your skill may fail, wrap error-producing subcalls in `catch` or let them fall through to the loop's `HandleError`.

## Verification

- The new skill appears through `skill-help` or the `&skills` affordance directory.
- The LLM invokes it without prompting tweaks.
- The return value shows up in `LAST_SKILL_USE_RESULTS` on the next turn.

## Next steps

- [reference-internals-skill-dispatch.md](./reference-internals-skill-dispatch.md) — how dispatch works.
- [reference-internals-extension-points.md](./reference-internals-extension-points.md) — other places to hook in.
- [tutorial-06-remote-agentverse-skills.md](./tutorial-06-remote-agentverse-skills.md) — delegate skills to a remote agent instead of running them locally.
