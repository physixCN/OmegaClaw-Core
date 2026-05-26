# Out-Of-Box Principles Check

This review covers the readiness branch after syntax recovery, runtime spaces, skill affordances, context compaction, continuity, web-search cleanup, memory merge, and optional Agentverse module work.

## Generalization And Hardcoding

Passes:

- Command heads, argument types, spaces, no-action heads, lowerings, shorthands, recovery hints, and module signatures are declared in MeTTa-shaped metadata, not Python skill tables.
- Skill discovery is symbolic: cards, topics, risks, effects, triggers, and preferred situations live in `&skills` atoms.
- Input-aware skill recall extracts factual signals only; it does not choose or execute skills.
- Context compaction is metadata-driven by `SkillContextView` and `SkillContextPolicy`; raw history is not summarized or mutated.
- Runtime memory uses registered space names and rejects path-like space names.
- Agentverse is optional/default-off and enters through `modules/loader.metta`; installed-but-disabled modules do not leak signatures or cards into core.
- Web search is a generic membrane: canonical `web-search`, legacy `search` alias, no hardcoded Tavily domain skill.

Acceptable membrane constants:

- Parser argument-type vocabulary such as `rest-text`, `number`, `space`, `metta`, and `multiline`.
- Declaration file names and deterministic load order.
- Conservative no-action phrase heads and parser error classes.
- Transport configuration names for optional modules, such as `OMEGACLAW_AGENTVERSE_ENDPOINT`.

Risks to watch:

- Do not add person, deployment, provider, home, channel, or task policy names to parser logic.
- Do not promote optional module affordances into always-on context hints unless the module is part of the default core surface.
- Do not let benchmarks or docs rely on private absolute paths.

## Patrick Hammer-Style Check

Assessment: aligned.

- Symbolic state remains inspectable as atoms and spaces.
- Procedural membranes are narrow and serve parsing, IO, transport, persistence, or measurement.
- PLN/NAL guidance now distinguishes rule vocabularies and truth-value requirements instead of asking the LLM to infer hidden engine contracts.
- Memory mutation skills require explicit patterns, replacements, reasons, traces, and registered spaces.
- The system favors explicit representations over opaque prompt habits.

Remaining caution: `pln-step` is still a small affordance over current rule shapes, not a full theorem-proving planner. Docs should continue saying what it actually does.

## Ben Goertzel-Style Check

Assessment: aligned for a practical AGI substrate branch.

- LLMs are treated as cognition providers, not the agent identity or memory owner.
- MeTTa/AtomSpace remains the language of thought and the place where affordances are represented.
- The architecture supports cognitive synergy: language provider, symbolic memory, reasoning engines, action membranes, and remote agents are separate but composable.
- Agentverse is an external specialist network organ, not hidden cognition inside core.
- Raw trace is preserved for research inspection while bounded context views keep the active cognitive loop tractable.

Remaining caution: optional remote-agent demos should show distributed cognitive extension without implying remote services are required for core selfhood.

## Final Readiness Position

The branch is suitable as an out-of-box core readiness candidate once tests and benchmark commands pass on a clean checkout. Optional body/channel modules should remain separate branches until they have the same boundary, docs, and test discipline.
