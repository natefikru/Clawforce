/**
 * SQLite cursor-based activity poller for SSE streaming.
 *
 * Provides:
 * - `createActivityPoller()` — a PollSource that queries new compliance_events
 * - `getBackfill()` — initial load or reconnection replay with cursor
 */

import type { DatabaseSync } from "node:sqlite";
import type { SSEMessage, SyncPollSource, PollResult } from "./sse";
import { buildAgentSqlFilter, normalizeAgentId } from "./agent-filter";

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
  const normalizedAgentId = normalizeAgentId(agentId);

  return {
    name: "activity",
    intervalMs: 1500,
    poll(): PollResult {
      const { whereSql, params } = buildWhereSql(["id > ?"], [cursor], normalizedAgentId);
      const rows = db
        .prepare(
          `SELECT id, data FROM compliance_events ${whereSql} ORDER BY id ASC LIMIT ?`,
        )
        .all(...params, POLL_BATCH) as { id: number; data: string }[];

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
  const normalizedAgentId = normalizeAgentId(agentId);

  if (!isNaN(parsedId) && parsedId > 0) {
    // Check how many events were missed
    const countQuery = buildWhereSql(["id > ?"], [parsedId], normalizedAgentId);
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM compliance_events ${countQuery.whereSql}`,
      )
      .get(...countQuery.params) as { cnt: number };

    const truncated = countRow.cnt > RECONNECT_LIMIT;

    let rows: { id: number; data: string }[];
    if (truncated) {
      // Too many missed — fetch the latest 500 (DESC then reverse)
      const truncatedQuery = buildWhereSql([], [], normalizedAgentId);
      rows = db
        .prepare(
          `SELECT id, data FROM compliance_events ${truncatedQuery.whereSql} ORDER BY id DESC LIMIT ?`,
        )
        .all(...truncatedQuery.params, RECONNECT_LIMIT) as { id: number; data: string }[];
      rows.reverse();
    } else {
      // Replay all missed events
      const replayQuery = buildWhereSql(["id > ?"], [parsedId], normalizedAgentId);
      rows = db
        .prepare(
          `SELECT id, data FROM compliance_events ${replayQuery.whereSql} ORDER BY id ASC`,
        )
        .all(...replayQuery.params) as { id: number; data: string }[];
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
  const initialQuery = buildWhereSql([], [], normalizedAgentId);
  const rows = db
    .prepare(
      `SELECT id, data FROM compliance_events ${initialQuery.whereSql} ORDER BY id DESC LIMIT ?`,
    )
    .all(...initialQuery.params, BACKFILL_LIMIT) as { id: number; data: string }[];

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

function buildWhereSql(
  baseConditions: string[],
  baseParams: (string | number)[],
  agentId?: string,
): { whereSql: string; params: (string | number)[] } {
  const conditions = [...baseConditions];
  const params = [...baseParams];
  const { clause, params: agentParams } = buildAgentSqlFilter(agentId);
  if (clause) {
    conditions.push(clause);
    params.push(...agentParams);
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { whereSql, params };
}
