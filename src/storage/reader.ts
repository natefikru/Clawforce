/**
 * Typed query methods for the Clawforce SQLite database.
 *
 * Replaces JSONL file parsing in the dashboard and CLI audit command.
 * All methods accept optional filters and return typed results.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  ComplianceEntry,
  RoutingDecisionRow,
  UsageSummary,
  BudgetStateRow,
  AlertRow,
  ModelDistribution,
  DailySpend,
  ModelHealthStateRow,
} from "./types.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "./types.js";

export class StorageReader {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  getRecentEvents(opts: {
    limit: number;
    event?: string;
    agentId?: string;
    since?: string;
  }): ComplianceEntry[] {
    if (opts.limit <= 0) return [];

    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (opts.event) {
      conditions.push("event = ?");
      params.push(opts.event);
    }
    if (opts.agentId) {
      const normalizedAgentId = normalizeAgentId(opts.agentId);
      if (normalizedAgentId === DEFAULT_AGENT_ID) {
        conditions.push("(agent_id = ? OR agent_id IS NULL)");
      } else {
        conditions.push("agent_id = ?");
      }
      params.push(normalizedAgentId);
    }
    if (opts.since) {
      conditions.push("ts >= ?");
      params.push(opts.since);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(opts.limit);

    const rows = this.db
      .prepare(
        `SELECT data FROM compliance_events ${where} ORDER BY ts DESC LIMIT ?`,
      )
      .all(...params) as { data: string }[];

    return rows.map((r) => {
      const entry = JSON.parse(r.data) as ComplianceEntry;
      return {
        ...entry,
        agentId: normalizeAgentId(entry.agentId),
      };
    });
  }

  getRoutingDecisions(opts: {
    since?: string;
    agentId?: string;
    piiOnly?: boolean;
    limit?: number;
  }): RoutingDecisionRow[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (opts.since) {
      conditions.push("ts >= ?");
      params.push(opts.since);
    }
    if (opts.agentId) {
      const normalizedAgentId = normalizeAgentId(opts.agentId);
      if (normalizedAgentId === DEFAULT_AGENT_ID) {
        conditions.push("(agent_id = ? OR agent_id IS NULL)");
      } else {
        conditions.push("agent_id = ?");
      }
      params.push(normalizedAgentId);
    }
    if (opts.piiOnly) {
      conditions.push("has_pii = 1");
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 100;
    params.push(limit);

    return this.db
      .prepare(
        `SELECT * FROM routing_decisions ${where} ORDER BY ts DESC LIMIT ?`,
      )
      .all(...params) as unknown as RoutingDecisionRow[];
  }

  getUsageSummary(opts: { days: number; agentId?: string }): UsageSummary {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - opts.days);
    const since = sinceDate.toISOString();

    const conditions = ["ts >= ?"];
    const params: SQLInputValue[] = [since];

    if (opts.agentId) {
      const normalizedAgentId = normalizeAgentId(opts.agentId);
      if (normalizedAgentId === DEFAULT_AGENT_ID) {
        conditions.push("(agent_id = ? OR agent_id IS NULL)");
      } else {
        conditions.push("agent_id = ?");
      }
      params.push(normalizedAgentId);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const rows = this.db
      .prepare(
        `SELECT selected_model, is_local, estimated_cost FROM routing_decisions ${where} LIMIT 100000`,
      )
      .all(...params) as {
      selected_model: string;
      is_local: number;
      estimated_cost: number;
    }[];

    const modelBreakdown: Record<string, { count: number; cost: number }> = {};
    let totalCost = 0;
    let localRequests = 0;
    let cloudRequests = 0;

    for (const row of rows) {
      totalCost += row.estimated_cost;
      if (row.is_local) {
        localRequests++;
      } else {
        cloudRequests++;
      }
      if (!modelBreakdown[row.selected_model]) {
        modelBreakdown[row.selected_model] = { count: 0, cost: 0 };
      }
      modelBreakdown[row.selected_model].count++;
      modelBreakdown[row.selected_model].cost += row.estimated_cost;
    }

    return {
      totalRequests: rows.length,
      totalCost,
      localRequests,
      cloudRequests,
      modelBreakdown,
    };
  }

  getBudgetState(agentId?: string): BudgetStateRow | null {
    const id = agentId ?? "_global";
    const today = new Date().toISOString().slice(0, 10);

    const row = this.db
      .prepare(
        "SELECT * FROM budget_state WHERE agent_id = ? AND date = ?",
      )
      .get(id, today) as BudgetStateRow | undefined;

    return row ?? null;
  }

  getAlerts(opts: {
    since?: string;
    severity?: string;
    type?: string;
    unacknowledgedOnly?: boolean;
    limit?: number;
  }): AlertRow[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (opts.since) {
      conditions.push("ts >= ?");
      params.push(opts.since);
    }
    if (opts.severity) {
      conditions.push("severity = ?");
      params.push(opts.severity);
    }
    if (opts.type) {
      conditions.push("type = ?");
      params.push(opts.type);
    }
    if (opts.unacknowledgedOnly) {
      conditions.push("acknowledged = 0");
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 100;
    params.push(limit);

    return this.db
      .prepare(`SELECT * FROM alerts ${where} ORDER BY ts DESC LIMIT ?`)
      .all(...params) as unknown as AlertRow[];
  }

  getModelHealthStates(): ModelHealthStateRow[] {
    return this.db
      .prepare(
        `SELECT * FROM model_health_state ORDER BY updated_at DESC`,
      )
      .all() as unknown as ModelHealthStateRow[];
  }

  getModelDistribution(opts: {
    days: number;
    agentId?: string;
  }): ModelDistribution[] {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - opts.days);
    const since = sinceDate.toISOString();

    const conditions = ["ts >= ?"];
    const params: SQLInputValue[] = [since];

    if (opts.agentId) {
      const normalizedAgentId = normalizeAgentId(opts.agentId);
      if (normalizedAgentId === DEFAULT_AGENT_ID) {
        conditions.push("(agent_id = ? OR agent_id IS NULL)");
      } else {
        conditions.push("agent_id = ?");
      }
      params.push(normalizedAgentId);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const rows = this.db
      .prepare(
        `SELECT selected_model, COUNT(*) as count FROM routing_decisions ${where} GROUP BY selected_model ORDER BY count DESC`,
      )
      .all(...params) as { selected_model: string; count: number }[];

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    if (total === 0) return [];

    return rows.map((r) => ({
      model: r.selected_model,
      count: r.count,
      percentage: (r.count / total) * 100,
    }));
  }

  getDailySpend(opts: { days: number; agentId?: string }): DailySpend[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (opts.agentId) {
      conditions.push("agent_id = ?");
      params.push(opts.agentId);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT date, spent, request_count FROM budget_state ${where} ORDER BY date DESC LIMIT ?`,
      )
      .all(...params, opts.days) as {
      date: string;
      spent: number;
      request_count: number;
    }[];

    return rows.map((r) => ({
      date: r.date,
      spent: r.spent,
      requestCount: r.request_count,
    }));
  }

  getTotalEventCount(event?: string): number {
    if (event) {
      const row = this.db
        .prepare(
          "SELECT COUNT(*) as total FROM compliance_events WHERE event = ?",
        )
        .get(event) as { total: number };
      return row.total;
    }
    const row = this.db
      .prepare("SELECT COUNT(*) as total FROM compliance_events")
      .get() as { total: number };
    return row.total;
  }
}
