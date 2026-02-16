import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createActivityPoller, getBackfill } from "../activity-poller";

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
  `);
  return db;
}

function seedEvents(db: DatabaseSync, count: number, startId?: number): void {
  const stmt = db.prepare(
    "INSERT INTO compliance_events (ts, event, data) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < count; i++) {
    const idx = (startId ?? 0) + i;
    const ts = new Date(Date.now() - (count - i) * 1000).toISOString();
    const data = JSON.stringify({
      ts,
      event: "tool_call",
      tool: `tool_${idx}`,
      success: true,
    });
    stmt.run(ts, "tool_call", data);
  }
}

describe("getBackfill", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns last 50 events in chronological order for initial load", () => {
    seedEvents(db, 100);

    const result = getBackfill(db);

    expect(result.events).toHaveLength(50);
    expect(result.truncated).toBe(false);
    expect(result.cursor).toBeGreaterThan(0);

    // Verify chronological order (oldest first)
    const ids = result.events.map((e) => parseInt(e.id!, 10));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }

    // Should be the last 50 (ids 51-100)
    expect(ids[0]).toBe(51);
    expect(ids[49]).toBe(100);
  });

  it("returns all events when fewer than 50 exist", () => {
    seedEvents(db, 10);

    const result = getBackfill(db);

    expect(result.events).toHaveLength(10);
    expect(result.truncated).toBe(false);
  });

  it("returns empty for empty database", () => {
    const result = getBackfill(db);

    expect(result.events).toHaveLength(0);
    expect(result.cursor).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("replays events from cursor on reconnection", () => {
    seedEvents(db, 20);

    // Simulate reconnection from event ID 15
    const result = getBackfill(db, "15");

    expect(result.events).toHaveLength(5); // IDs 16-20
    expect(result.truncated).toBe(false);
    const ids = result.events.map((e) => parseInt(e.id!, 10));
    expect(ids[0]).toBe(16);
    expect(ids[4]).toBe(20);
  });

  it("caps reconnection replay at 500 and sets truncated", () => {
    seedEvents(db, 600);

    // Reconnect from very early — should truncate
    const result = getBackfill(db, "1");

    expect(result.events).toHaveLength(500);
    expect(result.truncated).toBe(true);

    // Should be the latest 500 events
    const lastId = parseInt(
      result.events[result.events.length - 1].id!,
      10,
    );
    expect(lastId).toBe(600);
  });

  it("treats non-numeric Last-Event-ID as fresh connect", () => {
    seedEvents(db, 10);

    const result = getBackfill(db, "not-a-number");

    expect(result.events).toHaveLength(10);
    expect(result.truncated).toBe(false);
  });

  it("treats zero Last-Event-ID as fresh connect", () => {
    seedEvents(db, 10);

    const result = getBackfill(db, "0");

    expect(result.events).toHaveLength(10);
    expect(result.truncated).toBe(false);
  });

  it("returns empty when Last-Event-ID exceeds max row ID", () => {
    seedEvents(db, 5);

    const result = getBackfill(db, "999");

    expect(result.events).toHaveLength(0);
    expect(result.cursor).toBe(999);
    expect(result.truncated).toBe(false);
  });

  it("all events have event: activity and valid id", () => {
    seedEvents(db, 5);

    const result = getBackfill(db);

    for (const event of result.events) {
      expect(event.event).toBe("activity");
      expect(event.id).toBeDefined();
      expect(parseInt(event.id!, 10)).toBeGreaterThan(0);
      expect(() => JSON.parse(event.data)).not.toThrow();
    }
  });
});

describe("createActivityPoller", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns only events after initial cursor", () => {
    seedEvents(db, 10);

    const poller = createActivityPoller(db, 5);
    const result = poller.poll();

    expect(result.events).toHaveLength(5); // IDs 6-10

    const ids = result.events.map((e) => parseInt(e.id!, 10));
    expect(ids[0]).toBe(6);
    expect(ids[4]).toBe(10);
  });

  it("returns empty when no new events", () => {
    seedEvents(db, 5);

    const poller = createActivityPoller(db, 5);
    const result = poller.poll();

    expect(result.events).toHaveLength(0);
  });

  it("tracks cursor internally across successive polls", () => {
    seedEvents(db, 5);

    const poller = createActivityPoller(db, 0);

    // First poll gets all 5
    const r1 = poller.poll();
    expect(r1.events).toHaveLength(5);

    // Second poll gets nothing (cursor advanced internally)
    const r2 = poller.poll();
    expect(r2.events).toHaveLength(0);

    // Add more events
    seedEvents(db, 3);

    // Third poll picks up new events
    const r3 = poller.poll();
    expect(r3.events).toHaveLength(3);
  });

  it("has correct PollSource metadata", () => {
    const poller = createActivityPoller(db, 0);

    expect(poller.name).toBe("activity");
    expect(poller.intervalMs).toBe(1500);
  });

  it("batches results to 100 max", () => {
    seedEvents(db, 150);

    const poller = createActivityPoller(db, 0);
    const result = poller.poll();

    expect(result.events).toHaveLength(100);
  });
});
