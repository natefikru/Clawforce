import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  runMigrations,
  getCurrentVersion,
  getMigrations,
} from "../../../src/storage/migrations.js";

function freshDb(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

describe("migrations", () => {
  describe("runMigrations", () => {
    it("creates schema_version table", () => {
      const db = freshDb();
      runMigrations(db);

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
        )
        .all();
      expect(tables).toHaveLength(1);

      db.close();
    });

    it("applies version 1 migration", () => {
      const db = freshDb();
      runMigrations(db);

      expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(1);

      // Verify all tables from v1
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain("compliance_events");
      expect(names).toContain("routing_decisions");
      expect(names).toContain("usage_metrics");
      expect(names).toContain("budget_state");
      expect(names).toContain("alerts");

      db.close();
    });

    it("is idempotent — running twice does not error", () => {
      const db = freshDb();
      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();
      expect(getCurrentVersion(db)).toBe(2);
      db.close();
    });

    it("does not re-apply already applied migrations", () => {
      const db = freshDb();
      runMigrations(db);

      // Insert a row into compliance_events
      db.prepare(
        "INSERT INTO compliance_events (ts, event, data) VALUES (?, ?, ?)",
      ).run("2026-01-01", "test", "{}");

      // Run migrations again
      runMigrations(db);

      // Row should still be there (table not dropped/recreated)
      const count = db
        .prepare("SELECT COUNT(*) as c FROM compliance_events")
        .get() as { c: number };
      expect(count.c).toBe(1);

      db.close();
    });

    it("records migration version in schema_version table", () => {
      const db = freshDb();
      runMigrations(db);

      const rows = db.prepare("SELECT * FROM schema_version").all() as {
        version: number;
        applied_at: string;
      }[];
      expect(rows).toHaveLength(2);
      expect(rows[0].version).toBe(1);
      expect(rows[0].applied_at).toBeTruthy();

      db.close();
    });
  });

  describe("getCurrentVersion", () => {
    it("returns 0 for fresh database with only schema_version table", () => {
      const db = freshDb();
      db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      expect(getCurrentVersion(db)).toBe(0);
      db.close();
    });

    it("returns correct version after migrations", () => {
      const db = freshDb();
      runMigrations(db);
      expect(getCurrentVersion(db)).toBe(2);
      db.close();
    });
  });

  describe("getMigrations", () => {
    it("returns a non-empty array of migrations", () => {
      const migrations = getMigrations();
      expect(migrations.length).toBeGreaterThan(0);
    });

    it("migrations are in ascending version order", () => {
      const migrations = getMigrations();
      for (let i = 1; i < migrations.length; i++) {
        expect(migrations[i].version).toBeGreaterThan(
          migrations[i - 1].version,
        );
      }
    });

    it("each migration has a description", () => {
      for (const m of getMigrations()) {
        expect(m.description).toBeTruthy();
      }
    });
  });

  describe("schema integrity", () => {
    it("compliance_events has correct columns", () => {
      const db = freshDb();
      runMigrations(db);

      const columns = db.prepare("PRAGMA table_info(compliance_events)").all() as {
        name: string;
        type: string;
        notnull: number;
      }[];
      const colNames = columns.map((c) => c.name);

      expect(colNames).toContain("id");
      expect(colNames).toContain("ts");
      expect(colNames).toContain("event");
      expect(colNames).toContain("agent_id");
      expect(colNames).toContain("channel");
      expect(colNames).toContain("data");
      expect(colNames).toContain("created_at");

      // ts and event are NOT NULL
      const ts = columns.find((c) => c.name === "ts");
      const event = columns.find((c) => c.name === "event");
      expect(ts?.notnull).toBe(1);
      expect(event?.notnull).toBe(1);

      db.close();
    });

    it("budget_state has composite primary key", () => {
      const db = freshDb();
      runMigrations(db);

      // Insert two rows with same agent_id but different dates — should work
      db.prepare(
        "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
      ).run("_global", "2026-02-14", 1.0, 5);
      db.prepare(
        "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
      ).run("_global", "2026-02-15", 2.0, 10);

      // Duplicate (agent_id, date) should fail
      expect(() => {
        db.prepare(
          "INSERT INTO budget_state (agent_id, date, spent, request_count) VALUES (?, ?, ?, ?)",
        ).run("_global", "2026-02-15", 3.0, 15);
      }).toThrow();

      db.close();
    });

    it("routing_decisions requires selected_model NOT NULL", () => {
      const db = freshDb();
      runMigrations(db);

      expect(() => {
        db.prepare(
          "INSERT INTO routing_decisions (ts, selected_model, data) VALUES (?, ?, ?)",
        ).run("2026-01-01", null, "{}");
      }).toThrow();

      db.close();
    });
  });

  describe("v2 — dashboard_users", () => {
    it("applies version 2 migration", () => {
      const db = freshDb();
      runMigrations(db);

      expect(getCurrentVersion(db)).toBe(2);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain("dashboard_users");

      db.close();
    });

    it("dashboard_users has correct columns", () => {
      const db = freshDb();
      runMigrations(db);

      const columns = db.prepare("PRAGMA table_info(dashboard_users)").all() as {
        name: string;
        type: string;
        notnull: number;
      }[];
      const colNames = columns.map((c) => c.name);

      expect(colNames).toContain("id");
      expect(colNames).toContain("username");
      expect(colNames).toContain("password_hash");
      expect(colNames).toContain("role");
      expect(colNames).toContain("created_at");
      expect(colNames).toContain("updated_at");

      const username = columns.find((c) => c.name === "username");
      const passwordHash = columns.find((c) => c.name === "password_hash");
      const role = columns.find((c) => c.name === "role");
      expect(username?.notnull).toBe(1);
      expect(passwordHash?.notnull).toBe(1);
      expect(role?.notnull).toBe(1);

      db.close();
    });

    it("dashboard_users has username index", () => {
      const db = freshDb();
      runMigrations(db);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dashboard_users'",
        )
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_dashboard_users_username");

      db.close();
    });

    it("dashboard_users enforces unique username", () => {
      const db = freshDb();
      runMigrations(db);

      db.prepare(
        "INSERT INTO dashboard_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
      ).run("u1", "admin", "$2a$10$hash1", "admin");

      expect(() => {
        db.prepare(
          "INSERT INTO dashboard_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
        ).run("u2", "admin", "$2a$10$hash2", "viewer");
      }).toThrow();

      db.close();
    });

    it("dashboard_users role defaults to viewer", () => {
      const db = freshDb();
      runMigrations(db);

      db.prepare(
        "INSERT INTO dashboard_users (id, username, password_hash) VALUES (?, ?, ?)",
      ).run("u1", "testuser", "$2a$10$hash");

      const user = db.prepare("SELECT role FROM dashboard_users WHERE id = ?").get("u1") as {
        role: string;
      };
      expect(user.role).toBe("viewer");

      db.close();
    });

    it("upgrades from v1 to v2 without losing data", () => {
      const db = freshDb();

      // Simulate v1 already applied
      db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
      db.exec(`
        CREATE TABLE compliance_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          event TEXT NOT NULL,
          agent_id TEXT,
          channel TEXT,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.prepare(
        "INSERT INTO compliance_events (ts, event, data) VALUES (?, ?, ?)",
      ).run("2026-01-01", "test", "{}");

      // Run migrations — should only apply v2
      runMigrations(db);

      expect(getCurrentVersion(db)).toBe(2);

      const count = db
        .prepare("SELECT COUNT(*) as c FROM compliance_events")
        .get() as { c: number };
      expect(count.c).toBe(1);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      expect(tables.map((t) => t.name)).toContain("dashboard_users");

      db.close();
    });
  });
});
