import { describe, it, expect } from "vitest";
import type {
  StorageConfig,
  ComplianceEntry,
  AlertEntry,
  ComplianceEventRow,
  RoutingLogEntry,
  RoutingDecisionRow,
  UsageMetricRow,
  BudgetStateRow,
  AlertRow,
  UsageSummary,
  ModelDistribution,
  DailySpend,
} from "../../../src/storage/types.js";
import { ALERT_TYPES } from "../../../src/storage/types.js";

describe("storage types", () => {
  it("StorageConfig has required fields", () => {
    const config: StorageConfig = {
      dbPath: "/tmp/test.db",
      complianceLogPath: "/tmp/compliance.jsonl",
      routingLogPath: "/tmp/routing.jsonl",
    };
    expect(config.dbPath).toBe("/tmp/test.db");
  });

  it("ComplianceEntry is compatible with plugin type", () => {
    const entry: ComplianceEntry = {
      ts: "2026-02-15T12:00:00Z",
      event: "tool_call",
      agentId: "main",
      tool: "exec",
    };
    expect(entry.ts).toBeDefined();
    expect(entry.event).toBe("tool_call");
  });

  it("ComplianceEventRow matches SQLite schema", () => {
    const row: ComplianceEventRow = {
      id: 1,
      ts: "2026-02-15T12:00:00Z",
      event: "tool_call",
      agent_id: "main",
      channel: null,
      data: '{"ts":"2026-02-15T12:00:00Z","event":"tool_call"}',
      created_at: "2026-02-15 12:00:00",
    };
    expect(row.id).toBe(1);
    expect(row.agent_id).toBe("main");
  });

  it("RoutingLogEntry supports all router plugin event shapes", () => {
    const routingDecision: RoutingLogEntry = {
      ts: "2026-02-15T12:00:00Z",
      event: "routing_decision",
      agentId: "main",
      model: "ollama/llama3.3:8b",
      hasPII: true,
      piiTypes: ["email"],
      complexity: "low",
      domain: "conversation",
    };
    expect(routingDecision.hasPII).toBe(true);

    const redaction: RoutingLogEntry = {
      ts: "2026-02-15T12:00:00Z",
      event: "output_redaction",
      redactedTypes: ["email"],
      matchCount: 1,
    };
    expect(redaction.matchCount).toBe(1);

    const sessionEnd: RoutingLogEntry = {
      ts: "2026-02-15T12:00:00Z",
      event: "agent_session_end",
      agentId: "main",
      success: true,
      durationMs: 1500,
      messageCount: 3,
    };
    expect(sessionEnd.messageCount).toBe(3);
  });

  it("RoutingDecisionRow matches SQLite schema", () => {
    const row: RoutingDecisionRow = {
      id: 1,
      ts: "2026-02-15T12:00:00Z",
      agent_id: "main",
      selected_model: "ollama/llama3.3:8b",
      selected_provider: "ollama",
      has_pii: 1,
      pii_types: '["email"]',
      complexity: "low",
      domain: "conversation",
      data_tier: "internal",
      is_local: 1,
      estimated_cost: 0,
      data: "{}",
      created_at: "2026-02-15 12:00:00",
    };
    expect(row.has_pii).toBe(1);
    expect(row.is_local).toBe(1);
  });

  it("UsageMetricRow matches SQLite schema", () => {
    const row: UsageMetricRow = {
      id: 1,
      ts: "2026-02-15T12:00:00Z",
      agent_id: null,
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      input_tokens: 500,
      output_tokens: 1000,
      estimated_cost: 0.015,
      is_local: 0,
      created_at: "2026-02-15 12:00:00",
    };
    expect(row.input_tokens).toBe(500);
  });

  it("BudgetStateRow matches SQLite schema", () => {
    const row: BudgetStateRow = {
      agent_id: "_global",
      date: "2026-02-15",
      spent: 1.5,
      request_count: 10,
      updated_at: "2026-02-15 12:00:00",
    };
    expect(row.agent_id).toBe("_global");
  });

  it("AlertRow matches SQLite schema", () => {
    const row: AlertRow = {
      id: 1,
      ts: "2026-02-15T12:00:00Z",
      severity: "critical",
      type: "pii_violation",
      agent_id: "main",
      message: "PII detected heading to cloud",
      acknowledged: 0,
      data: null,
      created_at: "2026-02-15 12:00:00",
    };
    expect(row.severity).toBe("critical");
  });

  it("AlertEntry enforces known alert type values", () => {
    const entry: AlertEntry = {
      ts: "2026-02-15T12:00:00Z",
      severity: "warning",
      type: "model_health",
      message: "Provider changed state",
    };
    expect(entry.type).toBe("model_health");
    expect(ALERT_TYPES).toContain(entry.type);
  });

  it("UsageSummary has aggregate fields", () => {
    const summary: UsageSummary = {
      totalRequests: 100,
      totalCost: 5.0,
      localRequests: 80,
      cloudRequests: 20,
      modelBreakdown: {
        "ollama/llama3.3:8b": { count: 80, cost: 0 },
        "claude-sonnet-4-5": { count: 20, cost: 5.0 },
      },
    };
    expect(summary.localRequests + summary.cloudRequests).toBe(
      summary.totalRequests,
    );
  });

  it("ModelDistribution has percentage field", () => {
    const dist: ModelDistribution = {
      model: "ollama/llama3.3:8b",
      count: 80,
      percentage: 80.0,
    };
    expect(dist.percentage).toBe(80.0);
  });

  it("DailySpend has date and spend fields", () => {
    const daily: DailySpend = {
      date: "2026-02-15",
      spent: 2.5,
      requestCount: 25,
    };
    expect(daily.date).toBe("2026-02-15");
  });
});
