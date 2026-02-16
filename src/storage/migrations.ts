/**
 * Versioned schema migrations for the Clawforce SQLite database.
 *
 * Each migration is applied exactly once, tracked via the schema_version table.
 * Migrations run inside transactions — if one fails, it rolls back cleanly.
 */

import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSync) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema — compliance, routing, usage, budget, alerts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS compliance_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          event TEXT NOT NULL,
          agent_id TEXT,
          channel TEXT,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_compliance_ts ON compliance_events(ts);
        CREATE INDEX IF NOT EXISTS idx_compliance_event ON compliance_events(event);
        CREATE INDEX IF NOT EXISTS idx_compliance_agent ON compliance_events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_compliance_event_ts ON compliance_events(event, ts);

        CREATE TABLE IF NOT EXISTS routing_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          agent_id TEXT,
          selected_model TEXT NOT NULL,
          selected_provider TEXT,
          has_pii INTEGER NOT NULL DEFAULT 0,
          pii_types TEXT,
          complexity TEXT,
          domain TEXT,
          data_tier TEXT,
          is_local INTEGER NOT NULL DEFAULT 0,
          estimated_cost REAL DEFAULT 0,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_routing_ts ON routing_decisions(ts);
        CREATE INDEX IF NOT EXISTS idx_routing_agent ON routing_decisions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_routing_model ON routing_decisions(selected_model);
        CREATE INDEX IF NOT EXISTS idx_routing_pii ON routing_decisions(has_pii);

        CREATE TABLE IF NOT EXISTS usage_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          agent_id TEXT,
          model TEXT NOT NULL,
          provider TEXT,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          estimated_cost REAL DEFAULT 0,
          is_local INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_metrics(ts);
        CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_metrics(agent_id);
        CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_metrics(model);
        CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_metrics(date(ts));

        CREATE TABLE IF NOT EXISTS budget_state (
          agent_id TEXT NOT NULL DEFAULT '_global',
          date TEXT NOT NULL,
          spent REAL NOT NULL DEFAULT 0,
          request_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (agent_id, date)
        );

        CREATE TABLE IF NOT EXISTS alerts (
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

        CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);
        CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
        CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
      `);
    },
  },
  {
    version: 2,
    description: "Dashboard users table for authentication",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dashboard_users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'viewer',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_dashboard_users_username ON dashboard_users(username);
      `);
    },
  },
  {
    version: 3,
    description: "Composite alerts index for model health queries",
    up: (db) => {
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alerts'",
        )
        .get() as { name?: string } | undefined;
      if (!table?.name) return;
      db.exec("CREATE INDEX IF NOT EXISTS idx_alerts_type_ts ON alerts(type, ts DESC)");
    },
  },
  {
    version: 4,
    description: "Canonical current model health state table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_health_state (
          provider TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          circuit TEXT NOT NULL,
          last_checked_at TEXT,
          last_healthy_at TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_model_health_state_updated ON model_health_state(updated_at DESC);
      `);
    },
  },
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const currentVersion = getCurrentVersion(db);

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.exec("BEGIN");
      try {
        migration.up(db);
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
          migration.version,
        );
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  }
}

export function getCurrentVersion(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT MAX(version) as version FROM schema_version")
    .get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

export function getMigrations(): readonly Migration[] {
  return migrations;
}
