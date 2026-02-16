import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

let tmpDir: string;

function seedAlertsDb(path: string): void {
  const db = new DatabaseSync(path);
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
  db.prepare(
    "INSERT INTO alerts (ts, severity, type, agent_id, message, acknowledged) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("2026-02-15T00:00:00Z", "warning", "budget_exceeded", "agent-1", "Budget exceeded", 0);
  db.prepare(
    "INSERT INTO alerts (ts, severity, type, agent_id, message, acknowledged) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("2026-02-15T00:01:00Z", "error", "pii_violation", "agent-1", "PII violation", 0);
  db.close();
}

describe("alerts API routes", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dashboard-alert-routes-"));
    vi.stubEnv("DATA_DIR", tmpDir);
    seedAlertsDb(join(tmpDir, "clawforce.db"));
  });

  afterEach(async () => {
    const { resetReadDb } = await import("@/lib/db");
    resetReadDb();
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/alerts supports severity and type filters", async () => {
    const { GET } = await import("@/app/api/alerts/route");
    const req = new Request("http://localhost/api/alerts?severity=error&type=pii_violation");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { alerts: Array<{ type: string; severity: string }> };
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe("pii_violation");
    expect(body.alerts[0].severity).toBe("error");
  });

  it("POST /api/alerts/[id]/acknowledge is idempotent", async () => {
    const route = await import("@/app/api/alerts/[id]/acknowledge/route");
    const ctx = { params: Promise.resolve({ id: "1" }) };

    const first = await route.POST(new Request("http://localhost"), ctx);
    expect(first.status).toBe(200);

    const second = await route.POST(new Request("http://localhost"), ctx);
    expect(second.status).toBe(200);

    const payload = await second.json() as { acknowledged: boolean };
    expect(payload.acknowledged).toBe(true);
  });

  it("POST /api/alerts/[id]/acknowledge returns 400 for invalid ID", async () => {
    const route = await import("@/app/api/alerts/[id]/acknowledge/route");
    const res = await route.POST(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/alerts/[id]/acknowledge returns 404 for missing alert", async () => {
    const route = await import("@/app/api/alerts/[id]/acknowledge/route");
    const res = await route.POST(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: "99999" }) },
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/alerts/[id]/acknowledge returns 503 when database is busy", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getWriteDb: () => ({
        prepare: () => ({
          get: () => ({ acknowledged: 0 }),
          run: () => {
            throw new Error("SQLITE_BUSY: database is locked");
          },
        }),
        close: () => undefined,
      }),
    }));

    const route = await import("@/app/api/alerts/[id]/acknowledge/route");
    const res = await route.POST(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(503);

    vi.doUnmock("@/lib/db");
  });
});
