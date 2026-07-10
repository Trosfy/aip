import type { ContextProvider } from "./context.ts";

export class PromptComposer {
  constructor(private readonly providers: ContextProvider[]) {}

  compose(basePrompt: string, modules: string[] = []): string {
    const parts = [basePrompt.trimEnd()];
    for (const module of modules) parts.push("", module.trimEnd());
    parts.push("", "# Environment");
    for (const provider of this.providers) parts.push(...provider.lines());
    return parts.join("\n") + "\n";
  }
}
