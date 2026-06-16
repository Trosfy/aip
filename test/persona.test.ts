import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BundledSource,
  FilesystemSource,
  type Persona,
  PersonaNotFound,
  PersonaRepository,
} from "../src/persona.ts";

function makeRoot(): string {
  const root = join(tmpdir(), `aip-test-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writePersona(root: string, name: string, system = "PROMPT", description?: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "system.md"), system, "utf8");
  if (description !== undefined) {
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ description }), "utf8");
  }
}

function bundled(name: string, prompt: string, description = ""): Persona {
  return { name, description, systemPrompt: () => prompt };
}

function fsRepo(...roots: string[]): PersonaRepository {
  return new PersonaRepository([new FilesystemSource(roots)]);
}

test("filesystem source resolves prompt and description", () => {
  const root = makeRoot();
  writePersona(root, "demo", "HELLO", "a demo");
  const persona = fsRepo(root).get("demo");
  expect(persona.name).toBe("demo");
  expect(persona.systemPrompt()).toBe("HELLO");
  expect(persona.description).toBe("a demo");
});

test("bundled source resolves", () => {
  const repo = new PersonaRepository([new BundledSource([bundled("fable-5", "S", "d")])]);
  expect(repo.get("fable-5").systemPrompt()).toBe("S");
});

test("unknown persona throws", () => {
  expect(() => fsRepo(makeRoot()).get("nope")).toThrow(PersonaNotFound);
});

test("rejects names with path separators or traversal", () => {
  const repo = fsRepo(makeRoot());
  expect(() => repo.get("../escape")).toThrow(PersonaNotFound);
  expect(() => repo.get("a/b")).toThrow(PersonaNotFound);
  expect(() => repo.get("..")).toThrow(PersonaNotFound);
});

test("earlier source wins (user overrides bundled)", () => {
  const root = makeRoot();
  writePersona(root, "fable-5", "USER OVERRIDE");
  const repo = new PersonaRepository([
    new FilesystemSource([root]),
    new BundledSource([bundled("fable-5", "BUNDLED")]),
  ]);
  expect(repo.get("fable-5").systemPrompt()).toBe("USER OVERRIDE");
});

test("all merges and de-duplicates across sources", () => {
  const root = makeRoot();
  writePersona(root, "one");
  const repo = new PersonaRepository([
    new FilesystemSource([root]),
    new BundledSource([bundled("one", "x"), bundled("two", "y")]),
  ]);
  expect(repo.all().map((p) => p.name).sort()).toEqual(["one", "two"]);
});
