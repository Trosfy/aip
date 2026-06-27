import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PromptComposer } from "../src/composer.ts";
import { defaultProviders } from "../src/context.ts";
import { parseEnvFile } from "../src/spark/config.ts";

const REPO = join(import.meta.dir, "..");

// CGNAT / RFC1918 / loopback address shapes — a fleet ingress IP must never be baked
// into a committed file.
const PRIVATE_IP =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/;
const BEARER = /Bearer\s+[A-Za-z0-9_-]{16,}/;
const SK_TOKEN = /\bsk-[A-Za-z0-9_-]{16,}\b/;

function committedTextFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(join(REPO, "src"));
  for (const name of [
    "spark.env.example",
    ".gitignore",
    "README.md",
    "package.json",
    "SECURITY.md",
    "CONTRIBUTING.md",
  ]) {
    files.push(join(REPO, name));
  }
  return files;
}

test("no committed source file holds a token or private-IP shape", () => {
  for (const file of committedTextFiles()) {
    const text = readFileSync(file, "utf8");
    expect(`${file}: ${PRIVATE_IP.test(text)}`).toBe(`${file}: false`);
    expect(`${file}: ${BEARER.test(text)}`).toBe(`${file}: false`);
    expect(`${file}: ${SK_TOKEN.test(text)}`).toBe(`${file}: false`);
  }
});

test("spark.env.example holds only ${PLACEHOLDER} values", () => {
  const rec = parseEnvFile(readFileSync(join(REPO, "spark.env.example"), "utf8"));
  expect(Object.keys(rec).length).toBeGreaterThan(0);
  for (const [key, value] of Object.entries(rec)) {
    expect(`${key}=${value}`).toMatch(/^[A-Z_]+=\$\{[A-Z_]+\}$/);
  }
});

test(".gitignore ignores .env and *.env", () => {
  const ignore = readFileSync(join(REPO, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  expect(ignore).toContain(".env");
  expect(ignore).toContain("*.env");
});

test("the out-of-tree config paths are untracked", () => {
  let tracked: string;
  try {
    tracked = execFileSync("git", ["-C", REPO, "ls-files"], { encoding: "utf8" });
  } catch {
    return; // not a git repo in this checkout — nothing to assert
  }
  expect(tracked).not.toContain("spark.env\n");
  expect(tracked).not.toContain("spark-home");
});

test("the rendered system prompt carries no secrets — they travel via env only", () => {
  const sentinelToken = "virtual-key-must-not-appear";
  const sentinelUrl = "http://fleet.secret.test:9000";
  process.env.ANTHROPIC_AUTH_TOKEN = sentinelToken;
  process.env.ANTHROPIC_BASE_URL = sentinelUrl;
  try {
    const systemMd = readFileSync(join(REPO, "src/personas/spark/system.md"), "utf8");
    const rendered = new PromptComposer(defaultProviders()).compose(systemMd);
    expect(rendered).not.toContain(sentinelToken);
    expect(rendered).not.toContain(sentinelUrl);
    expect(rendered).not.toMatch(BEARER);
    expect(rendered).not.toMatch(SK_TOKEN);
    expect(rendered).not.toMatch(PRIVATE_IP);
  } finally {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
  }
});
