export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4-5": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  "anthropic/claude-opus-4": {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
  },
  "anthropic/claude-haiku-4-5": {
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
  },
  "openai/gpt-4o": {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
  },
  "openai/gpt-4o-mini": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
};

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostBreakdown {
  totalCost: number;
  cloudCost: number;
  localCost: number;
  perModel: Record<string, { cost: number; requests: number }>;
  cloudRequests: number;
  localRequests: number;
  savingsPercent: number;
}

export function isLocalModel(model: string): boolean {
  return model.startsWith("ollama/") || model.startsWith("local/");
}

export function calculateTokenCost(
  usage: TokenUsage,
  pricing?: Record<string, ModelPricing>,
): number {
  if (isLocalModel(usage.model)) return 0;

  const prices = pricing ?? DEFAULT_PRICING;
  const modelPricing = prices[usage.model];
  if (!modelPricing) return 0;

  const inputCost =
    (usage.inputTokens / 1_000_000) * modelPricing.inputPerMillion;
  const outputCost =
    (usage.outputTokens / 1_000_000) * modelPricing.outputPerMillion;

  return inputCost + outputCost;
}

export function calculateCostBreakdown(
  usages: TokenUsage[],
  pricing?: Record<string, ModelPricing>,
): CostBreakdown {
  const perModel: Record<string, { cost: number; requests: number }> = {};
  let cloudCost = 0;
  let localCost = 0;
  let cloudRequests = 0;
  let localRequests = 0;

  for (const usage of usages) {
    const cost = calculateTokenCost(usage, pricing);
    const local = isLocalModel(usage.model);

    if (!perModel[usage.model]) {
      perModel[usage.model] = { cost: 0, requests: 0 };
    }
    perModel[usage.model].cost += cost;
    perModel[usage.model].requests += 1;

    if (local) {
      localCost += cost;
      localRequests += 1;
    } else {
      cloudCost += cost;
      cloudRequests += 1;
    }
  }

  const totalCost = cloudCost + localCost;
  const totalRequests = cloudRequests + localRequests;

  // Savings: what would it cost if all requests used the most expensive cloud model?
  // Simplified: savings = local requests / total requests (since local is free)
  const savingsPercent =
    totalRequests > 0
      ? Math.round((localRequests / totalRequests) * 100)
      : 0;

  return {
    totalCost,
    cloudCost,
    localCost,
    perModel,
    cloudRequests,
    localRequests,
    savingsPercent,
  };
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
