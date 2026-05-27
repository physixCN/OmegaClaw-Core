# Tutorial 04 - Adding A Channel

Goal: add a communication surface as a proper OmegaClaw module.

## 1. Create The Module Directory

Use this shape:

```text
modules/channel_example/
  entry.metta
  module.toml
  signatures.metta
  catalog.metta
  affordance.metta
  skills.metta
  src/example.py
```

## 2. Declare The Symbolic Contract

`entry.metta` should declare the module, channel, provided skills, risks/effects, runtime config, and trace events. Example atoms:

```metta
(Module omegaclaw.channel.example)
(ModuleKind omegaclaw.channel.example channel)
(Channel example)
(Provides omegaclaw.channel.example (Channel example))
(Provides omegaclaw.channel.example (Skill send-example))
(TraceWrites omegaclaw.channel.example ExampleMessageSent)
(TraceWrites omegaclaw.channel.example ExampleMessageReceived)
```

## 3. Keep Python As Transport

The Python file may poll, send, parse transport payloads, and append traces. It should not decide goals, infer meaning, choose personality, or hide routing policy.

## 4. Add Skills And Cards

Expose command syntax in `signatures.metta`, implementation in `skills.metta`, and help/trigger lines in `catalog.metta` and `affordance.metta`.

## 5. Enable Deliberately

Set `default_enabled = true` only when the channel is part of the out-of-box surface. Otherwise leave it optional and import it only in a deployment-specific loader.
