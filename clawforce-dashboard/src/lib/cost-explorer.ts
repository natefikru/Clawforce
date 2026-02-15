/**
 * Cost exploration utilities for timeline visualization and what-if analysis.
 */

import {
  type TokenUsage,
  isLocalModel,
  calculateTokenCost,
  DEFAULT_PRICING,
  type ModelPricing,
} from "./cost-calculator";

export interface TimeSeriesPoint {
  timestamp: string;
  cloudCost: number;
  localCost: number;
  totalRequests: number;
}

export interface WhatIfResult {
  currentCost: number;
  projectedCost: number;
  savings: number;
  savingsPercent: number;
}

export type WhatIfScenario =
  | { type: "routeAllTo"; model: string }
  | { type: "localPercent"; percent: number };

export interface TimestampedUsage extends TokenUsage {
  timestamp: string;
}

export function buildTimeSeries(
  usages: TimestampedUsage[],
  bucketSize: "hour" | "day",
): TimeSeriesPoint[] {
  if (usages.length === 0) return [];

  const buckets = new Map<
    string,
    { cloudCost: number; localCost: number; totalRequests: number }
  >();

  for (const usage of usages) {
    const key = getBucketKey(usage.timestamp, bucketSize);
    const existing = buckets.get(key) ?? {
      cloudCost: 0,
      localCost: 0,
      totalRequests: 0,
    };

    const cost = calculateTokenCost(usage);
    if (isLocalModel(usage.model)) {
      existing.localCost += cost;
    } else {
      existing.cloudCost += cost;
    }
    existing.totalRequests += 1;

    buckets.set(key, existing);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, data]) => ({
      timestamp,
      cloudCost: round(data.cloudCost),
      localCost: round(data.localCost),
      totalRequests: data.totalRequests,
    }));
}

export function calculateWhatIf(
  usages: TokenUsage[],
  scenario: WhatIfScenario,
  pricing?: Record<string, ModelPricing>,
): WhatIfResult {
  const prices = pricing ?? DEFAULT_PRICING;

  const currentCost = usages.reduce(
    (sum, u) => sum + calculateTokenCost(u, prices),
    0,
  );

  let projectedCost: number;

  if (scenario.type === "routeAllTo") {
    // What if we routed everything to a specific model?
    projectedCost = usages.reduce((sum, u) => {
      const rerouted: TokenUsage = {
        ...u,
        model: scenario.model,
      };
      return sum + calculateTokenCost(rerouted, prices);
    }, 0);
  } else {
    // What if X% of requests went to local (cost = 0)?
    const percent = Math.max(0, Math.min(100, scenario.percent));
    const localCount = Math.round((usages.length * percent) / 100);

    // Sort by cost descending — route the most expensive ones to local first
    const sorted = [...usages]
      .map((u) => ({ usage: u, cost: calculateTokenCost(u, prices) }))
      .sort((a, b) => b.cost - a.cost);

    projectedCost = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i < localCount) continue; // This one goes local (free)
      projectedCost += sorted[i].cost;
    }
  }

  const savings = currentCost - projectedCost;
  const savingsPercent =
    currentCost > 0 ? Math.round((savings / currentCost) * 100) : 0;

  return {
    currentCost: round(currentCost),
    projectedCost: round(projectedCost),
    savings: round(savings),
    savingsPercent,
  };
}

function getBucketKey(timestamp: string, bucketSize: "hour" | "day"): string {
  try {
    const date = new Date(timestamp);
    if (bucketSize === "day") {
      return date.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 13) + ":00:00.000Z";
  } catch {
    return "unknown";
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
