import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PersonaNotFound, PersonaRepository } from "../src/persona.ts";

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

test("get returns persona with prompt and description", () => {
  const root = makeRoot();
  writePersona(root, "demo", "HELLO", "a demo");
  const persona = new PersonaRepository([root]).get("demo");
  expect(persona.name).toBe("demo");
  expect(persona.systemPrompt()).toBe("HELLO");
  expect(persona.description).toBe("a demo");
});

test("unknown persona throws", () => {
  const root = makeRoot();
  expect(() => new PersonaRepository([root]).get("nope")).toThrow(PersonaNotFound);
});

test("rejects names with path separators or traversal", () => {
  const repo = new PersonaRepository([makeRoot()]);
  expect(() => repo.get("../escape")).toThrow(PersonaNotFound);
  expect(() => repo.get("a/b")).toThrow(PersonaNotFound);
  expect(() => repo.get("..")).toThrow(PersonaNotFound);
});

test("first root wins", () => {
  const a = makeRoot();
  const b = makeRoot();
  writePersona(a, "demo", "A");
  writePersona(b, "demo", "B");
  expect(new PersonaRepository([a, b]).get("demo").systemPrompt()).toBe("A");
});

test("all lists personas across roots", () => {
  const a = makeRoot();
  const b = makeRoot();
  writePersona(a, "one");
  writePersona(b, "two");
  const names = new PersonaRepository([a, b]).all().map((p) => p.name).sort();
  expect(names).toEqual(["one", "two"]);
});
