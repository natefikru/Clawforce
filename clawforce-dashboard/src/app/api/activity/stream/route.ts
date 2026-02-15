import { NextRequest } from "next/server";
import { watch, readFileSync, existsSync, statSync } from "node:fs";
import { parseJsonl } from "@/lib/log-parser";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;
const INITIAL_ENTRIES = 50;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastSize = 0;

      // Send initial batch of recent entries
      try {
        if (existsSync(COMPLIANCE_LOG)) {
          const content = readFileSync(COMPLIANCE_LOG, "utf8");
          lastSize = Buffer.byteLength(content, "utf8");
          const entries = parseJsonl(content);
          const recent = entries.slice(-INITIAL_ENTRIES);
          if (recent.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(recent)}\n\n`),
            );
          }
        }
      } catch {
        // Best effort — send empty if file can't be read
      }

      // Watch for file changes
      let watcher: ReturnType<typeof watch> | null = null;
      try {
        watcher = watch(COMPLIANCE_LOG, () => {
          try {
            if (!existsSync(COMPLIANCE_LOG)) return;
            const stat = statSync(COMPLIANCE_LOG);
            if (stat.size <= lastSize) return;

            const content = readFileSync(COMPLIANCE_LOG, "utf8");
            const currentSize = Buffer.byteLength(content, "utf8");
            if (currentSize <= lastSize) return;

            // Only parse new content
            const newContent = content.slice(lastSize);
            lastSize = currentSize;

            const newEntries = parseJsonl(newContent);
            if (newEntries.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(newEntries)}\n\n`),
              );
            }
          } catch {
            // Ignore read errors during watch
          }
        });
      } catch {
        // File doesn't exist yet — that's ok, we'll just not have a watcher
      }

      // Clean up on client disconnect
      req.signal.addEventListener("abort", () => {
        if (watcher) watcher.close();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
