import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { BudgetTracker } from "../../../../src/plugins/clawforce-router/budget-tracker.js";
import { createTestDatabase } from "../../../../src/storage/database.js";

const TEST_DIR = join(tmpdir(), "clawforce-budget-test");
const STATE_PATH = join(TEST_DIR, "budget-state.json");

function makeTracker(overrides?: Partial<{ dailyLimit: number; perRequestCap: number; fallbackModel: string; db: DatabaseSync }>) {
  return new BudgetTracker(
    {
      dailyLimit: overrides?.dailyLimit ?? 10,
      perRequestCap: overrides?.perRequestCap,
      fallbackModel: overrides?.fallbackModel ?? "ollama/llama3.3:8b",
    },
    STATE_PATH,
    overrides?.db,
  );
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Clean up any existing state
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("BudgetTracker", () => {
  describe("checkBudget", () => {
    it("should be within budget when no spend recorded", () => {
      const tracker = makeTracker();
      const check = tracker.checkBudget(1.0);
      expect(check.withinBudget).toBe(true);
      expect(check.remainingBudget).toBe(10);
      expect(check.dailySpent).toBe(0);
      expect(check.suggestedModel).toBeUndefined();
    });

    it("should be within budget when estimated cost fits", () => {
      const tracker = makeTracker();
      tracker.recordSpend(5.0);
      const check = tracker.checkBudget(3.0);
      expect(check.withinBudget).toBe(true);
      expect(check.remainingBudget).toBe(5);
    });

    it("should be over budget when estimated cost exceeds daily limit", () => {
      const tracker = makeTracker({ dailyLimit: 5 });
      tracker.recordSpend(4.0);
      const check = tracker.checkBudget(2.0);
      expect(check.withinBudget).toBe(false);
      expect(check.suggestedModel).toBe("ollama/llama3.3:8b");
      expect(check.dailySpent).toBe(4.0);
    });

    it("should be over budget at exact limit", () => {
      const tracker = makeTracker({ dailyLimit: 5 });
      tracker.recordSpend(5.0);
      const check = tracker.checkBudget(0.01);
      expect(check.withinBudget).toBe(false);
      expect(check.suggestedModel).toBe("ollama/llama3.3:8b");
    });

    it("should always be within budget for zero cost (local models)", () => {
      const tracker = makeTracker({ dailyLimit: 0.01 });
      tracker.recordSpend(100);
      const check = tracker.checkBudget(0);
      expect(check.withinBudget).toBe(true);
    });

    it("should enforce per-request cap", () => {
      const tracker = makeTracker({ dailyLimit: 100, perRequestCap: 0.5 });
      const check = tracker.checkBudget(0.75);
      expect(check.withinBudget).toBe(false);
      expect(check.suggestedModel).toBe("ollama/llama3.3:8b");
    });

    it("should pass per-request cap when cost is within cap", () => {
      const tracker = makeTracker({ dailyLimit: 100, perRequestCap: 1.0 });
      const check = tracker.checkBudget(0.5);
      expect(check.withinBudget).toBe(true);
    });

    it("should use custom fallback model", () => {
      const tracker = makeTracker({
        dailyLimit: 1,
        fallbackModel: "ollama/mistral:7b",
      });
      tracker.recordSpend(1.0);
      const check = tracker.checkBudget(0.5);
      expect(check.suggestedModel).toBe("ollama/mistral:7b");
    });
  });

  describe("recordSpend", () => {
    it("should accumulate spend across multiple records", () => {
      const tracker = makeTracker();
      tracker.recordSpend(1.0);
      tracker.recordSpend(2.0);
      tracker.recordSpend(3.0);
      const state = tracker.getState();
      expect(state.spent).toBe(6.0);
      expect(state.requestCount).toBe(3);
    });

    it("should increment request count", () => {
      const tracker = makeTracker();
      tracker.recordSpend(0.1);
      tracker.recordSpend(0.2);
      expect(tracker.getState().requestCount).toBe(2);
    });
  });

  describe("state persistence", () => {
    it("should persist state across instances", () => {
      const tracker1 = makeTracker();
      tracker1.recordSpend(3.5);

      const tracker2 = makeTracker();
      const state = tracker2.getState();
      expect(state.spent).toBe(3.5);
      expect(state.requestCount).toBe(1);
    });

    it("should start fresh when state file is missing", () => {
      const tracker = makeTracker();
      const state = tracker.getState();
      expect(state.spent).toBe(0);
      expect(state.requestCount).toBe(0);
    });

    it("should handle corrupted state file gracefully", () => {
      writeFileSync(STATE_PATH, "not-json", "utf8");
      const tracker = makeTracker();
      const state = tracker.getState();
      expect(state.spent).toBe(0);
    });

    it("should handle partial state file gracefully", () => {
      writeFileSync(STATE_PATH, JSON.stringify({ date: "2026-01-01" }), "utf8");
      const tracker = makeTracker();
      const state = tracker.getState();
      expect(state.spent).toBe(0);
    });
  });

  describe("daily reset", () => {
    it("should reset when date changes", () => {
      // Write state with yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      writeFileSync(
        STATE_PATH,
        JSON.stringify({ date: yesterdayStr, spent: 50, requestCount: 100 }),
        "utf8",
      );

      const tracker = makeTracker();
      const state = tracker.getState();
      expect(state.spent).toBe(0);
      expect(state.requestCount).toBe(0);
      expect(state.date).not.toBe(yesterdayStr);
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      const tracker = makeTracker();
      tracker.recordSpend(5.0);
      tracker.recordSpend(3.0);
      tracker.reset();
      const state = tracker.getState();
      expect(state.spent).toBe(0);
      expect(state.requestCount).toBe(0);
    });
  });

  describe("getState", () => {
    it("should return a copy (not a reference)", () => {
      const tracker = makeTracker();
      tracker.recordSpend(1.0);
      const state1 = tracker.getState();
      tracker.recordSpend(2.0);
      const state2 = tracker.getState();
      expect(state1.spent).toBe(1.0);
      expect(state2.spent).toBe(3.0);
    });
  });

  describe("SQLite backend", () => {
    let db: DatabaseSync;

    beforeEach(() => {
      db = createTestDatabase();
    });

    afterEach(() => {
      db.close();
    });

    it("should persist budget state to SQLite", () => {
      const tracker = makeTracker({ db });
      tracker.recordSpend(2.5);
      tracker.recordSpend(1.0);

      const row = db.prepare(
        "SELECT spent, request_count FROM budget_state WHERE agent_id = '_global'",
      ).get() as { spent: number; request_count: number } | undefined;

      expect(row).toBeDefined();
      expect(row!.spent).toBe(3.5);
      expect(row!.request_count).toBe(2);
    });

    it("should load state from SQLite on construction", () => {
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(
        "INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at) VALUES ('_global', ?, ?, ?, datetime('now'))",
      ).run(today, 4.0, 8);

      const tracker = makeTracker({ db });
      const state = tracker.getState();
      expect(state.spent).toBe(4.0);
      expect(state.requestCount).toBe(8);
    });

    it("should upsert (update) existing SQLite row on subsequent writes", () => {
      const tracker = makeTracker({ db });
      tracker.recordSpend(1.0);
      tracker.recordSpend(2.0);

      const rows = db.prepare(
        "SELECT * FROM budget_state WHERE agent_id = '_global'",
      ).all() as unknown[];
      expect(rows).toHaveLength(1); // Single row, upserted

      const row = rows[0] as { spent: number; request_count: number };
      expect(row.spent).toBe(3.0);
      expect(row.request_count).toBe(2);
    });

    it("should fall back to JSON when no DB provided", () => {
      // This is the existing behavior — no DB = JSON only
      const tracker = makeTracker();
      tracker.recordSpend(1.0);
      const state = tracker.getState();
      expect(state.spent).toBe(1.0);
    });

    it("should also write to JSON file when DB is provided (dual-write)", () => {
      const tracker = makeTracker({ db });
      tracker.recordSpend(5.0);

      // Verify JSON file was also written
      expect(existsSync(STATE_PATH)).toBe(true);
      const json = JSON.parse(
        require("node:fs").readFileSync(STATE_PATH, "utf8"),
      );
      expect(json.spent).toBe(5.0);
    });

    it("should isolate budget state by agent ID in SQLite", () => {
      const tracker = makeTracker({ db });
      tracker.recordSpend(1.0, "agent-a");
      tracker.recordSpend(2.5, "agent-b");
      tracker.recordSpend(0.5, "agent-a");

      const rowA = db.prepare(
        "SELECT spent, request_count FROM budget_state WHERE agent_id = 'agent-a'",
      ).get() as { spent: number; request_count: number } | undefined;
      const rowB = db.prepare(
        "SELECT spent, request_count FROM budget_state WHERE agent_id = 'agent-b'",
      ).get() as { spent: number; request_count: number } | undefined;

      expect(rowA).toBeDefined();
      expect(rowA!.spent).toBe(1.5);
      expect(rowA!.request_count).toBe(2);

      expect(rowB).toBeDefined();
      expect(rowB!.spent).toBe(2.5);
      expect(rowB!.request_count).toBe(1);
    });

    it("should evaluate budget independently per agent", () => {
      const tracker = makeTracker({ db, dailyLimit: 2 });
      tracker.recordSpend(1.75, "agent-a");
      tracker.recordSpend(0.25, "agent-b");

      const checkA = tracker.checkBudget(0.5, "agent-a");
      const checkB = tracker.checkBudget(0.5, "agent-b");

      expect(checkA.withinBudget).toBe(false);
      expect(checkB.withinBudget).toBe(true);
    });

    it("should reset state in both SQLite and JSON", () => {
      const tracker = makeTracker({ db });
      tracker.recordSpend(3.0);
      tracker.reset();

      const row = db.prepare(
        "SELECT spent, request_count FROM budget_state WHERE agent_id = '_global'",
      ).get() as { spent: number; request_count: number } | undefined;

      expect(row).toBeDefined();
      expect(row!.spent).toBe(0);
      expect(row!.request_count).toBe(0);

      const state = tracker.getState();
      expect(state.spent).toBe(0);
    });
  });

  describe("per-agent budget config", () => {
    let db: DatabaseSync;

    beforeEach(() => {
      db = createTestDatabase();
    });

    afterEach(() => {
      db.close();
    });

    it("should isolate limits per agent with per-agent config map", () => {
      const tracker = new BudgetTracker(
        {
          "agent-a": { dailyLimit: 5, fallbackModel: "ollama/llama3.3:8b" },
          "agent-b": { dailyLimit: 10, fallbackModel: "ollama/llama3.3:8b" },
        },
        STATE_PATH,
        db,
      );

      tracker.recordSpend(4.0, "agent-a");
      tracker.recordSpend(4.0, "agent-b");

      const checkA = tracker.checkBudget(2.0, "agent-a");
      const checkB = tracker.checkBudget(2.0, "agent-b");

      expect(checkA.withinBudget).toBe(false);
      expect(checkA.suggestedModel).toBe("ollama/llama3.3:8b");
      expect(checkB.withinBudget).toBe(true);
    });

    it("should return allow-all for agent without config in per-agent map", () => {
      const tracker = new BudgetTracker(
        {
          "agent-a": { dailyLimit: 5, fallbackModel: "ollama/llama3.3:8b" },
        },
        STATE_PATH,
        db,
      );

      const check = tracker.checkBudget(1000, "agent-unknown");
      expect(check.withinBudget).toBe(true);
      expect(check.remainingBudget).toBe(Infinity);
    });

    it("should not interfere between concurrent agent state lookups", () => {
      const tracker = new BudgetTracker(
        {
          "agent-a": { dailyLimit: 10, fallbackModel: "ollama/llama3.3:8b" },
          "agent-b": { dailyLimit: 10, fallbackModel: "ollama/llama3.3:8b" },
        },
        STATE_PATH,
        db,
      );

      // Interleave operations between agents
      tracker.recordSpend(1.0, "agent-a");
      tracker.recordSpend(2.0, "agent-b");
      tracker.recordSpend(3.0, "agent-a");
      tracker.recordSpend(4.0, "agent-b");

      const stateA = tracker.getState("agent-a");
      const stateB = tracker.getState("agent-b");

      expect(stateA.spent).toBe(4.0);
      expect(stateA.requestCount).toBe(2);
      expect(stateB.spent).toBe(6.0);
      expect(stateB.requestCount).toBe(2);
    });
  });
});
