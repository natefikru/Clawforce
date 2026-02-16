import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dashboard-db-test-"));
  vi.stubEnv("DATA_DIR", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Reset module cache to clear cached DB
  vi.resetModules();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getReadDb", () => {
  it("returns null when DB file does not exist", async () => {
    const { getReadDb } = await import("@/lib/db");
    const db = getReadDb();
    expect(db).toBeNull();
  });

  it("returns a DatabaseSync instance when DB exists", async () => {
    // Create the DB file first
    const db = new DatabaseSync(join(tmpDir, "clawforce.db"));
    db.exec("CREATE TABLE test (id INTEGER)");
    db.close();

    const { getReadDb } = await import("@/lib/db");
    const readDb = getReadDb();
    expect(readDb).not.toBeNull();
    readDb?.close();
  });

  it("returns cached instance on second call", async () => {
    const db = new DatabaseSync(join(tmpDir, "clawforce.db"));
    db.exec("CREATE TABLE test (id INTEGER)");
    db.close();

    const { getReadDb } = await import("@/lib/db");
    const db1 = getReadDb();
    const db2 = getReadDb();
    expect(db1).toBe(db2);
    db1?.close();
  });
});

describe("getWriteDb", () => {
  it("returns a write-capable DatabaseSync instance", async () => {
    const db = new DatabaseSync(join(tmpDir, "clawforce.db"));
    db.exec("CREATE TABLE alerts (id INTEGER PRIMARY KEY, acknowledged INTEGER)");
    db.close();

    const { getWriteDb } = await import("@/lib/db");
    const writeDb = getWriteDb();
    expect(writeDb).not.toBeNull();

    writeDb?.prepare("INSERT INTO alerts (id, acknowledged) VALUES (?, ?)").run(1, 0);
    const row = writeDb?.prepare("SELECT acknowledged FROM alerts WHERE id = 1").get() as { acknowledged: number };
    expect(row.acknowledged).toBe(0);

    writeDb?.close();
  });
});
