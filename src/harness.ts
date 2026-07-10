import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const VALID_NAME = /^[A-Za-z0-9._-]+$/;

export class HarnessNotFound extends Error {}

export interface Harness {
  name: string;
  prompt(): string;
}

export interface HarnessSource {
  get(name: string): Harness | null;
  all(): Harness[];
}

export class FilesystemHarnessSource implements HarnessSource {
  constructor(private readonly roots: string[]) {}

  get(name: string): Harness | null {
    for (const root of this.roots) {
      const harness = load(join(root, `${name}.md`));
      if (harness) return harness;
    }
    return null;
  }

  all(): Harness[] {
    const out: Harness[] = [];
    for (const root of this.roots) {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue;
      for (const entry of readdirSync(root).sort()) {
        if (!entry.endsWith(".md")) continue;
        const harness = load(join(root, entry));
        if (harness) out.push(harness);
      }
    }
    return out;
  }
}

export class BundledHarnessSource implements HarnessSource {
  constructor(private readonly harnesses: Harness[]) {}

  get(name: string): Harness | null {
    return this.harnesses.find((harness) => harness.name === name) ?? null;
  }

  all(): Harness[] {
    return [...this.harnesses];
  }
}

export class HarnessRepository {
  constructor(private readonly sources: HarnessSource[]) {}

  get(name: string): Harness {
    if (!VALID_NAME.test(name)) throw new HarnessNotFound(name);
    for (const source of this.sources) {
      const harness = source.get(name);
      if (harness) return harness;
    }
    throw new HarnessNotFound(name);
  }

  all(): Harness[] {
    const found = new Map<string, Harness>();
    for (const source of this.sources) {
      for (const harness of source.all()) {
        if (!found.has(harness.name)) found.set(harness.name, harness);
      }
    }
    return [...found.values()];
  }
}

function load(path: string): Harness | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return {
    name: basename(path, ".md"),
    prompt: () => readFileSync(path, "utf8"),
  };
}

export function defaultHarnessRoot(): string {
  return join(homedir(), ".config", "aip", "harnesses");
}
