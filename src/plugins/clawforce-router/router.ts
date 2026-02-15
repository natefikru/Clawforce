/**
 * Model selection logic based on PII detection and complexity analysis.
 * PII detection always takes priority (routes to local model).
 * Complexity-based routing optimizes cost vs capability.
 */

import type { ComplexityLevel } from "./complexity-analyzer.js";

export type RoutingCondition =
  | "pii_detected"
  | "low_complexity"
  | "high_complexity";

export interface RoutingRule {
  condition: RoutingCondition;
  model: string;
}

export interface SelectModelInput {
  hasPII: boolean;
  complexity: ComplexityLevel;
  rules: RoutingRule[];
  defaultModel: string;
}

export interface RoutingDecision {
  model: string;
  reason: string;
  matchedRule?: RoutingRule;
}

const DEFAULT_RULES: RoutingRule[] = [
  { condition: "pii_detected", model: "ollama/llama3.3:8b" },
  { condition: "low_complexity", model: "ollama/llama3.3:8b" },
  { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
];

export function selectModel(input: SelectModelInput): RoutingDecision {
  const { hasPII, complexity, rules, defaultModel } = input;

  // PII always takes highest priority — route to local model
  if (hasPII) {
    const piiRule = rules.find((r) => r.condition === "pii_detected");
    if (piiRule) {
      return {
        model: piiRule.model,
        reason: "PII detected — routing to local model",
        matchedRule: piiRule,
      };
    }
  }

  // Complexity-based routing
  if (complexity === "low") {
    const lowRule = rules.find((r) => r.condition === "low_complexity");
    if (lowRule) {
      return {
        model: lowRule.model,
        reason: "Low complexity — routing to cost-efficient model",
        matchedRule: lowRule,
      };
    }
  }

  if (complexity === "high") {
    const highRule = rules.find((r) => r.condition === "high_complexity");
    if (highRule) {
      return {
        model: highRule.model,
        reason: "High complexity — routing to capable model",
        matchedRule: highRule,
      };
    }
  }

  // Default: use the configured default model
  return {
    model: defaultModel,
    reason: "No routing rule matched — using default model",
  };
}

export function getDefaultRules(): RoutingRule[] {
  return [...DEFAULT_RULES];
}
