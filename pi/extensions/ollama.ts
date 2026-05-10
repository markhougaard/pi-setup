import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const baseUrl = "http://localhost:11434/v1";

  const response = await fetch(`${baseUrl}/models`);
  const payload = (await response.json()) as {
    data: Array<{ id: string }>;
  };

  pi.registerProvider("ollama", {
    baseUrl,
    apiKey: "ollama",
    api: "openai-completions",
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    })),
  });
}
