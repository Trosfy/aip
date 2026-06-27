import { normalizeBaseUrl } from "./env.ts";

export type ProbeKind = "network" | "auth" | "model-absent" | "reachable";

export interface ProbeResult {
  ok: boolean;
  models: string[];
  diagnostic?: { kind: ProbeKind; message: string };
}

const TIMEOUT_MS = 5000;

function extractModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
}

// Connectivity probe with three distinct diagnostics: network-unreachable,
// 401-bad-token, reachable-but-model-absent. `/v1/models` with the token proves
// auth + lists seats; a minimal `/v1/messages` POST proves the Anthropic route claude
// actually uses is present. 5s AbortController bound on each request.
export async function probeFleet(
  baseUrl: string,
  token: string,
  opts: { expectModel?: string } = {},
): Promise<ProbeResult> {
  const root = normalizeBaseUrl(baseUrl);

  let models: string[];
  try {
    const res = await fetchWithTimeout(`${root}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        models: [],
        diagnostic: { kind: "auth", message: `HTTP ${res.status} on /v1/models — token rejected` },
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        models: [],
        diagnostic: {
          kind: "reachable",
          message: `reachable but /v1/models returned HTTP ${res.status}`,
        },
      };
    }
    models = extractModelIds(await res.json());
  } catch (error) {
    return { ok: false, models: [], diagnostic: networkDiagnostic(error) };
  }

  if (opts.expectModel && !models.includes(opts.expectModel)) {
    return {
      ok: false,
      models,
      diagnostic: {
        kind: "model-absent",
        message: `model '${opts.expectModel}' not served by the fleet — available: ${models.join(", ") || "(none)"}`,
      },
    };
  }

  try {
    const res = await fetchWithTimeout(`${root}/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.expectModel ?? models[0] ?? "haiku",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (res.status === 404) {
      return {
        ok: false,
        models,
        diagnostic: {
          kind: "reachable",
          message: "/v1/messages returned 404 — gateway is not Anthropic-compatible",
        },
      };
    }
  } catch (error) {
    return { ok: false, models, diagnostic: networkDiagnostic(error) };
  }

  return { ok: true, models };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function networkDiagnostic(error: unknown): { kind: ProbeKind; message: string } {
  if (error instanceof Error && error.name === "AbortError") {
    return { kind: "network", message: `timed out after ${TIMEOUT_MS / 1000}s — fleet unreachable (VPN down?)` };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { kind: "network", message: `network error — fleet unreachable: ${detail}` };
}
