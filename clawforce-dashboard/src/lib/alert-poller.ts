import type { DatabaseSync } from "node:sqlite";
import type { SSEMessage, SyncPollSource, PollResult } from "./sse";

const POLL_BATCH = 100;
const INITIAL_BATCH = 50;

export function createAlertPoller(
  db: DatabaseSync,
  initialCursor: number,
): SyncPollSource {
  let cursor = initialCursor;

  return {
    name: "alert",
    intervalMs: 2000,
    poll(): PollResult {
      const rows = db
        .prepare(
          "SELECT id, ts, severity, type, agent_id, message, acknowledged, data, created_at FROM alerts WHERE id > ? AND acknowledged = 0 ORDER BY id ASC LIMIT ?",
        )
        .all(cursor, POLL_BATCH) as unknown as AlertPollRow[];

      const events: SSEMessage[] = rows.map((row) => ({
        id: `a-${row.id}`,
        event: "alert",
        data: JSON.stringify(row),
      }));

      if (rows.length > 0) {
        cursor = rows[rows.length - 1].id;
      }

      return { events };
    },
  };
}

interface AlertPollRow {
  id: number;
  ts: string;
  severity: string;
  type: string;
  agent_id: string | null;
  message: string;
  acknowledged: number;
  data: string | null;
  created_at: string;
}

export interface AlertBackfillResult {
  events: SSEMessage[];
  cursor: number;
}

export function getAlertBackfill(db: DatabaseSync): AlertBackfillResult {
  const rows = db
    .prepare(
      "SELECT id, ts, severity, type, agent_id, message, acknowledged, data, created_at FROM alerts WHERE acknowledged = 0 ORDER BY id DESC LIMIT ?",
    )
    .all(INITIAL_BATCH) as unknown as AlertPollRow[];

  rows.reverse();

  const events: SSEMessage[] = rows.map((row) => ({
    id: `a-${row.id}`,
    event: "alert",
    data: JSON.stringify(row),
  }));
  const cursor = rows.length > 0 ? rows[rows.length - 1].id : 0;

  return { events, cursor };
}
