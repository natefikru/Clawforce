/**
 * Dual-write storage: JSONL (source of truth) + SQLite (query layer).
 *
 * JSONL always writes first. SQLite inserts are best-effort — if they fail,
 * JSONL still succeeds. Prepared statements are cached in the constructor
 * for performance (hot path: every hook invocation).
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ComplianceEntry } from "../plugins/clawforce-compliance/index.js";
import type {
  AlertEntry,
  ModelHealthStateEntry,
  RoutingLogEntry,
} from "./types.js";
import { normalizeAgentId } from "./types.js";
import { isLocalModel } from "../shared/pricing.js";

export class StorageWriter {
  private db: DatabaseSync;
  private complianceLogPath: string;
  private routingLogPath: string;
  private dirCache = new Set<string>();

  private stmtCompliance: StatementSync | null;
  private stmtRouting: StatementSync | null;
  private stmtBudget: StatementSync | null;
  private stmtAlert: StatementSync | null;
  private stmtModelHealthState: StatementSync | null;

  constructor(
    db: DatabaseSync,
    complianceLogPath: string,
    routingLogPath: string,
  ) {
    this.db = db;
    this.complianceLogPath = complianceLogPath;
    this.routingLogPath = routingLogPath;

    // Cache prepared statements. If DB schema is missing/corrupt, degrade
    // gracefully — JSONL writes still succeed, SQLite inserts are skipped.
    try {
      this.stmtCompliance = db.prepare(
        `INSERT INTO compliance_events (ts, event, agent_id, channel, data) VALUES (?, ?, ?, ?, ?)`,
      );
      this.stmtRouting = db.prepare(
        `INSERT INTO routing_decisions (ts, agent_id, selected_model, selected_provider, has_pii, pii_types, complexity, domain, data_tier, is_local, estimated_cost, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      this.stmtBudget = db.prepare(
        `INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(agent_id, date) DO UPDATE SET
           spent = excluded.spent,
           request_count = excluded.request_count,
           updated_at = datetime('now')`,
      );
      this.stmtAlert = db.prepare(
        `INSERT INTO alerts (ts, severity, type, agent_id, message, acknowledged, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      this.stmtModelHealthState = db.prepare(
        `INSERT INTO model_health_state
           (provider, status, circuit, last_checked_at, last_healthy_at, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(provider) DO UPDATE SET
           status = excluded.status,
           circuit = excluded.circuit,
           last_checked_at = excluded.last_checked_at,
           last_healthy_at = excluded.last_healthy_at,
           last_error = excluded.last_error,
           updated_at = datetime('now')`,
      );
    } catch (err) {
      this.stmtCompliance = null;
      this.stmtRouting = null;
      this.stmtBudget = null;
      this.stmtAlert = null;
      this.stmtModelHealthState = null;
      process.stderr.write(
        `[storage] Failed to prepare SQLite statements: ${String(err)}\n`,
      );
    }
  }

  writeComplianceEvent(entry: ComplianceEntry): void {
    const normalizedAgentId = normalizeAgentId(entry.agentId);
    const normalizedEntry: ComplianceEntry = {
      ...entry,
      agentId: normalizedAgentId,
    };
    this.appendJsonl(this.complianceLogPath, normalizedEntry);
    if (!this.stmtCompliance) return;
    try {
      this.stmtCompliance.run(
        normalizedEntry.ts,
        normalizedEntry.event,
        normalizedAgentId,
        typeof normalizedEntry.channel === "string" ? normalizedEntry.channel : null,
        JSON.stringify(normalizedEntry),
      );
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite compliance insert failed: ${String(err)}\n`,
      );
    }
  }

  writeRoutingDecision(entry: RoutingLogEntry): void {
    const normalizedAgentId = normalizeAgentId(entry.agentId);
    const normalizedEntry: RoutingLogEntry = {
      ...entry,
      agentId: normalizedAgentId,
    };
    this.appendJsonl(this.routingLogPath, normalizedEntry);
    if (!this.stmtRouting) return;
    try {
      const model = normalizedEntry.model ?? "";
      const provider = model.includes("/") ? model.split("/")[0] : null;
      this.stmtRouting.run(
        normalizedEntry.ts,
        normalizedAgentId,
        model,
        provider,
        normalizedEntry.hasPII ? 1 : 0,
        normalizedEntry.piiTypes ? JSON.stringify(normalizedEntry.piiTypes) : null,
        normalizedEntry.complexity ?? null,
        normalizedEntry.domain ?? null,
        normalizedEntry.dataTier ?? null,
        isLocalModel(model) ? 1 : 0,
        0,
        JSON.stringify(normalizedEntry),
      );
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite routing insert failed: ${String(err)}\n`,
      );
    }
  }

  writeBudgetState(
    agentId: string,
    date: string,
    spent: number,
    requestCount: number,
  ): void {
    if (!this.stmtBudget) return;
    try {
      this.stmtBudget.run(agentId, date, spent, requestCount);
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite budget upsert failed: ${String(err)}\n`,
      );
    }
  }

  writeAlert(entry: AlertEntry): void {
    this.appendJsonl(this.complianceLogPath, {
      ...entry,
      event: "alert",
    });
    if (!this.stmtAlert) return;
    try {
      this.stmtAlert.run(
        entry.ts,
        entry.severity,
        entry.type,
        entry.agentId ?? null,
        entry.message,
        entry.acknowledged ? 1 : 0,
        entry.data ? JSON.stringify(entry.data) : null,
      );
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite alert insert failed: ${String(err)}\n`,
      );
    }
  }

  writeModelHealthState(entry: ModelHealthStateEntry): void {
    if (!this.stmtModelHealthState) return;
    try {
      this.stmtModelHealthState.run(
        entry.provider,
        entry.status,
        entry.circuit,
        entry.lastCheckedAt ?? null,
        entry.lastHealthyAt ?? null,
        entry.lastError ?? null,
      );
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite model_health_state upsert failed: ${String(err)}\n`,
      );
    }
  }

  private appendJsonl(logPath: string, entry: unknown): void {
    try {
      const dir = dirname(logPath);
      if (!this.dirCache.has(dir)) {
        mkdirSync(dir, { recursive: true });
        this.dirCache.add(dir);
      }
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      process.stderr.write(
        `[storage] JSONL write failed for ${logPath}: ${String(err)}\n`,
      );
    }
  }
}
