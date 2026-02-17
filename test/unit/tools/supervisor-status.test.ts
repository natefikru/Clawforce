import { describe, expect, it } from "vitest";
import type { ComplianceEntry } from "../../../src/storage/types.js";
import type { AlertRow, BudgetStateRow, UsageSummary } from "../../../src/storage/types.js";
import { SupervisorStatusService } from "../../../src/tools/supervisor-status.js";

class FakeReader {
  eventsByAgent: Record<string, ComplianceEntry[]> = {};
  budgetsByAgent: Record<string, BudgetStateRow | null> = {};
  alertsByAgent: Record<string, AlertRow[]> = {};
  usageByAgent: Record<string, UsageSummary> = {};

  getRecentEvents(opts: {
    limit: number;
    event?: string;
    agentId?: string;
    since?: string;
  }): ComplianceEntry[] {
    const rows = opts.agentId ? (this.eventsByAgent[opts.agentId] ?? []) : [];
    return rows.slice(0, opts.limit);
  }

  getBudgetState(agentId?: string): BudgetStateRow | null {
    if (!agentId) return null;
    return this.budgetsByAgent[agentId] ?? null;
  }

  getAlerts(opts: {
    since?: string;
    severity?: string;
    type?: string;
    agentId?: string;
    unacknowledgedOnly?: boolean;
    limit?: number;
  }): AlertRow[] {
    const rows = opts.agentId ? (this.alertsByAgent[opts.agentId] ?? []) : [];
    return rows.slice(0, opts.limit ?? 100);
  }

  getUsageSummary(opts: { days: number; agentId?: string }): UsageSummary {
    if (!opts.agentId) {
      return {
        totalRequests: 0,
        totalCost: 0,
        localRequests: 0,
        cloudRequests: 0,
        modelBreakdown: {},
      };
    }
    return this.usageByAgent[opts.agentId] ?? {
      totalRequests: 0,
      totalCost: 0,
      localRequests: 0,
      cloudRequests: 0,
      modelBreakdown: {},
    };
  }
}

describe("SupervisorStatusService", () => {
  it("returns activity for authorized supervised agents only", () => {
    const reader = new FakeReader();
    reader.eventsByAgent["agent-a"] = [
      { ts: "2026-02-16T10:00:00Z", event: "message_received", agentId: "agent-a" } as ComplianceEntry,
    ];
    reader.eventsByAgent["agent-b"] = [
      { ts: "2026-02-16T10:01:00Z", event: "message_received", agentId: "agent-b" } as ComplianceEntry,
    ];

    const service = new SupervisorStatusService(reader);
    const rows = service.getAgentActivity(
      { callerAgentId: "ultron", supervisedAgentIds: ["agent-a", "agent-b"] },
      { agentIds: ["agent-b"] },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].agentId).toBe("agent-b");
  });

  it("rejects unauthorized agent scope", () => {
    const reader = new FakeReader();
    const service = new SupervisorStatusService(reader);

    expect(() =>
      service.getAgentActivity(
        { callerAgentId: "ultron", supervisedAgentIds: ["agent-a"] },
        { agentIds: ["agent-b"] },
      ),
    ).toThrow("cannot access status");
  });

  it("rejects missing caller identity", () => {
    const reader = new FakeReader();
    const service = new SupervisorStatusService(reader);

    expect(() =>
      service.getAgentBudgets({ supervisedAgentIds: ["agent-a"] }, ["agent-a"]),
    ).toThrow("missing caller agent identity");
  });

  it("aggregates workforce metrics across supervised agents", () => {
    const reader = new FakeReader();
    reader.usageByAgent["agent-a"] = {
      totalRequests: 3,
      totalCost: 1.5,
      localRequests: 1,
      cloudRequests: 2,
      modelBreakdown: {
        "anthropic/claude-sonnet-4-5": { count: 2, cost: 1.2 },
        "ollama/llama3.3:8b": { count: 1, cost: 0.3 },
      },
    };
    reader.usageByAgent["agent-b"] = {
      totalRequests: 2,
      totalCost: 0.4,
      localRequests: 2,
      cloudRequests: 0,
      modelBreakdown: {
        "ollama/llama3.3:8b": { count: 2, cost: 0.4 },
      },
    };

    const service = new SupervisorStatusService(reader);
    const metrics = service.getWorkforceMetrics({
      callerAgentId: "ultron",
      supervisedAgentIds: ["agent-a", "agent-b"],
    });

    expect(metrics.agentCount).toBe(2);
    expect(metrics.totalRequests).toBe(5);
    expect(metrics.totalCost).toBeCloseTo(1.9);
    expect(metrics.localRequests).toBe(3);
    expect(metrics.cloudRequests).toBe(2);
    expect(metrics.modelBreakdown["ollama/llama3.3:8b"].count).toBe(3);
  });

  it("enforces max limits for alert queries", () => {
    const reader = new FakeReader();
    reader.alertsByAgent["agent-a"] = new Array(50).fill(0).map(
      (_, i) =>
        ({
          id: i + 1,
          ts: `2026-02-16T10:${String(i).padStart(2, "0")}:00Z`,
          severity: "warning",
          type: "agent_error",
          agent_id: "agent-a",
          message: `alert-${i}`,
          acknowledged: 0,
          data: null,
          created_at: "2026-02-16T10:00:00Z",
        }) as AlertRow,
    );

    const service = new SupervisorStatusService(reader, { defaultLimit: 10, maxLimit: 20 });
    const rows = service.getAgentAlerts(
      { callerAgentId: "ultron", supervisedAgentIds: ["agent-a"] },
      { limit: 1000 },
    );

    expect(rows).toHaveLength(20);
  });
});
