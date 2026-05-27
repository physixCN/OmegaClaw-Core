# Changelog

## Unreleased - out-of-box core readiness

This branch collects the portable core-readiness layers prepared after live Omega testing. It avoids private deployment assumptions and makes optional organs visible only through the active module loader composition.

### Added

- Typed command syntax membrane driven by `SkillSignature`, `SignatureSpace`, `SignatureLowering`, `SignatureShorthand`, and `SignatureRecoveryHint` declarations.
- Symbolic skill affordance directory with cards, topics, arguments, risks, effects, input-aware triggers, and compact context hints.
- Runtime spaces for persistent, agenda, beliefs, world, events, activity, cleanup, assume, attention, skills, skill-triggers, scratch, scratch-ttl, and agentverse.
- Bounded context views for large skill payloads via `SkillContextView` and `SkillContextPolicy`; raw history remains exact.
- Core continuity skill `pin` with volatile working-state guidance.
- Portable energy loop self-regulation and restart/reboot continuity affordances.
- Canonical `web-search` surface, with legacy `search` retained as an alias.
- Symbolic memory cleanup affordances: `space-transform`, `space-merge-atoms`, `persistent-merge-atoms`, and reviewed persistent retirement.
- Module-owned AgentVerse surface with discovery, registry, listener, async inbox, trace, and AgentChatProtocol call path; visibility is controlled by `modules/loader.metta`.
- Repeatable parser and context-compaction benchmarks under `tests/` and `docs/review/`.
- Reviewer-facing demo suite and generated results under `docs/review/`,
  including syntax repair, large-payload context compaction, bounded episodes,
  module surfaces, AgentVerse surface, and Assume/FabricPC story evidence.
- Current v0.01a technical walkthrough and name/security audit for outside
  research review.

### Changed

- Core context now uses compact bootstrap skill hints; full help and cards remain inspectable through symbolic affordance skills.
- Parser errors now fail closed with recovery hints and relevant skill-card lines when available.
- PLN/NAL guidance now distinguishes NAL copulas from truth-valued PLN statements.
- Generated runtime memory files are ignored except curated prompt/history seed files.
- Remote-agent support moved behind the module boundary; old hardcoded Agentverse core bridge was removed.

### Validation

- Live Omega tested syntax repair, context compaction, runtime spaces, pin continuity, memory merge behavior, and Agentverse end-to-end remote call behavior before readiness branch publication.
- Clean readiness branch tests and benchmark commands are documented in `docs/reference-testing-benchmarks.md`.

### Not included

- Deployment-specific glue such as live run-script endpoint values, channel auth
  sessions, local webhost/public-site state, private runtime memory, and private
  Home Assistant deployments.
