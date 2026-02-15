import { describe, it, expect } from "vitest";
import {
  calculateWhatIf,
  formatCost,
  isLocalModel,
  type CostEntry,
} from "@/lib/cost-explorer";

describe("isLocalModel", () => {
  it("returns true for ollama models", () => {
    expect(isLocalModel("ollama/llama3.3:8b")).toBe(true);
  });

  it("returns true for local/ prefix", () => {
    expect(isLocalModel("local/my-model")).toBe(true);
  });

  it("returns false for cloud models", () => {
    expect(isLocalModel("anthropic/claude-sonnet-4-5")).toBe(false);
    expect(isLocalModel("openai/gpt-4o")).toBe(false);
  });
});

describe("formatCost", () => {
  it("formats zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small costs with 4 decimal places", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
  });

  it("formats normal costs with 2 decimal places", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.01)).toBe("$0.01");
  });
});

describe("calculateWhatIf", () => {
  const cloudEntries: CostEntry[] = [
    { model: "anthropic/claude-sonnet-4-5", cost: 0.05 },
    { model: "anthropic/claude-sonnet-4-5", cost: 0.03 },
    { model: "openai/gpt-4o", cost: 0.02 },
  ];

  it("returns zero savings when already 100% local", () => {
    const localEntries: CostEntry[] = [
      { model: "ollama/llama3.3:8b", cost: 0 },
    ];

    const result = calculateWhatIf(localEntries, {
      type: "localPercent",
      percent: 100,
    });

    expect(result.currentCost).toBe(0);
    expect(result.projectedCost).toBe(0);
    expect(result.savings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("projects zero cost when routing 100% to local", () => {
    const result = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: 100,
    });

    expect(result.currentCost).toBe(0.1);
    expect(result.projectedCost).toBe(0);
    expect(result.savings).toBe(0.1);
    expect(result.savingsPercent).toBe(100);
  });

  it("projects same cost when routing 0% to local", () => {
    const result = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: 0,
    });

    expect(result.projectedCost).toBe(result.currentCost);
    expect(result.savings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("routes most expensive requests to local first", () => {
    // With 33% local (1 of 3 requests), should route the $0.05 one locally
    const result = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: 33,
    });

    // Most expensive ($0.05) goes local, remaining = $0.03 + $0.02 = $0.05
    expect(result.projectedCost).toBe(0.05);
    expect(result.savings).toBe(0.05);
    expect(result.savingsPercent).toBe(50);
  });

  it("clamps percent to 0-100 range", () => {
    const resultOver = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: 200,
    });
    const result100 = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: 100,
    });

    expect(resultOver.projectedCost).toBe(result100.projectedCost);

    const resultUnder = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: -50,
    });
    const result0 = calculateWhatIf(cloudEntries, {
      type: "localPercent",
      percent: 0,
    });

    expect(resultUnder.projectedCost).toBe(result0.projectedCost);
  });

  it("returns empty results for empty entries", () => {
    const result = calculateWhatIf([], {
      type: "localPercent",
      percent: 50,
    });

    expect(result.currentCost).toBe(0);
    expect(result.projectedCost).toBe(0);
    expect(result.savings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("handles mixed local and cloud entries", () => {
    const mixed: CostEntry[] = [
      { model: "anthropic/claude-sonnet-4-5", cost: 0.10 },
      { model: "ollama/llama3.3:8b", cost: 0 },
      { model: "openai/gpt-4o", cost: 0.04 },
    ];

    const result = calculateWhatIf(mixed, {
      type: "localPercent",
      percent: 0,
    });

    expect(result.currentCost).toBe(0.14);
  });

  it("rounds results to 4 decimal places", () => {
    const entries: CostEntry[] = [
      { model: "anthropic/claude-sonnet-4-5", cost: 0.00333 },
      { model: "anthropic/claude-sonnet-4-5", cost: 0.00333 },
      { model: "anthropic/claude-sonnet-4-5", cost: 0.00333 },
    ];

    const result = calculateWhatIf(entries, {
      type: "localPercent",
      percent: 0,
    });

    // 0.00333 * 3 = 0.00999, rounded to 4dp = 0.01
    const costStr = result.currentCost.toString();
    const decimals = costStr.split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(4);
  });
});
