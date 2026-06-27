import { beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MODELS, readSparkEnv, sparkEnvPath, sparkHomeDir } from "../src/spark/config.ts";
import { reservedVerb, runInstall, runUninstall } from "../src/spark/install.ts";
import { fileMode, useTempXdg } from "./helpers/tmpXdg.ts";

useTempXdg("aip-cli");

let tokenFile: string;

beforeEach(() => {
  tokenFile = join(tmpdir(), `aip-token-${crypto.randomUUID()}`);
  writeFileSync(tokenFile, "virtual-key-A\n");
  chmodSync(tokenFile, 0o600);
});

test("reservedVerb fires only on the first non-flag token", () => {
  expect(reservedVerb(["install", "spark"])).toBe("install");
  expect(reservedVerb(["uninstall", "spark"])).toBe("uninstall");
  expect(reservedVerb(["--root", "install", "spark"])).toBe("install");
  expect(reservedVerb(["spark"])).toBeNull();
  expect(reservedVerb(["--list"])).toBeNull();
  expect(reservedVerb([])).toBeNull();
});

test("install writes a 600 config + 700 home with sane defaults", async () => {
  const code = await runInstall([
    "install",
    "spark",
    "--url",
    "http://fleet.test:9000/v1",
    "--token-file",
    tokenFile,
    "--skip-probe",
  ]);
  expect(code).toBe(0);
  expect(fileMode(sparkEnvPath())).toBe(0o600);
  expect(fileMode(sparkHomeDir())).toBe(0o700);
  const rec = readSparkEnv()!;
  expect(rec.SPARK_BASE_URL).toBe("http://fleet.test:9000"); // root-normalized
  expect(rec.SPARK_TOKEN).toBe("virtual-key-A");
  expect(rec.SPARK_HARNESS).toBe("claude");
  expect(rec.SPARK_MODEL).toBeDefined();
  expect(rec.SPARK_OPUS_MODEL).toBeDefined();
});

test("install is idempotent and merges — a token-only re-run preserves other keys", async () => {
  await runInstall(["install", "spark", "--url", "http://fleet.test:9000", "--token-file", tokenFile, "--skip-probe"]);
  const firstModel = readSparkEnv()!.SPARK_MODEL;

  const tokenFile2 = join(tmpdir(), `aip-token-${crypto.randomUUID()}`);
  writeFileSync(tokenFile2, "virtual-key-B\n");
  chmodSync(tokenFile2, 0o600);
  const code = await runInstall(["install", "spark", "--token-file", tokenFile2, "--skip-probe"]);
  expect(code).toBe(0);

  const rec = readSparkEnv()!;
  expect(rec.SPARK_TOKEN).toBe("virtual-key-B");
  expect(rec.SPARK_BASE_URL).toBe("http://fleet.test:9000");
  expect(rec.SPARK_MODEL).toBe(firstModel);
});

test("install --model overrides the primary seat on merge", async () => {
  await runInstall(["install", "spark", "--url", "http://fleet.test:9000", "--token-file", tokenFile, "--skip-probe"]);
  await runInstall(["install", "spark", "--model", "custom-seat", "--token-file", tokenFile, "--skip-probe"]);
  expect(readSparkEnv()!.SPARK_MODEL).toBe("custom-seat");
});

test("install rejects --root, --token <value>, a missing target, and a missing URL", async () => {
  expect(await runInstall(["install", "spark", "--root"])).toBe(2);
  expect(await runInstall(["install", "spark", "--token", "secret"])).toBe(2);
  expect(await runInstall(["install"])).toBe(2);
  expect(await runInstall(["install", "spark", "--token-file", tokenFile, "--skip-probe"])).toBe(2);
});

test("install refuses a group/world-readable token file", async () => {
  chmodSync(tokenFile, 0o644);
  await expect(
    runInstall(["install", "spark", "--url", "http://fleet.test:9000", "--token-file", tokenFile, "--skip-probe"]),
  ).rejects.toThrow(/group\/world-accessible/);
});

test("uninstall is idempotent and rejects --root / unknown targets", async () => {
  expect(runUninstall(["uninstall", "spark"])).toBe(0); // nothing installed
  await runInstall(["install", "spark", "--url", "http://fleet.test:9000", "--token-file", tokenFile, "--skip-probe"]);
  expect(existsSync(sparkEnvPath())).toBe(true);
  expect(runUninstall(["uninstall", "spark"])).toBe(0);
  expect(existsSync(sparkEnvPath())).toBe(false);
  expect(runUninstall(["uninstall", "spark"])).toBe(0); // idempotent no-op
  expect(runUninstall(["--root", "uninstall", "spark"])).toBe(2);
  expect(runUninstall(["uninstall", "bogus"])).toBe(2);
});

function withFakeFleet<T>(modelIds: string[], run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).endsWith("/v1/models")) {
      return new Response(JSON.stringify({ data: modelIds.map((id) => ({ id })) }), { status: 200 });
    }
    return new Response("{}", { status: 200 }); // /v1/messages reachability
  }) as unknown as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = realFetch;
  });
}

test("install validates the DEFAULT model against the fleet and fails when it is absent", async () => {
  const code = await withFakeFleet(["only-other-seat"], () =>
    runInstall(["install", "spark", "--url", "http://fleet.test:9000", "--token-file", tokenFile]),
  );
  expect(code).toBe(1);
  expect(existsSync(sparkEnvPath())).toBe(false);
});

test("install succeeds when the resolved default model is served by the fleet", async () => {
  const code = await withFakeFleet([DEFAULT_MODELS.SPARK_MODEL, "extra-seat"], () =>
    runInstall(["install", "spark", "--url", "http://fleet.test:9000", "--token-file", tokenFile]),
  );
  expect(code).toBe(0);
  expect(readSparkEnv()!.SPARK_MODEL).toBe(DEFAULT_MODELS.SPARK_MODEL);
});
