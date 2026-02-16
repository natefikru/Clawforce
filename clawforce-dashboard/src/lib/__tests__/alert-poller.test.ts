import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createAlertPoller, getAlertBackfill } from "../alert-poller";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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

describe("alert-poller", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns unacknowledged alerts on backfill", () => {
    db.prepare(
      "INSERT INTO alerts (ts, severity, type, message, acknowledged) VALUES (?, ?, ?, ?, ?)",
    ).run("2026-02-15T00:00:00Z", "warning", "budget_exceeded", "Budget exceeded", 0);
    db.prepare(
      "INSERT INTO alerts (ts, severity, type, message, acknowledged) VALUES (?, ?, ?, ?, ?)",
    ).run("2026-02-15T00:01:00Z", "error", "pii_violation", "PII violation", 1);

    const result = getAlertBackfill(db);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe("alert");
  });

  it("poll emits only new unacknowledged alerts and advances cursor", () => {
    db.prepare(
      "INSERT INTO alerts (ts, severity, type, message, acknowledged) VALUES (?, ?, ?, ?, ?)",
    ).run("2026-02-15T00:00:00Z", "warning", "budget_exceeded", "Budget exceeded", 0);
    const backfill = getAlertBackfill(db);
    const poller = createAlertPoller(db, backfill.cursor);

    const first = poller.poll();
    expect(first.events).toHaveLength(0);

    db.prepare(
      "INSERT INTO alerts (ts, severity, type, message, acknowledged) VALUES (?, ?, ?, ?, ?)",
    ).run("2026-02-15T00:02:00Z", "error", "agent_error", "Agent failed", 0);
    db.prepare(
      "INSERT INTO alerts (ts, severity, type, message, acknowledged) VALUES (?, ?, ?, ?, ?)",
    ).run("2026-02-15T00:03:00Z", "info", "model_health", "Healthy", 1);

    const second = poller.poll();
    expect(second.events).toHaveLength(1);
    expect(second.events[0].event).toBe("alert");
  });
});
