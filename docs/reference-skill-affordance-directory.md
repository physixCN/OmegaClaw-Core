# Skill Affordance Directory

The skill affordance directory is a symbolic index of available runtime skills.
It is intended to answer questions such as "what should be used for this
situation?" without moving that decision into hidden Python routing code.

The directory is loaded as the `&skills` space. It contains ordinary MeTTa atoms:

- `(Skill "name")`
- `(SkillTopic "name" "topic")`
- `(SkillArg "name" index "type" "argument-name")`
- `(SituationFeature "situation" "feature")`
- `(PreferredWhen "skill" "feature" confidence "why")`
- `(Risk "skill" "risk")`
- `(Effect "skill" "effect")`
- `(SkillCardLine "skill" "compact help text")`

These atoms are data for symbolic inspection. They are not an automation policy.
The agent still chooses whether to act, wait, ask, or reason further.

## Public Queries

`query-skill-space topic` returns compact skill candidates for a topic.
Examples: `memory`, `reasoning`, `core`, `affordance`.

`choose-skill-for situation` returns candidate skills linked through
`SituationFeature` and `PreferredWhen` atoms, including confidence and rationale.

`explain-skill skill` returns known argument, risk, and effect atoms for one
skill.

`skill-card skill` returns compact human-readable reminder lines.

## Context Economy

The loop's `getSkills` value is intentionally a small bootstrap, not the full
skill catalogue. It is derived from `(SkillContextHint domain text)` atoms. The
full catalogue remains available through `getFullSkills`, `skill-help`, and the
`&skills` affordance directory.

When a task needs more detail, the agent can call `query-skill-space`,
`choose-skill-for`, `explain-skill`, or `skill-card`; the result then appears in
the normal command result trace for the next cycle. This keeps discovery
composable while preserving an explicit trace of what was looked up and why.

Use `SkillContextHint` sparingly. It is for orientation primitives such as core
reply/wait/memory commands and the discovery commands themselves. It is not a
place to list every installed organ.

## Adding Skill Cards

A skill module may add its own affordance declarations by importing a file that
adds atoms to `&skills` after `skills_affordance.metta` has created the space.
Keep declarations factual and compact. Avoid embedding policy that forces the
agent to act. Prefer descriptions of arguments, risks, effects, and useful
situations.

A minimal card looks like:

```metta
!(add-atom &skills (Skill "example-skill"))
!(add-atom &skills (SkillTopic "example-skill" "example-topic"))
!(add-atom &skills (SkillArg "example-skill" 1 "rest-text" "input"))
!(add-atom &skills (PreferredWhen "example-skill" "example-feature" 0.75 "why it may fit"))
!(add-atom &skills (Risk "example-skill" "example-risk"))
!(add-atom &skills (Effect "example-skill" "example-effect"))
!(add-atom &skills (SkillCardLine "example-skill" "example-skill input - compact description"))
```

If a module adds a new topic with `SkillHelp`, it should also expose at least one
`SkillTopic` atom for that topic so the topic is discoverable through the same
symbolic path.

## Attention Triggers

The affordance directory can also hold symbolic attention triggers. A trigger is
not a router and does not execute a skill. It only records that an observed input
signal may make a skill worth considering:

```metta
(SkillTrigger "skill-name" "signal" confidence "why")
(CandidateSkillTrigger "skill-name" "signal" confidence "why")
```

Useful commands:

- `skill-suggestions-for signal` returns matching `AttentionSkillSuggestion` atoms.
- `suggest-skill-trigger skill signal confidence reason` records a candidate trigger after a missed affordance or correction.
- `promote-skill-trigger skill signal confidence reason` turns a reviewed candidate into an active trigger.
- `add-skill-trigger skill signal confidence reason` adds an active trigger directly when already justified.
- `skill-trigger-candidates` lists candidate triggers awaiting review.

Signals should be factual observations such as `has-question`,
`mentions-word:metta`, or `has-attachment:image`, not hidden interpretations of
what the agent must do. The agent still decides whether to inspect, ignore, or
use the suggested skill.
