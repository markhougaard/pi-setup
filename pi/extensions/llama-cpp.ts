import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  pi.registerProvider("llama-cpp", {
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "none",
    api: "openai-completions",
    // Only ONE of these is actually being served on :8080 at a time — see
    // `bin/llm-swap`, which flips the LaunchAgent and sets `defaultModel` to match.
    // Both are registered so pi recognises whichever one is currently loaded.
    models: [
      {
        id: "ggml-org/gpt-oss-20b-GGUF",
        name: "gpt-oss-20b (llama.cpp)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8000,
      },
      {
        id: "unsloth/gemma-4-12b-it-GGUF",
        name: "gemma-4-12b (llama.cpp)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8000,
      },
    ],
  });
}
