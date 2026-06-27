import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PromptComposer } from "../composer.ts";
import { defaultProviders } from "../context.ts";
import { PlainRunner } from "../runner.ts";
import {
  aipCacheDir,
  aipConfigDir,
  readModelsCache,
  renderedPromptPath,
  requireSparkConfig,
  seedSparkHome,
  SparkNotInstalled,
  writeModelsCache,
  type SparkConfig,
} from "./config.ts";
import { banner, buildSparkEnv, normalizeBaseUrl, refuseReason } from "./env.ts";
import { probeFleet } from "./probe.ts";
import { MIN_CLAUDE_VERSION, meetsMinimum, parseVersion } from "./version.ts";

// Pull a `--model <id>` / `--model=<id>` out of the passthrough so it becomes
// ANTHROPIC_MODEL and is NOT forwarded to claude. Returns the remaining args.
export function interceptModel(passthrough: string[]): { model?: string; rest: string[] } {
  const rest: string[] = [];
  let model: string | undefined;
  for (let i = 0; i < passthrough.length; i++) {
    const arg = passthrough[i];
    if (arg === "--model") {
      const next = passthrough[++i];
      if (next !== undefined) model = next;
      continue;
    }
    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
      continue;
    }
    rest.push(arg);
  }
  return { model, rest };
}

function bundledSparkSystemPath(): string {
  return join(import.meta.dir, "..", "personas", "spark", "system.md");
}

function renderUnique(prompt: string): string {
  mkdirSync(aipCacheDir(), { recursive: true });
  const path = renderedPromptPath();
  writeFileSync(path, prompt, "utf8");
  return path;
}

// Bounded runtime gate: a claude that does not honor CLAUDE_CONFIG_DIR would silently
// break isolation, so a failed/timed-out version probe or a below-minimum version is a
// hard refuse, never a launch.
function probeClaudeVersion(claudeBin: string): { ok: boolean; reason?: string } {
  const result = spawnSync(claudeBin, ["--version"], { encoding: "utf8", timeout: 5000 });
  if (result.signal) return { ok: false, reason: "`claude --version` timed out" };
  if (result.error) return { ok: false, reason: `\`claude --version\` failed: ${result.error.message}` };
  if (result.status !== 0) return { ok: false, reason: `\`claude --version\` exited ${result.status}` };
  const parsed = parseVersion(result.stdout ?? "");
  if (!parsed) return { ok: false, reason: `could not parse claude version from: ${(result.stdout ?? "").trim()}` };
  const version = parsed.join(".");
  if (!meetsMinimum(version)) {
    return {
      ok: false,
      reason: `claude ${version} < required ${MIN_CLAUDE_VERSION} (older binaries may not honor CLAUDE_CONFIG_DIR)`,
    };
  }
  return { ok: true };
}

// Launch-time `--model` validation against the install-cached /v1/models list, with a
// single re-probe on a miss. An empty cache (offline install) cannot validate, so it
// allows rather than blocking; a populated cache that lacks the model is fail-fast.
async function ensureModelAvailable(
  cfg: SparkConfig,
  model: string,
): Promise<{ ok: boolean; message?: string }> {
  let models = readModelsCache();
  if (models.includes(model)) return { ok: true };

  const probe = await probeFleet(cfg.baseUrl, cfg.token);
  if (probe.ok) {
    writeModelsCache(probe.models);
    models = probe.models;
  }
  if (models.includes(model) || models.length === 0) return { ok: true };
  return { ok: false, message: `model '${model}' not served by the fleet — available: ${models.join(", ")}` };
}

// Dedicated backend entry, separate from the generic `aip <persona>` path: fail-closed
// config read, --model intercept, runtime version gate, scrubbed allow-list env,
// independent refuse-predicate, stderr banner, and a unique per-launch rendered prompt
// unlinked on exit.
export async function runSparkBackend(
  passthrough: string[],
  opts: { root: boolean; claudeBin: string },
): Promise<number> {
  if (opts.root) {
    console.error("aip: `aip spark` does not support --root — a fleet session needs no privilege escalation");
    return 2;
  }
  if (passthrough[0] === "install" || passthrough[0] === "uninstall") {
    console.error(`aip: did you mean \`aip ${passthrough[0]} spark\`? forwarding '${passthrough[0]}' to the agent`);
  }

  let cfg: SparkConfig;
  try {
    cfg = requireSparkConfig();
  } catch (error) {
    if (error instanceof SparkNotInstalled) {
      console.error(`aip: ${error.message}`);
      return 1;
    }
    throw error;
  }

  // Fail-closed against a present-but-incomplete spark.env: a blank token, or a base URL
  // that normalizes to empty (e.g. a hand-edited `/v1`), would inject empty
  // ANTHROPIC_BASE_URL/AUTH_TOKEN and let claude silently fall back to cloud. Guard the
  // NORMALIZED value since that is what buildSparkEnv injects.
  if (!cfg.token || !normalizeBaseUrl(cfg.baseUrl)) {
    console.error("aip: spark.env is missing SPARK_BASE_URL/SPARK_TOKEN — re-run `aip install spark`");
    return 1;
  }

  // Re-seed a removed config home so CLAUDE_CONFIG_DIR never points at an unseeded dir
  // (which would drop claude into the onboarding/trust wizard and hang a launch).
  if (!existsSync(cfg.configDir)) seedSparkHome();

  const { model: modelOverride, rest } = interceptModel(passthrough);
  if (modelOverride) {
    const check = await ensureModelAvailable(cfg, modelOverride);
    if (!check.ok) {
      console.error(`aip: ${check.message}`);
      return 1;
    }
    cfg = { ...cfg, model: modelOverride };
  }

  const version = probeClaudeVersion(opts.claudeBin);
  if (!version.ok) {
    console.error(`aip: ${version.reason} — refusing to launch (fleet isolation requires CLAUDE_CONFIG_DIR support)`);
    return 1;
  }

  const env = buildSparkEnv(process.env, cfg);
  const refusal = refuseReason(env);
  if (refusal) {
    console.error(`aip: ${refusal}`);
    return 1;
  }

  console.error(banner(env, cfg.harness));

  if (existsSync(join(aipConfigDir(), "personas", "spark", "system.md"))) {
    console.error(
      "aip: a user persona shadows the bundled `spark`; the fleet backend uses the bundled system.md regardless",
    );
  }

  const systemPrompt = readFileSync(bundledSparkSystemPath(), "utf8");
  const prompt = new PromptComposer(defaultProviders()).compose(systemPrompt);
  const rendered = renderUnique(prompt);
  const cleanup = () => {
    try {
      unlinkSync(rendered);
    } catch {
      // already gone
    }
  };
  process.once("exit", cleanup);
  try {
    return new PlainRunner(opts.claudeBin).run(rendered, rest, env);
  } finally {
    cleanup();
  }
}
