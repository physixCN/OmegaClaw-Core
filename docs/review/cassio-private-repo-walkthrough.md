# OmegaClaw Core Private Review Walkthrough For Cassio

Audience: Cassio, SNET AI researcher and reviewer familiar with Ben Goertzel's AGI work, neural-symbolic systems, AtomSpace/MeTTa-style representations, and the difference between an agent architecture and an LLM wrapper.

Repo under review: `physixCN/OmegaClaw-Core-private`

Branch under review: `out-of-box-core-readiness`

Private branch head: run `git rev-parse --short HEAD` in the checkout being reviewed.

## 1. Executive Orientation

This branch is a private readiness branch for OmegaClaw Core. It is not trying to turn OmegaClaw into a chatbot product. It is trying to make a fresh core checkout behave like a coherent persistent cognitive substrate: symbolic memory, exact trace, bounded context, inspectable skills, safe command syntax, restart continuity, live web grounding, and optional remote-agent extension.

The central architectural position is:

- OmegaClaw is the agent substrate.
- The LLM is a cognition provider, not the agent.
- MeTTa/AtomSpace is the language of thought.
- Python, shell, JS, web search, providers, and uAgents are membranes, hands, sensors, or transports.
- Raw history is sacred and exact.
- Context views may be bounded or mechanically compacted.
- Skills should be symbolic, inspectable, removable, and self-describing.
- Avoid hardcoded cognition. Expose affordances and let Omega choose.

This branch was shaped by live testing on a more organically grown Omega deployment, then backported into a clean private repo while removing live-only deployment assumptions. It is meant to be a staging ground: Cassio can review the complete private branch, and later the team can choose which clean pieces are appropriate for upstream core.

The main review question is:

Does this version make OmegaClaw Core work out of the box as an inspectable neural-symbolic agent substrate, without smuggling cognition into Python or private deployment glue?

My current answer: yes, with documented cautions. The pieces are not all equally mature, but the branch is coherent and testable.

## 2. Major Developments In Chronological Order

This is the branch history from `origin/main` to the readiness head, in chronological order. Each item is expanded later.

1. `e80c626 Add typed command syntax membrane`
   - Replaces fragile command string coercion with declaration-driven typed parsing.

2. `c3e470e Add runtime memory context boundary`
   - Introduces safer memory path handling, context tail helpers, and runtime memory boundaries.

3. `f279718 Add symbolic skill affordance directory`
   - Adds `&skills` as an inspectable symbolic directory of skills, topics, args, risks, effects, and cards.

4. `609f7b6 Add input-aware context recall`
   - Adds fresh-input memory recall into the prompt flow without treating it as a substitute for deliberate memory checking.

5. `ad8792c Add explicit module loader boundary`
   - Creates a clear optional-module loading point and prevents installed-but-disabled modules from leaking into core.

6. `5a61208 Complete core skill affordance help surface`
   - Broadens the core skill cards/help surface so the agent can inspect its body manual symbolically.

7. `9ff3d0e Add input-aware symbolic skill recall`
   - Adds signal-to-trigger-to-card recall for skills on fresh input.

8. `8d73bef Improve skill help fallback`
   - Makes `skill-help` more robust by falling back to cards and argument atoms.

9. `7634e98 Add bounded context and continuity affordances`
   - Adds context compaction policies and strengthens `pin` as volatile continuity.

10. `ddac831 Make web-search the canonical core web surface`
    - Makes `web-search` the canonical live web skill and keeps `search` as a legacy alias.

11. `7248182 Tighten portable prompt memory discipline`
    - Strengthens prompt discipline around memory, fresh input, and non-confabulation without private assumptions.

12. `bb00640 Guide PLN reasoning through explicit affordances`
    - Clarifies PLN/NAL expectations and discourages fake unsupported query surfaces.

13. `3e4ab5a Add portable energy loop self-regulation`
    - Changes loop posture from hardcoded/high-churn defaults to bounded portable warm operation.

14. `1023a3b Align presentation docs with core runtime readiness`
    - Updates docs to describe the new runtime shape.

15. `fdf829a Ignore generated runtime memory files`
    - Prevents generated runtime memory files from being accidentally committed.

16. `3adbf1a Add optional Agentverse listener module`
    - Adds default-off Agentverse/uAgents remote-agent module with listener, inbox, discovery, and async call support.

17. `fc656b0 Finish core out-of-box repair affordances`
    - Adds syntax recovery hints/cards, `space-merge-atoms`, `persistent-merge-atoms`, PLN docs, and final core cleanup.

18. `debf2fe Document out-of-box readiness checks`
    - Adds changelog, benchmark docs, context benchmark, and hardcoding/generalization review.

## 3. Architecture Overview: Original Core Versus This Version

### Original Core Shape

The original `origin/main` core was admirably compact. It had a continuous MeTTa loop, provider calls, channel receive/send, history, memory, and a simple helper that normalized LLM output into s-expressions.

The original loop did roughly this:

1. Initialize memory, channel, and loop parameters.
2. Build the prompt with `getContext`.
3. Receive a channel message.
4. Append the latest message to the prompt.
5. Call the configured LLM provider.
6. Run `helper.balance_parentheses` on the provider text.
7. `sread` and evaluate the resulting skill calls.
8. Add to history.
9. Sleep and continue.

This original version was compact and legible, but it had predictable fragility:

- The prompt was built before receive, so fresh-input-specific recall could not naturally be included.
- The parser was mostly string manipulation and special cases, especially around write-file/append-file.
- Provider/model defaults were configured in the loop, which made portability and provider separation less clean.
- Skill visibility was mostly prompt/catalog shaped, not a rich symbolic affordance directory.
- Optional extensions did not have a strong module boundary.
- Large payloads in history could dominate context.
- Raw history and prompt-facing context were not cleanly separated as first-class concepts.
- There was no principled syntax recovery surface for the agent to learn from parser errors.

### New Architecture Shape

This branch keeps the continuous MeTTa loop, but turns several implicit or brittle areas into explicit membranes and symbolic surfaces.

The new loop shape is:

1. Receive channel input.
2. Determine whether input is fresh.
3. Build `INPUT_RECALL` only for fresh input.
4. Build `SKILL_RECALL` only for fresh input.
5. Build prompt context with prompt, compact skills, last results, bounded history, input recall, skill recall, promoted memory hints, and time.
6. Call the provider.
7. Pass provider output through `signature_balance_parentheses`, the typed syntax membrane.
8. Read and reduce commands.
9. Record raw output, parsed form, and command results in history.
10. Bound and save runtime spaces.
11. Sleep or wake according to loop energy state.

The key new architecture elements are:

- Typed syntax membrane: declaration-driven command parsing.
- Symbolic skill affordance directory: inspectable atoms for skill discovery.
- Input-aware memory recall: bounded recall for fresh human input.
- Input-aware skill recall: signal-trigger-card path for relevant affordance hints.
- Runtime spaces: registered named symbolic spaces with persistence.
- Context view compaction: mechanical large-payload omission from LLM-facing context only.
- Continuity pin: volatile working-state vector.
- Module loader boundary: optional organs do not leak unless enabled.
- Agentverse optional module: remote-agent transport behind self-contained module metadata.
- Test/benchmark suite: repeatable checks for the above.

### Compare And Contrast Summary

Original core was minimal and elegant, but brittle at the LLM-to-skill boundary and thin on symbolic self-description. This version is slightly larger, but the added complexity is mostly in explicit membranes and inspectable metadata.

The tradeoff is intentional:

- Original: smaller, easier to read, but more vulnerable to syntax drift, context bloat, and hidden deployment habits.
- This branch: more moving parts, but clearer boundaries, better self-description, better repair behavior, and better out-of-box operation.

A reviewer should ask whether the added mechanisms preserve the MeTTa-first substrate or whether they hide cognition elsewhere. The branch includes tests and review docs specifically to keep that pressure on.

## 4. Improvement 1: Typed Command Syntax Membrane

Commit: `e80c626 Add typed command syntax membrane`

### What It Does

It replaces the original simple `balance_parentheses` path with a typed command syntax membrane. The LLM still emits plain command-like text, but the membrane normalizes it into safe MeTTa skill calls or explicit error/no-action atoms.

### How It Is Implemented

Core files:

- `src/helper_command_parser.py`
- `src/skill_signatures*.metta`
- `docs/reference-syntax-membrane.md`
- `tests/test_syntax_smoke_corpus.py`

Command declarations live in MeTTa-shaped metadata:

```metta
(SkillSignature web-search (Arg rest-text query))
(SkillSignature space-find (Arg space space) (Arg metta pattern))
(SignatureSpace persistent)
(SignatureLowering write-file write-file-base64)
```

Python reads those declarations and enforces argument types such as `rest-text`, `number`, `space`, `metta`, `multiline`, `base64`, and `shell-command`.

### Why It Was Needed

LLMs often produce almost-correct command syntax. In a persistent agent, an almost-correct command can be worse than no command: it can fail silently, mutate the wrong thing, or generate confusing history. The membrane gives the agent a deterministic grammar boundary.

### What Is Right

- Skill signatures are declared outside Python.
- Bad commands fail closed.
- File writes preserve bytes through base64 lowering.
- Registered spaces are enforced.
- Tests cover many prior failure shapes.

### What Is Wrong Or Still Fragile

- The parser is larger than the original helper and must be watched for creeping policy.
- Argument-type vocabulary is still a Python-side membrane vocabulary.
- Some legacy command shapes are supported for compatibility, which increases surface area.

### Confidence

High. The static and smoke tests are strong, and live Omega exercised the syntax path heavily. Remaining risk is future maintainers adding skill-specific policy back into Python.

## 5. Improvement 2: Runtime Memory Context Boundary

Commit: `c3e470e Add runtime memory context boundary`

### What It Does

It separates raw memory/history files from prompt-facing context helpers. It also makes memory paths configurable and safer for tests and clean deployments.

### How It Is Implemented

Core files:

- `src/helper_metta.py`
- `src/helper_history.py`
- `src/memory.metta`
- `tests/test_memory_runtime.py`

The helpers read prompt/history through configured memory paths, return safe empty values when memory is absent, and support bounded history/context views.

### Why It Was Needed

The original helper had hardcoded assumptions about history paths. That is fine for a single live deployment, but not for portable core tests or a clean private repo.

### What Is Right

- Tests can run without touching live memory.
- Runtime memory files use configured memory directories.
- Missing memory files do not crash the core context path.
- This sets up later context compaction without altering raw history.

### What Is Wrong Or Still Fragile

- Path indirection adds complexity and needs consistent environment behavior.
- There is still a conceptual distinction reviewers must keep straight: raw history, bounded history tail, context view, and episode retrieval are related but not the same.

### Confidence

High for the tested helpers. Medium-high for all deployment modes, because path/environment behavior is always where portability bugs like to hide.

## 6. Improvement 3: Symbolic Skill Affordance Directory

Commit: `f279718 Add symbolic skill affordance directory`

### What It Does

It creates an inspectable `&skills` space where skills are represented as atoms: skill name, topics, args, risks, effects, preferred situations, triggers, aliases, and compact card lines.

### How It Is Implemented

Core files:

- `src/skills_affordance.metta`
- `src/skill_affordance*.metta`
- `src/skill_catalog*.metta`
- `docs/reference-skill-affordance-directory.md`
- `tests/test_skill_affordance_contract.py`

Example atoms:

```metta
(Skill "web-search")
(SkillTopic "web-search" "web")
(SkillArg "web-search" 1 "rest-text" "query")
(Risk "send" "external-communication")
(Effect "send" "message-sent")
(SkillCardLine "web-search" "web-search query - search the live web through the configured websearch membrane")
```

Public queries include `query-skill-space`, `choose-skill-for`, `explain-skill`, and `skill-card`.

### Why It Was Needed

A persistent agent should be able to inspect its own action surface. Skill discovery should not be only prompt prose or hidden Python routing.

### What Is Right

- The skill surface becomes symbolic and inspectable.
- Risks and effects are explicit.
- Cards can be loaded/unloaded with modules.
- The agent can ask what skills exist instead of guessing.

### What Is Wrong Or Still Fragile

- The quality of discovery depends on the quality of cards/topics/triggers.
- There is no deep ontology of skills yet; it is a practical symbolic directory.
- Too many cards could become noisy if future modules are careless.

### Confidence

High for the core directory mechanics. Medium for long-term scaling until there is stronger ontology/attention management.

## 7. Improvement 4: Input-Aware Context Recall

Commit: `609f7b6 Add input-aware context recall`

### What It Does

It adds bounded memory recall for fresh human input and injects that recall into the next prompt as `INPUT_RECALL`.

### How It Is Implemented

Core files:

- `src/memory.metta`
- `src/helper_recall.py`
- `src/loop.metta`
- `tests/test_input_context.py`
- `docs/reference-internals-memory-store.md`

The loop now receives first, detects fresh input, computes input recall, and then builds context.

### Why It Was Needed

The original loop built the prompt before receive. That meant the context could not naturally include memory relevant to the fresh message. Omega could feel forgetful because the LLM was answering without enough explicit memory retrieval.

### What Is Right

- Recall only runs for fresh input.
- It is bounded.
- The prompt explicitly says automatic recall is a hint, not the full memory check.
- The agent is still expected to call `query` deliberately when memory matters.

### What Is Wrong Or Still Fragile

- Embedding recall can be noisy or incomplete.
- It can create a false sense of having checked memory if the prompt discipline is ignored.
- It is not semantic proof; it is retrieval context.

### Confidence

Medium-high. The loop ordering and bounds are tested. The retrieval quality depends on embedding data and deployment memory quality.

## 8. Improvement 5: Explicit Module Loader Boundary

Commit: `ad8792c Add explicit module loader boundary`

### What It Does

It creates a single explicit enablement point for optional modules: `modules/loader.metta`. Installed module folders do not become active simply by existing.

### How It Is Implemented

Core files:

- `modules/loader.metta`
- parser/catalog declaration path loading in `src/helper_command_parser.py`
- module tests such as `tests/test_agentverse_module.py`

A module contributes signatures, catalog/help, affordances, and skills only when its `entry.metta` is imported by the loader.

### Why It Was Needed

Live deployments naturally accumulate local organs. A clean core cannot let installed-but-disabled experiments leak into parser-visible or context-visible skill surfaces.

### What Is Right

- Optionality is explicit.
- Module docs/cards/signatures live near module code.
- Parser and catalog loading respect the same boundary.
- Default-off modules can be reviewed separately.

### What Is Wrong Or Still Fragile

- The loader is simple; dependency ordering and module conflicts are still manual.
- There is not yet a full package manager or capability negotiation system.

### Confidence

High for default-off behavior. Medium for future complex module ecosystems.

## 9. Improvement 6: Core Skill Help And Help Fallback

Commits: `5a61208 Complete core skill affordance help surface`, `8d73bef Improve skill help fallback`

### What It Does

It makes core skills more self-describing and makes `skill-help` fall back to cards and args when direct help is sparse.

### How It Is Implemented

Core files:

- `src/skill_catalog*.metta`
- `src/skill_affordance*.metta`
- `src/skill_catalog.metta`
- `tests/test_skill_affordance_contract.py`

`getFullSkills` reads `SkillCatalog`. `getSkills` reads only `SkillContextHint`. `skill-help` can return help lines, cards, and args.

### Why It Was Needed

A symbolic agent should be able to inspect its own tool manual. If a command fails or a user asks for a capability, Omega should have an internal path to discover the answer.

### What Is Right

- The help surface is inspectable.
- It does not require Python routing.
- It gives the parser recovery path something useful to point toward.

### What Is Wrong Or Still Fragile

- Help text can go stale if not tested.
- Cards are compact, so they cannot replace real docs.
- The distinction among `getSkills`, `getFullSkills`, `skill-help`, and `skill-card` must be understood.

### Confidence

High for current core. Medium for future modules unless module authors follow the same discipline.

## 10. Improvement 7: Input-Aware Symbolic Skill Recall

Commit: `9ff3d0e Add input-aware symbolic skill recall`

### What It Does

It adds a fresh-input path from factual text signals to skill-card recall. This produces `SKILL_RECALL` context.

### How It Is Implemented

Core files:

- `src/helper_skill_recall.py`
- `src/skills_affordance.metta`
- `src/loop.metta`
- `tests/test_input_context.py`

Python extracts shallow factual signals only:

- `has-question`
- `has-url`
- `has-code-shape`
- `has-file-reference`
- `mentions-word:<token>`

MeTTa then matches those signals against `SkillTrigger` atoms and returns matching `SkillCardLine`s as `SkillRecall` atoms.

### Why It Was Needed

Omega should not need every skill in the prompt all the time. But when fresh input mentions a relevant signal, a compact skill card can be surfaced.

### What Is Right

- Python does not choose skills.
- Trigger matching is symbolic.
- Cards are compact and traceable.
- It reduces pressure to bloat always-on `SKILLS` context.

### What Is Wrong Or Still Fragile

- Signal extraction is shallow by design.
- Trigger quality matters.
- It can miss relevant skills if no signal/trigger exists.
- It can surface a plausible card without guaranteeing the skill is the right action.

### Confidence

Medium-high. The mechanism is clean. Coverage depends on trigger curation.

## 11. Improvement 8: Bounded Context And Continuity Affordances

Commit: `7634e98 Add bounded context and continuity affordances`

### What It Does

It adds context compaction for bulky payloads and strengthens `pin` as the volatile continuity skill.

### How It Is Implemented

Core files:

- `src/helper_metta.py`
- `src/skill_context*.metta` declarations where applicable
- `src/skill_catalog_core.metta`
- `src/skill_affordance_core.metta`
- `tests/test_memory_runtime.py`
- `tests/bench_context_compaction.py`

Context compaction is metadata-driven:

```metta
(SkillContextView "write-file" "compact-payload")
(SkillContextPolicy "write-file" "compact-threshold" 900)
```

A large payload becomes a mechanical placeholder in the LLM-facing history view, while raw history remains exact.

`pin` is advertised as a one-line volatile continuity vector:

```text
MODE | primary: agenda/<goal> -> next | meta: beliefs/<self-belief> or persistent/<self-model> -> practice | secondary: ... | open-loop: ... | constraint: ... | wake/check: ...
```

### Why It Was Needed

Large artifacts were consuming context. Also, continuous agents need a small working-state vector across waits, sleeps, reboots, and task switches.

### What Is Right

- Raw history is preserved.
- Compaction is mechanical, not semantic summarization.
- Context size drops dramatically in benchmark.
- `pin` is explicitly volatile, not durable memory.

### What Is Wrong Or Still Fragile

- Compaction policies must be declared for each bulky skill surface.
- The agent can still misuse `pin` as diary if prompt discipline fails.
- Mechanical omission helps context size but does not solve all memory summarization needs.

### Confidence

High for write/file payload compaction and pin availability. Medium for long-term agent discipline around pin usage.

## 12. Improvement 9: Canonical Web Search

Commit: `ddac831 Make web-search the canonical core web surface`

### What It Does

It makes `web-search` the canonical live web skill. `search` remains as a legacy alias.

### How It Is Implemented

Core files:

- `src/channels.metta`
- `src/skill_signatures_core.metta`
- `src/skill_catalog_core.metta`
- `src/skill_affordance_core.metta`
- `docs/reference-skills-communication.md`
- `Autotests/test_search*.py`

The core runtime has:

```metta
(= (web-search $msg) ...)
(= (search $msg) (web-search $msg))
```

### Why It Was Needed

The live environment had confusion around Tavily and older remote-agent search surfaces. Core needs one generic live web affordance. Specific providers or remote search agents belong behind adapters or optional modules.

### What Is Right

- Canonical command is generic.
- Legacy alias avoids breaking older behavior.
- Tests now accept canonical `web-search` and legacy `search`.
- No hardcoded Tavily skill remains in core signatures.

### What Is Wrong Or Still Fragile

- The lower websearch backend still depends on configured channel adapter behavior.
- Old habits may persist in prompts or user expectations.
- The alias means the surface is not perfectly minimal.

### Confidence

High for command surface cleanup. Medium for live search quality because it depends on backend configuration.

## 13. Improvement 10: Portable Prompt Memory Discipline

Commit: `7248182 Tighten portable prompt memory discipline`

### What It Does

It strengthens the core prompt around memory behavior without including private deployment facts.

### How It Is Implemented

Core file:

- `memory/prompt.txt`

Tests:

- `tests/test_input_context.py`

The prompt now emphasizes that fresh human messages are open conversations and that automatic `INPUT_RECALL` is a hint, not a replacement for deliberate `query` when memory matters.

### Why It Was Needed

Live Omega could appear forgetful if it relied only on rolling history or automatic recall. The prompt needed to reinforce memory checking as a behavior, not a hidden automatic guarantee.

### What Is Right

- Portable; no private names.
- Aligns with persistent-agent expectations.
- Reinforces explicit `query` and reply-debt handling.

### What Is Wrong Or Still Fragile

- Prompt discipline is weaker than a formal policy.
- The agent can still skip memory checks under pressure.
- Stronger symbolic policies may be needed later.

### Confidence

Medium. The prompt is correct, but behavior still depends on provider compliance and loop context.

## 14. Improvement 11: PLN/NAL Reasoning Affordances

Commit: `bb00640 Guide PLN reasoning through explicit affordances`

### What It Does

It clarifies how to use `pln-step` and `nal-step`, especially the difference between NAL copulas and truth-valued PLN statements.

### How It Is Implemented

Core files:

- `src/skill_affordance_reasoning.metta`
- `src/skill_catalog_reasoning.metta`
- `docs/reference-skills-reasoning.md`
- `tests/test_skill_affordance_contract.py`

`pln-step` docs now point to truth-valued premises such as:

```metta
((Inheritance A B) (stv f c))
```

### Why It Was Needed

Omega was trying bare `Inheritance` atoms and expecting PLN transitivity to fire. The issue was not necessarily that PLN was broken; the surface was under-described.

### What Is Right

- The representational contract is clearer.
- Cards help avoid mixing NAL and PLN syntax.
- It discourages fake unsupported `PLN.Query` habits.

### What Is Wrong Or Still Fragile

- `pln-step` is still narrow.
- It is not a full theorem-proving planner.
- The reasoning stack still needs broader demonstrations and tests.

### Confidence

Medium. The guidance is correct and useful, but the reasoning affordance itself remains limited.

## 15. Improvement 12: Portable Energy Loop Self-Regulation

Commit: `3e4ab5a Add portable energy loop self-regulation`

### What It Does

It changes loop defaults and exposes energy/runtime posture so the agent can operate more sanely out of the box.

### How It Is Implemented

Core files:

- `src/loop.metta`
- `src/energy.py`
- `src/skills_energy.metta`
- `src/skill_catalog_energy.metta`
- `src/skill_affordance_energy.metta`
- `tests/test_energy.py`
- `tests/test_input_context.py`

Notable loop changes compared with original:

- `maxNewInputLoops` from 50 to 12.
- `maxWakeLoops` from 1 to 6.
- `sleepInterval` from 1 to 3.
- provider/model defaults removed from loop.
- warm autonomous wake posture added.

### Why It Was Needed

The original loop posture was too deployment-shaped and high-churn for a portable default. A persistent agent needs bounded autonomy and sane idle behavior.

### What Is Right

- Removes hardcoded provider/model defaults from the loop.
- Makes runtime posture inspectable.
- Reduces runaway loop tendency.
- Keeps warm wake behavior.

### What Is Wrong Or Still Fragile

- The numbers are still heuristic defaults.
- Full ECAN/attention-driven energy management is not implemented.
- Different deployments may need different profiles.

### Confidence

Medium-high as a portable default. Medium as a long-term cognitive energy model.

## 16. Improvement 13: Documentation Alignment And Runtime Ignore Rules

Commits: `1023a3b Align presentation docs with core runtime readiness`, `fdf829a Ignore generated runtime memory files`, `debf2fe Document out-of-box readiness checks`

### What It Does

It updates documentation, changelog, testing/benchmark docs, review notes, and ignore rules so the repo presents the new architecture coherently and does not accidentally commit generated runtime memory files.

### How It Is Implemented

Core files:

- `CHANGELOG.md`
- `docs/README.md`
- `docs/reference-testing-benchmarks.md`
- `docs/review/out-of-box-principles-check.md`
- `.gitignore`

### Why It Was Needed

A private review branch without docs is not reviewable. Also, runtime memory files should not drift into Git just because the agent ran.

### What Is Right

- Review path is explicit.
- Test/benchmark commands are recorded.
- Known cautions are written down.
- Runtime memory generation is safer.

### What Is Wrong Or Still Fragile

- Docs can lag code if not kept in test discipline.
- The benchmark numbers are local VM numbers, not universal claims.
- Documentation still assumes reviewer comfort with MeTTa/OmegaClaw concepts.

### Confidence

High that docs now represent the branch. Medium that future docs stay synchronized without continued tests/review.

## 17. Improvement 14: Optional Agentverse Module

Commit: `3adbf1a Add optional Agentverse listener module`

### What It Does

It adds Agentverse/uAgents as an optional default-off remote-agent organ. It supports discovery, registration, listener status/start/stop, async calls, inbox inspection, and trace.

### How It Is Implemented

Core files:

- `modules/agentverse/module.toml`
- `modules/agentverse/entry.metta`
- `modules/agentverse/skills.metta`
- `modules/agentverse/signatures.metta`
- `modules/agentverse/catalog.metta`
- `modules/agentverse/affordance.metta`
- `modules/agentverse/src/agentverse_bridge.py`
- `modules/agentverse/src/agentverse_listener.py`
- `tests/test_agentverse_module.py`

The module is enabled only if its `entry.metta` is imported from `modules/loader.metta`. In the private repo it is default-off.

### Why It Was Needed

The live system had remote-agent needs, but old Agentverse code was too close to core and had proof-of-concept hardcoded surfaces. The right shape is optional module, not built-in cognition.

### What Is Right

- Default-off.
- Self-contained signatures, cards, docs, and bridge.
- Missing `uagents` reports status instead of breaking boot.
- Async AgentChatProtocol path was tested live with a real remote word-counter agent.
- Old Tavily/technical-analysis hardcoded surfaces were removed.

### What Is Wrong Or Still Fragile

- Requires external Agentverse/uAgents dependencies.
- End-to-end behavior depends on public endpoint/mailbox configuration.
- Discovery quality depends on external registry state.
- The module is young compared with core memory/syntax pieces.

### Confidence

Medium-high for module boundary and local tests. Medium for broad real-world remote-agent reliability because it depends on external infrastructure.

## 18. Improvement 15: Core Out-Of-Box Repair Affordances

Commit: `fc656b0 Finish core out-of-box repair affordances`

### What It Does

It adds the final practical repair affordances that made live Omega behave better:

- `SignatureRecoveryHint` declarations,
- skill-card hints inside syntax errors,
- `space-merge-atoms`,
- `persistent-merge-atoms`,
- clearer PLN docs/cards,
- stale docs/test cleanup.

### How It Is Implemented

Core files:

- `src/helper_command_parser.py`
- `src/skill_signatures.metta`
- `src/skills_space_mutation.metta`
- `src/skill_affordance_memory.metta`
- `src/skill_catalog_memory.metta`
- `tests/test_syntax_smoke_corpus.py`
- `tests/test_skill_affordance_contract.py`
- `tests/space_merge_atoms_smoke.metta`

### Why It Was Needed

This addresses the last mile of out-of-box behavior. It is not enough for the agent to have skills; it needs to recover from bad command shapes, clean symbolic memory, and understand reasoning affordances.

### What Is Right

- Recovery hints are metadata, not hidden policy.
- Merge skills are explicit symbolic mutations with traces and reasons.
- Smoke test proves merge behavior in an isolated temporary space.
- PLN guidance is grounded in actual expected premise shapes.

### What Is Wrong Or Still Fragile

- Recovery hints can become stale if cards/signatures drift.
- Merge skills are powerful; the agent must inspect before mutating.
- This is still not a full memory maintenance planner.

### Confidence

High for the implemented mechanics. Medium for autonomous long-term memory hygiene, because that requires good agent judgment and future attention mechanisms.

## 19. Current Test And Benchmark Results

The branch records this in `docs/reference-testing-benchmarks.md`.

Latest local suite:

- Core unit suite: 54 tests passed.
- `space_merge_atoms_smoke.metta`: passed.
- Parser benchmark: 45,000 parses; signature parser 12.38 us/parse; legacy/current path 14.79 us/parse; declaration reload 408.58 us/load; 100 loaded signatures.
- Context compaction benchmark: raw 27,428 chars to view 161 chars; raw history preserved; payload omitted from view; thought atom visible.

These numbers are local VM numbers. They are useful for regression shape, not universal performance claims.

## 20. Overall Confidence Assessment

My confidence levels by layer:

- Typed syntax membrane: high.
- Runtime memory/context boundary: high.
- Symbolic skill affordance directory: high for mechanics, medium for long-term ontology quality.
- Input-aware memory recall: medium-high.
- Input-aware skill recall: medium-high for mechanism, medium for trigger coverage.
- Module loader boundary: high for default-off behavior.
- Context compaction: high for mechanical payload compaction.
- Pin continuity: high for availability, medium for agent discipline.
- Web-search surface cleanup: high for command surface, medium for backend quality.
- PLN/NAL affordance guidance: medium.
- Energy loop defaults: medium-high as portable defaults, medium as cognitive energy theory.
- Agentverse module: medium-high for boundary/local tests, medium for external reliability.
- Documentation/readiness sweep: high for current branch, medium for future drift.

Overall branch confidence: medium-high.

I would be comfortable presenting this as a private core readiness candidate. I would not present it as a complete cognitive architecture solution. It is a strong substrate cleanup that makes the system more inspectable, safer at the LLM/action boundary, more memory-aware, and more modular.

## 21. What Is Explicitly Not Included

The branch intentionally excludes:

- private live logs/history,
- live endpoint URLs,
- live webhost proxy configuration,
- private secrets,
- WhatsApp channel experiments,
- Home Assistant body-app experiment,
- deployment-specific website/webhost files.

In the working VM there may be untracked local files for WhatsApp and Home Assistant. They are not part of this branch head and should not be reviewed as committed core.

## 22. Recommended Review Procedure For Cassio

1. Read `CHANGELOG.md`.
2. Read `docs/review/out-of-box-principles-check.md`.
3. Read this walkthrough.
4. Run the core unit suite in `docs/reference-testing-benchmarks.md`.
5. Run parser and context benchmarks.
6. Inspect `src/helper_command_parser.py` for hidden cognition.
7. Inspect `src/skills_affordance.metta` and `src/helper_skill_recall.py` for hidden routing.
8. Inspect `src/helper_metta.py` for raw-history preservation.
9. Inspect `src/skills_space_mutation.metta` for explicit mutation semantics.
10. Inspect `modules/loader.metta` and `modules/agentverse/` for optional-module boundary discipline.
11. Search for deployment leakage.
12. Decide which patches should be upstreamed individually.

Useful searches:

```bash
grep -RInE "secret|password|token|private endpoint|live endpoint" README.md CHANGELOG.md docs src tests modules/agentverse Autotests

grep -RInE "tavily|Tavily|agentverse_organ|src/agentverse.py" README.md CHANGELOG.md docs src tests modules/agentverse Autotests

grep -RInE "SkillContextHint|SkillTrigger|SkillCardLine|SkillSignature|SignatureRecoveryHint" src modules/agentverse docs tests
```

## 23. Bottom Line

This branch turns OmegaClaw Core from a compact but fragile loop into a more explicit cognitive substrate. The added systems are not decorative; each addresses a concrete live failure mode:

- syntax fragility,
- memory/context bloat,
- weak skill discovery,
- forgetfulness under fresh input,
- optional module leakage,
- remote-agent hardcoding,
- web-search confusion,
- PLN/NAL misuse,
- continuity loss,
- runtime memory noise.

The right thing about the branch is that most of these fixes are represented as MeTTa declarations, symbolic spaces, or narrow membranes rather than hidden Python cognition.

The wrong thing, or at least the caution, is that the branch is now more complex. The burden is to keep that complexity principled: parser as parser, memory as memory, skills as symbolic affordances, modules as optional organs, remote services as extensions, and LLMs as providers.

If Cassio wants to stress-test one thesis, it should be this:

Did the branch preserve OmegaClaw's identity as a MeTTa/AtomSpace cognitive substrate while making it practical enough to work out of the box?

My assessment is yes, with medium-high confidence and with the cautions above clearly visible.
