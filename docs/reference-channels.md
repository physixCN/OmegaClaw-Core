# Reference - Channels

Channels are optional modules that expose communication surfaces through symbolic skills and trace declarations. In v0.01a, channel source lives under `modules/channel_*`; legacy root `channels/` adapters are not part of the shareable core.

## Module Shape

A channel module provides:

- `entry.metta` for symbolic module, channel, skill, risk, and trace atoms.
- `module.toml` for package metadata and runtime-secret declarations.
- `signatures.metta`, `catalog.metta`, `affordance.metta`, and `skills.metta` for the visible skill surface.
- `src/` only for transport IO: polling, sending, bridge calls, and trace writes.

## Included Channels

- `modules/channel_router` - primary operator routing and channel dispatch.
- `modules/channel_whatsapp` - WhatsApp bridge, quoted replies, reactions, edits/deletes, read state, and append-only message trace.
- `modules/channel_telegram` - Telegram Bot API adapter.
- `modules/channel_mattermost` - Mattermost bot adapter.
- `modules/channel_web_control` - local operator-control queue/channel.
- `modules/channel_irc`, `modules/channel_slack`, and `modules/channel_mock` - optional modules, not enabled by default in v0.01a.

## Adding A Channel

Create a new `modules/channel_name/` package using the module contract. Do not add new root-level channel adapters. The MeTTa entrypoint should declare `(Channel name)`, provided skills, runtime dependencies, runtime-secret config, and trace events. Python should only perform transport IO and trace writes.
