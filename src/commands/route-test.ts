import { parseConfig } from "../config/parse.js";
import { detectPII, detectPIITypes } from "../plugins/clawforce-router/pii-detector.js";
import { analyzeComplexity } from "../plugins/clawforce-router/complexity-analyzer.js";
import { detectDomain } from "../plugins/clawforce-router/domain-detector.js";
import {
  selectModel,
  getDefaultRules,
  type RoutingRule,
  type RoutingDimension,
} from "../plugins/clawforce-router/router.js";
import {
  BudgetTracker,
  type BudgetConfig,
  estimateRequestCost,
} from "../plugins/clawforce-router/budget-tracker.js";

const ESTIMATED_INPUT_TOKENS = 500;
const ESTIMATED_OUTPUT_TOKENS = 1000;

export interface RouteTestResult {
  model: string;
  reason: string;
  dimension?: RoutingDimension;
  hasPII: boolean;
  piiTypes: string[];
  complexity: string;
  domain: string;
  domainConfidence: number;
  budgetSpent: number;
  budgetRemaining: number;
  matchedCondition?: string;
}

export function routeTest(
  configPath: string,
  prompt: string,
): RouteTestResult {
  const config = parseConfig(configPath);

  const defaultModel = config.models.primary;
  const routerConfig = config.router;

  const rules: RoutingRule[] = routerConfig?.rules ?? getDefaultRules();
  const sensitivityKeywords = routerConfig?.sensitivity_keywords ?? [];
  const priority = routerConfig?.priority as RoutingDimension[] | undefined;

  // Dimension 1: PII
  const hasPII = detectPII(prompt, { blocklist: sensitivityKeywords });
  const piiTypes = hasPII
    ? detectPIITypes(prompt, { blocklist: sensitivityKeywords })
    : [];

  // Dimension 2: Complexity
  const complexity = analyzeComplexity(prompt);

  // Dimension 3: Domain
  const domainSignals = detectDomain(prompt);

  // Dimension 4: Budget
  let budgetTracker: BudgetTracker | null = null;
  if (routerConfig?.budget) {
    const budgetConfig: BudgetConfig = {
      dailyLimit: routerConfig.budget.daily_limit,
      perRequestCap: routerConfig.budget.per_request_cap,
      fallbackModel: routerConfig.budget.fallback_model,
    };
    budgetTracker = new BudgetTracker(budgetConfig);
  }

  const estimatedCost = estimateRequestCost(
    defaultModel,
    ESTIMATED_INPUT_TOKENS,
    ESTIMATED_OUTPUT_TOKENS,
  );

  const budgetCheck = budgetTracker
    ? budgetTracker.checkBudget(estimatedCost)
    : { withinBudget: true, remainingBudget: Infinity, dailySpent: 0 };

  const decision = selectModel({
    hasPII,
    complexity,
    domain: domainSignals.domain,
    budgetCheck,
    rules,
    defaultModel,
    priority,
  });

  return {
    model: decision.model,
    reason: decision.reason,
    dimension: decision.dimension,
    hasPII,
    piiTypes,
    complexity,
    domain: domainSignals.domain,
    domainConfidence: domainSignals.confidence,
    budgetSpent: budgetCheck.dailySpent,
    budgetRemaining: budgetCheck.remainingBudget,
    matchedCondition: decision.matchedRule?.condition,
  };
}

export function formatRouteTestResult(result: RouteTestResult): string {
  const lines: string[] = [];

  lines.push(`Model: ${result.model}`);
  lines.push(`Reason: ${result.reason}`);
  lines.push("");
  lines.push("Dimensions:");
  lines.push(`  PII: ${result.hasPII ? `yes (${result.piiTypes.join(", ")})` : "no"}`);
  lines.push(`  Complexity: ${result.complexity}`);
  lines.push(`  Domain: ${result.domain} (confidence: ${result.domainConfidence})`);

  if (result.budgetRemaining !== Infinity) {
    lines.push(
      `  Budget: $${result.budgetSpent.toFixed(2)}/$${(result.budgetSpent + result.budgetRemaining).toFixed(2)} remaining`,
    );
  } else {
    lines.push("  Budget: not configured");
  }

  if (result.matchedCondition) {
    lines.push("");
    lines.push(`Matched Rule: ${result.matchedCondition} → ${result.model}`);
  }

  if (result.dimension) {
    lines.push(`Winning Dimension: ${result.dimension}`);
  }

  return lines.join("\n");
}

export async function routeTestCommand(
  configPath: string,
  prompt: string,
): Promise<void> {
  const result = routeTest(configPath, prompt);
  console.log(formatRouteTestResult(result));
}
