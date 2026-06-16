import type { ContextProvider } from "./context.ts";

export class PromptComposer {
  constructor(private readonly providers: ContextProvider[]) {}

  compose(basePrompt: string): string {
    const parts = [basePrompt.trimEnd(), "", "# Environment"];
    for (const provider of this.providers) parts.push(...provider.lines());
    return parts.join("\n") + "\n";
  }
}
