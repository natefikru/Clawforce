import { getRuntimeEngineIds } from "../config/engines/registry.js";

/**
 * Shared model pricing constants and utilities.
 * Used by both the router (budget tracking) and dashboard (cost calculation).
 */

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

/**
 * Conservative fallback for unknown cloud models.
 * Uses the highest common pricing tier to prevent budget bypass.
 */
export const FALLBACK_CLOUD_PRICING: ModelPricing = {
  inputPerMillion: 15.0,
  outputPerMillion: 75.0,
};

export function isLocalModel(model: string): boolean {
  const slashIdx = model.indexOf("/");
  if (slashIdx <= 0) return false;
  const provider = model.slice(0, slashIdx);
  if (provider === "local") return true;
  return getRuntimeEngineIds().includes(provider);
}

const warnedModels = new Set<string>();

export function resetWarningCache(): void {
  warnedModels.clear();
}

export function estimateRequestCost(
  model: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  pricing?: Record<string, ModelPricing>,
): number {
  if (isLocalModel(model)) return 0;

  const prices = pricing ?? DEFAULT_PRICING;
  let modelPricing = prices[model];
  if (!modelPricing) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      process.stderr.write(
        `[clawforce] No pricing data for model "${model}" — using conservative fallback ($${FALLBACK_CLOUD_PRICING.inputPerMillion}/$${FALLBACK_CLOUD_PRICING.outputPerMillion} per M tokens)\n`,
      );
    }
    modelPricing = FALLBACK_CLOUD_PRICING;
  }

  const inputCost =
    (estimatedInputTokens / 1_000_000) * modelPricing.inputPerMillion;
  const outputCost =
    (estimatedOutputTokens / 1_000_000) * modelPricing.outputPerMillion;

  return inputCost + outputCost;
}
