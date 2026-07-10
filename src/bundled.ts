import type { Harness } from "./harness.ts";
import claudeHarness from "./harnesses/claude.md" with { type: "text" };
import type { Persona } from "./persona.ts";
import notusSystem from "./personas/notus/system.md" with { type: "text" };

export const BUNDLED: Persona[] = [
  {
    name: "notus",
    description: "Notus (south wind): extreme-density flagship persona — selective, artifact, and agentic modes; delegation-first orchestration.",
    harness: "claude",
    systemPrompt: () => notusSystem,
  },
];

export const BUNDLED_HARNESSES: Harness[] = [
  {
    name: "claude",
    prompt: () => claudeHarness,
  },
];
