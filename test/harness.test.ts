import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BundledHarnessSource,
  FilesystemHarnessSource,
  type Harness,
  HarnessNotFound,
  HarnessRepository,
} from "../src/harness.ts";

function makeRoot(): string {
  const root = join(tmpdir(), `aip-harness-test-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeHarness(root: string, name: string, prompt = "HARNESS"): void {
  writeFileSync(join(root, `${name}.md`), prompt, "utf8");
}

function bundled(name: string, prompt: string): Harness {
  return { name, prompt: () => prompt };
}

function fsRepo(root: string): HarnessRepository {
  return new HarnessRepository([new FilesystemHarnessSource([root])]);
}

test("filesystem source resolves <root>/<name>.md", () => {
  const root = makeRoot();
  writeHarness(root, "claude", "TOOLS");
  const harness = fsRepo(root).get("claude");
  expect(harness.name).toBe("claude");
  expect(harness.prompt()).toBe("TOOLS");
});

test("bundled source resolves", () => {
  const repo = new HarnessRepository([new BundledHarnessSource([bundled("claude", "H")])]);
  expect(repo.get("claude").prompt()).toBe("H");
});

test("unknown harness throws", () => {
  expect(() => fsRepo(makeRoot()).get("nope")).toThrow(HarnessNotFound);
});

test("rejects names with path separators or traversal", () => {
  const repo = fsRepo(makeRoot());
  expect(() => repo.get("../escape")).toThrow(HarnessNotFound);
  expect(() => repo.get("a/b")).toThrow(HarnessNotFound);
  expect(() => repo.get("..")).toThrow(HarnessNotFound);
});

test("earlier source wins (user overrides bundled)", () => {
  const root = makeRoot();
  writeHarness(root, "claude", "USER OVERRIDE");
  const repo = new HarnessRepository([
    new FilesystemHarnessSource([root]),
    new BundledHarnessSource([bundled("claude", "BUNDLED")]),
  ]);
  expect(repo.get("claude").prompt()).toBe("USER OVERRIDE");
});

test("all merges and de-duplicates across sources", () => {
  const root = makeRoot();
  writeHarness(root, "claude", "USER");
  const repo = new HarnessRepository([
    new FilesystemHarnessSource([root]),
    new BundledHarnessSource([bundled("claude", "BUNDLED"), bundled("opencode", "OC")]),
  ]);
  const names = repo.all().map((h) => h.name);
  expect(names).toContain("claude");
  expect(names).toContain("opencode");
  expect(repo.all().find((h) => h.name === "claude")?.prompt()).toBe("USER");
});

test("all ignores non-md entries", () => {
  const root = makeRoot();
  writeHarness(root, "claude");
  mkdirSync(join(root, "not-a-harness"), { recursive: true });
  writeFileSync(join(root, "README.txt"), "ignore me", "utf8");
  expect(fsRepo(root).all().map((h) => h.name)).toEqual(["claude"]);
});
