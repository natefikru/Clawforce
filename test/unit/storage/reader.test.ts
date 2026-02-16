import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { StorageReader } from "../../../src/storage/reader.js";
import { StorageWriter } from "../../../src/storage/writer.js";
import { createTestDatabase } from "../../../src/storage/database.js";
import { vi } from "vitest";

// Mock node:fs to avoid real file writes from StorageWriter
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe("StorageReader", () => {
  let db: DatabaseSync;
  let reader: StorageReader;
  let writer: StorageWriter;

  beforeEach(() => {
    db = createTestDatabase();
    reader = new StorageReader(db);
    writer = new StorageWriter(db, "/tmp/c.jsonl", "/tmp/r.jsonl");
  });

  afterEach(() => {
    db.close();
  });

  describe("getRecentEvents", () => {
    it("returns entries in descending order by ts", () => {
      writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "a" });
      writer.writeComplianceEvent({ ts: "2026-02-15T12:00:00Z", event: "b" });
      writer.writeComplianceEvent({ ts: "2026-02-15T11:00:00Z", event: "c" });

      const events = reader.getRecentEvents({ limit: 10 });
      expect(events).toHaveLength(3);
      expect(events[0].event).toBe("b"); // latest first
      expect(events[2].event).toBe("a"); // earliest last
    });

    it("filters by event type", () => {
      writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "tool_call" });
      writer.writeComplianceEvent({ ts: "2026-02-15T11:00:00Z", event: "message_sent" });
      writer.writeComplianceEvent({ ts: "2026-02-15T12:00:00Z", event: "tool_call" });

      const events = reader.getRecentEvents({ limit: 10, event: "tool_call" });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.event === "tool_call")).toBe(true);
    });

    it("filters by agent ID", () => {
      writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "a", agentId: "agent-1" });
      writer.writeComplianceEvent({ ts: "2026-02-15T11:00:00Z", event: "b", agentId: "agent-2" });
      writer.writeComplianceEvent({ ts: "2026-02-15T12:00:00Z", event: "c", agentId: "agent-1" });

      const events = reader.getRecentEvents({ limit: 10, agentId: "agent-1" });
      expect(events).toHaveLength(2);
    });

  it("normalizes missing agent ID to _global in returned entries", () => {
    writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "a" });
    const events = reader.getRecentEvents({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe("_global");
  });

  it("treats legacy NULL agent_id rows as _global when filtering", () => {
    const payload = JSON.stringify({
      ts: "2026-02-15T10:00:00Z",
      event: "legacy_event",
    });
    db.prepare(
      "INSERT INTO compliance_events (ts, event, agent_id, channel, data) VALUES (?, ?, NULL, NULL, ?)",
    ).run("2026-02-15T10:00:00Z", "legacy_event", payload);

    const events = reader.getRecentEvents({ limit: 10, agentId: "_global" });
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("legacy_event");
    expect(events[0].agentId).toBe("_global");
  });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        writer.writeComplianceEvent({ ts: `2026-02-15T${String(i).padStart(2, "0")}:00:00Z`, event: "x" });
      }

      const events = reader.getRecentEvents({ limit: 3 });
      expect(events).toHaveLength(3);
    });

    it("returns empty array on empty DB", () => {
      const events = reader.getRecentEvents({ limit: 10 });
      expect(events).toEqual([]);
    });

    it("returns empty array when limit is 0", () => {
      writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "x" });
      const events = reader.getRecentEvents({ limit: 0 });
      expect(events).toEqual([]);
    });

    it("returns full ComplianceEntry from data column", () => {
      writer.writeComplianceEvent({
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
        agentId: "main",
        tool: "exec",
        success: true,
        durationMs: 150,
      });

      const events = reader.getRecentEvents({ limit: 1 });
      expect(events[0].tool).toBe("exec");
      expect(events[0].success).toBe(true);
      expect(events[0].durationMs).toBe(150);
    });
  });

  describe("getRoutingDecisions", () => {
    it("returns decisions filtered by since timestamp", () => {
      writer.writeRoutingDecision({ ts: "2026-02-14T10:00:00Z", event: "routing_decision", model: "a" });
      writer.writeRoutingDecision({ ts: "2026-02-15T10:00:00Z", event: "routing_decision", model: "b" });
      writer.writeRoutingDecision({ ts: "2026-02-16T10:00:00Z", event: "routing_decision", model: "c" });

      const rows = reader.getRoutingDecisions({ since: "2026-02-15T00:00:00Z" });
      expect(rows).toHaveLength(2);
    });

    it("filters piiOnly", () => {
      writer.writeRoutingDecision({ ts: "2026-02-15T10:00:00Z", event: "routing_decision", model: "a", hasPII: true, piiTypes: ["email"] });
      writer.writeRoutingDecision({ ts: "2026-02-15T11:00:00Z", event: "routing_decision", model: "b", hasPII: false });

      const rows = reader.getRoutingDecisions({ piiOnly: true });
      expect(rows).toHaveLength(1);
      expect(rows[0].has_pii).toBe(1);
    });

    it("returns empty array with future since date", () => {
      writer.writeRoutingDecision({ ts: "2026-02-15T10:00:00Z", event: "routing_decision", model: "a" });
      const rows = reader.getRoutingDecisions({ since: "2099-01-01T00:00:00Z" });
      expect(rows).toEqual([]);
    });
  });

  describe("getBudgetState", () => {
    it("returns null when no state exists", () => {
      const state = reader.getBudgetState();
      expect(state).toBeNull();
    });

    it("returns current day state for default agent", () => {
      const today = new Date().toISOString().slice(0, 10);
      writer.writeBudgetState("_global", today, 1.5, 10);

      const state = reader.getBudgetState();
      expect(state).not.toBeNull();
      expect(state!.spent).toBe(1.5);
      expect(state!.request_count).toBe(10);
    });

    it("returns null for yesterday state (different date)", () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      writer.writeBudgetState("_global", yesterday, 1.5, 10);

      const state = reader.getBudgetState();
      expect(state).toBeNull();
    });

    it("filters by agent ID", () => {
      const today = new Date().toISOString().slice(0, 10);
      writer.writeBudgetState("_global", today, 1.0, 5);
      writer.writeBudgetState("agent-1", today, 2.0, 10);

      const state = reader.getBudgetState("agent-1");
      expect(state).not.toBeNull();
      expect(state!.spent).toBe(2.0);
    });
  });

  describe("getModelDistribution", () => {
    it("calculates percentages correctly", () => {
      for (let i = 0; i < 8; i++) {
        writer.writeRoutingDecision({ ts: new Date().toISOString(), event: "routing_decision", model: "ollama/llama3.3:8b" });
      }
      for (let i = 0; i < 2; i++) {
        writer.writeRoutingDecision({ ts: new Date().toISOString(), event: "routing_decision", model: "anthropic/claude-sonnet-4-5" });
      }

      const dist = reader.getModelDistribution({ days: 1 });
      expect(dist).toHaveLength(2);

      const ollama = dist.find((d) => d.model === "ollama/llama3.3:8b");
      expect(ollama?.count).toBe(8);
      expect(ollama?.percentage).toBe(80);

      const claude = dist.find((d) => d.model === "anthropic/claude-sonnet-4-5");
      expect(claude?.count).toBe(2);
      expect(claude?.percentage).toBe(20);
    });

    it("returns empty array with no data (no division by zero)", () => {
      const dist = reader.getModelDistribution({ days: 1 });
      expect(dist).toEqual([]);
    });

    it("isolates model distribution by agent ID", () => {
      writer.writeRoutingDecision({
        ts: new Date().toISOString(),
        event: "routing_decision",
        agentId: "agent-1",
        model: "ollama/llama3.3:8b",
      });
      writer.writeRoutingDecision({
        ts: new Date().toISOString(),
        event: "routing_decision",
        agentId: "agent-2",
        model: "anthropic/claude-sonnet-4-5",
      });

      const dist = reader.getModelDistribution({ days: 1, agentId: "agent-1" });
      expect(dist).toHaveLength(1);
      expect(dist[0].model).toBe("ollama/llama3.3:8b");
    });
  });

  describe("getDailySpend", () => {
    it("aggregates by date", () => {
      writer.writeBudgetState("_global", "2026-02-14", 1.0, 5);
      writer.writeBudgetState("_global", "2026-02-15", 2.0, 10);

      const spend = reader.getDailySpend({ days: 7 });
      expect(spend).toHaveLength(2);
      expect(spend[0].date).toBe("2026-02-15"); // most recent first
      expect(spend[0].spent).toBe(2.0);
      expect(spend[0].requestCount).toBe(10);
    });

    it("isolates daily spend by agent ID", () => {
      writer.writeBudgetState("agent-1", "2026-02-15", 4.0, 6);
      writer.writeBudgetState("agent-2", "2026-02-15", 9.0, 11);

      const spend = reader.getDailySpend({ days: 7, agentId: "agent-1" });
      expect(spend).toHaveLength(1);
      expect(spend[0].spent).toBe(4.0);
      expect(spend[0].requestCount).toBe(6);
    });
  });

  describe("getModelHealthStates", () => {
    it("returns latest canonical provider health states", () => {
      writer.writeModelHealthState({
        provider: "sglang",
        status: "degraded",
        circuit: "half_open",
        lastCheckedAt: "2026-02-15T12:00:00Z",
      });
      writer.writeModelHealthState({
        provider: "ollama",
        status: "healthy",
        circuit: "closed",
        lastCheckedAt: "2026-02-15T12:00:05Z",
      });

      const states = reader.getModelHealthStates();
      expect(states).toHaveLength(2);
      const byProvider = Object.fromEntries(states.map((s) => [s.provider, s]));
      expect(byProvider.sglang.status).toBe("degraded");
      expect(byProvider.ollama.circuit).toBe("closed");
    });
  });

  describe("getAlerts", () => {
    it("filters by type", () => {
      writer.writeAlert({
        ts: "2026-02-15T10:00:00Z",
        severity: "warning",
        type: "budget_exceeded",
        message: "Budget exceeded",
      });
      writer.writeAlert({
        ts: "2026-02-15T10:01:00Z",
        severity: "error",
        type: "pii_violation",
        message: "PII violation",
      });

      const rows = reader.getAlerts({ type: "pii_violation", limit: 10 });
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("pii_violation");
    });
  });

  describe("getTotalEventCount", () => {
    it("returns total count without filter", () => {
      writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "a" });
      writer.writeComplianceEvent({ ts: "2026-02-15T11:00:00Z", event: "b" });
      writer.writeComplianceEvent({ ts: "2026-02-15T12:00:00Z", event: "a" });

      expect(reader.getTotalEventCount()).toBe(3);
    });

    it("returns filtered count", () => {
      writer.writeComplianceEvent({ ts: "2026-02-15T10:00:00Z", event: "tool_call" });
      writer.writeComplianceEvent({ ts: "2026-02-15T11:00:00Z", event: "message_sent" });
      writer.writeComplianceEvent({ ts: "2026-02-15T12:00:00Z", event: "tool_call" });

      expect(reader.getTotalEventCount("tool_call")).toBe(2);
      expect(reader.getTotalEventCount("message_sent")).toBe(1);
      expect(reader.getTotalEventCount("nonexistent")).toBe(0);
    });

    it("returns 0 for empty DB", () => {
      expect(reader.getTotalEventCount()).toBe(0);
    });
  });

  describe("round-trip writer/reader", () => {
    it("data written by writer is correctly read by reader", () => {
      const entry = {
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
        agentId: "main",
        tool: "database_query",
        success: true,
        durationMs: 250,
      };
      writer.writeComplianceEvent(entry);

      const events = reader.getRecentEvents({ limit: 1 });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(entry);
    });

    it("routing decision round-trips correctly", () => {
      const entry = {
        ts: "2026-02-15T12:00:00Z",
        event: "routing_decision",
        agentId: "main",
        model: "ollama/llama3.3:8b",
        hasPII: true,
        piiTypes: ["email", "phone"],
        complexity: "low",
        domain: "conversation",
        dataTier: "internal",
      };
      writer.writeRoutingDecision(entry);

      const rows = reader.getRoutingDecisions({});
      expect(rows).toHaveLength(1);
      expect(rows[0].selected_model).toBe("ollama/llama3.3:8b");
      expect(rows[0].has_pii).toBe(1);
      expect(JSON.parse(rows[0].pii_types!)).toEqual(["email", "phone"]);

      // Also verify data column round-trips the full entry
      const data = JSON.parse(rows[0].data);
      expect(data).toEqual(entry);
    });
  });
});
