/**
 * SQLite database connection and lifecycle management.
 *
 * Uses Node.js built-in `node:sqlite` (available in Node 22+).
 * WAL mode enabled for concurrent reads during writes.
 * busy_timeout set to 5s for multi-process safety.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

const DEFAULT_DB_PATH = "/home/node/.openclaw/data/clawforce.db";

let db: DatabaseSync | null = null;

export function getDatabase(dbPath?: string): DatabaseSync {
  if (!db) {
    const path = dbPath ?? DEFAULT_DB_PATH;
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("PRAGMA busy_timeout=5000");
    runMigrations(db);
  }
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

/** Create an in-memory database for testing. Runs migrations automatically. */
export function createTestDatabase(): DatabaseSync {
  const testDb = new DatabaseSync(":memory:");
  testDb.exec("PRAGMA foreign_keys=ON");
  runMigrations(testDb);
  return testDb;
}
