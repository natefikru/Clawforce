import type { ComplianceEntry } from "../storage/types.js";
import type { AlertRow, BudgetStateRow, UsageSummary } from "../storage/types.js";

export interface SupervisorStatusReader {
  getRecentEvents(opts: {
    limit: number;
    event?: string;
    agentId?: string;
    since?: string;
  }): ComplianceEntry[];
  getBudgetState(agentId?: string): BudgetStateRow | null;
  getAlerts(opts: {
    since?: string;
    severity?: string;
    type?: string;
    agentId?: string;
    unacknowledgedOnly?: boolean;
    limit?: number;
  }): AlertRow[];
  getUsageSummary(opts: { days: number; agentId?: string }): UsageSummary;
}

export interface SupervisorStatusContext {
  callerAgentId?: string;
  supervisedAgentIds: string[];
}

export interface WorkforceMetrics {
  agentCount: number;
  totalRequests: number;
  totalCost: number;
  localRequests: number;
  cloudRequests: number;
  modelBreakdown: Record<string, { count: number; cost: number }>;
}

export interface SupervisorStatusLimits {
  defaultLimit: number;
  maxLimit: number;
  defaultDays: number;
  maxDays: number;
}

const DEFAULT_LIMITS: SupervisorStatusLimits = {
  defaultLimit: 100,
  maxLimit: 500,
  defaultDays: 1,
  maxDays: 30,
};

export class SupervisorStatusService {
  private readonly limits: SupervisorStatusLimits;

  constructor(
    private readonly reader: SupervisorStatusReader,
    limits: Partial<SupervisorStatusLimits> = {},
  ) {
    this.limits = {
      ...DEFAULT_LIMITS,
      ...limits,
    };
  }

  getAgentActivity(
    ctx: SupervisorStatusContext,
    opts: {
      agentIds?: string[];
      since?: string;
      event?: string;
      limit?: number;
    } = {},
  ): ComplianceEntry[] {
    const authorized = this.resolveAuthorizedAgentIds(ctx, opts.agentIds);
    const limit = this.normalizeLimit(opts.limit);
    const perAgentLimit = Math.max(1, Math.ceil(limit / Math.max(1, authorized.length)));
    const rows: ComplianceEntry[] = [];

    for (const agentId of authorized) {
      rows.push(
        ...this.reader.getRecentEvents({
          agentId,
          since: opts.since,
          event: opts.event,
          limit: perAgentLimit,
        }),
      );
    }

    rows.sort((a, b) => b.ts.localeCompare(a.ts));
    return rows.slice(0, limit);
  }

  getAgentBudgets(
    ctx: SupervisorStatusContext,
    agentIds?: string[],
  ): Array<{ agentId: string; state: BudgetStateRow | null }> {
    const authorized = this.resolveAuthorizedAgentIds(ctx, agentIds);
    return authorized.map((agentId) => ({
      agentId,
      state: this.reader.getBudgetState(agentId),
    }));
  }

  getAgentAlerts(
    ctx: SupervisorStatusContext,
    opts: {
      agentIds?: string[];
      since?: string;
      severity?: string;
      type?: string;
      unacknowledgedOnly?: boolean;
      limit?: number;
    } = {},
  ): AlertRow[] {
    const authorized = this.resolveAuthorizedAgentIds(ctx, opts.agentIds);
    const limit = this.normalizeLimit(opts.limit);
    const perAgentLimit = Math.max(1, Math.ceil(limit / Math.max(1, authorized.length)));
    const rows: AlertRow[] = [];

    for (const agentId of authorized) {
      rows.push(
        ...this.reader.getAlerts({
          agentId,
          since: opts.since,
          severity: opts.severity,
          type: opts.type,
          unacknowledgedOnly: opts.unacknowledgedOnly,
          limit: perAgentLimit,
        }),
      );
    }

    rows.sort((a, b) => b.ts.localeCompare(a.ts));
    return rows.slice(0, limit);
  }

  getWorkforceMetrics(
    ctx: SupervisorStatusContext,
    opts: {
      agentIds?: string[];
      days?: number;
    } = {},
  ): WorkforceMetrics {
    const authorized = this.resolveAuthorizedAgentIds(ctx, opts.agentIds);
    const days = this.normalizeDays(opts.days);

    const totals: WorkforceMetrics = {
      agentCount: authorized.length,
      totalRequests: 0,
      totalCost: 0,
      localRequests: 0,
      cloudRequests: 0,
      modelBreakdown: {},
    };

    for (const agentId of authorized) {
      const summary = this.reader.getUsageSummary({ days, agentId });
      totals.totalRequests += summary.totalRequests;
      totals.totalCost += summary.totalCost;
      totals.localRequests += summary.localRequests;
      totals.cloudRequests += summary.cloudRequests;

      for (const [model, breakdown] of Object.entries(summary.modelBreakdown)) {
        const current = totals.modelBreakdown[model] ?? { count: 0, cost: 0 };
        current.count += breakdown.count;
        current.cost += breakdown.cost;
        totals.modelBreakdown[model] = current;
      }
    }

    return totals;
  }

  private resolveAuthorizedAgentIds(
    ctx: SupervisorStatusContext,
    requestedAgentIds?: string[],
  ): string[] {
    const caller = ctx.callerAgentId?.trim();
    if (!caller) {
      throw new Error("Unauthorized: missing caller agent identity");
    }

    const allowed = [...new Set(ctx.supervisedAgentIds.map((id) => id.trim()).filter(Boolean))];
    if (allowed.length === 0) {
      throw new Error(`Unauthorized: supervisor '${caller}' has no supervised agents`);
    }

    const requested = requestedAgentIds?.length
      ? [...new Set(requestedAgentIds.map((id) => id.trim()).filter(Boolean))]
      : allowed;
    if (requested.length === 0) {
      throw new Error("Invalid request: no agent IDs provided");
    }

    const allowedSet = new Set(allowed);
    const unauthorized = requested.find((id) => !allowedSet.has(id));
    if (unauthorized) {
      throw new Error(
        `Unauthorized: agent '${caller}' cannot access status for '${unauthorized}'`,
      );
    }

    return requested;
  }

  private normalizeLimit(limit?: number): number {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
      return this.limits.defaultLimit;
    }
    return Math.min(Math.floor(limit), this.limits.maxLimit);
  }

  private normalizeDays(days?: number): number {
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
      return this.limits.defaultDays;
    }
    return Math.min(Math.floor(days), this.limits.maxDays);
  }
}
