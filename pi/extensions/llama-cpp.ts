import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  pi.registerProvider("llama-cpp", {
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "none",
    api: "openai-completions",
    models: [
      {
        id: "ggml-org/gpt-oss-20b-GGUF",
        name: "gpt-oss-20b (llama.cpp)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16384,
        maxTokens: 8000,
      },
    ],
  });
}
