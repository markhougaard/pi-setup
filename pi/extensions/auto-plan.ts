import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRAILER = "Plan written to PLAN.md";
const FILENAME = "PLAN.md";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : "",
      )
      .join("");
  }
  return "";
}

export default function (pi: ExtensionAPI) {
  pi.on("message_end", async (event: any, ctx: any) => {
    const msg = event?.message;
    if (msg?.role !== "assistant") return;

    const content = extractText(msg.content);
    const idx = content.indexOf(TRAILER);
    if (idx < 0) return;

    const plan = content.substring(0, idx).trim();

    const cwd = ctx?.workingDirectory ?? process.cwd();
    const path = join(cwd, FILENAME);

    try {
      await writeFile(path, plan, "utf-8");
      ctx.ui?.notify?.(`PLAN.md saved (${plan.length} chars)`, "info");
    } catch (e: any) {
      ctx.ui?.notify?.(`Failed to save PLAN.md: ${e?.message ?? e}`, "error");
    }
  });
}
