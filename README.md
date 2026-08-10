# aip — Add-In Prompt

![aip — Add-In Prompt](assets/banner.png)

Aftermarket system prompts for AI coding agents. Like an NVIDIA **AIB** (Add-In Board) partner building a card on a reference GPU, an **AIP** is an *Add-In Prompt*: a third-party persona bolted onto a base model.

The first persona, `notus` (the storm-bringing south wind of the Anemoi), is an extreme-density persona: every response is routed through a classification layer into a selective, artifact, or agentic mode — maximum information per token, achieved by selection rather than fragment-compression. It is also delegation-first: search, browsing, and codebase exploration go to sub-agents that return conclusions, keeping the orchestrator's context for decisions. Run it through Claude Code (the default) or Codex, with client-specific tool mechanics layered onto the same persona.

## Scope

A prompt recovers a model's **working style**, not its **capability tier**. Style lives in instructions; capability lives in the weights. `aip` does the first and is honest about the second.

## Security

A persona's `system.md` becomes the client's replacement model instructions — arbitrary, fully-privileged instructions. Claude can also run it as root under `--root`; Codex deliberately rejects AIP's `--root` and retains its own sandbox and approval controls. **Only install personas you trust.** See [SECURITY.md](SECURITY.md).

## Install

### From a release (no Bun required)

Download the binary for your platform from [Releases](https://github.com/Trosfy/aip/releases/latest):

```sh
curl -fsSL -o aip https://github.com/Trosfy/aip/releases/latest/download/aip-linux-arm64
chmod +x aip && ./aip --list
```

Targets: `aip-linux-x64`, `aip-linux-arm64`, `aip-darwin-x64`, `aip-darwin-arm64`.

### From source (Bun)

```sh
bun install
bun link            # exposes the `aip` command on your PATH
```

## Use

```sh
aip notus                  # launch the agent with the notus persona
aip notus --client codex   # launch Codex with notus + the Codex harness
aip notus --root           # launch as root (sudo -E), restoring ownership on exit
aip notus --model opus     # unknown flags pass straight through to the agent
aip notus --harness claude # append a specific harness module (overrides the persona default)
aip notus --no-harness     # persona prompt only, no harness module
aip notus --client codex -- exec "fix the failing test"  # Codex subcommand passthrough
aip --list                 # list installed personas
```

`aip` composes the persona's `system.md`, an optional harness module, and a live environment block (cwd, platform, datetime, git). Claude receives the rendered file through `--system-prompt-file`; Codex receives it through `model_instructions_file`. Native project instructions, permissions, skills/plugins, memory, and custom agents still load through the selected client.

## Adding a persona

A persona is a directory with a required `system.md` and an optional `meta.json`:

```
~/.config/aip/personas/<name>/
  system.md     # persona prompt: style, modes, conduct (harness-agnostic)
  meta.json     # optional:  { "description": "...", "harness": "claude" }
```

Drop it in `~/.config/aip/personas/` and `aip <name>` finds it — no code, no rebuild. User personas take precedence over bundled ones.

Bundled personas (shipped inside the binary, like `notus`) live in `src/personas/<name>/` and are registered with a one-line `import` in `src/bundled.ts`, so `bun build --compile` embeds them.

## Harness modules

Tool mechanics live in a separate, persona-agnostic layer so the same persona works across agents. A harness module is a single markdown file appended after the persona prompt:

```
~/.config/aip/harnesses/<name>.md   # user modules (shadow bundled ones)
src/harnesses/<name>.md             # bundled modules (claude, codex)
```

Selection precedence: `--no-harness` disables modules; otherwise an explicit
`--harness <name>` > an explicit same-name `--client <name>` > the persona's
`meta.json` `"harness"` > none. Final prompt = persona `system.md` + harness
module + `# Environment`.

When `--client <name>` is explicit and `--harness` is omitted, the same-name
harness is selected. This makes `aip notus --client codex` choose the bundled
Codex mechanics even though Notus defaults to Claude. An explicit `--harness`
still wins; `--no-harness` still disables modules.

## Client adapters

`--client claude` is the backward-compatible default. `--client codex` launches
the real Codex executable (or `AIP_CODEX_BIN` when set), preserving its normal
`CODEX_HOME`, authentication, plugins, project instructions, sandbox, and
approval policy. All arguments after `--` pass to that client unchanged.

Codex receives the rendered prompt with:

```text
codex -c model_instructions_file="<rendered-prompt>" ...
```

The config override is inserted before passthrough subcommands such as `exec`
or `review`. AIP never maps `--root` to Codex danger-full-access; select Codex
permissions explicitly with its own flags.

## Layout

```
src/
  cli.ts        composition root — parse args, wire the pieces, run
  persona.ts    PersonaRepository + PersonaSource (FilesystemSource / BundledSource)
  harness.ts    HarnessRepository + HarnessSource — appendable tool-mechanics modules
  bundled.ts    personas + harness modules embedded into the compiled binary
  composer.ts   PromptComposer — base prompt + modules + context sections
  context.ts    ContextProvider + WorkingDirectory / System / Clock / Git
  runner.ts     Claude and Codex runners + Claude RootSudoRunner
  personas/     bundled persona data
  harnesses/    bundled harness modules
test/
```

The extension points are the interfaces: add a `PersonaSource`, a `ContextProvider`, a `Runner`, or a persona directory — each without touching the others.

## CI/CD

- **`ci`** — push and pull request to `main`: `bun install`, typecheck, and `bun test`.
- **`release`** — [release-please](https://github.com/googleapis/release-please-action) on `main` maintains a release PR from [Conventional Commits](https://www.conventionalcommits.org/); merging it tags the version and creates the GitHub Release, then a `binaries` job compiles standalone executables (linux/macOS × x64/arm64) and uploads them to that release.

## Test

```sh
bun test
```
