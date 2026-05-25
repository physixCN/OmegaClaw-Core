# Tutorial 06 — Remote Agentverse Skills

**Goal:** understand how OmegaClaw can delegate work to optional remote agents
without making remote services look like built-in cognition.

Core OmegaClaw should work without remote Agentverse skills. For live web
research, use the core `web-search` skill. Remote agents are optional extension
organs: useful when installed, but not assumed by the default runtime.

## Why Remote Agents Are Optional

A remote agent crosses a network boundary, depends on another service, and may
have a different failure mode than local MeTTa/Python skills. Treat it as an
installed organ with an explicit contract, not as hidden cognition.

Good remote-agent modules expose:

- MeTTa skill signatures
- catalog/help text
- symbolic affordance cards
- request and response schemas
- local traces for calls and failures
- a clear unavailable/offline result

## Core Web Search

For ordinary current or external facts, use:

```metta
(web-search "OpenCog Hyperon")
```

Legacy `(search "query")` delegates to `web-search`, but new docs and prompts
should prefer the canonical name.

## Adding A Remote Skill

1. Pick or implement the remote service.
2. Add a local bridge function or module-local transport wrapper.
3. Expose a MeTTa skill in the module.
4. Add signatures, catalog/help, and affordance atoms.
5. Return a visible error/status when the remote service is unavailable.
6. Keep durable conclusions in normal memory only after the agent reviews them.

Example shape:

```metta
(= (my-remote-skill $arg)
   (py-call (my_remote_bridge.call $arg)))
```

## Limits

Remote-agent output quality depends on the remote service. The local agent must
still reason over results, check provenance, and store only compact conclusions
that are worth remembering.

## See Also

- [reference-skills-remote-agents.md](./reference-skills-remote-agents.md)
- [reference-python-bridges.md](./reference-python-bridges.md)
