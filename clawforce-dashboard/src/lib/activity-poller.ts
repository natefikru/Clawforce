/**
 * SQLite cursor-based activity poller for SSE streaming.
 *
 * Provides:
 * - `createActivityPoller()` — a PollSource that queries new compliance_events
 * - `getBackfill()` — initial load or reconnection replay with cursor
 */

import type { DatabaseSync } from "node:sqlite";
import type { SSEMessage, SyncPollSource, PollResult } from "./sse";

const BACKFILL_LIMIT = 50;
const RECONNECT_LIMIT = 500;
const POLL_BATCH = 100;

/**
 * Create a PollSource that fetches new compliance_events from SQLite.
 * Manages its own cursor internally — queries `WHERE id > cursor ORDER BY id ASC LIMIT 100`.
 */
export function createActivityPoller(
  db: DatabaseSync,
  initialCursor: number,
  agentId?: string,
): SyncPollSource {
  let cursor = initialCursor;

  return {
    name: "activity",
    intervalMs: 1500,
    poll(): PollResult {
      const { clause, params } = buildAgentFilter(agentId);
      const rows = db
        .prepare(
          `SELECT id, data FROM compliance_events WHERE id > ?${clause} ORDER BY id ASC LIMIT ?`,
        )
        .all(cursor, ...params, POLL_BATCH) as { id: number; data: string }[];

      const events: SSEMessage[] = rows.map((row) => ({
        id: String(row.id),
        event: "activity",
        data: row.data,
      }));

      if (rows.length > 0) {
        cursor = rows[rows.length - 1].id;
      }

      return { events };
    },
  };
}

export interface BackfillResult {
  events: SSEMessage[];
  cursor: number;
  truncated: boolean;
}

/**
 * Get backfill events for initial connection or reconnection replay.
 *
 * - No `lastEventId` or invalid: returns last 50 events (initial load)
 * - With `lastEventId`: replays events since that ID, capped at 500.
 *   If more than 500 missed, returns latest 500 and sets `truncated: true`.
 */
export function getBackfill(
  db: DatabaseSync,
  lastEventId?: string,
  agentId?: string,
): BackfillResult {
  const parsedId = lastEventId !== undefined ? parseInt(lastEventId, 10) : NaN;
  const { clause, params } = buildAgentFilter(agentId);

  if (!isNaN(parsedId) && parsedId > 0) {
    // Check how many events were missed
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM compliance_events WHERE id > ?${clause}`,
      )
      .get(parsedId, ...params) as { cnt: number };

    const truncated = countRow.cnt > RECONNECT_LIMIT;

    let rows: { id: number; data: string }[];
    if (truncated) {
      // Too many missed — fetch the latest 500 (DESC then reverse)
      rows = db
        .prepare(
          `SELECT id, data FROM compliance_events${clause ? ` WHERE ${clause.slice(5)}` : ""} ORDER BY id DESC LIMIT ?`,
        )
        .all(...params, RECONNECT_LIMIT) as { id: number; data: string }[];
      rows.reverse();
    } else {
      // Replay all missed events
      rows = db
        .prepare(
          `SELECT id, data FROM compliance_events WHERE id > ?${clause} ORDER BY id ASC`,
        )
        .all(parsedId, ...params) as { id: number; data: string }[];
    }

    const events: SSEMessage[] = rows.map((row) => ({
      id: String(row.id),
      event: "activity",
      data: row.data,
    }));

    const cursor =
      rows.length > 0 ? rows[rows.length - 1].id : parsedId;

    return { events, cursor, truncated };
  }

  // Initial load: last 50 events in chronological order
  const rows = db
    .prepare(
      `SELECT id, data FROM compliance_events${clause ? ` WHERE ${clause.slice(5)}` : ""} ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, BACKFILL_LIMIT) as { id: number; data: string }[];

  // Reverse to chronological order (oldest first)
  rows.reverse();

  const events: SSEMessage[] = rows.map((row) => ({
    id: String(row.id),
    event: "activity",
    data: row.data,
  }));

  const cursor = rows.length > 0 ? rows[rows.length - 1].id : 0;

  return { events, cursor, truncated: false };
}

function buildAgentFilter(agentId?: string): { clause: string; params: (string | number)[] } {
  if (!agentId) {
    return { clause: "", params: [] };
  }
  const normalized = agentId.trim();
  if (normalized.length === 0) {
    return { clause: "", params: [] };
  }
  if (normalized === "_global") {
    return { clause: " AND (agent_id = ? OR agent_id IS NULL)", params: [normalized] };
  }
  return { clause: " AND agent_id = ?", params: [normalized] };
}
