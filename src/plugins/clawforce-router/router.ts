/**
 * Multi-dimensional model selection logic.
 * Evaluates dimensions in configurable priority order:
 * sensitivity → cost → domain → complexity (default).
 * First matching dimension wins.
 */

import type { ComplexityLevel } from "./complexity-analyzer.js";
import type { TaskDomain } from "./domain-detector.js";
import type { BudgetCheck } from "./budget-tracker.js";
import { isLocalModel } from "../../shared/pricing.js";
import { tierRequiresLocal, type DataTier } from "./data-policy.js";

export type RoutingCondition =
  | "pii_detected"
  | "low_complexity"
  | "high_complexity"
  | "domain_code"
  | "domain_writing"
  | "domain_analysis"
  | "domain_data"
  | "over_budget";

export type RoutingDimension = "policy" | "sensitivity" | "cost" | "domain" | "complexity";

export interface RoutingRule {
  condition: RoutingCondition;
  model: string;
}

export interface SelectModelInput {
  hasPII: boolean;
  complexity: ComplexityLevel;
  domain?: TaskDomain;
  budgetCheck?: BudgetCheck;
  dataTier?: DataTier;
  rules: RoutingRule[];
  defaultModel: string;
  defaultLocalModel?: string;
  priority?: RoutingDimension[];
}

export interface RoutingDecision {
  model: string;
  reason: string;
  matchedRule?: RoutingRule;
  dimension?: RoutingDimension;
}

const DEFAULT_PRIORITY: RoutingDimension[] = [
  "policy",
  "sensitivity",
  "cost",
  "domain",
  "complexity",
];

const DEFAULT_RULES: RoutingRule[] = [
  { condition: "pii_detected", model: "sglang/qwen3-32b" },
  { condition: "low_complexity", model: "sglang/qwen3-32b" },
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
    dataTier,
    rules,
    defaultModel,
    defaultLocalModel,
    priority = DEFAULT_PRIORITY,
  } = input;

  for (const dimension of priority) {
    const result = evaluateDimension(dimension, {
      hasPII,
      complexity,
      domain,
      budgetCheck,
      dataTier,
      rules,
      defaultLocalModel,
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
  dataTier?: DataTier;
  rules: RoutingRule[];
  defaultLocalModel?: string;
}

function evaluateDimension(
  dimension: RoutingDimension,
  ctx: DimensionContext,
): { model: string; reason: string; matchedRule?: RoutingRule } | null {
  switch (dimension) {
    case "policy":
      return evaluatePolicy(ctx);
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

function evaluatePolicy(ctx: DimensionContext) {
  if (!ctx.dataTier) return null;

  if (tierRequiresLocal(ctx.dataTier)) {
    return {
      model: ctx.defaultLocalModel ?? DEFAULT_LOCAL_MODEL,
      reason: `Data tier "${ctx.dataTier}" — local model required by policy`,
    };
  }

  // "internal" and "public" tiers don't force a specific model.
  // Let other dimensions (sensitivity, cost, domain, complexity) decide.
  return null;
}

const DEFAULT_LOCAL_MODEL = "sglang/qwen3-32b";

function evaluateSensitivity(ctx: DimensionContext) {
  if (!ctx.hasPII) return null;

  const localFallback = ctx.defaultLocalModel ?? DEFAULT_LOCAL_MODEL;
  const rule = ctx.rules.find((r) => r.condition === "pii_detected");

  if (rule) {
    // SAFETY INVARIANT: PII rule MUST point to a local model.
    // If misconfigured to point to a cloud model, override to local.
    if (!isLocalModel(rule.model)) {
      return {
        model: localFallback,
        reason: "PII detected — rule pointed to cloud model, overriding to local (safety invariant)",
        matchedRule: rule,
      };
    }
    return {
      model: rule.model,
      reason: "PII detected — routing to local model",
      matchedRule: rule,
    };
  }

  // HARD INVARIANT: no PII rule exists? Still route to local.
  // PII NEVER goes to a cloud model under any configuration.
  return {
    model: localFallback,
    reason: "PII detected — no explicit rule, enforcing local-only invariant",
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
