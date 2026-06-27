import { expect, test } from "bun:test";

import type { SparkConfig } from "../src/spark/config.ts";
import { banner, buildSparkEnv, normalizeBaseUrl, refuseReason, SPARK_ALLOWLIST } from "../src/spark/env.ts";
import { interceptModel } from "../src/spark/launch.ts";
import { meetsMinimum, parseVersion } from "../src/spark/version.ts";

function sampleConfig(over: Partial<SparkConfig> = {}): SparkConfig {
  return {
    baseUrl: "http://fleet.test:9000/v1/",
    token: "virtual-key-sentinel",
    model: "primary-seat",
    smallFastModel: "small-seat",
    opusModel: "opus-seat",
    sonnetModel: "sonnet-seat",
    haikuModel: "haiku-seat",
    harness: "claude",
    configDir: "/home/u/.config/aip/spark-home",
    shimPath: "",
    ...over,
  };
}

test("buildSparkEnv injects exactly the 8-key allow-list", () => {
  const env = buildSparkEnv({ PATH: "/bin", HOME: "/home/u" }, sampleConfig());
  const anthropicKeys = Object.keys(env).filter((k) => k.startsWith("ANTHROPIC_")).sort();
  expect(anthropicKeys).toEqual(
    SPARK_ALLOWLIST.filter((k) => k.startsWith("ANTHROPIC_")).slice().sort(),
  );
  expect(env.CLAUDE_CONFIG_DIR).toBe("/home/u/.config/aip/spark-home");
  for (const key of SPARK_ALLOWLIST) expect(env[key]).toBeDefined();
});

test("buildSparkEnv scrubs inherited cloud-routing keys and preserves PATH/HOME", () => {
  const env = buildSparkEnv(
    {
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "en_US.UTF-8",
      ANTHROPIC_API_KEY: "leak",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      AWS_BEARER_TOKEN_BEDROCK: "leak",
      AWS_REGION: "us-east-1",
      AWS_PROFILE: "default",
    },
    sampleConfig(),
  );
  expect(env.PATH).toBe("/usr/bin");
  expect(env.HOME).toBe("/home/u");
  expect(env.LANG).toBe("en_US.UTF-8");
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined();
  expect(Object.keys(env).some((k) => k.startsWith("CLAUDE_CODE_USE_"))).toBe(false);
  // AWS region/profile are inert once the Bedrock routing trigger is gone and survive the
  // scrub so in-session `aws` tooling keeps working.
  expect(env.AWS_REGION).toBe("us-east-1");
  expect(env.AWS_PROFILE).toBe("default");
  // re-injected base URL is the fleet root, not the inherited cloud one
  expect(env.ANTHROPIC_BASE_URL).toBe("http://fleet.test:9000");
});

test("buildSparkEnv scrubs Vertex/Google routing keys so they never trip the refuse-predicate", () => {
  // A user with GOOGLE_APPLICATION_CREDENTIALS / CLOUD_ML_REGION set must not be bricked:
  // the scrub deletes the whole cloud-routing family (single-sourced with the predicate),
  // and CLAUDE_CODE_USE_VERTEX (the routing trigger) is scrubbed too, so they are inert.
  const env = buildSparkEnv(
    {
      PATH: "/bin",
      GOOGLE_APPLICATION_CREDENTIALS: "/key.json",
      CLOUD_ML_REGION: "us-central1",
      CLAUDE_CODE_USE_VERTEX: "1",
    },
    sampleConfig(),
  );
  expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  expect(env.CLOUD_ML_REGION).toBeUndefined();
  expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
  expect(refuseReason(env)).toBeNull();
});

test("buildSparkEnv writes nothing into ~/.claude — config home is the isolated spark-home", () => {
  const cfg = sampleConfig();
  const env = buildSparkEnv({ HOME: "/home/u" }, cfg);
  expect(env.CLAUDE_CONFIG_DIR).toBe(cfg.configDir);
  expect(env.CLAUDE_CONFIG_DIR).not.toBe("/home/u/.claude");
  expect(env.CLAUDE_CONFIG_DIR).not.toContain("/.claude/");
});

test("buildSparkEnv does not mutate the parent env", () => {
  const parent = { PATH: "/bin", ANTHROPIC_API_KEY: "x" };
  buildSparkEnv(parent, sampleConfig());
  expect(parent.ANTHROPIC_API_KEY).toBe("x");
});

test("refuseReason accepts the clean allow-list env", () => {
  const env = buildSparkEnv({ PATH: "/bin" }, sampleConfig());
  expect(refuseReason(env)).toBeNull();
});

test("refuseReason rejects any cloud-routing key outside the allow-list", () => {
  const base = buildSparkEnv({ PATH: "/bin" }, sampleConfig());
  expect(refuseReason({ ...base, ANTHROPIC_API_KEY: "x" })).toContain("ANTHROPIC_API_KEY");
  expect(refuseReason({ ...base, GOOGLE_APPLICATION_CREDENTIALS: "x" })).toContain(
    "GOOGLE_APPLICATION_CREDENTIALS",
  );
  expect(refuseReason({ ...base, CLOUD_ML_REGION: "x" })).toContain("CLOUD_ML_REGION");
  expect(refuseReason({ ...base, CLAUDE_CODE_USE_BEDROCK: "1" })).toContain("CLAUDE_CODE_USE_BEDROCK");
});

test("normalizeBaseUrl strips a trailing /v1 and slashes", () => {
  expect(normalizeBaseUrl("http://h:1/v1/")).toBe("http://h:1");
  expect(normalizeBaseUrl("http://h:1/v1")).toBe("http://h:1");
  expect(normalizeBaseUrl("http://h:1/")).toBe("http://h:1");
  expect(normalizeBaseUrl("http://h:1")).toBe("http://h:1");
  expect(normalizeBaseUrl("  http://h:1/v1/  ")).toBe("http://h:1");
});

test("banner is computed from the final env", () => {
  const env = buildSparkEnv({ PATH: "/bin" }, sampleConfig({ model: "the-seat" }));
  const line = banner(env, "claude");
  expect(line).toContain("http://fleet.test:9000");
  expect(line).toContain("the-seat");
  expect(line).toContain("harness claude");
});

test("version parsing and minimum comparison", () => {
  expect(parseVersion("1.2.3 (Claude Code)")).toEqual([1, 2, 3]);
  expect(parseVersion("no version here")).toBeNull();
  expect(meetsMinimum("1.0.0", "1.0.0")).toBe(true);
  expect(meetsMinimum("1.2.0", "1.0.0")).toBe(true);
  expect(meetsMinimum("0.9.9", "1.0.0")).toBe(false);
  expect(meetsMinimum("garbage", "1.0.0")).toBe(false);
});

test("interceptModel pulls --model out of the passthrough", () => {
  expect(interceptModel(["--model", "m1", "-x"])).toEqual({ model: "m1", rest: ["-x"] });
  expect(interceptModel(["--model=m2"])).toEqual({ model: "m2", rest: [] });
  expect(interceptModel(["foo", "--bar"])).toEqual({ model: undefined, rest: ["foo", "--bar"] });
});
