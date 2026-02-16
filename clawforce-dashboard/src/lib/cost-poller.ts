/**
 * Cost poller — tracks budget_state changes and emits SSE cost events.
 *
 * Polls the budget_state table for today's global budget, comparing
 * (spent, requestCount) values in memory to detect changes without
 * needing an index on updated_at.
 */

import type { DatabaseSync } from "node:sqlite";
import type { PollSource, PollResult, SSEMessage } from "./sse";

export interface CostData {
  spent: number;
  requestCount: number;
}

export function createCostPoller(db: DatabaseSync): PollSource<CostData | null> {
  let lastKnown: CostData | null = null;

  return {
    name: "cost",
    intervalMs: 5000,
    poll(): PollResult<CostData | null> {
      const today = new Date().toISOString().slice(0, 10);

      let row: { spent: number; request_count: number } | undefined;
      try {
        row = db
          .prepare(
            "SELECT spent, request_count FROM budget_state WHERE agent_id = '_global' AND date = ?",
          )
          .get(today) as { spent: number; request_count: number } | undefined;
      } catch {
        return { events: [], cursor: lastKnown };
      }

      if (!row) {
        return { events: [], cursor: lastKnown };
      }

      const current: CostData = {
        spent: row.spent,
        requestCount: row.request_count,
      };

      // Only emit if values changed
      if (
        lastKnown &&
        lastKnown.spent === current.spent &&
        lastKnown.requestCount === current.requestCount
      ) {
        return { events: [], cursor: lastKnown };
      }

      lastKnown = current;

      const events: SSEMessage[] = [
        {
          event: "cost",
          data: JSON.stringify(current),
        },
      ];

      return { events, cursor: lastKnown };
    },
  };
}
