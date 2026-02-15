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

export function isLocalModel(model: string): boolean {
  return (
    model.startsWith("ollama/") ||
    model.startsWith("local/") ||
    model.startsWith("sglang/") ||
    model.startsWith("vllm/")
  );
}

const warnedModels = new Set<string>();

/** Reset the warned-models cache. Exported for testing only. */
export function clearWarningCache(): void {
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
  const modelPricing = prices[model];
  if (!modelPricing) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      process.stderr.write(
        `[clawforce] No pricing data for model "${model}" — budget tracking will undercount\n`,
      );
    }
    return 0;
  }

  const inputCost =
    (estimatedInputTokens / 1_000_000) * modelPricing.inputPerMillion;
  const outputCost =
    (estimatedOutputTokens / 1_000_000) * modelPricing.outputPerMillion;

  return inputCost + outputCost;
}
