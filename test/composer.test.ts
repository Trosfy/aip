import { expect, test } from "bun:test";

import { PromptComposer } from "../src/composer.ts";
import type { ContextProvider } from "../src/context.ts";

class Stub implements ContextProvider {
  constructor(private readonly out: string[]) {}
  lines(): string[] {
    return this.out;
  }
}

test("compose appends an environment section", () => {
  const out = new PromptComposer([new Stub(["- a: 1", "- b: 2"])]).compose("BASE");
  expect(out.startsWith("BASE")).toBe(true);
  expect(out).toContain("# Environment");
  expect(out).toContain("- a: 1");
  expect(out.endsWith("\n")).toBe(true);
});

test("compose preserves provider order", () => {
  const out = new PromptComposer([new Stub(["- first"]), new Stub(["- second"])]).compose("X");
  expect(out.indexOf("- first")).toBeLessThan(out.indexOf("- second"));
});

test("compose inserts modules between base and environment, in order", () => {
  const out = new PromptComposer([new Stub(["- env"])]).compose("BASE", ["# Harness A", "# Harness B"]);
  expect(out.indexOf("BASE")).toBeLessThan(out.indexOf("# Harness A"));
  expect(out.indexOf("# Harness A")).toBeLessThan(out.indexOf("# Harness B"));
  expect(out.indexOf("# Harness B")).toBeLessThan(out.indexOf("# Environment"));
});

test("compose without modules is unchanged", () => {
  const out = new PromptComposer([new Stub(["- env"])]).compose("BASE");
  expect(out).toBe("BASE\n\n# Environment\n- env\n");
});
