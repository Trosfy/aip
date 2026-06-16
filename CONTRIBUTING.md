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

A persona is a directory with a required `system.md` and an optional `meta.json`. Add a bundled one under `src/personas/<name>/`, or a local one under `~/.config/aip/personas/<name>/`. See the README.

## Architecture

Extension points are the interfaces in `src/`: a `ContextProvider` for new environment data, a `Runner` for a new launch strategy, or a persona directory for new behavior — each without touching the others. `cli.ts` is the only place they are wired together.

## Security

Personas are arbitrary, fully-privileged instructions. See [SECURITY.md](SECURITY.md); please report vulnerabilities privately rather than in public issues.
