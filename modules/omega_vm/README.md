# Tiny VM Module (POC)

This module gives the agent a tiny ephemeral Linux workspace-device.

Status: POC / optional. It is not default-enabled for out-of-box operation
until the QEMU dependency path, resource boundaries, and command safety model
have had more review.

The VM is represented symbolically as MeTTa atoms and executed through a QEMU
membrane. The agent can inspect the module, decide whether to use it, run a
bounded command, and receive a traced result.

The VM is deliberately not the mind. It is closer to a little workbench or
device the agent can use.

Provided skills:

- `vm-status`
- `vm-boot`
- `vm-shell command`
- `vm-last-trace`

Runtime shape:

```text
Agent / MeTTa atom
  -> omega-vm module membrane
  -> QEMU aarch64
  -> host ARM kernel + tiny BusyBox initramfs
  -> command result and trace
```

Default safety:

- no network device
- no disk image
- generated initramfs only
- bounded command timeout
- trace written to ignored runtime memory
