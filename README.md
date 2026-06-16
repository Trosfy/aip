# aip — Add-In Prompt

Aftermarket system prompts for AI coding agents. Like an NVIDIA **AIB** (Add-In Board) partner building a card on a reference GPU, an **AIP** is an *Add-In Prompt*: a third-party persona bolted onto a base model.

The first persona, `fable-5`, recovers the working style of the (suspended) Fable 5 — result-first, low-narration — on top of Opus 4.8 in Claude Code.

## Scope

A prompt recovers a model's **working style**, not its **capability tier**. Style lives in instructions; capability lives in the weights. `aip` does the first and is honest about the second.

## Security

A persona's `system.md` becomes the agent's *entire* system prompt — arbitrary, fully-privileged instructions, and run as root under `--root`. **Only install personas you trust.** See [SECURITY.md](SECURITY.md).

## Install (Bun)

```sh
bun install
bun link            # exposes the `aip` command on your PATH
```

## Use

```sh
aip fable-5                 # launch the agent with the fable-5 persona
aip fable-5 --root         # launch as root (sudo -E), restoring ownership on exit
aip fable-5 --model opus   # unknown flags pass straight through to the agent
aip --list                 # list installed personas
```

`aip` composes the persona's `system.md` with a live environment block (cwd, platform, datetime, git) and launches via `--system-prompt-file`. Your `CLAUDE.md`, memory, agents, and skills still load on their own.

## Adding a persona

A persona is a directory with a required `system.md` and an optional `meta.json`:

```
~/.config/aip/personas/<name>/
  system.md     # complete, self-contained prompt (full replace; no baseline)
  meta.json     # optional:  { "description": "..." }
```

Drop it in and `aip <name>` finds it — no code changes. User personas in `~/.config/aip/personas` take precedence over the bundled defaults.

## Layout

```
src/
  cli.ts        composition root — parse args, wire the pieces, run
  persona.ts    PersonaRepository + Persona — discovery across roots
  composer.ts   PromptComposer — base prompt + context sections
  context.ts    ContextProvider + WorkingDirectory / System / Clock / Git
  runner.ts     Runner + PlainRunner / RootSudoRunner
  personas/     bundled personas (data)
test/
```

The extension points are the interfaces: add a `ContextProvider` for new environment data, a `Runner` for a new launch strategy, or a persona directory for new behavior — each without touching the others.

## CI/CD

- **`ci`** runs on every push and pull request to `main`: `bun install`, typecheck, and `bun test`.
- **`release`** runs [release-please](https://github.com/googleapis/release-please-action) on push to `main`. It maintains a release PR from your [Conventional Commits](https://www.conventionalcommits.org/); merging that PR tags the version and creates the GitHub Release.

## Test

```sh
bun test
```
