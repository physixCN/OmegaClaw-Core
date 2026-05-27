# Body Container (POC)

body_container is the grounded symbolic handle for the runtime body that the
agent is running inside. It is not a second agent and it does not call an LLM. A
deployment launcher may write a small host descriptor, and then the agent can
observe that descriptor from inside the runtime.

The intent is recursive embodiment without doubled cognition cost:

- host runner starts the body
- VM hosts the runtime
- MeTTa atoms represent that body
- skills observe the body and its launcher grounding

Skills:

- body-container-status
- body-container-self
- body-container-launcher
- body-container-last-trace

Status: POC / optional. Deployment-specific identifiers, launcher names, and
process patterns must be supplied through `OMEGACLAW_BODY_CONTAINER_CONFIG` or
ignored runtime state; they are not part of the shareable repository.
