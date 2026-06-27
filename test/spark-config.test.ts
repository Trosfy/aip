import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  aipCacheDir,
  modelsCachePath,
  readModelsCache,
  readSparkEnv,
  requireSparkConfig,
  seedSparkHome,
  SparkNotInstalled,
  sparkEnvPath,
  sparkHomeDir,
  uninstallSpark,
  writeModelsCache,
  writeSparkEnv,
} from "../src/spark/config.ts";
import { fileMode as mode, useTempXdg } from "./helpers/tmpXdg.ts";

useTempXdg("aip-cfg");

test("writeSparkEnv creates a mode-600 file readable back", () => {
  writeSparkEnv({ SPARK_BASE_URL: "http://h:1", SPARK_TOKEN: "t", SPARK_MODEL: "m" });
  expect(mode(sparkEnvPath())).toBe(0o600);
  expect(readSparkEnv()).toMatchObject({ SPARK_BASE_URL: "http://h:1", SPARK_TOKEN: "t", SPARK_MODEL: "m" });
});

test("writeSparkEnv overlay-merges per key", () => {
  writeSparkEnv({ SPARK_BASE_URL: "http://h:1", SPARK_TOKEN: "t1", SPARK_MODEL: "m1" });
  writeSparkEnv({ SPARK_TOKEN: "t2" });
  const rec = readSparkEnv();
  expect(rec?.SPARK_TOKEN).toBe("t2");
  expect(rec?.SPARK_MODEL).toBe("m1");
  expect(rec?.SPARK_BASE_URL).toBe("http://h:1");
});

test("writeSparkEnv warns when the prior file was group/world-readable, then re-secures it", () => {
  writeSparkEnv({ SPARK_TOKEN: "t" });
  chmodSync(sparkEnvPath(), 0o644);
  const { warnedPerms } = writeSparkEnv({ SPARK_TOKEN: "t2" });
  expect(warnedPerms).toBe(true);
  expect(mode(sparkEnvPath())).toBe(0o600);
});

test("seedSparkHome creates a mode-700 home with mode-600 seed files", () => {
  seedSparkHome();
  expect(mode(sparkHomeDir())).toBe(0o700);
  expect(mode(join(sparkHomeDir(), "settings.json"))).toBe(0o600);
  expect(mode(join(sparkHomeDir(), ".claude.json"))).toBe(0o600);
});

test("seedSparkHome records onboarding + theme but NOT bypassPermissionsModeAccepted", () => {
  seedSparkHome();
  const dot = JSON.parse(readFileSync(join(sparkHomeDir(), ".claude.json"), "utf8"));
  expect(dot.hasCompletedOnboarding).toBe(true);
  expect(dot.theme).toBe("dark");
  expect("bypassPermissionsModeAccepted" in dot).toBe(false);
});

test("readSparkEnv is null and requireSparkConfig throws when nothing is installed", () => {
  expect(readSparkEnv()).toBeNull();
  expect(() => requireSparkConfig()).toThrow(SparkNotInstalled);
});

test("models cache round-trips", () => {
  writeModelsCache(["a", "b"]);
  expect(mode(modelsCachePath())).toBe(0o600);
  expect(readModelsCache()).toEqual(["a", "b"]);
});

test("uninstallSpark removes shim → rendered cache → config, in that order, idempotently", () => {
  const shim = join(process.env.XDG_CONFIG_HOME!, "fake-shim");
  mkdirSync(process.env.XDG_CONFIG_HOME!, { recursive: true });
  writeFileSync(shim, "#!/bin/sh\n");
  writeSparkEnv({ SPARK_TOKEN: "t", SPARK_SHIM_PATH: shim });
  seedSparkHome();
  mkdirSync(aipCacheDir(), { recursive: true });
  const rendered = join(aipCacheDir(), `spark.${process.pid}.deadbeef.rendered.md`);
  writeFileSync(rendered, "PROMPT");

  const { removed } = uninstallSpark();
  expect(removed.indexOf(shim)).toBe(0);
  expect(removed.indexOf(shim)).toBeLessThan(removed.indexOf(rendered));
  expect(removed.indexOf(rendered)).toBeLessThan(removed.indexOf(sparkEnvPath()));
  expect(removed.indexOf(sparkEnvPath())).toBeLessThan(removed.indexOf(sparkHomeDir()));

  expect(existsSync(shim)).toBe(false);
  expect(existsSync(rendered)).toBe(false);
  expect(existsSync(sparkEnvPath())).toBe(false);
  expect(existsSync(sparkHomeDir())).toBe(false);

  expect(uninstallSpark().removed).toEqual([]);
});
