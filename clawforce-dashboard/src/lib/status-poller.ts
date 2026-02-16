/**
 * Status poller — monitors Docker container state changes via SSE.
 *
 * Diffs container states against previous snapshot using JSON serialization.
 * Implements exponential backoff after consecutive failures (3 failures → 60s).
 */

import type { PollSource, PollResult, SSEMessage } from "./sse";
import { getContainerStatus, type AgentStatus } from "./container-status";

const BASE_INTERVAL = 10_000;
const BACKOFF_INTERVAL = 60_000;
const FAILURE_THRESHOLD = 3;

export interface StatusSnapshot {
  agents: AgentStatus[];
}

export function createStatusPoller(): PollSource {
  let lastSnapshot: string | null = null;
  let consecutiveFailures = 0;
  let nextPollAt = 0;

  return {
    name: "status",
    intervalMs: BASE_INTERVAL,
    async poll(): Promise<PollResult> {
      // Backoff: skip poll if too early
      if (Date.now() < nextPollAt) {
        return { events: [] };
      }

      let agents: AgentStatus[];
      try {
        agents = await getContainerStatus();
        consecutiveFailures = 0;
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= FAILURE_THRESHOLD) {
          nextPollAt = Date.now() + BACKOFF_INTERVAL;
        }
        return { events: [] };
      }

      const snapshot: StatusSnapshot = { agents };
      const serialized = JSON.stringify(snapshot);

      if (serialized === lastSnapshot) {
        return { events: [] };
      }

      lastSnapshot = serialized;

      const events: SSEMessage[] = [
        {
          event: "status",
          data: serialized,
        },
      ];

      return { events };
    },
  };
}
