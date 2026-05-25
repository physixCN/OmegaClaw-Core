# Reference — Python and Prolog Bridges

MeTTa handles reasoning and control flow; bridges handle everything that needs a library ecosystem.

## `lib_llm_ext.py`

LLM and embedding bridges.

| Function | Purpose |
|---|---|
| `callProvider(provider, prompt, max_tokens)` | Registry-backed provider dispatcher used by the loop for non-OpenAI providers. |
| `_register_provider(...)` / `_register_provider_instance(...)` | Add provider adapters without adding new branches to the loop. |
| `useClaude(prompt)`, `useMiniMax(prompt)`, `useAsi1(prompt)` | Legacy compatibility wrappers for older provider-specific routing. |
| `useLocalEmbedding(str)` | Compute an embedding with a locally loaded model. Used when `embeddingprovider = Local`. |
| `initLocalEmbedding()` | Load the local embedding model once at startup. |

OpenAI calls go through MeTTa-side helpers (`useGPT`, `useGPTEmbedding`) that are defined elsewhere in the library but use the same LLM call pattern.

## `modules/agentverse/src/agentverse_organ.py`

Optional Agentverse/uAgents remote-agent transport membrane.
This module is not present in every checkout and is not part of the default core
skill surface. When installed, it should expose its own MeTTa signatures,
catalog/help, affordance cards, and trace policy.

`src/agentverse.py` is a compatibility shim for old deployments. Do not assume
hardcoded remote skills exist unless their module is installed and loaded.

## `src/helper.py`

String and time utilities used by the loop.

| Function | Purpose |
|---|---|
| `signature_balance_parentheses(str)` | Canonical syntax command membrane. Reads MeTTa `SkillSignature` declarations, lowers friendly command text into safe MeTTa skill calls, and fails closed with `wait`/`syntax-error`. |
| `balance_parentheses(str)` | Compatibility wrapper for `signature_balance_parentheses`. |
| `normalize_string(obj)` | Render a skill return value into a string safe to embed in the next prompt. |
| `around_time(ts, n)` | Backs `(episodes ts)` — returns `n` lines of `memory/history.metta` around `ts`. |

## `src/skills.pl`

Prolog helpers imported via `import_prolog_functions_from_file`.

| Predicate | Purpose |
|---|---|
| `shell/2` | Run a shell command and capture stdout. Rejects apostrophes. |
| `first_char/2` | Return the first character of a string — used by the loop to detect whether the LLM produced a valid s-expression. |

## Calling conventions

- MeTTa to Python: `(py-call (module.function arg1 arg2 ...))`.
- MeTTa to Prolog: `(translatePredicate (predicate ...))` for side-effecting predicates, or `!(import_prolog_function name)` to lift a Prolog function into MeTTa.

## See also

- [reference-internals-loop.md](./reference-internals-loop.md) — where these bridges are invoked.
- [reference-internals-extension-points.md](./reference-internals-extension-points.md) — where to add new bridges.
