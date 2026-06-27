// Minimum `claude` that honors CLAUDE_CONFIG_DIR. Below it, isolation silently fails
// and the write-back bleed re-manifests, so the launcher hard-refuses.
// TODO: set the real pinned minimum after the live GO/NO-GO isolation matrix.
export const MIN_CLAUDE_VERSION = "1.0.0";

export function parseVersion(text: string): [number, number, number] | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function meetsMinimum(version: string, min: string = MIN_CLAUDE_VERSION): boolean {
  const v = parseVersion(version);
  const m = parseVersion(min);
  if (!v || !m) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] > m[i]) return true;
    if (v[i] < m[i]) return false;
  }
  return true;
}
