import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "ollama";
const OLLAMA_BASE = "http://localhost:11434";
const PIN_MODEL = "gemma4-fast";

const CYCLE = [
  { id: "gemma4-fast:latest", label: "Fast" },
  { id: "gemma4-think:latest", label: "Plan" },
  { id: "qwen-coder:latest",  label: "Code" },
] as const;

async function repin(modelName: string) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, keep_alive: -1, prompt: "" }),
    });
  } catch {
    // best-effort; swallow errors so the cycle UX never blocks
  }
}

export default function (pi: ExtensionAPI) {
  let index = 0;

  const advance = async (ctx: any) => {
    const next = CYCLE[(index + 1) % CYCLE.length];
    const model = ctx.modelRegistry.find(PROVIDER, next.id);
    if (!model) {
      ctx.ui.notify(
        `Model "${next.id}" not found in provider "${PROVIDER}".`,
        "error",
      );
      return;
    }
    const ok = await pi.setModel(model);
    if (!ok) {
      ctx.ui.notify(`Failed to switch to ${next.id}`, "error");
      return;
    }
    index = (index + 1) % CYCLE.length;
    ctx.ui.notify(`Mode: ${next.label} (${next.id})`, "info");

    if (next.id.startsWith(PIN_MODEL)) {
      void repin(PIN_MODEL);
    }
  };

  pi.registerShortcut("shift+tab", {
    description: "Cycle local model: Fast → Plan → Code",
    handler: advance,
  });

  pi.registerCommand("think", {
    description: "Cycle local model (same as ctrl+m): Fast → Plan → Code",
    handler: async (_args, ctx) => advance(ctx),
  });
}
