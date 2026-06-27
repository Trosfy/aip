import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export class SparkNotInstalled extends Error {}

// Resolved launch configuration — the SPARK_* env-file keys mapped to the values
// the launcher injects. `configDir` is the isolated CLAUDE_CONFIG_DIR (spark-home).
export interface SparkConfig {
  baseUrl: string;
  token: string;
  model: string;
  smallFastModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  harness: string;
  configDir: string;
  shimPath: string;
}

// Default model seats written to the out-of-tree spark.env only (never committed). Values = concrete fleet
// seat ids from the fleet's own fleet_alias_remap (spark-recipes config/fleet.json), user-confirmed — so the
// opus/sonnet/haiku tier overrides point at REAL seats rather than relying on gateway alias remapping. A consumer
// overrides them at `aip install spark --model …` (or by editing spark.env) if their gateway exposes different
// model ids. small_fast = the fast MoE seat (background/title calls).
export const DEFAULT_MODELS: Record<string, string> = {
  SPARK_MODEL: "qwen3.6-35b-a3b",
  SPARK_SMALL_FAST_MODEL: "qwen3.6-35b-a3b",
  SPARK_OPUS_MODEL: "qwen3.6-27b-think",
  SPARK_SONNET_MODEL: "qwen3.6-35b-a3b",
  SPARK_HAIKU_MODEL: "qwen3.6-27b",
};

function xdgDir(envVar: string, fallback: string): string {
  const base = process.env[envVar] || join(homedir(), fallback);
  return join(base, "aip");
}

export function aipConfigDir(): string {
  return xdgDir("XDG_CONFIG_HOME", ".config");
}

export function aipCacheDir(): string {
  return xdgDir("XDG_CACHE_HOME", ".cache");
}

// Write a secret-bearing file readable only by the owner, forcing 600 even when the file
// already exists (writeFileSync's mode applies only on create) or umask would loosen it.
function writeFile600(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function sparkEnvPath(): string {
  return join(aipConfigDir(), "spark.env");
}

export function sparkHomeDir(): string {
  return join(aipConfigDir(), "spark-home");
}

export function modelsCachePath(): string {
  return join(sparkHomeDir(), "models.json");
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export function serializeEnvFile(rec: Record<string, string>): string {
  return (
    Object.entries(rec)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

// Per-key overlay: provided keys win, every other existing key is preserved — so a
// `--token`-only re-run keeps SPARK_MODEL and the tier remaps.
export function mergeSparkEnv(
  existing: Record<string, string>,
  updates: Record<string, string>,
): Record<string, string> {
  return { ...existing, ...updates };
}

// Fail-closed source of truth: null when the file is absent or unreadable.
export function readSparkEnv(): Record<string, string> | null {
  const path = sparkEnvPath();
  if (!existsSync(path)) return null;
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function isGroupOrWorldAccessible(path: string): boolean {
  return (statSync(path).mode & 0o077) !== 0;
}

// Merge `updates` onto the existing config and re-secure to 600 on every write. Callers
// that already hold the existing record pass it in to avoid a redundant re-read.
// `warnedPerms` flags that the pre-existing file was group/world-accessible; `merged` is
// the record written (so a caller can resolveConfig it without re-reading the file).
export function writeSparkEnv(
  updates: Record<string, string>,
  existing: Record<string, string> = readSparkEnv() ?? {},
): { warnedPerms: boolean; merged: Record<string, string> } {
  mkdirSync(aipConfigDir(), { recursive: true });
  const path = sparkEnvPath();
  const warnedPerms = existsSync(path) && isGroupOrWorldAccessible(path);
  const merged = mergeSparkEnv(existing, updates);
  writeFile600(path, serializeEnvFile(merged));
  return { warnedPerms, merged };
}

// Pre-seed the isolated config home so the first `aip spark` lands in a session
// instead of the onboarding wizard / per-cwd trust dialog (which would hang a
// non-interactive launch). The seed contract is ONLY onboarding-complete + theme +
// (the deferred) cwd-trust — never `bypassPermissionsModeAccepted`, which would silently
// record consent to "dangerously skip permissions" the user never gave.
// TODO(GO/NO-GO): confirm the exact keys claude reads to suppress the onboarding
// wizard and the per-new-cwd trust dialog, then seed precisely those. The per-cwd
// trust key (`projects.<cwd>.hasTrustDialogAccepted`) cannot be pre-seeded for an
// unknown future cwd; the GO/NO-GO matrix decides whether a global suppressor exists.
export function seedSparkHome(): void {
  const home = sparkHomeDir();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);

  const settings = { theme: "dark" };
  writeFile600(join(home, "settings.json"), JSON.stringify(settings, null, 2) + "\n");

  const dotClaude = {
    hasCompletedOnboarding: true,
    theme: "dark",
  };
  writeFile600(join(home, ".claude.json"), JSON.stringify(dotClaude, null, 2) + "\n");
}

export function writeModelsCache(models: string[]): void {
  mkdirSync(sparkHomeDir(), { recursive: true, mode: 0o700 });
  writeFile600(modelsCachePath(), JSON.stringify({ models }, null, 2) + "\n");
}

export function readModelsCache(): string[] {
  const path = modelsCachePath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
    return Array.isArray(parsed.models) ? (parsed.models as string[]) : [];
  } catch {
    return [];
  }
}

export function resolveConfig(rec: Record<string, string>): SparkConfig {
  const seat = (key: string) => rec[key] || DEFAULT_MODELS[key];
  return {
    baseUrl: rec.SPARK_BASE_URL ?? "",
    token: rec.SPARK_TOKEN ?? "",
    model: seat("SPARK_MODEL"),
    smallFastModel: seat("SPARK_SMALL_FAST_MODEL"),
    opusModel: seat("SPARK_OPUS_MODEL"),
    sonnetModel: seat("SPARK_SONNET_MODEL"),
    haikuModel: seat("SPARK_HAIKU_MODEL"),
    harness: rec.SPARK_HARNESS || "claude",
    configDir: sparkHomeDir(),
    shimPath: rec.SPARK_SHIM_PATH ?? "",
  };
}

// Fail-closed: a missing/unreadable spark.env is a hard error, never a silent
// fallback to the cloud config.
export function requireSparkConfig(): SparkConfig {
  const rec = readSparkEnv();
  if (!rec) {
    throw new SparkNotInstalled("spark backend not configured — run `aip install spark`");
  }
  return resolveConfig(rec);
}

// Single source for the rendered-prompt filename contract so the per-launch write pattern
// and the uninstall-sweep glob cannot drift.
const RENDERED_PREFIX = "spark";
const RENDERED_EXT = ".rendered.md";

// A unique per-launch path (pid + random) so two terminals never share a system prompt.
export function renderedPromptPath(): string {
  const unique = `${process.pid}.${randomBytes(6).toString("hex")}`;
  return join(aipCacheDir(), `${RENDERED_PREFIX}.${unique}${RENDERED_EXT}`);
}

// Rendered system prompts left under the cache dir by `runSparkBackend`.
export function renderedCacheFiles(): string[] {
  const dir = aipCacheDir();
  if (!existsSync(dir)) return [];
  const match = new RegExp(`^${RENDERED_PREFIX}.*${RENDERED_EXT.replace(/\./g, "\\.")}$`);
  return readdirSync(dir)
    .filter((name) => match.test(name))
    .map((name) => join(dir, name));
}

// Idempotent teardown in the documented order: shim (read from spark.env FIRST) →
// rendered cache → config home. Returns the removed paths in removal order; an empty
// list means nothing was installed.
export function uninstallSpark(): { removed: string[] } {
  const removed: string[] = [];

  const rec = readSparkEnv();
  const shim = rec?.SPARK_SHIM_PATH ?? "";
  if (shim && existsSync(shim)) {
    rmSync(shim, { force: true });
    removed.push(shim);
  }

  for (const file of renderedCacheFiles()) {
    rmSync(file, { force: true });
    removed.push(file);
  }

  const envPath = sparkEnvPath();
  if (existsSync(envPath)) {
    rmSync(envPath, { force: true });
    removed.push(envPath);
  }
  const home = sparkHomeDir();
  if (existsSync(home)) {
    rmSync(home, { recursive: true, force: true });
    removed.push(home);
  }

  return { removed };
}
