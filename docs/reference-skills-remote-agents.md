# Reference — Remote Agent Skills

Remote agents are optional extension organs, not core cognition and not part of
the default command surface.

Out of the box, live web research is the core `web-search` skill documented in
[reference-skills-communication.md](./reference-skills-communication.md). Use
that for current or external facts unless an optional remote-agent module is
installed and discoverable.

## Default Core Surface

No named remote-agent domain skill is guaranteed by core. In particular, do not
assume a hardcoded search or market-analysis command exists just because an old
deployment had a bridge for it.

```metta
(web-search "OpenCog Hyperon")
```

## Optional Remote Agents

If a deployment installs a remote-agent module, the module should expose its own
MeTTa signatures, catalog/help entries, affordance cards, and trace policy. The
agent should discover or inspect that surface before calling it.

A remote-agent module should make these boundaries explicit:

- network dependency
- remote address or discovery mechanism
- request/response schema
- runtime traces
- failure behavior when the remote service is absent

## Adding Your Own

See [tutorial-06-remote-agentverse-skills.md](./tutorial-06-remote-agentverse-skills.md) for the pattern, and [reference-python-bridges.md](./reference-python-bridges.md) for bridge conventions.
