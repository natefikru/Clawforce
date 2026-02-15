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
import type { RoutingLogEntry } from "./types.js";
import { isLocalModel } from "../shared/pricing.js";

export class StorageWriter {
  private db: DatabaseSync;
  private complianceLogPath: string;
  private routingLogPath: string;
  private dirCache = new Set<string>();

  private stmtCompliance: StatementSync;
  private stmtRouting: StatementSync;
  private stmtBudget: StatementSync;

  constructor(
    db: DatabaseSync,
    complianceLogPath: string,
    routingLogPath: string,
  ) {
    this.db = db;
    this.complianceLogPath = complianceLogPath;
    this.routingLogPath = routingLogPath;

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
  }

  writeComplianceEvent(entry: ComplianceEntry): void {
    this.appendJsonl(this.complianceLogPath, entry);
    try {
      this.stmtCompliance.run(
        entry.ts,
        entry.event,
        typeof entry.agentId === "string" ? entry.agentId : null,
        typeof entry.channel === "string" ? entry.channel : null,
        JSON.stringify(entry),
      );
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite compliance insert failed: ${String(err)}\n`,
      );
    }
  }

  writeRoutingDecision(entry: RoutingLogEntry): void {
    this.appendJsonl(this.routingLogPath, entry);
    try {
      const model = entry.model ?? "";
      const provider = model.includes("/") ? model.split("/")[0] : null;
      this.stmtRouting.run(
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
    try {
      this.stmtBudget.run(agentId, date, spent, requestCount);
    } catch (err) {
      process.stderr.write(
        `[storage] SQLite budget upsert failed: ${String(err)}\n`,
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
