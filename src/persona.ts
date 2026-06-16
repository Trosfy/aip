import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const VALID_NAME = /^[A-Za-z0-9._-]+$/;

export class PersonaNotFound extends Error {}

export interface Persona {
  name: string;
  description: string;
  systemPrompt(): string;
}

export interface PersonaSource {
  get(name: string): Persona | null;
  all(): Persona[];
}

export class FilesystemSource implements PersonaSource {
  constructor(private readonly roots: string[]) {}

  get(name: string): Persona | null {
    for (const root of this.roots) {
      const persona = load(join(root, name));
      if (persona) return persona;
    }
    return null;
  }

  all(): Persona[] {
    const out: Persona[] = [];
    for (const root of this.roots) {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue;
      for (const entry of readdirSync(root).sort()) {
        const persona = load(join(root, entry));
        if (persona) out.push(persona);
      }
    }
    return out;
  }
}

export class BundledSource implements PersonaSource {
  constructor(private readonly personas: Persona[]) {}

  get(name: string): Persona | null {
    return this.personas.find((persona) => persona.name === name) ?? null;
  }

  all(): Persona[] {
    return [...this.personas];
  }
}

export class PersonaRepository {
  constructor(private readonly sources: PersonaSource[]) {}

  get(name: string): Persona {
    if (!VALID_NAME.test(name)) throw new PersonaNotFound(name);
    for (const source of this.sources) {
      const persona = source.get(name);
      if (persona) return persona;
    }
    throw new PersonaNotFound(name);
  }

  all(): Persona[] {
    const found = new Map<string, Persona>();
    for (const source of this.sources) {
      for (const persona of source.all()) {
        if (!found.has(persona.name)) found.set(persona.name, persona);
      }
    }
    return [...found.values()];
  }
}

function load(dir: string): Persona | null {
  const systemPath = join(dir, "system.md");
  if (!existsSync(systemPath) || !statSync(systemPath).isFile()) return null;
  return {
    name: basename(dir),
    description: readDescription(join(dir, "meta.json")),
    systemPrompt: () => readFileSync(systemPath, "utf8"),
  };
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

export function defaultUserRoot(): string {
  return join(homedir(), ".config", "aip", "personas");
}
