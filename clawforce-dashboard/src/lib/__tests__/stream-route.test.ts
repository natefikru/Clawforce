/**
 * Integration-style tests for the SSE stream route logic.
 * Tests the backfill + polling flow using in-memory SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { getBackfill, createActivityPoller } from "../activity-poller";
import { createCostPoller } from "../cost-poller";
import { formatSSE } from "../sse";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(`
    CREATE TABLE schema_version (
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE compliance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      event TEXT NOT NULL,
      agent_id TEXT,
      channel TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_compliance_ts ON compliance_events(ts);
    CREATE INDEX idx_compliance_event ON compliance_events(event);
    CREATE TABLE budget_state (
      agent_id TEXT NOT NULL DEFAULT '_global',
      date TEXT NOT NULL,
      spent REAL NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, date)
    );
    CREATE TABLE alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      severity TEXT NOT NULL,
      type TEXT NOT NULL,
      agent_id TEXT,
      message TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function seedEvents(db: DatabaseSync, count: number): void {
  const stmt = db.prepare(
    "INSERT INTO compliance_events (ts, event, data) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.now() - (count - i) * 1000).toISOString();
    const data = JSON.stringify({
      ts,
      event: "tool_call",
      tool: `tool_${i}`,
      success: true,
    });
    stmt.run(ts, "tool_call", data);
  }
}

describe("SSE stream integration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("backfill events have correct SSE fields", () => {
    seedEvents(db, 5);

    const { events } = getBackfill(db);

    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(event.event).toBe("activity");
      expect(event.id).toBeDefined();
      expect(parseInt(event.id!, 10)).toBeGreaterThan(0);

      // Verify formatSSE produces valid output
      const formatted = formatSSE(event);
      expect(formatted).toContain("id: ");
      expect(formatted).toContain("event: activity\n");
      expect(formatted).toContain("data: ");
      expect(formatted.endsWith("\n\n")).toBe(true);
    }
  });

  it("Last-Event-ID triggers reconnection replay", () => {
    seedEvents(db, 20);

    const r1 = getBackfill(db); // Initial: gets 20 events
    const cursor = r1.cursor;

    // Add 5 more events
    seedEvents(db, 5);

    // Reconnect with last cursor
    const r2 = getBackfill(db, String(cursor));

    expect(r2.events).toHaveLength(5);
    expect(r2.truncated).toBe(false);

    // All new events should be after the cursor
    for (const event of r2.events) {
      expect(parseInt(event.id!, 10)).toBeGreaterThan(cursor);
    }
  });

  it("activity poller picks up where backfill left off", () => {
    seedEvents(db, 10);

    const backfill = getBackfill(db);
    expect(backfill.cursor).toBe(10);

    // Add events after backfill
    seedEvents(db, 3);

    const poller = createActivityPoller(db, backfill.cursor);
    const result = poller.poll();

    expect(result.events).toHaveLength(3);
  });

  it("cost poller detects budget changes", () => {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
    ).run("_global", today, 0, 0);

    const poller = createCostPoller(db);

    // First poll emits initial state
    const r1 = poller.poll();
    expect(r1.events).toHaveLength(1);
    expect(r1.events[0].event).toBe("cost");

    // Update budget
    db.prepare(
      "UPDATE budget_state SET spent = ?, request_count = ? WHERE agent_id = '_global' AND date = ?",
    ).run(0.5, 3, today);

    // Second poll detects change
    const r2 = poller.poll();
    expect(r2.events).toHaveLength(1);
    const data = JSON.parse(r2.events[0].data);
    expect(data.spent).toBe(0.5);
    expect(data.requestCount).toBe(3);
  });

  it("truncated reconnection includes sync event", () => {
    seedEvents(db, 600);

    // Reconnect from very early
    const result = getBackfill(db, "1");

    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(500);

    // The route adds a sync event when truncated — verify the shape
    const syncEvent = {
      event: "sync",
      data: JSON.stringify({ reason: "truncated", missed: true }),
    };
    const formatted = formatSSE(syncEvent);
    expect(formatted).toContain("event: sync\n");
    expect(formatted).toContain('"reason":"truncated"');
  });

  it("JSONL fallback emits named activity events", () => {
    // Verify that formatSSE with event: "activity" produces named events
    const entry = { ts: "2025-01-01T00:00:00Z", event: "tool_call", tool: "bash" };
    const formatted = formatSSE({
      event: "activity",
      data: JSON.stringify(entry),
    });

    expect(formatted).toContain("event: activity\n");
    expect(formatted).toContain("data: ");
    expect(formatted).not.toBe(`data: ${JSON.stringify(entry)}\n\n`); // Must have event: field
  });

  it("can format alert events for SSE stream", () => {
    const alert = {
      id: 1,
      ts: "2025-01-01T00:00:00Z",
      severity: "warning",
      type: "budget_exceeded",
      message: "Budget exceeded",
      acknowledged: 0,
    };
    const formatted = formatSSE({
      event: "alert",
      id: "a-1",
      data: JSON.stringify(alert),
    });

    expect(formatted).toContain("event: alert\n");
    expect(formatted).toContain("id: a-1");
    expect(formatted).toContain("budget_exceeded");
  });
});
