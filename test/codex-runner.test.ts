import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodexRunner } from "../src/runner.ts";

const temporaryRoots: string[] = [];

function makeStub(exitCode = 0): { capturePath: string; executablePath: string; env: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), "aip-codex-runner-test-"));
  temporaryRoots.push(root);

  const capturePath = join(root, "argv.txt");
  const executablePath = join(root, "stub codex");
  writeFileSync(
    executablePath,
    `#!/bin/sh
: > "$AIP_TEST_CAPTURE"
for aip_test_arg in "$@"; do
  printf '%s\\n' "$aip_test_arg" >> "$AIP_TEST_CAPTURE"
done
exit "$AIP_TEST_EXIT"
`,
    { mode: 0o755 },
  );

  return {
    capturePath,
    executablePath,
    env: {
      AIP_TEST_CAPTURE: capturePath,
      AIP_TEST_EXIT: String(exitCode),
    },
  };
}

function capturedArgv(capturePath: string): string[] {
  const captured = readFileSync(capturePath, "utf8");
  return captured === "" ? [] : captured.slice(0, -1).split("\n");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("CodexRunner passes the instruction config first and preserves quoted paths as one argv item", () => {
  const stub = makeStub();
  const promptPath = join(
    tmpdir(),
    "aip prompt directory",
    'notus "quoted" \\ instructions.md',
  );

  const status = new CodexRunner(stub.executablePath).run(
    promptPath,
    ["exec", "--sandbox", "read-only", "request with spaces"],
    stub.env,
  );

  expect(status).toBe(0);
  expect(capturedArgv(stub.capturePath)).toEqual([
    "-c",
    `model_instructions_file=${JSON.stringify(promptPath)}`,
    "exec",
    "--sandbox",
    "read-only",
    "request with spaces",
  ]);
});

test("CodexRunner propagates the Codex process exit status", () => {
  const stub = makeStub(23);

  const status = new CodexRunner(stub.executablePath).run(
    "/tmp/notus.rendered.md",
    [],
    stub.env,
  );

  expect(status).toBe(23);
});
