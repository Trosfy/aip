import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface Runner {
  run(promptPath: string, extraArgs: string[], env?: Record<string, string>): number;
}

export class PlainRunner implements Runner {
  constructor(private readonly claudeBin: string) {}

  run(promptPath: string, extraArgs: string[], env?: Record<string, string>): number {
    const result = spawnSync(
      this.claudeBin,
      ["--system-prompt-file", promptPath, ...extraArgs],
      { stdio: "inherit", env },
    );
    return result.status ?? 1;
  }
}

export class RootSudoRunner implements Runner {
  constructor(
    private readonly claudeBin: string,
    private readonly owner: string,
    private readonly restore: string[],
  ) {}

  run(promptPath: string, extraArgs: string[], env?: Record<string, string>): number {
    const result = spawnSync(
      "sudo",
      ["-E", `HOME=${homedir()}`, this.claudeBin, "--system-prompt-file", promptPath, ...extraArgs],
      { stdio: "inherit", env },
    );
    this.restoreOwnership();
    return result.status ?? 1;
  }

  private restoreOwnership(): void {
    const targets = this.restore.filter((path) => existsSync(path));
    if (targets.length === 0) return;
    spawnSync("sudo", ["chown", "-R", this.owner, ...targets], { stdio: "ignore" });
  }
}
