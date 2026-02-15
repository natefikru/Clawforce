/**
 * Multi-dimensional model selection logic.
 * Evaluates dimensions in configurable priority order:
 * sensitivity → cost → domain → complexity (default).
 * First matching dimension wins.
 */

import type { ComplexityLevel } from "./complexity-analyzer.js";
import type { TaskDomain } from "./domain-detector.js";
import type { BudgetCheck } from "./budget-tracker.js";

export type RoutingCondition =
  | "pii_detected"
  | "low_complexity"
  | "high_complexity"
  | "domain_code"
  | "domain_writing"
  | "domain_analysis"
  | "domain_data"
  | "over_budget";

export type RoutingDimension = "sensitivity" | "cost" | "domain" | "complexity";

export interface RoutingRule {
  condition: RoutingCondition;
  model: string;
}

export interface SelectModelInput {
  hasPII: boolean;
  complexity: ComplexityLevel;
  domain?: TaskDomain;
  budgetCheck?: BudgetCheck;
  rules: RoutingRule[];
  defaultModel: string;
  priority?: RoutingDimension[];
}

export interface RoutingDecision {
  model: string;
  reason: string;
  matchedRule?: RoutingRule;
  dimension?: RoutingDimension;
}

const DEFAULT_PRIORITY: RoutingDimension[] = [
  "sensitivity",
  "cost",
  "domain",
  "complexity",
];

const DEFAULT_RULES: RoutingRule[] = [
  { condition: "pii_detected", model: "ollama/llama3.3:8b" },
  { condition: "low_complexity", model: "ollama/llama3.3:8b" },
  { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
];

const DOMAIN_CONDITIONS: Record<Exclude<TaskDomain, "conversation">, RoutingCondition> = {
  code: "domain_code",
  writing: "domain_writing",
  analysis: "domain_analysis",
  data: "domain_data",
};

export function selectModel(input: SelectModelInput): RoutingDecision {
  const {
    hasPII,
    complexity,
    domain,
    budgetCheck,
    rules,
    defaultModel,
    priority = DEFAULT_PRIORITY,
  } = input;

  for (const dimension of priority) {
    const result = evaluateDimension(dimension, {
      hasPII,
      complexity,
      domain,
      budgetCheck,
      rules,
    });
    if (result) {
      return { ...result, dimension };
    }
  }

  return {
    model: defaultModel,
    reason: "No routing rule matched — using default model",
  };
}

interface DimensionContext {
  hasPII: boolean;
  complexity: ComplexityLevel;
  domain?: TaskDomain;
  budgetCheck?: BudgetCheck;
  rules: RoutingRule[];
}

function evaluateDimension(
  dimension: RoutingDimension,
  ctx: DimensionContext,
): { model: string; reason: string; matchedRule?: RoutingRule } | null {
  switch (dimension) {
    case "sensitivity":
      return evaluateSensitivity(ctx);
    case "cost":
      return evaluateCost(ctx);
    case "domain":
      return evaluateDomain(ctx);
    case "complexity":
      return evaluateComplexity(ctx);
    default:
      return null;
  }
}

function evaluateSensitivity(ctx: DimensionContext) {
  if (!ctx.hasPII) return null;
  const rule = ctx.rules.find((r) => r.condition === "pii_detected");
  if (!rule) return null;
  return {
    model: rule.model,
    reason: "PII detected — routing to local model",
    matchedRule: rule,
  };
}

function evaluateCost(ctx: DimensionContext) {
  if (!ctx.budgetCheck || ctx.budgetCheck.withinBudget) return null;
  const rule = ctx.rules.find((r) => r.condition === "over_budget");
  if (rule) {
    return {
      model: rule.model,
      reason: "Over budget — routing to budget model",
      matchedRule: rule,
    };
  }
  // Use budget tracker's suggested model if no explicit rule
  if (ctx.budgetCheck.suggestedModel) {
    return {
      model: ctx.budgetCheck.suggestedModel,
      reason: `Over budget ($${ctx.budgetCheck.dailySpent.toFixed(2)} spent) — routing to fallback model`,
    };
  }
  return null;
}

function evaluateDomain(ctx: DimensionContext) {
  if (!ctx.domain || ctx.domain === "conversation") return null;
  const condition = DOMAIN_CONDITIONS[ctx.domain];
  if (!condition) return null;
  const rule = ctx.rules.find((r) => r.condition === condition);
  if (!rule) return null;
  return {
    model: rule.model,
    reason: `Domain "${ctx.domain}" — routing to specialized model`,
    matchedRule: rule,
  };
}

function evaluateComplexity(ctx: DimensionContext) {
  if (ctx.complexity === "low") {
    const rule = ctx.rules.find((r) => r.condition === "low_complexity");
    if (rule) {
      return {
        model: rule.model,
        reason: "Low complexity — routing to cost-efficient model",
        matchedRule: rule,
      };
    }
  }
  if (ctx.complexity === "high") {
    const rule = ctx.rules.find((r) => r.condition === "high_complexity");
    if (rule) {
      return {
        model: rule.model,
        reason: "High complexity — routing to capable model",
        matchedRule: rule,
      };
    }
  }
  return null;
}

export function getDefaultRules(): RoutingRule[] {
  return [...DEFAULT_RULES];
}
