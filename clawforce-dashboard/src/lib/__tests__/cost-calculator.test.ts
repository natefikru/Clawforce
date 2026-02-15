import { describe, it, expect } from "vitest";
import {
  isLocalModel,
  calculateTokenCost,
  calculateCostBreakdown,
  formatCost,
  DEFAULT_PRICING,
  type TokenUsage,
} from "../cost-calculator";

describe("isLocalModel", () => {
  it("should identify ollama models as local", () => {
    expect(isLocalModel("ollama/llama3.3:8b")).toBe(true);
  });

  it("should identify local/ prefix as local", () => {
    expect(isLocalModel("local/custom-model")).toBe(true);
  });

  it("should not identify anthropic models as local", () => {
    expect(isLocalModel("anthropic/claude-sonnet-4-5")).toBe(false);
  });

  it("should not identify openai models as local", () => {
    expect(isLocalModel("openai/gpt-4o")).toBe(false);
  });
});

describe("calculateTokenCost", () => {
  it("should calculate cost for known cloud model", () => {
    const usage: TokenUsage = {
      model: "anthropic/claude-sonnet-4-5",
      inputTokens: 1000,
      outputTokens: 500,
    };
    const cost = calculateTokenCost(usage);
    // 1000/1M * $3 + 500/1M * $15 = $0.003 + $0.0075 = $0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it("should return 0 for local models", () => {
    const usage: TokenUsage = {
      model: "ollama/llama3.3:8b",
      inputTokens: 10000,
      outputTokens: 5000,
    };
    expect(calculateTokenCost(usage)).toBe(0);
  });

  it("should return 0 for unknown models", () => {
    const usage: TokenUsage = {
      model: "unknown/model",
      inputTokens: 1000,
      outputTokens: 500,
    };
    expect(calculateTokenCost(usage)).toBe(0);
  });

  it("should use custom pricing when provided", () => {
    const usage: TokenUsage = {
      model: "custom/model",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    const pricing = {
      "custom/model": { inputPerMillion: 1.0, outputPerMillion: 2.0 },
    };
    const cost = calculateTokenCost(usage, pricing);
    expect(cost).toBe(3.0);
  });

  it("should handle zero tokens", () => {
    const usage: TokenUsage = {
      model: "anthropic/claude-sonnet-4-5",
      inputTokens: 0,
      outputTokens: 0,
    };
    expect(calculateTokenCost(usage)).toBe(0);
  });

  it("should handle large token counts", () => {
    const usage: TokenUsage = {
      model: "anthropic/claude-sonnet-4-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    const cost = calculateTokenCost(usage);
    // 1M/1M * $3 + 1M/1M * $15 = $18
    expect(cost).toBe(18);
  });
});

describe("calculateCostBreakdown", () => {
  it("should calculate breakdown for mixed local/cloud usage", () => {
    const usages: TokenUsage[] = [
      { model: "anthropic/claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 },
      { model: "ollama/llama3.3:8b", inputTokens: 2000, outputTokens: 1000 },
      { model: "anthropic/claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 },
    ];

    const breakdown = calculateCostBreakdown(usages);
    expect(breakdown.cloudRequests).toBe(2);
    expect(breakdown.localRequests).toBe(1);
    expect(breakdown.localCost).toBe(0);
    expect(breakdown.cloudCost).toBeGreaterThan(0);
    expect(breakdown.totalCost).toBe(breakdown.cloudCost);
    expect(breakdown.savingsPercent).toBe(33); // 1 out of 3 is local
  });

  it("should show 100% savings when all local", () => {
    const usages: TokenUsage[] = [
      { model: "ollama/llama3.3:8b", inputTokens: 1000, outputTokens: 500 },
      { model: "ollama/llama3.3:8b", inputTokens: 2000, outputTokens: 1000 },
    ];

    const breakdown = calculateCostBreakdown(usages);
    expect(breakdown.totalCost).toBe(0);
    expect(breakdown.savingsPercent).toBe(100);
  });

  it("should show 0% savings when all cloud", () => {
    const usages: TokenUsage[] = [
      { model: "anthropic/claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 },
    ];

    const breakdown = calculateCostBreakdown(usages);
    expect(breakdown.savingsPercent).toBe(0);
  });

  it("should track per-model breakdown", () => {
    const usages: TokenUsage[] = [
      { model: "anthropic/claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 },
      { model: "anthropic/claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 },
      { model: "ollama/llama3.3:8b", inputTokens: 1000, outputTokens: 500 },
    ];

    const breakdown = calculateCostBreakdown(usages);
    expect(breakdown.perModel["anthropic/claude-sonnet-4-5"].requests).toBe(2);
    expect(breakdown.perModel["ollama/llama3.3:8b"].requests).toBe(1);
    expect(breakdown.perModel["ollama/llama3.3:8b"].cost).toBe(0);
  });

  it("should handle empty usages", () => {
    const breakdown = calculateCostBreakdown([]);
    expect(breakdown.totalCost).toBe(0);
    expect(breakdown.cloudRequests).toBe(0);
    expect(breakdown.localRequests).toBe(0);
    expect(breakdown.savingsPercent).toBe(0);
  });

  it("should handle single usage", () => {
    const usages: TokenUsage[] = [
      { model: "anthropic/claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 },
    ];

    const breakdown = calculateCostBreakdown(usages);
    expect(breakdown.cloudRequests).toBe(1);
    expect(breakdown.localRequests).toBe(0);
    expect(Object.keys(breakdown.perModel)).toHaveLength(1);
  });
});

describe("formatCost", () => {
  it("should format zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("should format small costs with 4 decimals", () => {
    expect(formatCost(0.0035)).toBe("$0.0035");
  });

  it("should format regular costs with 2 decimals", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("should format exact dollar amounts", () => {
    expect(formatCost(10)).toBe("$10.00");
  });
});

describe("DEFAULT_PRICING", () => {
  it("should have pricing for claude-sonnet-4-5", () => {
    expect(DEFAULT_PRICING["anthropic/claude-sonnet-4-5"]).toBeDefined();
  });

  it("should have pricing for gpt-4o", () => {
    expect(DEFAULT_PRICING["openai/gpt-4o"]).toBeDefined();
  });

  it("should have positive prices", () => {
    for (const [, pricing] of Object.entries(DEFAULT_PRICING)) {
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    }
  });
});
