/**
 * Cost exploration utilities for what-if analysis.
 *
 * Uses CostEntry (model + pre-computed cost) instead of token counts +
 * hardcoded pricing. Cost data comes from the OpenClaw gateway.
 */

export interface CostEntry {
  model: string;
  cost: number;
}

export interface WhatIfResult {
  currentCost: number;
  projectedCost: number;
  savings: number;
  savingsPercent: number;
}

export type WhatIfScenario =
  | { type: "localPercent"; percent: number };

export function isLocalModel(model: string): boolean {
  return model.startsWith("ollama/") || model.startsWith("local/");
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function calculateWhatIf(
  entries: CostEntry[],
  scenario: WhatIfScenario,
): WhatIfResult {
  const currentCost = entries.reduce((sum, e) => sum + e.cost, 0);

  // What if X% of requests went to local (cost = 0)?
  const percent = Math.max(0, Math.min(100, scenario.percent));
  const localCount = Math.round((entries.length * percent) / 100);

  // Sort by cost descending — route the most expensive ones to local first
  const sorted = [...entries].sort((a, b) => b.cost - a.cost);

  let projectedCost = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i < localCount) continue; // This one goes local (free)
    projectedCost += sorted[i].cost;
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

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
