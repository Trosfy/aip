import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const VALID_NAME = /^[A-Za-z0-9._-]+$/;

export class PersonaNotFound extends Error {}

export interface Persona {
  name: string;
  systemPath: string;
  description: string;
  systemPrompt(): string;
}

export class PersonaRepository {
  constructor(private readonly roots: string[]) {}

  get(name: string): Persona {
    if (!VALID_NAME.test(name)) throw new PersonaNotFound(name);
    for (const root of this.roots) {
      const persona = this.load(join(root, name));
      if (persona) return persona;
    }
    throw new PersonaNotFound(name);
  }

  all(): Persona[] {
    const found = new Map<string, Persona>();
    for (const root of this.roots) {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue;
      for (const entry of readdirSync(root).sort()) {
        const persona = this.load(join(root, entry));
        if (persona && !found.has(persona.name)) found.set(persona.name, persona);
      }
    }
    return [...found.values()];
  }

  private load(dir: string): Persona | null {
    const systemPath = join(dir, "system.md");
    if (!existsSync(systemPath) || !statSync(systemPath).isFile()) return null;
    return {
      name: basename(dir),
      systemPath,
      description: readDescription(join(dir, "meta.json")),
      systemPrompt: () => readFileSync(systemPath, "utf8"),
    };
  }
}

function readDescription(metaPath: string): string {
  if (!existsSync(metaPath)) return "";
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { description?: unknown };
    return typeof meta.description === "string" ? meta.description : "";
  } catch {
    return "";
  }
}

export function defaultRoots(): string[] {
  const userDir = join(homedir(), ".config", "aip", "personas");
  const bundled = join(import.meta.dir, "personas");
  return [userDir, bundled];
}
