import { describe, it, expect, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDatabase,
  closeDatabase,
  createTestDatabase,
} from "../../../src/storage/database.js";
import { getCurrentVersion } from "../../../src/storage/migrations.js";

const EXPECTED_TABLES = [
  "compliance_events",
  "routing_decisions",
  "usage_metrics",
  "budget_state",
  "alerts",
  "model_health_state",
  "schema_version",
];

const EXPECTED_INDEXES = [
  "idx_compliance_ts",
  "idx_compliance_event",
  "idx_compliance_agent",
  "idx_compliance_event_ts",
  "idx_routing_ts",
  "idx_routing_agent",
  "idx_routing_model",
  "idx_routing_pii",
  "idx_usage_ts",
  "idx_usage_agent",
  "idx_usage_model",
  "idx_usage_date",
  "idx_alerts_ts",
  "idx_alerts_severity",
  "idx_alerts_type",
  "idx_alerts_type_ts",
  "idx_model_health_state_updated",
];

describe("database", () => {
  afterEach(() => {
    closeDatabase();
  });

  describe("createTestDatabase", () => {
    it("creates an in-memory database with all tables", () => {
      const db = createTestDatabase();
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      for (const table of EXPECTED_TABLES) {
        expect(tableNames).toContain(table);
      }

      db.close();
    });

    it("creates all expected indexes", () => {
      const db = createTestDatabase();
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
        )
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      for (const index of EXPECTED_INDEXES) {
        expect(indexNames).toContain(index);
      }

      db.close();
    });

    it("sets schema version to latest migration", () => {
      const db = createTestDatabase();
      const version = getCurrentVersion(db);
      expect(version).toBe(5);
      db.close();
    });

    it("returns a fresh database each call", () => {
      const db1 = createTestDatabase();
      const db2 = createTestDatabase();

      db1
        .prepare(
          "INSERT INTO compliance_events (ts, event, data) VALUES (?, ?, ?)",
        )
        .run("2026-01-01", "test", "{}");

      const count1 = db1
        .prepare("SELECT COUNT(*) as c FROM compliance_events")
        .get() as { c: number };
      const count2 = db2
        .prepare("SELECT COUNT(*) as c FROM compliance_events")
        .get() as { c: number };

      expect(count1.c).toBe(1);
      expect(count2.c).toBe(0);

      db1.close();
      db2.close();
    });
  });

  describe("getDatabase (file-based)", () => {
    let tmpDir: string;

    afterEach(() => {
      closeDatabase();
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("creates database file and parent directory", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "clawforce-test-"));
      const dbPath = join(tmpDir, "sub", "clawforce.db");

      const db = getDatabase(dbPath);
      expect(db).toBeInstanceOf(DatabaseSync);

      // Verify tables exist
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      for (const table of EXPECTED_TABLES) {
        expect(tableNames).toContain(table);
      }
    });

    it("enables WAL journal mode", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "clawforce-test-"));
      const dbPath = join(tmpDir, "clawforce.db");

      const db = getDatabase(dbPath);
      const result = db.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      expect(result.journal_mode).toBe("wal");
    });

    it("sets busy_timeout to 5000", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "clawforce-test-"));
      const dbPath = join(tmpDir, "clawforce.db");

      const db = getDatabase(dbPath);
      const result = db.prepare("PRAGMA busy_timeout").get() as Record<
        string,
        unknown
      >;
      // node:sqlite may return the value under different key names
      const timeout = Object.values(result)[0];
      expect(timeout).toBe(5000);
    });

    it("returns singleton on repeated calls", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "clawforce-test-"));
      const dbPath = join(tmpDir, "clawforce.db");

      const db1 = getDatabase(dbPath);
      const db2 = getDatabase(dbPath);
      expect(db1).toBe(db2);
    });
  });

  describe("closeDatabase", () => {
    it("cleans up singleton so next getDatabase creates fresh connection", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "clawforce-test-"));
      const dbPath = join(tmpDir, "clawforce.db");

      // Get first DB reference and verify it's working
      const db1 = getDatabase(dbPath);
      const v1 = getCurrentVersion(db1);
      expect(v1).toBe(5);

      // Close and get a new reference
      closeDatabase();
      const db2 = getDatabase(dbPath);

      // db2 should be a new object (not the same reference as db1)
      // We can verify it works by querying it
      const v2 = getCurrentVersion(db2);
      expect(v2).toBe(5);

      closeDatabase();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("is safe to call when no database is open", () => {
      expect(() => closeDatabase()).not.toThrow();
    });
  });
});
