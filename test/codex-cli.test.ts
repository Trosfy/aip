import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { BUNDLED_HARNESSES } from "../src/bundled.ts";
import { parse, resolveHarnessName } from "../src/cli.ts";
import { BundledHarnessSource, HarnessRepository } from "../src/harness.ts";

const projectRoot = join(import.meta.dir, "..");
const cliPath = join(projectRoot, "src", "cli.ts");

function runCli(args: string[]): { exitCode: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ["run", cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return { exitCode: result.status, stderr: result.stderr };
}

test("parse consumes --client before -- and passes every argument after -- through verbatim", () => {
  const args = parse([
    "notus",
    "--client",
    "codex",
    "--",
    "exec",
    "--client",
    "claude",
    "request with spaces",
  ]);

  expect(args.persona).toBe("notus");
  expect(args.client).toBe("codex");
  expect(args.passthrough).toEqual([
    "exec",
    "--client",
    "claude",
    "request with spaces",
  ]);
});

test("resolveHarnessName applies no-harness, explicit harness, client, then persona precedence", () => {
  expect(
    resolveHarnessName(
      parse(["notus", "--client", "codex", "--harness", "custom", "--no-harness"]),
      "persona-default",
    ),
  ).toBeUndefined();
  expect(
    resolveHarnessName(
      parse(["notus", "--client", "codex", "--harness", "custom"]),
      "persona-default",
    ),
  ).toBe("custom");
  expect(resolveHarnessName(parse(["notus", "--client", "codex"]), "persona-default")).toBe(
    "codex",
  );
  expect(resolveHarnessName(parse(["notus"]), "persona-default")).toBe("persona-default");
  expect(resolveHarnessName(parse(["notus"]))).toBeUndefined();
});

test("main rejects --root for the Codex client", () => {
  const result = runCli(["notus", "--client", "codex", "--root"]);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("--root is not supported for the Codex client");
});

test("main rejects an unknown client", () => {
  const result = runCli(["notus", "--client", "other"]);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("unknown client 'other'");
});

test("main rejects --client without a value", () => {
  const result = runCli(["notus", "--client"]);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("--client requires a name");
});

test("the bundled harness repository provides the Codex harness", () => {
  const repository = new HarnessRepository([new BundledHarnessSource(BUNDLED_HARNESSES)]);
  const harness = repository.get("codex");

  expect(harness.name).toBe("codex");
  expect(harness.prompt()).toStartWith("# Harness — Codex");
  expect(harness.prompt()).toContain("AGENTS.md");
});
