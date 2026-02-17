/**
 * Budget tracking for cost-aware model routing.
 * Tracks daily spend and enforces limits to auto-downgrade
 * to cheaper models when budget is exceeded.
 *
 * Uses a Map<agentId, BudgetState> to avoid state-thrashing
 * when multiple agents call checkBudget/recordSpend concurrently.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isLocalModel, estimateRequestCost } from "../../shared/pricing.js";

export interface BudgetConfig {
  dailyLimit: number;
  perRequestCap?: number;
  fallbackModel: string;
}

export interface BudgetState {
  date: string;
  spent: number;
  requestCount: number;
}

export interface BudgetCheck {
  withinBudget: boolean;
  remainingBudget: number;
  suggestedModel?: string;
  dailySpent: number;
}

const DEFAULT_STATE_PATH = "/home/node/.openclaw/data/budget-state.json";

export class BudgetTracker {
  private globalConfig: BudgetConfig;
  private agentConfigs: Record<string, BudgetConfig> | null;
  private statePath: string;
  private db: DatabaseSync | null;
  private states: Map<string, BudgetState>;

  constructor(
    config: BudgetConfig | Record<string, BudgetConfig>,
    statePath?: string,
    db?: DatabaseSync,
  ) {
    if (isPerAgentConfig(config)) {
      // Per-agent config map: use first entry as global fallback
      this.agentConfigs = config;
      const firstKey = Object.keys(config)[0];
      this.globalConfig = firstKey ? config[firstKey] : { dailyLimit: 0, fallbackModel: "" };
    } else {
      this.globalConfig = config;
      this.agentConfigs = null;
    }
    this.statePath = statePath ?? DEFAULT_STATE_PATH;
    this.db = db ?? null;
    this.states = new Map();
    // Pre-load global state for backward compat
    this.states.set("_global", this.loadState("_global"));
  }

  checkBudget(estimatedCost: number, agentId?: string): BudgetCheck {
    const id = normalizeAgentId(agentId);
    const state = this.getAgentState(id);
    const cfg = this.getConfigForAgent(id);

    if (!cfg) {
      // Agent has no budget config → allow-all
      return {
        withinBudget: true,
        remainingBudget: Infinity,
        dailySpent: state.spent,
      };
    }

    this.ensureCurrentDay(id);
    const currentState = this.states.get(id)!;

    // Local models are always free
    if (estimatedCost === 0) {
      return {
        withinBudget: true,
        remainingBudget: cfg.dailyLimit - currentState.spent,
        dailySpent: currentState.spent,
      };
    }

    // Check per-request cap
    if (cfg.perRequestCap && estimatedCost > cfg.perRequestCap) {
      return {
        withinBudget: false,
        remainingBudget: cfg.dailyLimit - currentState.spent,
        suggestedModel: cfg.fallbackModel,
        dailySpent: currentState.spent,
      };
    }

    // Check daily limit
    const projectedSpend = currentState.spent + estimatedCost;
    if (projectedSpend > cfg.dailyLimit) {
      return {
        withinBudget: false,
        remainingBudget: cfg.dailyLimit - currentState.spent,
        suggestedModel: cfg.fallbackModel,
        dailySpent: currentState.spent,
      };
    }

    return {
      withinBudget: true,
      remainingBudget: cfg.dailyLimit - currentState.spent,
      dailySpent: currentState.spent,
    };
  }

  recordSpend(actualCost: number, agentId?: string): void {
    const id = normalizeAgentId(agentId);
    this.ensureCurrentDay(id);
    const state = this.states.get(id)!;
    state.spent += actualCost;
    state.requestCount += 1;
    this.saveState(id, state);
  }

  getState(agentId?: string): BudgetState {
    const id = normalizeAgentId(agentId);
    this.ensureCurrentDay(id);
    return { ...this.states.get(id)! };
  }

  reset(agentId?: string): void {
    const id = normalizeAgentId(agentId);
    const state: BudgetState = {
      date: todayString(),
      spent: 0,
      requestCount: 0,
    };
    this.states.set(id, state);
    this.saveState(id, state);
  }

  private getConfigForAgent(agentId: string): BudgetConfig | null {
    if (!this.agentConfigs) return this.globalConfig;
    if (this.agentConfigs[agentId]) return this.agentConfigs[agentId];
    // No per-agent config and no global fallback from agentConfigs → null (allow-all)
    return null;
  }

  private getAgentState(agentId: string): BudgetState {
    if (!this.states.has(agentId)) {
      this.states.set(agentId, this.loadState(agentId));
    }
    return this.states.get(agentId)!;
  }

  private ensureCurrentDay(agentId: string): void {
    const state = this.getAgentState(agentId);
    const today = todayString();
    if (state.date !== today) {
      const fresh: BudgetState = { date: today, spent: 0, requestCount: 0 };
      this.states.set(agentId, fresh);
      this.saveState(agentId, fresh);
    }
  }

  private loadState(agentId: string): BudgetState {
    // Try SQLite first when available
    if (this.db) {
      try {
        const row = this.db.prepare(
          "SELECT spent, request_count FROM budget_state WHERE agent_id = ? AND date = ?",
        ).get(agentId, todayString()) as { spent: number; request_count: number } | undefined;
        if (row) {
          return { date: todayString(), spent: row.spent, requestCount: row.request_count };
        }
      } catch {
        // Fall through to JSON file
      }
    }

    // JSON file fallback (global state only)
    if (agentId !== "_global") {
      return { date: todayString(), spent: 0, requestCount: 0 };
    }

    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as BudgetState;
      if (parsed.date && typeof parsed.spent === "number" && typeof parsed.requestCount === "number") {
        return parsed;
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    return { date: todayString(), spent: 0, requestCount: 0 };
  }

  private saveState(agentId: string, state: BudgetState): void {
    // SQLite upsert (primary when available)
    if (this.db) {
      try {
        this.db.prepare(
          `INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(agent_id, date) DO UPDATE SET
             spent = excluded.spent, request_count = excluded.request_count, updated_at = datetime('now')`,
        ).run(agentId, state.date, state.spent, state.requestCount);
      } catch {
        // Best-effort SQLite persistence
      }
    }

    // JSON file fallback (global state only)
    if (agentId !== "_global") {
      return;
    }

    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify(state), "utf8");
    } catch {
      // Best-effort persistence
    }
  }
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAgentId(agentId?: string): string {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  return id.length > 0 ? id : "_global";
}

function isPerAgentConfig(config: BudgetConfig | Record<string, BudgetConfig>): config is Record<string, BudgetConfig> {
  return typeof config === "object" && !("dailyLimit" in config);
}

export { isLocalModel, estimateRequestCost };
