/**
 * JSONL-to-SQLite migration command.
 *
 * Backfills existing JSONL log files into the SQLite database.
 * Uses byte-offset watermarking for idempotent reruns.
 */

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { logger } from "../utils/logger.js";
import { getDatabase, closeDatabase } from "../storage/database.js";
import { StorageWriter } from "../storage/writer.js";
import { isLocalModel } from "../shared/pricing.js";
import type { ComplianceEntry } from "../plugins/clawforce-compliance/index.js";
import type { RoutingLogEntry } from "../storage/types.js";

const BATCH_SIZE = 1000;

export interface MigrateOptions {
  dataDir: string;
  dryRun?: boolean;
}

interface MigrateResult {
  compliance: { inserted: number; skipped: number; errors: number };
  routing: { inserted: number; skipped: number; errors: number };
  budget: { migrated: boolean };
}

export async function migrateCommand(opts: MigrateOptions): Promise<MigrateResult> {
  logger.header("Clawforce JSONL → SQLite Migration");

  const dbPath = join(opts.dataDir, "clawforce.db");
  const compliancePath = join(opts.dataDir, "compliance.jsonl");
  const routingPath = join(opts.dataDir, "routing.jsonl");
  const budgetPath = join(opts.dataDir, "budget-state.json");

  if (opts.dryRun) {
    logger.info("[dry-run] No data will be written.");
  }

  const db = getDatabase(dbPath);
  ensureMigrationStateTable(db);

  const result: MigrateResult = {
    compliance: { inserted: 0, skipped: 0, errors: 0 },
    routing: { inserted: 0, skipped: 0, errors: 0 },
    budget: { migrated: false },
  };

  // Migrate compliance.jsonl
  if (existsSync(compliancePath)) {
    logger.info(`Migrating ${compliancePath}...`);
    const stats = migrateJsonlFile(db, compliancePath, "compliance", opts.dryRun);
    result.compliance = stats;
    logger.info(`  Compliance: ${stats.inserted} inserted, ${stats.skipped} skipped, ${stats.errors} errors`);
  } else {
    logger.info("No compliance.jsonl found, skipping.");
  }

  // Migrate routing.jsonl
  if (existsSync(routingPath)) {
    logger.info(`Migrating ${routingPath}...`);
    const stats = migrateJsonlFile(db, routingPath, "routing", opts.dryRun);
    result.routing = stats;
    logger.info(`  Routing: ${stats.inserted} inserted, ${stats.skipped} skipped, ${stats.errors} errors`);
  } else {
    logger.info("No routing.jsonl found, skipping.");
  }

  // Migrate budget-state.json
  if (existsSync(budgetPath)) {
    logger.info(`Migrating ${budgetPath}...`);
    result.budget.migrated = migrateBudgetState(db, budgetPath, opts.dryRun);
    logger.info(`  Budget: ${result.budget.migrated ? "migrated" : "skipped (no valid data)"}`);
  } else {
    logger.info("No budget-state.json found, skipping.");
  }

  if (!opts.dryRun) {
    closeDatabase();
  }

  logger.info("");
  logger.info("Migration complete.");
  return result;
}

function ensureMigrationStateTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migration_state (
    source_file TEXT PRIMARY KEY,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    last_migrated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function getByteOffset(db: DatabaseSync, sourceFile: string): number {
  const row = db.prepare(
    "SELECT byte_offset FROM migration_state WHERE source_file = ?",
  ).get(sourceFile) as { byte_offset: number } | undefined;
  return row?.byte_offset ?? 0;
}

function setByteOffset(db: DatabaseSync, sourceFile: string, offset: number): void {
  db.prepare(
    `INSERT INTO migration_state (source_file, byte_offset, last_migrated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(source_file) DO UPDATE SET
       byte_offset = excluded.byte_offset,
       last_migrated_at = datetime('now')`,
  ).run(sourceFile, offset);
}

function migrateJsonlFile(
  db: DatabaseSync,
  filePath: string,
  type: "compliance" | "routing",
  dryRun?: boolean,
): { inserted: number; skipped: number; errors: number } {
  const lastOffset = dryRun ? 0 : getByteOffset(db, filePath);
  const fileSize = statSync(filePath).size;

  if (lastOffset >= fileSize && !dryRun) {
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  // Read only the unprocessed portion of the file to avoid OOM on large logs
  const bytesToRead = fileSize - lastOffset;
  const fd = openSync(filePath, "r");
  const buf = Buffer.alloc(bytesToRead);
  readSync(fd, buf, 0, bytesToRead, lastOffset);
  closeSync(fd);
  const newContent = buf.toString("utf8");
  const lines = newContent.split("\n").filter(Boolean);

  let inserted = 0;
  let errors = 0;

  if (dryRun) {
    // Count valid lines without inserting
    for (const line of lines) {
      try {
        JSON.parse(line);
        inserted++;
      } catch {
        errors++;
      }
    }
    return { inserted, skipped: 0, errors };
  }

  // Process in batches within transactions
  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const batch = lines.slice(i, i + BATCH_SIZE);
    db.exec("BEGIN");
    try {
      for (const line of batch) {
        try {
          const entry = JSON.parse(line);
          if (type === "compliance") {
            insertComplianceEntry(db, entry);
          } else {
            insertRoutingEntry(db, entry);
          }
          inserted++;
        } catch {
          errors++;
        }
      }
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      errors += batch.length;
    }
  }

  // Update byte offset to end of file
  setByteOffset(db, filePath, fileSize);

  return { inserted, skipped: 0, errors };
}

function insertComplianceEntry(db: DatabaseSync, entry: ComplianceEntry): void {
  db.prepare(
    "INSERT INTO compliance_events (ts, event, agent_id, channel, data) VALUES (?, ?, ?, ?, ?)",
  ).run(
    entry.ts,
    entry.event,
    typeof entry.agentId === "string" ? entry.agentId : null,
    typeof entry.channel === "string" ? entry.channel : null,
    JSON.stringify(entry),
  );
}

function insertRoutingEntry(db: DatabaseSync, entry: RoutingLogEntry): void {
  const model = entry.model ?? "";
  const provider = model.includes("/") ? model.split("/")[0] : null;
  db.prepare(
    `INSERT INTO routing_decisions (ts, agent_id, selected_model, selected_provider, has_pii, pii_types, complexity, domain, data_tier, is_local, estimated_cost, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.ts,
    entry.agentId ?? null,
    model,
    provider,
    entry.hasPII ? 1 : 0,
    entry.piiTypes ? JSON.stringify(entry.piiTypes) : null,
    entry.complexity ?? null,
    entry.domain ?? null,
    entry.dataTier ?? null,
    isLocalModel(model) ? 1 : 0,
    0,
    JSON.stringify(entry),
  );
}

function migrateBudgetState(
  db: DatabaseSync,
  budgetPath: string,
  dryRun?: boolean,
): boolean {
  try {
    const raw = readFileSync(budgetPath, "utf8");
    const state = JSON.parse(raw) as { date?: string; spent?: number; requestCount?: number };

    if (!state.date || typeof state.spent !== "number" || typeof state.requestCount !== "number") {
      return false;
    }

    if (dryRun) return true;

    db.prepare(
      `INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at)
       VALUES ('_global', ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id, date) DO UPDATE SET
         spent = excluded.spent, request_count = excluded.request_count, updated_at = datetime('now')`,
    ).run(state.date, state.spent, state.requestCount);

    return true;
  } catch {
    return false;
  }
}
