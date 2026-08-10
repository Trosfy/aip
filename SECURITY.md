# Security

## Trust model

`aip` loads a persona's `system.md` as replacement model instructions for a coding agent that can read and write files and run shell commands. Claude can also run it as root with your config via `--root`; the Codex client rejects AIP's `--root` and keeps Codex's native sandbox and approval policy. A persona is therefore arbitrary, privileged instructions even without operating-system root.

**Only install personas you have read and trust.** Treat a third-party `system.md` the way you would a shell script you are about to run as yourself (or as root): review it before placing it under `~/.config/aip/personas/`.

`aip` does not sandbox the agent. It composes a prompt and launches the agent you already have installed; it adds no isolation of its own.

## Reporting a vulnerability

For a vulnerability in `aip` itself (not in a third-party persona), please open a private security advisory on the repository rather than a public issue.
