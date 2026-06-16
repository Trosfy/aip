export interface ContextProvider {
  lines(): string[];
}

function sh(cmd: string[]): string {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
  if (proc.exitCode !== 0) return "";
  return proc.stdout.toString().trim();
}

export class WorkingDirectory implements ContextProvider {
  lines(): string[] {
    return [`- Working directory: ${process.cwd()}`];
  }
}

export class System implements ContextProvider {
  lines(): string[] {
    const sys = sh(["uname", "-s"]) || "unknown";
    const machine = sh(["uname", "-m"]);
    const release = sh(["uname", "-r"]);
    const shell = (process.env.SHELL ?? "").split("/").pop() || "unknown";
    return [
      `- Platform: ${`${sys} ${machine}`.trim()}`,
      `- OS: ${`${sys} ${release}`.trim()}`,
      `- Shell: ${shell}`,
    ];
  }
}

export class Clock implements ContextProvider {
  lines(): string[] {
    const local = sh(["date", "+%A %Y-%m-%d %H:%M %Z"]);
    const utc = sh(["date", "-u", "+%A %Y-%m-%d %H:%M"]);
    return [`- Date & time at launch: ${local} = ${utc} UTC`];
  }
}

export class Git implements ContextProvider {
  lines(): string[] {
    if (sh(["git", "rev-parse", "--is-inside-work-tree"]) !== "true") {
      return ["- Git: not a repository"];
    }
    const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]) || "(detached)";
    const status = sh(["git", "status", "--porcelain"]);
    const count = status ? status.split("\n").length : 0;
    return [`- Git: branch ${branch}, ${count} uncommitted change(s)`];
  }
}

export function defaultProviders(): ContextProvider[] {
  return [new WorkingDirectory(), new System(), new Clock(), new Git()];
}
