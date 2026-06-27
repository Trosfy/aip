import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseEnvFile, seedSparkHome, sparkHomeDir, writeSparkEnv } from "../src/spark/config.ts";
import { runSparkBackend } from "../src/spark/launch.ts";
import { useTempXdg } from "./helpers/tmpXdg.ts";

useTempXdg("aip-launch");

const NEVER = "claude-binary-must-not-be-spawned";

test("runSparkBackend refuses --root with exit 2 before touching config", async () => {
  expect(await runSparkBackend([], { root: true, claudeBin: NEVER })).toBe(2);
});

test("runSparkBackend fails closed with exit 1 when nothing is installed", async () => {
  expect(await runSparkBackend([], { root: false, claudeBin: NEVER })).toBe(1);
});

test("runSparkBackend fails closed with exit 1 on a present-but-incomplete spark.env", async () => {
  // SPARK_MODEL only — no base URL / token. Launching here would inject blank
  // ANTHROPIC_BASE_URL/AUTH_TOKEN and silently fall back to cloud.
  writeSparkEnv({ SPARK_MODEL: "some-seat" });
  expect(await runSparkBackend([], { root: false, claudeBin: NEVER })).toBe(1);
});

test("runSparkBackend fails closed with exit 1 when SPARK_BASE_URL normalizes to empty", async () => {
  // Raw-truthy but normalizes to "" → would inject an empty ANTHROPIC_BASE_URL.
  writeSparkEnv({ SPARK_BASE_URL: "/v1", SPARK_TOKEN: "vk", SPARK_MODEL: "seat" });
  expect(await runSparkBackend([], { root: false, claudeBin: NEVER })).toBe(1);
});

// A stub `claude`: prints a version for --version, and for the real launch dumps the
// environment it RECEIVED to `envOut` so a test can pin the child env.
function stubClaude(opts: { version?: string; envOut?: string } = {}): string {
  const version = opts.version ?? "9.9.9 (stub)";
  mkdirSync(process.env.XDG_CACHE_HOME!, { recursive: true });
  const bin = join(process.env.XDG_CACHE_HOME!, `stub-claude-${crypto.randomUUID()}`);
  const launch = opts.envOut ? `env > ${JSON.stringify(opts.envOut)}` : "true";
  writeFileSync(
    bin,
    `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo ${JSON.stringify(version)}; else ${launch}; fi\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

test("the CHILD env is the scrubbed allow-list env, not the polluted parent env", async () => {
  writeSparkEnv({ SPARK_BASE_URL: "http://fleet.test:9000", SPARK_TOKEN: "vk", SPARK_MODEL: "seat" });
  seedSparkHome();
  const envOut = join(process.env.XDG_CACHE_HOME!, "child-env.txt");
  const polluted = {
    ANTHROPIC_API_KEY: "leak",
    CLAUDE_CODE_USE_VERTEX: "1",
    GOOGLE_APPLICATION_CREDENTIALS: "/key.json",
    CLOUD_ML_REGION: "us-central1",
  };
  for (const [k, v] of Object.entries(polluted)) process.env[k] = v;
  try {
    const code = await runSparkBackend([], { root: false, claudeBin: stubClaude({ envOut }) });
    expect(code).toBe(0);
    const child = parseEnvFile(readFileSync(envOut, "utf8"));
    expect(child.ANTHROPIC_API_KEY).toBeUndefined();
    expect(child.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(child.CLOUD_ML_REGION).toBeUndefined();
    expect(child.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(child.ANTHROPIC_BASE_URL).toBe("http://fleet.test:9000");
    expect(child.ANTHROPIC_AUTH_TOKEN).toBe("vk");
  } finally {
    for (const k of Object.keys(polluted)) delete process.env[k];
  }
});

test("runSparkBackend refuses with exit 1 when claude is below the pinned minimum version", async () => {
  writeSparkEnv({ SPARK_BASE_URL: "http://fleet.test:9000", SPARK_TOKEN: "vk", SPARK_MODEL: "seat" });
  seedSparkHome();
  const code = await runSparkBackend([], { root: false, claudeBin: stubClaude({ version: "0.0.1 (stub)" }) });
  expect(code).toBe(1);
});

test("runSparkBackend re-seeds a removed spark-home before launching", async () => {
  writeSparkEnv({ SPARK_BASE_URL: "http://fleet.test:9000", SPARK_TOKEN: "vk", SPARK_MODEL: "seat" });
  // Note: never seeded here — runSparkBackend must create it.
  expect(existsSync(sparkHomeDir())).toBe(false);
  const code = await runSparkBackend([], { root: false, claudeBin: stubClaude() });
  expect(code).toBe(0);
  expect(existsSync(join(sparkHomeDir(), ".claude.json"))).toBe(true);
});
