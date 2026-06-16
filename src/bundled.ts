import type { Persona } from "./persona.ts";
import fableSystem from "./personas/fable-5/system.md" with { type: "text" };

export const BUNDLED: Persona[] = [
  {
    name: "fable-5",
    description: "Fable 5 working style on a base model: result-first, low-narration.",
    systemPrompt: () => fableSystem,
  },
];
