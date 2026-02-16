/**
 * Budget tracking for cost-aware model routing.
 * Tracks daily spend and enforces limits to auto-downgrade
 * to cheaper models when budget is exceeded.
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
  private config: BudgetConfig;
  private statePath: string;
  private db: DatabaseSync | null;
  private state: BudgetState;

  constructor(config: BudgetConfig, statePath?: string, db?: DatabaseSync) {
    this.config = config;
    this.statePath = statePath ?? DEFAULT_STATE_PATH;
    this.db = db ?? null;
    this.state = this.loadState();
  }

  checkBudget(estimatedCost: number): BudgetCheck {
    this.ensureCurrentDay();

    // Local models are always free
    if (estimatedCost === 0) {
      return {
        withinBudget: true,
        remainingBudget: this.config.dailyLimit - this.state.spent,
        dailySpent: this.state.spent,
      };
    }

    // Check per-request cap
    if (this.config.perRequestCap && estimatedCost > this.config.perRequestCap) {
      return {
        withinBudget: false,
        remainingBudget: this.config.dailyLimit - this.state.spent,
        suggestedModel: this.config.fallbackModel,
        dailySpent: this.state.spent,
      };
    }

    // Check daily limit
    const projectedSpend = this.state.spent + estimatedCost;
    if (projectedSpend > this.config.dailyLimit) {
      return {
        withinBudget: false,
        remainingBudget: this.config.dailyLimit - this.state.spent,
        suggestedModel: this.config.fallbackModel,
        dailySpent: this.state.spent,
      };
    }

    return {
      withinBudget: true,
      remainingBudget: this.config.dailyLimit - this.state.spent,
      dailySpent: this.state.spent,
    };
  }

  recordSpend(actualCost: number): void {
    this.ensureCurrentDay();
    this.state.spent += actualCost;
    this.state.requestCount += 1;
    this.saveState();
  }

  getState(): BudgetState {
    this.ensureCurrentDay();
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      date: todayString(),
      spent: 0,
      requestCount: 0,
    };
    this.saveState();
  }

  private ensureCurrentDay(): void {
    const today = todayString();
    if (this.state.date !== today) {
      this.state = { date: today, spent: 0, requestCount: 0 };
      this.saveState();
    }
  }

  private loadState(): BudgetState {
    // Try SQLite first when available
    if (this.db) {
      try {
        const row = this.db.prepare(
          "SELECT spent, request_count FROM budget_state WHERE agent_id = '_global' AND date = ?",
        ).get(todayString()) as { spent: number; request_count: number } | undefined;
        if (row) {
          return { date: todayString(), spent: row.spent, requestCount: row.request_count };
        }
      } catch {
        // Fall through to JSON file
      }
    }

    // JSON file fallback
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

  private saveState(): void {
    // SQLite upsert (primary when available)
    if (this.db) {
      try {
        this.db.prepare(
          `INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at)
           VALUES ('_global', ?, ?, ?, datetime('now'))
           ON CONFLICT(agent_id, date) DO UPDATE SET
             spent = excluded.spent, request_count = excluded.request_count, updated_at = datetime('now')`,
        ).run(this.state.date, this.state.spent, this.state.requestCount);
      } catch {
        // Best-effort SQLite persistence
      }
    }

    // JSON file fallback (always write for backward compat)
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify(this.state), "utf8");
    } catch {
      // Best-effort persistence
    }
  }
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export { isLocalModel, estimateRequestCost };
