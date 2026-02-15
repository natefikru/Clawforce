/**
 * Clawforce Model Router Plugin for OpenClaw.
 *
 * Analyzes incoming prompts for PII and complexity, then logs a routing
 * decision. Uses `prependContext` to inject routing metadata into the
 * agent context and writes decisions to the compliance log for dashboard
 * consumption.
 *
 * Note: OpenClaw's plugin API does not currently expose a model override
 * mechanism. This plugin records what model *should* be used and prepends
 * routing context. Actual model enforcement requires OpenClaw-side changes
 * (tracked for Phase 2).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectPII, detectPIITypes } from "./pii-detector.js";
import { analyzeComplexity } from "./complexity-analyzer.js";
import { selectModel, getDefaultRules, type RoutingRule } from "./router.js";

export interface RouterPluginConfig {
  defaultModel?: string;
  rules?: RoutingRule[];
  sensitivityKeywords?: string[];
  logPath?: string;
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

export function activate(api: RouterPluginApi): void {
  const config = resolveConfig(api.pluginConfig);

  api.logger.info(
    `Router plugin activated (${config.rules.length} rules, default: ${config.defaultModel})`,
  );

  api.on(
    "before_agent_start",
    (event, ctx) => {
      const prompt = event.prompt ?? "";
      if (!prompt.trim()) return;

      const hasPII = detectPII(prompt, {
        blocklist: config.sensitivityKeywords,
      });
      const piiTypes = hasPII
        ? detectPIITypes(prompt, { blocklist: config.sensitivityKeywords })
        : [];
      const complexity = analyzeComplexity(prompt);

      const decision = selectModel({
        hasPII,
        complexity,
        rules: config.rules,
        defaultModel: config.defaultModel,
      });

      api.logger.info(
        `Route: ${decision.model} (${decision.reason})` +
          (hasPII ? ` [PII: ${piiTypes.join(", ")}]` : "") +
          ` [complexity: ${complexity}]`,
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
        matchedCondition: decision.matchedRule?.condition,
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

function resolveConfig(
  pluginConfig?: Record<string, unknown>,
): Required<RouterPluginConfig> {
  return {
    defaultModel:
      (pluginConfig?.defaultModel as string) ?? "anthropic/claude-sonnet-4-5",
    rules: (pluginConfig?.rules as RoutingRule[]) ?? getDefaultRules(),
    sensitivityKeywords:
      (pluginConfig?.sensitivityKeywords as string[]) ?? [],
    logPath:
      (pluginConfig?.logPath as string) ??
      "/home/node/.openclaw/data/routing.jsonl",
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
