import { readFileSync, statSync } from "node:fs";

import {
  DEFAULT_MODELS,
  isGroupOrWorldAccessible,
  resolveConfig,
  readSparkEnv,
  seedSparkHome,
  uninstallSpark,
  writeModelsCache,
  writeSparkEnv,
} from "./config.ts";
import { banner, buildSparkEnv, normalizeBaseUrl } from "./env.ts";
import { probeFleet } from "./probe.ts";

export function reservedVerb(argv: string[]): "install" | "uninstall" | null {
  const first = argv.find((arg) => !arg.startsWith("-"));
  if (first === "install" || first === "uninstall") return first;
  return null;
}

interface InstallArgs {
  nonFlags: string[];
  url?: string;
  model?: string;
  harness?: string;
  tokenFile?: string;
  skipProbe: boolean;
  root: boolean;
  badToken: boolean;
}

function parseInstallArgs(argv: string[]): InstallArgs {
  const args: InstallArgs = { nonFlags: [], skipProbe: false, root: false, badToken: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case "--url":
        args.url = value();
        break;
      case "--model":
        args.model = value();
        break;
      case "--harness":
        args.harness = value();
        break;
      case "--token-file":
        args.tokenFile = value();
        break;
      case "--skip-probe":
      case "--force":
        args.skipProbe = true;
        break;
      case "--root":
        args.root = true;
        break;
      case "--token":
        args.badToken = true;
        if (inline === undefined) i++;
        break;
      default:
        if (!arg.startsWith("-")) args.nonFlags.push(arg);
    }
  }
  return args;
}

function assertPrivateFile(path: string): void {
  if (isGroupOrWorldAccessible(path)) {
    const mode = (statSync(path).mode & 0o777).toString(8);
    throw new Error(`token file ${path} is group/world-accessible (mode ${mode}) — chmod 600 it first`);
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const ETX = String.fromCharCode(3); // Ctrl-C
const DEL = String.fromCharCode(127); // backspace
const BS = String.fromCharCode(8); // backspace

function promptNoEcho(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (data: Buffer) => {
      for (const ch of data.toString("utf8")) {
        if (ch === "\n" || ch === "\r") {
          stdin.off("data", onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stderr.write("\n");
          resolve(buffer);
          return;
        }
        if (ch === ETX) process.exit(130);
        else if (ch === DEL || ch === BS) buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

// Token entry without leaking into shell history or `ps`: --token-file (perms-checked),
// piped stdin, or a no-echo interactive prompt. An empty interactive entry means "keep
// the existing token" so a --model/--url-only re-run does not force re-entry.
// There is deliberately NO `--token <value>` flag.
async function readToken(tokenFile?: string): Promise<{ token: string; keep: boolean }> {
  if (tokenFile) {
    assertPrivateFile(tokenFile);
    return { token: readFileSync(tokenFile, "utf8").trim(), keep: false };
  }
  if (!process.stdin.isTTY) {
    return { token: (await readAllStdin()).trim(), keep: false };
  }
  const entered = (
    await promptNoEcho("Paste the LiteLLM virtual key (blank = keep existing): ")
  ).trim();
  return entered === "" ? { token: "", keep: true } : { token: entered, keep: false };
}

const INSTALL_USAGE =
  "usage: aip install spark [--url <https://host:port>] [--model <id>] [--harness claude] [--token-file <path>] [--skip-probe]";

export async function runInstall(argv: string[]): Promise<number> {
  const args = parseInstallArgs(argv);

  if (args.root) {
    console.error("aip: --root is not valid for `install`");
    return 2;
  }
  if (args.badToken) {
    console.error(
      "aip: refusing `--token <value>` — it lands in shell history and `ps`; use --token-file, a pipe, or the prompt",
    );
    return 2;
  }
  const target = args.nonFlags[1];
  if (!target) {
    console.error(INSTALL_USAGE);
    return 2;
  }
  if (target !== "spark") {
    console.error(`aip: unknown install target '${target}'`);
    console.error(INSTALL_USAGE);
    return 2;
  }

  const harness = args.harness ?? "claude";
  if (harness !== "claude") {
    console.error(
      `aip: harness '${harness}' is not supported in this build — only 'claude' (opencode ships later)`,
    );
    return 2;
  }

  const existing = readSparkEnv() ?? {};
  const baseUrl = args.url ? normalizeBaseUrl(args.url) : existing.SPARK_BASE_URL;
  if (!baseUrl) {
    console.error("aip: missing fleet URL — pass --url <https://host:port>");
    return 2;
  }

  const { token, keep } = await readToken(args.tokenFile);
  const resolvedToken = keep ? existing.SPARK_TOKEN ?? "" : token;
  if (!resolvedToken) {
    console.error("aip: no token provided and none on file");
    return 2;
  }

  // Validate the model the launch will actually use — args.model when given, else the
  // existing or default SPARK_MODEL — so a default seat the fleet doesn't serve is caught
  // now with the available-list diagnostic, not as a first-launch 404.
  const resolvedModel = args.model ?? existing.SPARK_MODEL ?? DEFAULT_MODELS.SPARK_MODEL;
  if (!args.skipProbe) {
    const probe = await probeFleet(baseUrl, resolvedToken, { expectModel: resolvedModel });
    if (!probe.ok) {
      console.error(`aip: ${probe.diagnostic?.message} (use --skip-probe to write config offline)`);
      return 1;
    }
    writeModelsCache(probe.models);
  } else {
    console.error("aip: --skip-probe — writing config without verifying fleet connectivity");
  }

  const updates: Record<string, string> = {
    SPARK_BASE_URL: baseUrl,
    SPARK_TOKEN: resolvedToken,
    SPARK_HARNESS: harness,
  };
  if (args.model) updates.SPARK_MODEL = args.model;
  for (const [key, value] of Object.entries(DEFAULT_MODELS)) {
    if (!existing[key] && !updates[key]) updates[key] = value;
  }

  const { warnedPerms, merged } = writeSparkEnv(updates, existing);
  if (warnedPerms) {
    console.error("aip: previous spark.env was group/world-readable — re-secured to 600");
  }
  seedSparkHome();

  const cfg = resolveConfig(merged);
  console.error(banner(buildSparkEnv(process.env, cfg), cfg.harness));
  console.error("");
  console.error("Use a per-consumer LiteLLM VIRTUAL key (scoped + revocable via /key/generate),");
  console.error("never the gateway master key — one leaked laptop config must not compromise the fleet.");
  console.error("");
  console.error("Run a fleet-backed session with: aip spark");
  return 0;
}

export function runUninstall(argv: string[]): number {
  // Reuse the install subparser so all --root detection shares one mechanism (and does
  // not spuriously match `--root` appearing as a flag value).
  const args = parseInstallArgs(argv);
  if (args.root) {
    console.error("aip: --root is not valid for `uninstall`");
    return 2;
  }
  const target = args.nonFlags[1];
  if (target && target !== "spark") {
    console.error(`aip: unknown uninstall target '${target}'`);
    return 2;
  }

  const { removed } = uninstallSpark();
  if (removed.length === 0) {
    console.log("aip: nothing to uninstall — spark is not installed");
    return 0;
  }
  console.log("aip: uninstalled spark — removed:");
  for (const path of removed) console.log(`  ${path}`);
  return 0;
}
