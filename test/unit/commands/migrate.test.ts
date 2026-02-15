import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../../../src/storage/migrations.js";

// Mock logger to suppress output during tests
vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    header: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Instead of mocking getDatabase, we mock the whole module to use fresh DBs per call
let currentDb: DatabaseSync | null = null;

vi.mock("../../../src/storage/database.js", () => ({
  getDatabase: (dbPath: string) => {
    if (!currentDb) {
      mkdirSync(require("node:path").dirname(dbPath), { recursive: true });
      currentDb = new DatabaseSync(dbPath);
      currentDb.exec("PRAGMA journal_mode=WAL");
      currentDb.exec("PRAGMA foreign_keys=ON");
      runMigrations(currentDb);
    }
    return currentDb;
  },
  closeDatabase: () => {
    currentDb?.close();
    currentDb = null;
  },
  createTestDatabase: () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    runMigrations(db);
    return db;
  },
}));

// Dynamic import after mocks are set up
const { migrateCommand } = await import("../../../src/commands/migrate.js");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `clawforce-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  currentDb = null;
});

afterEach(() => {
  if (currentDb) {
    try { currentDb.close(); } catch { /* ignore */ }
    currentDb = null;
  }
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
});

function sampleComplianceLines(): string[] {
  return [
    JSON.stringify({ ts: "2026-02-15T10:00:00Z", event: "tool_call", agentId: "main", tool: "exec", success: true }),
    JSON.stringify({ ts: "2026-02-15T10:01:00Z", event: "message_sent", channel: "slack", to: "#general" }),
    JSON.stringify({ ts: "2026-02-15T10:02:00Z", event: "tool_call", agentId: "main", tool: "search", success: false }),
  ];
}

function sampleRoutingLines(): string[] {
  return [
    JSON.stringify({ ts: "2026-02-15T10:00:00Z", event: "routing_decision", model: "ollama/llama3.3:8b", hasPII: false, complexity: "low", domain: "conversation" }),
    JSON.stringify({ ts: "2026-02-15T10:01:00Z", event: "routing_decision", model: "anthropic/claude-sonnet-4-5", hasPII: true, piiTypes: ["email"], complexity: "high", domain: "code" }),
  ];
}

describe("migrateCommand", () => {
  it("migrates compliance.jsonl entries into SQLite", async () => {
    writeFileSync(join(testDir, "compliance.jsonl"), sampleComplianceLines().join("\n") + "\n");
    const result = await migrateCommand({ dataDir: testDir });

    expect(result.compliance.inserted).toBe(3);
    expect(result.compliance.errors).toBe(0);
  });

  it("migrates routing.jsonl entries into SQLite", async () => {
    writeFileSync(join(testDir, "routing.jsonl"), sampleRoutingLines().join("\n") + "\n");
    const result = await migrateCommand({ dataDir: testDir });

    expect(result.routing.inserted).toBe(2);
    expect(result.routing.errors).toBe(0);
  });

  it("migrates budget-state.json", async () => {
    writeFileSync(join(testDir, "budget-state.json"), JSON.stringify({ date: "2026-02-15", spent: 3.5, requestCount: 10 }));
    const result = await migrateCommand({ dataDir: testDir });

    expect(result.budget.migrated).toBe(true);
  });

  it("handles missing files gracefully", async () => {
    const result = await migrateCommand({ dataDir: testDir });

    expect(result.compliance.inserted).toBe(0);
    expect(result.routing.inserted).toBe(0);
    expect(result.budget.migrated).toBe(false);
  });

  it("handles malformed JSONL lines without crashing", async () => {
    const lines = [
      JSON.stringify({ ts: "2026-02-15T10:00:00Z", event: "tool_call" }),
      "not-valid-json",
      JSON.stringify({ ts: "2026-02-15T10:02:00Z", event: "message_sent" }),
    ];
    writeFileSync(join(testDir, "compliance.jsonl"), lines.join("\n") + "\n");
    const result = await migrateCommand({ dataDir: testDir });

    expect(result.compliance.inserted).toBe(2);
    expect(result.compliance.errors).toBe(1);
  });

  it("dry-run reports counts without inserting", async () => {
    writeFileSync(join(testDir, "compliance.jsonl"), sampleComplianceLines().join("\n") + "\n");
    writeFileSync(join(testDir, "routing.jsonl"), sampleRoutingLines().join("\n") + "\n");
    writeFileSync(join(testDir, "budget-state.json"), JSON.stringify({ date: "2026-02-15", spent: 1.0, requestCount: 5 }));

    const result = await migrateCommand({ dataDir: testDir, dryRun: true });

    expect(result.compliance.inserted).toBe(3);
    expect(result.routing.inserted).toBe(2);
    expect(result.budget.migrated).toBe(true);
  });

  it("handles invalid budget-state.json", async () => {
    writeFileSync(join(testDir, "budget-state.json"), "not-json");
    const result = await migrateCommand({ dataDir: testDir });
    expect(result.budget.migrated).toBe(false);
  });

  it("handles empty JSONL files", async () => {
    writeFileSync(join(testDir, "compliance.jsonl"), "");
    const result = await migrateCommand({ dataDir: testDir });
    expect(result.compliance.inserted).toBe(0);
    expect(result.compliance.errors).toBe(0);
  });
});
