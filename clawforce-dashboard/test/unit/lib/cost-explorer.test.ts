import { describe, it, expect } from "vitest";
import {
  buildTimeSeries,
  calculateWhatIf,
  type TimestampedUsage,
} from "@/lib/cost-explorer";
import type { TokenUsage } from "@/lib/cost-calculator";

// Helper to create a timestamped usage entry
function usage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  timestamp: string,
): TimestampedUsage {
  return { model, inputTokens, outputTokens, timestamp };
}

describe("buildTimeSeries", () => {
  it("returns empty array for empty usages", () => {
    expect(buildTimeSeries([], "hour")).toEqual([]);
  });

  it("buckets by hour", () => {
    const usages: TimestampedUsage[] = [
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-01T10:15:00Z"),
      usage("anthropic/claude-sonnet-4-5", 2000, 1000, "2025-06-01T10:45:00Z"),
      usage("anthropic/claude-sonnet-4-5", 500, 200, "2025-06-01T11:05:00Z"),
    ];

    const result = buildTimeSeries(usages, "hour");
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe("2025-06-01T10:00:00.000Z");
    expect(result[1].timestamp).toBe("2025-06-01T11:00:00.000Z");
    // First bucket: 2 requests
    expect(result[0].totalRequests).toBe(2);
    // Second bucket: 1 request
    expect(result[1].totalRequests).toBe(1);
  });

  it("buckets by day", () => {
    const usages: TimestampedUsage[] = [
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-01T10:00:00Z"),
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-01T22:00:00Z"),
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-02T05:00:00Z"),
    ];

    const result = buildTimeSeries(usages, "day");
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe("2025-06-01");
    expect(result[1].timestamp).toBe("2025-06-02");
    expect(result[0].totalRequests).toBe(2);
    expect(result[1].totalRequests).toBe(1);
  });

  it("separates cloud and local costs", () => {
    const usages: TimestampedUsage[] = [
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-01T10:00:00Z"),
      usage("ollama/llama3.3:8b", 1000, 500, "2025-06-01T10:30:00Z"),
    ];

    const result = buildTimeSeries(usages, "hour");
    expect(result).toHaveLength(1);
    expect(result[0].cloudCost).toBeGreaterThan(0);
    expect(result[0].localCost).toBe(0); // Local models are free
    expect(result[0].totalRequests).toBe(2);
  });

  it("sorts buckets chronologically", () => {
    const usages: TimestampedUsage[] = [
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-03T10:00:00Z"),
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-01T10:00:00Z"),
      usage("anthropic/claude-sonnet-4-5", 1000, 500, "2025-06-02T10:00:00Z"),
    ];

    const result = buildTimeSeries(usages, "day");
    expect(result.map((r) => r.timestamp)).toEqual([
      "2025-06-01",
      "2025-06-02",
      "2025-06-03",
    ]);
  });

  it("rounds costs to 4 decimal places", () => {
    const usages: TimestampedUsage[] = [
      usage("anthropic/claude-sonnet-4-5", 1, 1, "2025-06-01T10:00:00Z"),
    ];

    const result = buildTimeSeries(usages, "hour");
    // Very small cost should be rounded
    const costStr = result[0].cloudCost.toString();
    const decimals = costStr.split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(4);
  });

  it("handles unknown models with zero cost", () => {
    const usages: TimestampedUsage[] = [
      usage("unknown/model-xyz", 10000, 5000, "2025-06-01T10:00:00Z"),
    ];

    const result = buildTimeSeries(usages, "hour");
    expect(result).toHaveLength(1);
    expect(result[0].cloudCost).toBe(0);
    expect(result[0].totalRequests).toBe(1);
  });
});

describe("calculateWhatIf", () => {
  const cloudUsages: TokenUsage[] = [
    { model: "anthropic/claude-sonnet-4-5", inputTokens: 10000, outputTokens: 5000 },
    { model: "anthropic/claude-sonnet-4-5", inputTokens: 8000, outputTokens: 3000 },
    { model: "openai/gpt-4o", inputTokens: 5000, outputTokens: 2000 },
  ];

  it("returns zero savings when already 100% local", () => {
    const localUsages: TokenUsage[] = [
      { model: "ollama/llama3.3:8b", inputTokens: 10000, outputTokens: 5000 },
    ];

    const result = calculateWhatIf(localUsages, {
      type: "localPercent",
      percent: 100,
    });

    expect(result.currentCost).toBe(0);
    expect(result.projectedCost).toBe(0);
    expect(result.savings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("projects zero cost when routing 100% to local", () => {
    const result = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: 100,
    });

    expect(result.currentCost).toBeGreaterThan(0);
    expect(result.projectedCost).toBe(0);
    expect(result.savings).toBe(result.currentCost);
    expect(result.savingsPercent).toBe(100);
  });

  it("projects same cost when routing 0% to local", () => {
    const result = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: 0,
    });

    expect(result.projectedCost).toBe(result.currentCost);
    expect(result.savings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("routes most expensive requests to local first", () => {
    // With 33% local (1 of 3 requests), should route the most expensive one locally
    const result = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: 33,
    });

    expect(result.projectedCost).toBeLessThan(result.currentCost);
    expect(result.savings).toBeGreaterThan(0);
    // Savings should be higher than proportional because we route expensive ones first
  });

  it("handles routeAllTo scenario", () => {
    const result = calculateWhatIf(cloudUsages, {
      type: "routeAllTo",
      model: "openai/gpt-4o-mini",
    });

    // GPT-4o-mini is cheaper than sonnet, so projected should be less
    expect(result.projectedCost).toBeLessThan(result.currentCost);
    expect(result.savingsPercent).toBeGreaterThan(0);
  });

  it("handles routeAllTo local model (zero cost)", () => {
    const result = calculateWhatIf(cloudUsages, {
      type: "routeAllTo",
      model: "ollama/llama3.3:8b",
    });

    expect(result.projectedCost).toBe(0);
    expect(result.savingsPercent).toBe(100);
  });

  it("clamps percent to 0-100 range", () => {
    const resultOver = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: 200,
    });
    const result100 = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: 100,
    });

    expect(resultOver.projectedCost).toBe(result100.projectedCost);

    const resultUnder = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: -50,
    });
    const result0 = calculateWhatIf(cloudUsages, {
      type: "localPercent",
      percent: 0,
    });

    expect(resultUnder.projectedCost).toBe(result0.projectedCost);
  });

  it("returns empty results for empty usages", () => {
    const result = calculateWhatIf([], {
      type: "localPercent",
      percent: 50,
    });

    expect(result.currentCost).toBe(0);
    expect(result.projectedCost).toBe(0);
    expect(result.savings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("accepts custom pricing", () => {
    const customPricing = {
      "anthropic/claude-sonnet-4-5": {
        inputPerMillion: 100,
        outputPerMillion: 200,
      },
    };

    const withDefault = calculateWhatIf(
      [cloudUsages[0]],
      { type: "localPercent", percent: 0 },
    );

    const withCustom = calculateWhatIf(
      [cloudUsages[0]],
      { type: "localPercent", percent: 0 },
      customPricing,
    );

    // Custom pricing is much higher, so cost should differ
    expect(withCustom.currentCost).toBeGreaterThan(withDefault.currentCost);
  });
});
