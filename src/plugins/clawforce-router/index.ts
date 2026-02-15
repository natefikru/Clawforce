/**
 * Clawforce Model Router Plugin for OpenClaw.
 *
 * Analyzes incoming prompts across 5 dimensions (PII, complexity, domain,
 * budget, latency) and enforces routing decisions via modelOverride and
 * providerOverride. Also injects routing metadata via `prependContext` and
 * writes decisions to the compliance log for dashboard consumption.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { detectPII, detectPIITypes } from "./pii-detector.js";
import { filterOutput } from "./output-filter.js";
import { analyzeComplexity } from "./complexity-analyzer.js";
import { detectDomain } from "./domain-detector.js";
import {
  selectModel,
  getDefaultRules,
  type RoutingRule,
  type RoutingDimension,
} from "./router.js";
import { resolveDataTier, type DataPolicy } from "./data-policy.js";
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
      event: Record<string, unknown>,
      ctx: {
        agentId?: string;
        sessionKey?: string;
        channelId?: string;
        userId?: string;
        [key: string]: unknown;
      },
    ) => Record<string, unknown> | void,
    opts?: { priority?: number },
  ) => void;
}

// Default token estimates for cost estimation before routing
const ESTIMATED_INPUT_TOKENS = 500;
const ESTIMATED_OUTPUT_TOKENS = 1000;

/** Max number of recent messages to scan for PII alongside the current prompt. */
const DEFAULT_HISTORY_SCAN_DEPTH = 5;

/**
 * Build the text corpus to scan for PII.
 * Combines the current prompt with the last N messages from conversation history
 * to catch PII introduced in earlier turns.
 */
export function buildScanText(
  prompt: string,
  messages?: unknown[],
  depth: number = DEFAULT_HISTORY_SCAN_DEPTH,
): string {
  if (!messages || messages.length === 0) return prompt;

  const recentMessages = messages.slice(-depth);
  const historyText = recentMessages
    .map((msg) => {
      if (typeof msg === "string") return msg;
      if (msg && typeof msg === "object") {
        const m = msg as Record<string, unknown>;
        // Support common message shapes: { content: string } or { text: string }
        if (typeof m.content === "string") return m.content;
        if (typeof m.text === "string") return m.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  return historyText ? `${historyText}\n${prompt}` : prompt;
}

/**
 * Parse a "provider/model" string into separate override fields.
 * E.g. "ollama/llama3.3:8b" → { providerOverride: "ollama", modelOverride: "llama3.3:8b" }
 * If no slash, the entire string is treated as modelOverride with no provider.
 */
export function parseModelRef(ref: string): {
  modelOverride: string;
  providerOverride?: string;
} {
  const slashIdx = ref.indexOf("/");
  if (slashIdx === -1) {
    return { modelOverride: ref };
  }
  return {
    providerOverride: ref.slice(0, slashIdx),
    modelOverride: ref.slice(slashIdx + 1),
  };
}

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

      // Dimension 1: PII detection (scan prompt + recent conversation history)
      const textToScan = buildScanText(prompt, event.messages);
      const hasPII = detectPII(textToScan, {
        blocklist: config.sensitivityKeywords,
      });
      const piiTypes = hasPII
        ? detectPIITypes(textToScan, { blocklist: config.sensitivityKeywords })
        : [];

      // Dimension 2: Complexity analysis
      const complexity = analyzeComplexity(prompt);

      // Dimension 3: Domain detection
      const domainSignals = detectDomain(prompt);

      // Dimension 0: Policy check (channel/user data tier)
      const dataTier = config.policy
        ? resolveDataTier(
            config.policy,
            ctx.channelId as string | undefined,
            ctx.userId as string | undefined,
          )
        : undefined;

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
        dataTier,
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
          (dataTier ? ` [tier: ${dataTier}]` : "") +
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
        dataTier,
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

      return {
        prependContext: contextLines.join("\n"),
        ...parseModelRef(decision.model),
      };
    },
    { priority: 10 },
  );

  // Output filter: scan outbound messages for PII and redact before sending
  api.on(
    "message_sending",
    (event) => {
      const content = (event.content ?? event.text ?? "") as string;
      if (!content) return;

      const result = filterOutput(content, {
        blocklist: config.sensitivityKeywords,
      });
      if (result.redacted) {
        api.logger.warn(
          `Output filter: redacted ${result.matchCount} PII match(es) [${result.redactedTypes.join(", ")}]`,
        );
        writeRoutingLog(config.logPath, {
          ts: new Date().toISOString(),
          event: "output_redaction",
          redactedTypes: result.redactedTypes,
          matchCount: result.matchCount,
        });
        return { content: result.content };
      }
    },
    { priority: 10 },
  );

  // Tool result filter: scan tool outputs for PII before they persist in conversation
  api.on(
    "tool_result_persist",
    (event) => {
      const message = event.message as { content?: string } | undefined;
      if (!message?.content) return;

      const result = filterOutput(message.content, {
        blocklist: config.sensitivityKeywords,
      });
      if (result.redacted) {
        api.logger.warn(
          `Tool result filter: redacted ${result.matchCount} PII match(es) from ${event.toolName ?? "unknown"}`,
        );
        writeRoutingLog(config.logPath, {
          ts: new Date().toISOString(),
          event: "tool_result_redaction",
          toolName: event.toolName,
          redactedTypes: result.redactedTypes,
          matchCount: result.matchCount,
        });
        return { message: { ...message, content: result.content } };
      }
    },
  );

  // Audit: log session end events for compliance trail
  api.on("agent_end", (event, ctx) => {
    writeRoutingLog(config.logPath, {
      ts: new Date().toISOString(),
      event: "agent_session_end",
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      success: event.success,
      durationMs: event.durationMs,
      messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
    });
  });
}

interface ResolvedRouterConfig {
  defaultModel: string;
  rules: RoutingRule[];
  sensitivityKeywords: string[];
  logPath: string;
  priority?: RoutingDimension[];
  budget?: BudgetConfig;
  policy?: DataPolicy;
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
    policy: pluginConfig?.policy as DataPolicy | undefined,
  };
}

function writeRoutingLog(
  logPath: string,
  entry: Record<string, unknown>,
): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Best-effort logging — don't crash the agent on write failure
    // Log the error so misconfigured paths are discoverable
    process.stderr.write(
      `[clawforce-router] Failed to write routing log to ${logPath}: ${String(err)}\n`,
    );
  }
}
