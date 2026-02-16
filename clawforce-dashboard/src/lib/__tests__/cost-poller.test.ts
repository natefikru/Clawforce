import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createCostPoller } from "../cost-poller";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE budget_state (
      agent_id TEXT NOT NULL DEFAULT '_global',
      date TEXT NOT NULL,
      spent REAL NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, date)
    );
  `);
  return db;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("createCostPoller", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("emits cost event when budget_state has data", () => {
    db.prepare(
      "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
    ).run("_global", today(), 1.5, 10);

    const poller = createCostPoller(db);
    const result = poller.poll(null);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe("cost");
    const data = JSON.parse(result.events[0].data);
    expect(data.spent).toBe(1.5);
    expect(data.requestCount).toBe(10);
  });

  it("does not emit when values unchanged", () => {
    db.prepare(
      "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
    ).run("_global", today(), 1.5, 10);

    const poller = createCostPoller(db);

    // First poll emits
    const r1 = poller.poll(null);
    expect(r1.events).toHaveLength(1);

    // Second poll with same values does not emit
    const r2 = poller.poll(r1.cursor);
    expect(r2.events).toHaveLength(0);
  });

  it("emits when values change", () => {
    db.prepare(
      "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
    ).run("_global", today(), 1.0, 5);

    const poller = createCostPoller(db);
    poller.poll(null); // First poll

    // Update values
    db.prepare(
      "UPDATE budget_state SET spent = ?, request_count = ? WHERE agent_id = '_global' AND date = ?",
    ).run(2.5, 15, today());

    const r2 = poller.poll(null);
    expect(r2.events).toHaveLength(1);
    const data = JSON.parse(r2.events[0].data);
    expect(data.spent).toBe(2.5);
    expect(data.requestCount).toBe(15);
  });

  it("returns empty when no budget_state exists", () => {
    const poller = createCostPoller(db);
    const result = poller.poll(null);

    expect(result.events).toHaveLength(0);
  });

  it("has correct PollSource metadata", () => {
    const poller = createCostPoller(db);
    expect(poller.name).toBe("cost");
    expect(poller.intervalMs).toBe(5000);
  });

  it("ignores non-global agent budget states", () => {
    db.prepare(
      "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
    ).run("agent-1", today(), 99.0, 999);

    const poller = createCostPoller(db);
    const result = poller.poll(null);

    expect(result.events).toHaveLength(0);
  });
});
