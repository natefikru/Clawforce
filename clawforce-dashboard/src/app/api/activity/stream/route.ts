/**
 * SSE endpoint for real-time activity streaming.
 *
 * Primary path: SQLite cursor-based polling with Last-Event-ID reconnection.
 * Fallback: JSONL fs.watch() when SQLite is unavailable.
 *
 * Multiplexes three event streams over a single SSE connection:
 * - activity (1.5s) — compliance events from SQLite
 * - cost (5s)       — budget_state changes
 * - status (10s)    — Docker container state changes
 */

import { NextRequest } from "next/server";
import {
  watch,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
  statSync,
} from "node:fs";
import { parseJsonl } from "@/lib/log-parser";
import { getReadDb, resetReadDb } from "@/lib/db";
import { createPollingStream, formatSSE } from "@/lib/sse";
import { createActivityPoller, getBackfill } from "@/lib/activity-poller";
import { createCostPoller } from "@/lib/cost-poller";
import { createStatusPoller } from "@/lib/status-poller";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;
const INITIAL_ENTRIES = 50;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const lastEventId =
    req.headers.get("Last-Event-ID") ?? undefined;

  // Try SQLite path
  const db = getReadDb();
  if (db) {
    try {
      const backfill = getBackfill(db, lastEventId);

      const initialMessages = [...backfill.events];

      // If reconnection was truncated, send a sync event so client knows to reset
      if (backfill.truncated) {
        initialMessages.push({
          event: "sync",
          data: JSON.stringify({ reason: "truncated", missed: true }),
        });
      }

      const sources = [
        createActivityPoller(db, backfill.cursor),
        createCostPoller(db),
        createStatusPoller(),
      ];

      const stream = createPollingStream(sources, req.signal, {
        initialMessages,
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch {
      resetReadDb();
      // Fall through to JSONL fallback
    }
  }

  // JSONL fallback — preserved for when SQLite is unavailable
  return createJsonlFallbackResponse(req);
}

function createJsonlFallbackResponse(req: NextRequest): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send retry directive
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      let lastByteOffset = 0;

      // Send initial batch of recent entries
      try {
        if (existsSync(COMPLIANCE_LOG)) {
          const content = readFileSync(COMPLIANCE_LOG, "utf8");
          lastByteOffset = Buffer.byteLength(content, "utf8");
          const entries = parseJsonl(content);
          const recent = entries.slice(-INITIAL_ENTRIES);
          for (const entry of recent) {
            // MF-2 fix: emit named events so client addEventListener("activity", ...) works
            controller.enqueue(
              encoder.encode(
                formatSSE({ event: "activity", data: JSON.stringify(entry) }),
              ),
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
            if (stat.size <= lastByteOffset) return;

            const newByteCount = stat.size - lastByteOffset;
            const buf = Buffer.alloc(newByteCount);
            const fd = openSync(COMPLIANCE_LOG, "r");
            try {
              readSync(fd, buf, 0, newByteCount, lastByteOffset);
            } finally {
              closeSync(fd);
            }

            lastByteOffset = stat.size;
            const newContent = buf.toString("utf8");

            const newEntries = parseJsonl(newContent);
            for (const entry of newEntries) {
              // MF-2 fix: emit named events for JSONL fallback too
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    event: "activity",
                    data: JSON.stringify(entry),
                  }),
                ),
              );
            }
          } catch {
            // Ignore read errors during watch
          }
        });
      } catch {
        // File doesn't exist yet — that's ok
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
