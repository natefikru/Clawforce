import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { StorageWriter } from "../../../src/storage/writer.js";
import { createTestDatabase } from "../../../src/storage/database.js";
import type { ComplianceEntry } from "../../../src/storage/types.js";
import type { RoutingLogEntry } from "../../../src/storage/types.js";

// Mock node:fs to avoid real file writes in unit tests
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { appendFileSync, mkdirSync } from "node:fs";

const mockAppendFileSync = vi.mocked(appendFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

describe("StorageWriter", () => {
  let db: DatabaseSync;
  let writer: StorageWriter;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDatabase();
    writer = new StorageWriter(db, "/tmp/compliance.jsonl", "/tmp/routing.jsonl");
  });

  afterEach(() => {
    db.close();
  });

  describe("writeComplianceEvent", () => {
    it("inserts row into compliance_events table", () => {
      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
        agentId: "main",
        tool: "exec",
        success: true,
      };

      writer.writeComplianceEvent(entry);

      const rows = db
        .prepare("SELECT * FROM compliance_events")
        .all() as { ts: string; event: string; agent_id: string; data: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0].ts).toBe("2026-02-15T12:00:00Z");
      expect(rows[0].event).toBe("tool_call");
      expect(rows[0].agent_id).toBe("main");

      const data = JSON.parse(rows[0].data);
      expect(data.tool).toBe("exec");
      expect(data.success).toBe(true);
    });

    it("appends to JSONL file", () => {
      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
      };

      writer.writeComplianceEvent(entry);

      expect(mockAppendFileSync).toHaveBeenCalledWith(
        "/tmp/compliance.jsonl",
        expect.stringContaining('"event":"tool_call"'),
        "utf8",
      );
    });

    it("handles missing agentId and channel gracefully (null in DB)", () => {
      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "message_received",
      };

      writer.writeComplianceEvent(entry);

      const rows = db
        .prepare("SELECT agent_id, channel FROM compliance_events")
        .all() as { agent_id: string | null; channel: string | null }[];

      expect(rows).toHaveLength(1);
      expect(rows[0].agent_id).toBeNull();
      expect(rows[0].channel).toBeNull();
    });

    it("handles non-string agentId gracefully", () => {
      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
        agentId: 123 as unknown, // intentionally wrong type
      };

      writer.writeComplianceEvent(entry);

      const rows = db
        .prepare("SELECT agent_id FROM compliance_events")
        .all() as { agent_id: string | null }[];

      expect(rows[0].agent_id).toBeNull();
    });

    it("continues JSONL write even if SQLite fails", () => {
      // Close the DB to force SQLite failure
      const brokenDb = createTestDatabase();
      const brokenWriter = new StorageWriter(
        brokenDb,
        "/tmp/c.jsonl",
        "/tmp/r.jsonl",
      );
      brokenDb.close();

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "test",
      };

      // Should not throw — JSONL write happens first and succeeds
      expect(() => brokenWriter.writeComplianceEvent(entry)).not.toThrow();
      expect(mockAppendFileSync).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });
  });

  describe("writeRoutingDecision", () => {
    it("inserts row into routing_decisions table", () => {
      const entry: RoutingLogEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "routing_decision",
        agentId: "main",
        model: "anthropic/claude-sonnet-4-5",
        hasPII: false,
        complexity: "low",
        domain: "conversation",
      };

      writer.writeRoutingDecision(entry);

      const rows = db
        .prepare("SELECT * FROM routing_decisions")
        .all() as {
          ts: string;
          selected_model: string;
          selected_provider: string;
          has_pii: number;
          is_local: number;
        }[];

      expect(rows).toHaveLength(1);
      expect(rows[0].selected_model).toBe("anthropic/claude-sonnet-4-5");
      expect(rows[0].selected_provider).toBe("anthropic");
      expect(rows[0].has_pii).toBe(0);
      expect(rows[0].is_local).toBe(0);
    });

    it("correctly extracts provider from model string", () => {
      const entry: RoutingLogEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "routing_decision",
        model: "ollama/llama3.3:8b",
      };

      writer.writeRoutingDecision(entry);

      const row = db
        .prepare("SELECT selected_provider FROM routing_decisions")
        .get() as { selected_provider: string };
      expect(row.selected_provider).toBe("ollama");
    });

    it("sets is_local=1 for local models", () => {
      for (const model of [
        "ollama/llama3.3:8b",
        "sglang/qwen3-32b",
        "vllm/mistral-7b",
        "local/phi-3",
      ]) {
        const entry: RoutingLogEntry = {
          ts: "2026-02-15T12:00:00Z",
          event: "routing_decision",
          model,
        };
        writer.writeRoutingDecision(entry);
      }

      const rows = db
        .prepare("SELECT is_local FROM routing_decisions")
        .all() as { is_local: number }[];
      expect(rows.every((r) => r.is_local === 1)).toBe(true);
    });

    it("sets is_local=0 for cloud models", () => {
      const entry: RoutingLogEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "routing_decision",
        model: "anthropic/claude-sonnet-4-5",
      };
      writer.writeRoutingDecision(entry);

      const row = db
        .prepare("SELECT is_local FROM routing_decisions")
        .get() as { is_local: number };
      expect(row.is_local).toBe(0);
    });

    it("stores PII types as JSON array", () => {
      const entry: RoutingLogEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "routing_decision",
        model: "ollama/llama3.3:8b",
        hasPII: true,
        piiTypes: ["email", "ssn"],
      };
      writer.writeRoutingDecision(entry);

      const row = db
        .prepare("SELECT pii_types, has_pii FROM routing_decisions")
        .get() as { pii_types: string; has_pii: number };
      expect(row.has_pii).toBe(1);
      expect(JSON.parse(row.pii_types)).toEqual(["email", "ssn"]);
    });

    it("handles entries with missing optional fields", () => {
      const entry: RoutingLogEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "output_redaction",
        redactedTypes: ["email"],
        matchCount: 1,
      };

      // Should not throw — optional fields become null
      expect(() => writer.writeRoutingDecision(entry)).not.toThrow();

      const row = db
        .prepare("SELECT selected_model, agent_id, complexity FROM routing_decisions")
        .get() as { selected_model: string; agent_id: string | null; complexity: string | null };
      expect(row.selected_model).toBe("");
      expect(row.agent_id).toBeNull();
      expect(row.complexity).toBeNull();
    });

    it("appends to routing JSONL file", () => {
      const entry: RoutingLogEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "routing_decision",
        model: "ollama/llama3.3:8b",
      };
      writer.writeRoutingDecision(entry);

      expect(mockAppendFileSync).toHaveBeenCalledWith(
        "/tmp/routing.jsonl",
        expect.stringContaining('"routing_decision"'),
        "utf8",
      );
    });
  });

  describe("writeBudgetState", () => {
    it("inserts into budget_state table", () => {
      writer.writeBudgetState("_global", "2026-02-15", 1.5, 10);

      const row = db
        .prepare("SELECT * FROM budget_state")
        .get() as { agent_id: string; date: string; spent: number; request_count: number };
      expect(row.agent_id).toBe("_global");
      expect(row.date).toBe("2026-02-15");
      expect(row.spent).toBe(1.5);
      expect(row.request_count).toBe(10);
    });

    it("upserts on conflict (same agent + date)", () => {
      writer.writeBudgetState("_global", "2026-02-15", 1.0, 5);
      writer.writeBudgetState("_global", "2026-02-15", 2.5, 12);

      const rows = db
        .prepare("SELECT * FROM budget_state")
        .all() as { spent: number; request_count: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].spent).toBe(2.5);
      expect(rows[0].request_count).toBe(12);
    });

    it("supports multiple agents on same date", () => {
      writer.writeBudgetState("agent-1", "2026-02-15", 1.0, 5);
      writer.writeBudgetState("agent-2", "2026-02-15", 2.0, 10);

      const rows = db
        .prepare("SELECT * FROM budget_state ORDER BY agent_id")
        .all() as { agent_id: string }[];
      expect(rows).toHaveLength(2);
      expect(rows[0].agent_id).toBe("agent-1");
      expect(rows[1].agent_id).toBe("agent-2");
    });
  });

  describe("JSONL directory caching", () => {
    it("only calls mkdirSync once per directory", () => {
      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
      };

      writer.writeComplianceEvent(entry);
      writer.writeComplianceEvent(entry);
      writer.writeComplianceEvent(entry);

      // mkdirSync for /tmp should be called once (for compliance log dir)
      const complianceDirCalls = mockMkdirSync.mock.calls.filter(
        (call) => call[0] === "/tmp",
      );
      expect(complianceDirCalls).toHaveLength(1);
    });
  });

  describe("error isolation", () => {
    it("JSONL failure does not prevent SQLite write", () => {
      mockAppendFileSync.mockImplementation(() => {
        throw new Error("disk full");
      });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const entry: ComplianceEntry = {
        ts: "2026-02-15T12:00:00Z",
        event: "tool_call",
      };

      writer.writeComplianceEvent(entry);

      // SQLite should still have the row
      const count = db
        .prepare("SELECT COUNT(*) as c FROM compliance_events")
        .get() as { c: number };
      expect(count.c).toBe(1);

      stderrSpy.mockRestore();
    });
  });
});
