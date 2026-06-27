import type { SparkConfig } from "./config.ts";

// The ONLY env keys the launcher injects, and the ONLY cloud-routing keys the
// independent refuse-predicate permits in the final spawn env.
export const SPARK_ALLOWLIST = [
  "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

// CLAUDE_CONFIG_DIR isolates FILES, not env, so any inherited cloud-routing var is
// scrubbed before injection. ONE source of truth for the cloud-routing families, shared
// by the scrub and the refuse-predicate so the two can never drift: ANTHROPIC_* /
// CLAUDE_CODE_USE_* (Bedrock/Vertex) / GOOGLE_* / CLOUD_ML_* (Vertex) by prefix, plus the
// Bedrock token by exact name. AWS_REGION/PROFILE are deliberately NOT scrubbed: they are
// inert for routing once CLAUDE_CODE_USE_BEDROCK is gone, and stripping them would break a
// user's in-session `aws` tooling.
const CLOUD_PREFIXES = [/^ANTHROPIC_/, /^CLAUDE_CODE_USE_/, /^GOOGLE_/, /^CLOUD_ML_/];
const CLOUD_EXACT = new Set(["AWS_BEARER_TOKEN_BEDROCK"]);

function isCloudRoutingKey(key: string): boolean {
  return CLOUD_PREFIXES.some((re) => re.test(key)) || CLOUD_EXACT.has(key);
}

// claude appends `/v1/messages`, so it wants the ROOT base URL: strip a trailing
// `/v1` and any trailing slashes (prevents the `/v1/v1/messages` 404 footgun).
export function normalizeBaseUrl(url: string): string {
  let u = url.trim();
  while (u.endsWith("/")) u = u.slice(0, -1);
  if (u.endsWith("/v1")) u = u.slice(0, -"/v1".length);
  while (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

// Spawn env = `process.env` (PATH/HOME/locale preserved) with the scrub keys DELETED
// and the exact allow-list OVERWRITTEN. Returns a new object; the parent env is never
// mutated and the token is not copied onto `process.env`.
export function buildSparkEnv(
  parent: Record<string, string | undefined>,
  cfg: SparkConfig,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (isCloudRoutingKey(key)) continue;
    env[key] = value;
  }
  env.CLAUDE_CONFIG_DIR = cfg.configDir;
  env.ANTHROPIC_BASE_URL = normalizeBaseUrl(cfg.baseUrl);
  env.ANTHROPIC_AUTH_TOKEN = cfg.token;
  env.ANTHROPIC_MODEL = cfg.model;
  env.ANTHROPIC_SMALL_FAST_MODEL = cfg.smallFastModel;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = cfg.opusModel;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = cfg.sonnetModel;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = cfg.haikuModel;
  return env;
}

// Backstop self-check on the FINAL env: scrub + inject should already have produced an
// env whose only cloud-routing keys are the 8 allow-list keys. A non-null result means
// injection / allow-list drift — a future cloud-routing key injected into the spawn env
// without being added to SPARK_ALLOWLIST. It does NOT catch a bug in isCloudRoutingKey
// itself, since the scrub and this check share that predicate. Fail-closed: callers must
// not launch on a non-null result.
export function refuseReason(env: Record<string, string>): string | null {
  const allow = new Set<string>(SPARK_ALLOWLIST);
  const offenders = Object.keys(env)
    .filter((key) => isCloudRoutingKey(key) && !allow.has(key))
    .sort();
  if (offenders.length === 0) return null;
  return `refusing to launch — cloud-routing env key(s) outside the allow-list: ${offenders.join(", ")}`;
}

// Computed from the FINAL post-scrub env so it reflects what claude will actually
// talk to, not our intended config — the cheapest guard against a silent-cloud path.
export function banner(env: Record<string, string>, harness: string): string {
  return `aip spark → fleet ${env.ANTHROPIC_BASE_URL} · model ${env.ANTHROPIC_MODEL} · harness ${harness}`;
}
