# Tutorial 03 — Writing a Custom Skill

**Goal:** add a new skill the agent can call, end-to-end.

## Prerequisites

- A local clone of OmegaClaw-Core (so you can edit MeTTa source).
- Familiarity with running the agent — see [Usage](/README.md#usage).

## The anatomy of a skill

A skill is three things:

1. **A symbolic signature and affordance card** so the parser and skill directory know the call shape, risks, effects, and when to use it.
2. **A catalogue/help entry** so the full skill docs are queryable through `skill-help`, `skill-card`, and `choose-skill-for`.
3. **A MeTTa definition** of how the skill executes, in the appropriate `src/skills_*.metta` organ or module-owned `skills.metta`. Pure-MeTTa skills are written directly; skills that need system access delegate to Python or Prolog.
4. **Optional Python/Prolog glue** imported through `py-call` or `translatePredicate`. This glue performs IO/execution only; it should not hide cognition.

## Example: a `word-count` skill

We'll add `(word-count "some text")` that returns the number of whitespace-separated tokens.

### Step 1 — Declare the signature

Open the closest signature file, for example `src/skill_signatures_core.metta`, and add the accepted argument shape:

```metta
(SkillSignature word-count (Arg rest-text text))
```

The syntax membrane uses this to validate and repair calls. Keep signatures exact and fail-closed.

### Step 2 — Add affordance and catalogue atoms

Open the closest affordance/catalog files, for example `src/skill_affordance_core.metta` and `src/skill_catalog_core.metta`:

```metta
(Skill "word-count")
(SkillTopic "word-count" "text")
(SkillArg "word-count" 1 "rest-text" "text")
(SkillCardLine "word-count" "word-count text - count whitespace-separated words")
(PreferredWhen "word-count" "need-token-count" 0.70 "use for small local text counting")

(SkillCatalog "Text helper: word-count text")
(SkillHelp "text" "word-count text - count whitespace-separated words in local text")
```

Do not stuff every new skill into the always-visible `getSkills` bootstrap. `getSkills` is intentionally small and reads only `(SkillContextHint ...)` atoms. Most skills should be discovered through the symbolic skill directory.

### Step 3 — Define the implementation in the right organ

Choose the closest MeTTa organ file:

- `src/skills_core.metta` — core runtime, file IO, reboot, generic execution helpers
- `src/skills_memory.metta` — structured memory/world/belief/event/agenda writes and reads
- `src/skills_energy.metta` — energy, attention mode, cycle-status, loop pacing affordances
- `modules/assume/skills.metta` — Assume/FabricPC prediction and mutation-review affordances
- `modules/*/skills.metta` — optional devices/apps such as vision, audio, glucose, house control
- `src/skills_reasoning_spaces.metta` — MeTTa/NAL/PLN and read-only space inspection
- `src/skills_attention.metta` — attention ledger and ECAN-lite immune affordances
- `src/skills_space_mutation.metta` — explicit reviewed space mutation/retirement utilities

For this pure text helper, `src/skills_core.metta` is a reasonable home:

```metta
(= (word-count $str)
   (progn (translatePredicate (split_string $str " " "" $parts))
          (length $parts)))
```

If you prefer Python, register a function in a `.py` module and call `(py-call (mymodule.word_count $str))`.

`src/skills.metta` remains as a compatibility loader for humans and older imports. New implementations should go into the organ file, not back into that loader.

### Step 4 — Test

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

- `skill-card word-count` shows the card, argument shape, and purpose.
- `choose-skill-for "count words in this short sentence"` can recall it.
- The LLM invokes it without prompt edits when the relevant task appears.
- The return value shows up in `LAST_SKILL_USE_RESULTS` on the next turn.

## Next steps

- [reference-internals-skill-dispatch.md](./reference-internals-skill-dispatch.md) — how dispatch works.
- [reference-internals-extension-points.md](./reference-internals-extension-points.md) — other places to hook in.
- [tutorial-06-remote-agentverse-skills.md](./tutorial-06-remote-agentverse-skills.md) — delegate skills to a remote agent instead of running them locally.
