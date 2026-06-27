import { afterEach, beforeEach } from "bun:test";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point XDG config/cache at a fresh temp root for each test in the calling file (so the
// spark config/cache helpers resolve under it), restoring the prior values afterward.
export function useTempXdg(prefix: string): void {
  let savedConfig: string | undefined;
  let savedCache: string | undefined;
  beforeEach(() => {
    savedConfig = process.env.XDG_CONFIG_HOME;
    savedCache = process.env.XDG_CACHE_HOME;
    const root = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`);
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.XDG_CACHE_HOME = join(root, "cache");
  });
  afterEach(() => {
    if (savedConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedConfig;
    if (savedCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = savedCache;
  });
}

export function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}
