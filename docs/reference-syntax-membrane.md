# Reference - Syntax Command Membrane

The syntax command membrane sits between the LLM response and MeTTa `sread`.
It is not a reasoning layer and it is not a skill router. Its job is narrow:
turn the text produced by a cognition provider into a small tuple of typed,
safe MeTTa skill calls, or return an explicit non-action/error atom.

This membrane exists because persistent agent runtimes ask language models to
speak a precise command language while preserving the architectural rule that
the LLM is not the agent. The agent substrate still owns memory, spaces,
skills, reasoning, identity, and action. The syntax membrane only protects the
mouth/hand boundary.

## Canonical Declarations

The command surface is declared in MeTTa-shaped files, not in Python tables:

- `src/skill_signatures*.metta`
- `modules/<enabled-module>/signatures.metta`
- `src/skill_catalog*.metta`
- `modules/<enabled-module>/catalog.metta`

Examples:

```metta
(SignatureSpace persistent)
(SkillSignature send (Arg rest-text message))
(SkillSignature space-find (Arg space space) (Arg metta pattern))
(SignatureLowering write-file write-file-base64)
(SignatureRecoveryHint missing-argument "recover: check required args with skill-card or explain-skill")
```

Modules are enabled by `modules/loader.metta`. A module contributes signatures
and catalog entries only when the loader imports its `entry.metta` file. Merely
placing a folder under `modules/` is not enough.

Python reads these atoms and performs typed lowering. Malformed, duplicate, or unknown declaration shapes fail fast instead of being silently skipped. Adding a new skill should normally mean adding a neighboring `SkillSignature`, runtime implementation, and catalog/help atom. It should not require editing the parser.

## Argument Types

The current membrane understands these argument types:

| Type | Meaning |
|---|---|
| `rest-text` | Consume the rest of the command as text. Newlines are collapsed unless a base64 lowering is declared. |
| `optional-rest-text` | Optional trailing text. |
| `text`, `jid`, `filepath` | One token or one quoted token. Execution layers still enforce path/channel safety. |
| `number`, `optional-number` | Numeric value only. Words such as `high` intentionally fail. |
| `base64` | Base64-ish payload token. Used by byte-preserving lowerings. |
| `space` | A declared `SignatureSpace`. |
| `metta` | One complete balanced MeTTa expression, syntax-checked before dispatch. |
| `pipe-spec`, `pipe-fields` | Pipe-delimited structured specs with fixed arity. |
| `multiline` | Text body, usually lowered to base64. |
| `shell-command` | Shell text passed to the shell skill boundary. |

## Lowering

Some human-friendly commands lower to safer internal commands before `sread`:

```text
write-file memory/page.html "<h1>Home: ok</h1>"
```

becomes:

```metta
((write-file-base64 "memory/page.html" "PGgxPkhvbWU6IG9rPC9oMT4="))
```

The same pattern is used for channel sends that need colons, quotes, Unicode, or
multiline text preserved. The lowered call is still just a MeTTa skill call.

## Generalisation Boundaries

The parser should not know a runtime instance's active skill list. Commands,
spaces, catalog text, and base64 lowerings come from declarations. Multiline
lowering follows the declared signature, so a future channel or organ can
preserve text without parser edits.

A few constants are intentional membrane vocabulary rather than hidden cognition:

- argument type names such as `text`, `number`, `space`, and `metta`
- declaration file naming and deterministic load order
- small no-action heads that normalize silence into explicit `wait`
- legacy shorthand handling for historically fragile commands such as `space-transform`

If a future change adds a skill name, space name, model name, person name, room name, or domain policy to Python parser logic, treat that as a regression. It belongs in MeTTa declarations, runtime skills, memory, or the relevant execution membrane.

## Recovery Hints

`SignatureRecoveryHint` declarations are compact repair cues for parser error classes such as `missing-argument`, `unexpected-trailing`, `unknown-space`, `metta-syntax`, `invalid-number`, and `pipe-shape`. The parser may also attach the first `SkillCardLine` for the failing command. This is reinforcement for the next cognitive cycle, not hidden routing: the hint is declared in MeTTa-shaped metadata and appears in the normal command-result trace.

Example shape:

```metta
(syntax-error "beliefs-about" "missing relation; card: beliefs-about domain relation - inspect exact belief relation; recover: check required args with skill-card or explain-skill" "beliefs-about Anna")
```

## Failure Behavior

The membrane fails closed:

- Unknown command head -> `(wait "ignored unknown command head ...")`
- Known command with bad arguments -> `(syntax-error "head" "reason plus declared recovery hint" "raw")`
- Prose/no-action phrases such as `No tool calls needed` -> `(wait "...")`
- Malformed nested MeTTa arguments -> `(syntax-error ...)`

It must not invent skills, execute prose, silently coerce non-numeric confidence
words, or turn malformed symbolic writes into memory atoms.

## Trace Expectations

Raw model output is still recorded by the loop/history path. The membrane output
is the dispatch form, not the sole truth record. This matters for AGI research:
if a provider hallucinates a bad command, the original text should remain
inspectable while the dispatch layer prevents accidental action.

## Extension Contract

To add a skill or organ:

1. Add a runtime implementation, usually in `src/skills_*.metta` or
   `modules/<name>/skills.metta`.
2. Add `(SkillSignature ...)` declarations beside that organ.
3. Add `(SkillCatalog ...)` / `(SkillHelp ...)` entries beside that organ, plus `SkillContextHint` only for minimal always-on bootstrap text.
4. If it is a module, import `modules/<name>/entry.metta` from `modules/loader.metta`.
5. Add smoke tests for the expected command shapes.
6. Keep execution safety at the execution boundary, not in parser heuristics.

The membrane should remain boring, deterministic, and cheap. Cognition belongs
in symbolic spaces, memory, reasoning, and skills; this layer only keeps command
syntax clean enough for those systems to work.
