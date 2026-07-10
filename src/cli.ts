#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import { BUNDLED, BUNDLED_HARNESSES } from "./bundled.ts";
import { PromptComposer } from "./composer.ts";
import { defaultProviders } from "./context.ts";
import {
  BundledHarnessSource,
  FilesystemHarnessSource,
  HarnessNotFound,
  HarnessRepository,
  defaultHarnessRoot,
} from "./harness.ts";
import {
  BundledSource,
  FilesystemSource,
  PersonaNotFound,
  PersonaRepository,
  defaultUserRoot,
} from "./persona.ts";
import { PlainRunner, RootSudoRunner, type Runner } from "./runner.ts";
import { reservedVerb, runInstall, runUninstall } from "./spark/install.ts";
import { runSparkBackend } from "./spark/launch.ts";

// `spark` is a reserved backend name bound to the bundled persona at the launcher,
// not resolved through the (shadowable) persona repository.
const SPARK_PERSONA = "spark";

interface Args {
  persona?: string;
  list: boolean;
  root: boolean;
  harness?: string;
  noHarness: boolean;
  passthrough: string[];
}

function parse(argv: string[]): Args {
  const args: Args = { list: false, root: false, noHarness: false, passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--list") args.list = true;
    else if (arg === "--root") args.root = true;
    else if (arg === "--no-harness") args.noHarness = true;
    else if (arg === "--harness") args.harness = argv[++i] ?? "";
    else if (args.persona === undefined && !arg.startsWith("-")) args.persona = arg;
    else args.passthrough.push(arg);
  }
  return args;
}

function repository(): PersonaRepository {
  return new PersonaRepository([
    new FilesystemSource([defaultUserRoot()]),
    new BundledSource(BUNDLED),
  ]);
}

function harnesses(): HarnessRepository {
  return new HarnessRepository([
    new FilesystemHarnessSource([defaultHarnessRoot()]),
    new BundledHarnessSource(BUNDLED_HARNESSES),
  ]);
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

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);

  // Reserved verbs checked on the FIRST non-flag token, before persona dispatch, each
  // with its own subparser so their flags never leak to claude.
  const verb = reservedVerb(argv);
  if (verb === "install") return runInstall(argv);
  if (verb === "uninstall") return runUninstall(argv);

  const args = parse(argv);
  if (args.harness === "") {
    console.error("aip: --harness requires a name");
    return 2;
  }
  const repo = repository();

  if (args.list) {
    printPersonas(repo);
    return 0;
  }
  if (!args.persona) {
    console.error("usage: aip <persona> [--root] [--harness <name> | --no-harness] [agent args...]");
    printPersonas(repo, true);
    return 2;
  }

  if (args.persona === SPARK_PERSONA) {
    if (args.harness !== undefined || args.noHarness) {
      console.error("aip: --harness/--no-harness are ignored for spark (set via `aip install spark --harness`)");
    }
    return runSparkBackend(args.passthrough, { root: args.root, claudeBin: claudeBinary() });
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

  // Harness module resolution: explicit flag > persona default > none (self-contained persona).
  const harnessName = args.noHarness ? undefined : (args.harness ?? persona.harness);
  const modules: string[] = [];
  if (harnessName) {
    try {
      modules.push(harnesses().get(harnessName).prompt());
    } catch (error) {
      if (error instanceof HarnessNotFound) {
        console.error(`aip: unknown harness '${harnessName}'`);
        const known = harnesses().all();
        if (known.length > 0) console.error(`known harnesses: ${known.map((h) => h.name).join(", ")}`);
        return 1;
      }
      throw error;
    }
  }

  const prompt = new PromptComposer(defaultProviders()).compose(persona.systemPrompt(), modules);
  const rendered = render(persona.name, prompt);
  return buildRunner(args.root, claudeBinary()).run(rendered, args.passthrough);
}

process.exit(await main());
