#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import { PromptComposer } from "./composer.ts";
import { defaultProviders } from "./context.ts";
import { PersonaNotFound, PersonaRepository, defaultRoots } from "./persona.ts";
import { PlainRunner, RootSudoRunner, type Runner } from "./runner.ts";

interface Args {
  persona?: string;
  list: boolean;
  root: boolean;
  passthrough: string[];
}

function parse(argv: string[]): Args {
  const args: Args = { list: false, root: false, passthrough: [] };
  for (const arg of argv) {
    if (arg === "--list") args.list = true;
    else if (arg === "--root") args.root = true;
    else if (args.persona === undefined && !arg.startsWith("-")) args.persona = arg;
    else args.passthrough.push(arg);
  }
  return args;
}

function claudeBinary(): string {
  return Bun.which("claude") ?? join(homedir(), ".local", "bin", "claude");
}

function render(personaName: string, prompt: string): string {
  const cache = join(homedir(), ".cache", "aip");
  mkdirSync(cache, { recursive: true });
  const path = join(cache, `${personaName}.rendered.md`);
  writeFileSync(path, prompt, "utf8");
  return path;
}

function buildRunner(useRoot: boolean, claudeBin: string): Runner {
  if (!useRoot) return new PlainRunner(claudeBin);
  const home = homedir();
  const restore = [join(home, ".claude"), join(home, ".claude.json"), join(home, ".npm")];
  return new RootSudoRunner(claudeBin, userInfo().username, restore);
}

function printPersonas(repo: PersonaRepository, toErr = false): void {
  const write = toErr ? console.error : console.log;
  const personas = repo.all();
  if (personas.length === 0) {
    write("(no personas found)");
    return;
  }
  const width = Math.max(...personas.map((p) => p.name.length));
  for (const persona of personas) {
    write(persona.description ? `${persona.name.padEnd(width)}  ${persona.description}` : persona.name);
  }
}

function main(): number {
  const args = parse(Bun.argv.slice(2));
  const repo = new PersonaRepository(defaultRoots());

  if (args.list) {
    printPersonas(repo);
    return 0;
  }
  if (!args.persona) {
    console.error("usage: aip <persona> [--root] [agent args...]");
    printPersonas(repo, true);
    return 2;
  }

  let persona;
  try {
    persona = repo.get(args.persona);
  } catch (error) {
    if (error instanceof PersonaNotFound) {
      console.error(`aip: unknown persona '${args.persona}'`);
      printPersonas(repo, true);
      return 1;
    }
    throw error;
  }

  const prompt = new PromptComposer(defaultProviders()).compose(persona.systemPrompt());
  const rendered = render(persona.name, prompt);
  return buildRunner(args.root, claudeBinary()).run(rendered, args.passthrough);
}

process.exit(main());
