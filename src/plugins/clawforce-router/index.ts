/**
 * Clawforce Model Router Plugin for OpenClaw.
 *
 * Analyzes incoming prompts across 5 dimensions (PII, complexity, domain,
 * budget, latency) and logs a routing decision. Uses `prependContext` to
 * inject routing metadata into the agent context and writes decisions to
 * the compliance log for dashboard consumption.
 *
 * Note: OpenClaw's plugin API does not currently expose a model override
 * mechanism. This plugin records what model *should* be used and prepends
 * routing context. Actual model enforcement requires OpenClaw-side changes
 * (tracked for Tier 2).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { detectPII, detectPIITypes } from "./pii-detector.js";
import { analyzeComplexity } from "./complexity-analyzer.js";
import { detectDomain } from "./domain-detector.js";
import {
  selectModel,
  getDefaultRules,
  type RoutingRule,
  type RoutingDimension,
} from "./router.js";
import {
  BudgetTracker,
  type BudgetConfig,
  isLocalModel,
  estimateRequestCost,
} from "./budget-tracker.js";

export interface RouterPluginConfig {
  defaultModel?: string;
  rules?: RoutingRule[];
  sensitivityKeywords?: string[];
  logPath?: string;
  priority?: RoutingDimension[];
  budget?: BudgetConfig;
}

export interface RouterPluginApi {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  on: (
    hookName: string,
    handler: (
      event: { prompt: string; messages?: unknown[] },
      ctx: { agentId?: string; sessionKey?: string },
    ) => { prependContext?: string } | void,
    opts?: { priority?: number },
  ) => void;
}

// Default token estimates for cost estimation before routing
const ESTIMATED_INPUT_TOKENS = 500;
const ESTIMATED_OUTPUT_TOKENS = 1000;

export function activate(api: RouterPluginApi): void {
  const config = resolveConfig(api.pluginConfig);

  const budgetTracker = config.budget
    ? new BudgetTracker(config.budget)
    : null;

  api.logger.info(
    `Router plugin activated (${config.rules.length} rules, default: ${config.defaultModel})` +
      (budgetTracker ? `, budget: $${config.budget!.dailyLimit}/day` : ""),
  );

  api.on(
    "before_agent_start",
    (event, ctx) => {
      const prompt = event.prompt ?? "";
      if (!prompt.trim()) return;

      // Dimension 1: PII detection
      const hasPII = detectPII(prompt, {
        blocklist: config.sensitivityKeywords,
      });
      const piiTypes = hasPII
        ? detectPIITypes(prompt, { blocklist: config.sensitivityKeywords })
        : [];

      // Dimension 2: Complexity analysis
      const complexity = analyzeComplexity(prompt);

      // Dimension 3: Domain detection
      const domainSignals = detectDomain(prompt);

      // Dimension 4: Budget check
      const estimatedCost = estimateRequestCost(
        config.defaultModel,
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
        rules: config.rules,
        defaultModel: config.defaultModel,
        priority: config.priority,
      });

      // Record spend after routing decision using the selected model's cost
      if (budgetTracker && !isLocalModel(decision.model)) {
        const actualEstimate = estimateRequestCost(
          decision.model,
          ESTIMATED_INPUT_TOKENS,
          ESTIMATED_OUTPUT_TOKENS,
        );
        budgetTracker.recordSpend(actualEstimate);
      }

      api.logger.info(
        `Route: ${decision.model} (${decision.reason})` +
          (hasPII ? ` [PII: ${piiTypes.join(", ")}]` : "") +
          ` [complexity: ${complexity}]` +
          ` [domain: ${domainSignals.domain}]` +
          (decision.dimension ? ` [dimension: ${decision.dimension}]` : ""),
      );

      // Write routing decision to log
      writeRoutingLog(config.logPath, {
        ts: new Date().toISOString(),
        event: "routing_decision",
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        model: decision.model,
        reason: decision.reason,
        hasPII,
        piiTypes,
        complexity,
        domain: domainSignals.domain,
        domainConfidence: domainSignals.confidence,
        dimension: decision.dimension,
        matchedCondition: decision.matchedRule?.condition,
        budgetSpent: budgetCheck.dailySpent,
        budgetRemaining: budgetCheck.remainingBudget,
      });

      // Prepend routing context for the agent
      const contextLines = [
        `[Router] Model recommendation: ${decision.model}`,
        `[Router] Reason: ${decision.reason}`,
      ];
      if (hasPII) {
        contextLines.push(
          `[Router] PII detected (${piiTypes.join(", ")}) — handle with care`,
        );
      }

      return { prependContext: contextLines.join("\n") };
    },
    { priority: 10 },
  );
}

interface ResolvedRouterConfig {
  defaultModel: string;
  rules: RoutingRule[];
  sensitivityKeywords: string[];
  logPath: string;
  priority?: RoutingDimension[];
  budget?: BudgetConfig;
}

function resolveConfig(
  pluginConfig?: Record<string, unknown>,
): ResolvedRouterConfig {
  return {
    defaultModel:
      (pluginConfig?.defaultModel as string) ?? "anthropic/claude-sonnet-4-5",
    rules: (pluginConfig?.rules as RoutingRule[]) ?? getDefaultRules(),
    sensitivityKeywords:
      (pluginConfig?.sensitivityKeywords as string[]) ?? [],
    logPath:
      (pluginConfig?.logPath as string) ??
      "/home/node/.openclaw/data/routing.jsonl",
    priority: pluginConfig?.priority as RoutingDimension[] | undefined,
    budget: pluginConfig?.budget as BudgetConfig | undefined,
  };
}

function writeRoutingLog(
  logPath: string,
  entry: Record<string, unknown>,
): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Best-effort logging — don't crash the agent on write failure
  }
}
