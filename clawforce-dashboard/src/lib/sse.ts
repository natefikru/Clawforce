/**
 * SSE (Server-Sent Events) wire-format utilities and multiplexed polling stream.
 *
 * Provides `formatSSE()` for spec-compliant message formatting, and
 * `createPollingStream()` to multiplex multiple poll sources into a
 * single SSE ReadableStream with heartbeat keep-alive.
 */

export interface SSEMessage {
  id?: string;
  event?: string;
  data: string;
}

/**
 * A source that can be polled at a fixed interval.
 * Each source manages its own internal cursor/state.
 * `poll()` takes no arguments — call it and it returns any new events.
 */
export interface PollSource {
  name: string;
  intervalMs: number;
  poll(): PollResult | Promise<PollResult>;
}

export interface PollResult {
  events: SSEMessage[];
}

/** Format a single SSE message per the spec (https://html.spec.whatwg.org/#server-sent-events). */
export function formatSSE(msg: SSEMessage): string {
  let out = "";
  if (msg.id !== undefined) out += `id: ${msg.id}\n`;
  if (msg.event) out += `event: ${msg.event}\n`;
  out += `data: ${msg.data}\n\n`;
  return out;
}

/** Format an SSE comment (used for heartbeats). */
export function formatComment(text: string): string {
  return `: ${text}\n\n`;
}

export interface PollingStreamOptions {
  /** Initial messages to send before polling begins. */
  initialMessages?: SSEMessage[];
  /** Heartbeat interval in ms. Default: 30000. */
  heartbeatMs?: number;
  /** `retry:` field value in ms sent at stream start. Default: 3000. */
  retryMs?: number;
}

/**
 * Create a ReadableStream that multiplexes multiple PollSources into SSE.
 *
 * Each source is polled at its own interval. A heartbeat comment is sent
 * every `heartbeatMs` milliseconds to keep proxy connections alive.
 * On `signal.abort()` all intervals are cleared and the stream closes.
 */
export function createPollingStream(
  sources: PollSource[],
  signal: AbortSignal,
  options: PollingStreamOptions = {},
): ReadableStream<Uint8Array> {
  const { initialMessages = [], heartbeatMs = 30_000, retryMs = 3000 } = options;
  const encoder = new TextEncoder();
  const intervals: ReturnType<typeof setInterval>[] = [];

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Send retry directive
      controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));

      // Send initial backfill messages
      for (const msg of initialMessages) {
        controller.enqueue(encoder.encode(formatSSE(msg)));
      }

      // Set up polling for each source
      for (const source of sources) {
        const id = setInterval(() => {
          try {
            const result = source.poll();
            if (result instanceof Promise) {
              result
                .then((r) => {
                  for (const event of r.events) {
                    controller.enqueue(encoder.encode(formatSSE(event)));
                  }
                })
                .catch(() => {
                  // Swallow — prevent leaked intervals
                });
            } else {
              for (const event of result.events) {
                controller.enqueue(encoder.encode(formatSSE(event)));
              }
            }
          } catch {
            // Swallow — prevent leaked intervals
          }
        }, source.intervalMs);
        intervals.push(id);
      }

      // Heartbeat
      const heartbeatId = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(formatComment("heartbeat")));
        } catch {
          // Stream already closed
        }
      }, heartbeatMs);
      intervals.push(heartbeatId);

      // Cleanup on abort
      const cleanup = () => {
        for (const id of intervals) clearInterval(id);
        intervals.length = 0;
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      if (signal.aborted) {
        cleanup();
      } else {
        signal.addEventListener("abort", cleanup, { once: true });
      }
    },

    cancel() {
      for (const id of intervals) clearInterval(id);
      intervals.length = 0;
    },
  });
}
