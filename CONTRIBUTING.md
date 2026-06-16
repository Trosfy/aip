# Contributing

Thanks for your interest in `aip`.

## Workflow

- `main` is protected: all changes land through a pull request, and CI must pass before merge.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Releases are automated by release-please from these messages, so the prefix determines the version bump.

## Development

```sh
bun install
bun run typecheck
bun test
```

## Adding a persona

User personas are drop-in: a directory with `system.md` (and optional `meta.json`) under `~/.config/aip/personas/<name>/`. No code change.

A *bundled* persona (shipped inside the compiled binary) lives in `src/personas/<name>/` and is registered with a one-line `import … with { type: "text" }` in `src/bundled.ts`, so `bun build --compile` embeds it.

## Architecture

Extension points are the interfaces in `src/`: a `PersonaSource` for where personas come from, a `ContextProvider` for new environment data, or a `Runner` for a new launch strategy — each without touching the others. `cli.ts` is the only place they are wired together.

## Releases & binaries

Releases are automated by release-please from Conventional Commits. When a release PR merges, the `binaries` job in `release.yml` compiles `aip` for linux and macOS (x64/arm64) and uploads the executables to the GitHub Release.

## Security

Personas are arbitrary, fully-privileged instructions. See [SECURITY.md](SECURITY.md); please report vulnerabilities privately rather than in public issues.
