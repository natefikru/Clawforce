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
import type { DatabaseSync } from "node:sqlite";
import type { StorageWriter } from "../../storage/writer.js";
import type {
  AlertSeverity,
  AlertType,
  RoutingLogEntry,
} from "../../storage/types.js";
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
import {
  ModelHealthMonitor,
  type HealthCheckConfig,
  type ProviderHealthState,
} from "./health-monitor.js";
import { IdleMonitor } from "./idle-monitor.js";
import { dispatchAlertNotifications } from "../../alerts/dispatcher.js";

export interface RouterPluginConfig {
  defaultModel?: string;
  rules?: RoutingRule[];
  sensitivityKeywords?: string[];
  logPath?: string;
  priority?: RoutingDimension[];
  budget?: BudgetConfig;
  healthCheck?: Partial<HealthCheckConfig>;
  alerts?: RouterAlertConfig;
}

export interface RouterAlertConfig {
  enabled?: boolean;
  types?: {
    modelHealth?: boolean;
    budgetExceeded?: boolean;
    piiViolation?: boolean;
    agentError?: boolean;
    agentIdle?: boolean;
  };
  idle?: {
    thresholdMinutes?: number;
    cooldownMinutes?: number;
  };
  budget?: {
    cooldownMinutes?: number;
    autoBlockOnExceeded?: boolean;
  };
  notifications?: {
    dashboard?: boolean;
    slack?: {
      enabled?: boolean;
      webhookUrl?: string;
    };
    email?: {
      enabled?: boolean;
      smtpHost?: string;
      smtpPort?: number;
      username?: string;
      password?: string;
      from?: string;
      to?: string[];
    };
  };
}

interface ResolvedRouterAlertConfig {
  enabled: boolean;
  types: {
    modelHealth: boolean;
    budgetExceeded: boolean;
    piiViolation: boolean;
    agentError: boolean;
    agentIdle: boolean;
  };
  idle: {
    thresholdMinutes: number;
    cooldownMinutes: number;
  };
  budget: {
    cooldownMinutes: number;
    autoBlockOnExceeded: boolean;
  };
  notifications: {
    dashboard: boolean;
    slack: {
      enabled: boolean;
      webhookUrl?: string;
    };
    email: {
      enabled: boolean;
      smtpHost?: string;
      smtpPort: number;
      username?: string;
      password?: string;
      from?: string;
      to?: string[];
    };
  };
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
const DEFAULT_HEALTH_CHECK: HealthCheckConfig = {
  enabled: true,
  intervalSeconds: 10,
  timeoutSeconds: 3,
  staleAfterSeconds: 30,
  failoverPolicy: "block",
  failureThreshold: 3,
  recoveryThreshold: 2,
};

const DEFAULT_ALERT_CONFIG: ResolvedRouterAlertConfig = {
  enabled: true,
  types: {
    modelHealth: true,
    budgetExceeded: true,
    piiViolation: true,
    agentError: true,
    agentIdle: true,
  },
  idle: {
    thresholdMinutes: 60,
    cooldownMinutes: 30,
  },
  budget: {
    cooldownMinutes: 60,
    autoBlockOnExceeded: false,
  },
  notifications: {
    dashboard: true,
    slack: {
      enabled: false,
    },
    email: {
      enabled: false,
      smtpPort: 587,
    },
  },
};

const ALERT_TYPE_TO_CONFIG_KEY: Record<AlertType, keyof ResolvedRouterAlertConfig["types"]> = {
  model_health: "modelHealth",
  budget_exceeded: "budgetExceeded",
  pii_violation: "piiViolation",
  agent_error: "agentError",
  agent_idle: "agentIdle",
};

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
  const writer = api.pluginConfig?.storageWriter as StorageWriter | undefined;
  const alertCooldowns = new Map<string, number>();

  const emitAlert = (input: {
    type: AlertType;
    severity: AlertSeverity;
    message: string;
    agentId?: string;
    data?: Record<string, unknown>;
    cooldownMinutes?: number;
    cooldownKey?: string;
  }): void => {
    if (!writer) return;
    if (!config.alerts.enabled) return;
    const typeKey = ALERT_TYPE_TO_CONFIG_KEY[input.type];
    if (!config.alerts.types[typeKey]) return;

    const cooldownMinutes = input.cooldownMinutes ?? 0;
    if (cooldownMinutes > 0) {
      const key = input.cooldownKey ?? `${input.type}:${input.agentId ?? "_global"}`;
      const nowMs = Date.now();
      const last = alertCooldowns.get(key) ?? 0;
      if (nowMs - last < cooldownMinutes * 60_000) {
        return;
      }
      alertCooldowns.set(key, nowMs);
    }

    const ts = new Date().toISOString();
    const alertEntry = {
      ts,
      severity: input.severity,
      type: input.type,
      agentId: input.agentId,
      message: input.message,
      data: input.data,
    } as const;
    writer.writeAlert(alertEntry);

    void dispatchAlertNotifications(
      alertEntry,
      {
        slack: config.alerts.notifications.slack,
        email: config.alerts.notifications.email,
      },
    );
  };

  const storageDb = api.pluginConfig?.storageDb as DatabaseSync | undefined;
  const budgetTracker = config.budget
    ? new BudgetTracker(config.budget, undefined, storageDb)
    : null;
  const healthMonitor = new ModelHealthMonitor({
    config: config.healthCheck,
    onState: (state) => {
      writer?.writeModelHealthState({
        provider: state.provider,
        status: state.status,
        circuit: state.circuit,
        lastCheckedAt: state.lastCheckedAt,
        lastHealthyAt: state.lastHealthyAt,
        lastError: state.lastError,
      });
    },
    onChange: (change) => {
      api.logger.warn(
        `[health] ${change.provider} ${change.previous.status} -> ${change.current.status} ` +
          `(circuit: ${change.current.circuit})`,
      );
      emitAlert({
        type: "model_health",
        severity: change.current.status === "down" ? "error" : "warning",
        message:
          `Provider ${change.provider} health changed ` +
          `${change.previous.status}/${change.previous.circuit} -> ` +
          `${change.current.status}/${change.current.circuit}`,
        data: {
          provider: change.provider,
          previousStatus: change.previous.status,
          currentStatus: change.current.status,
          previousCircuit: change.previous.circuit,
          currentCircuit: change.current.circuit,
          error: change.current.lastError,
        },
      });
      writeLog({
        ts: new Date().toISOString(),
        event: "model_health_transition",
        modelProvider: change.provider,
        healthStatus: change.current.status,
        healthCircuit: change.current.circuit,
        healthError: change.current.lastError,
      });
    },
  });
  for (const model of collectConfiguredLocalModels(config)) {
    healthMonitor.trackModel(model);
  }
  healthMonitor.start();
  registerProcessCleanup(healthMonitor);

  const idleMonitor = new IdleMonitor({
    thresholdMinutes: config.alerts.idle.thresholdMinutes,
    cooldownMinutes: config.alerts.idle.cooldownMinutes,
    onIdle: (event) => {
      emitAlert({
        type: "agent_idle",
        severity: "warning",
        agentId: event.agentId,
        message: `Agent ${event.agentId} has been idle for ${event.idleMinutes} minute(s)`,
        data: {
          lastActivityAt: event.lastActivityAt,
          idleMinutes: event.idleMinutes,
          thresholdMinutes: config.alerts.idle.thresholdMinutes,
        },
        cooldownMinutes: config.alerts.idle.cooldownMinutes,
        cooldownKey: `agent_idle:${event.agentId}`,
      });
    },
  });
  idleMonitor.start();
  registerIdleCleanup(idleMonitor);

  function writeLog(entry: RoutingLogEntry): void {
    if (writer) {
      writer.writeRoutingDecision(entry);
    } else {
      writeRoutingLog(config.logPath, entry);
    }
  }

  api.logger.info(
    `Router plugin activated (${config.rules.length} rules, default: ${config.defaultModel})` +
      (budgetTracker ? `, budget: $${config.budget!.dailyLimit}/day` : ""),
  );

  api.on(
    "before_agent_start",
    (event, ctx) => {
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      if (!prompt.trim()) return;

      // Dimension 1: PII detection (scan prompt + recent conversation history)
      const messages = Array.isArray(event.messages) ? event.messages : undefined;
      const textToScan = buildScanText(prompt, messages);
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
        ? budgetTracker.checkBudget(estimatedCost, ctx.agentId)
        : { withinBudget: true, remainingBudget: Infinity, dailySpent: 0 };

      if (!budgetCheck.withinBudget) {
        emitAlert({
          type: "budget_exceeded",
          severity: "warning",
          agentId: ctx.agentId,
          message: "Budget exceeded; router is applying fallback behavior",
          data: {
            estimatedCost,
            dailySpent: budgetCheck.dailySpent,
            remainingBudget: budgetCheck.remainingBudget,
            suggestedModel: budgetCheck.suggestedModel,
          },
          cooldownMinutes: config.alerts.budget.cooldownMinutes,
          cooldownKey: `budget_exceeded:${ctx.agentId ?? "_global"}`,
        });
        if (config.alerts.budget.autoBlockOnExceeded) {
          emitAlert({
            type: "agent_error",
            severity: "error",
            agentId: ctx.agentId,
            message: "Request blocked: budget exceeded and auto-block is enabled",
            data: {
              estimatedCost,
              dailySpent: budgetCheck.dailySpent,
            },
          });
          throw new Error("Blocked request: budget exceeded and auto-block is enabled");
        }
      }

      let decision = selectModel({
        hasPII,
        complexity,
        domain: domainSignals.domain,
        budgetCheck,
        dataTier,
        rules: config.rules,
        defaultModel: config.defaultModel,
        defaultLocalModel: config.defaultLocalModel,
        priority: config.priority,
      });

      // Health gate for selected local models.
      healthMonitor.trackModel(decision.model);
      const healthState = healthMonitor.getStateForModel(decision.model);
      if (healthState && (healthState.status === "down" || healthState.circuit === "open")) {
        try {
          decision = applyFailoverPolicy({
            decision,
            healthState,
            hasPII,
            defaultModel: config.defaultModel,
            failoverPolicy: config.healthCheck.failoverPolicy,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitAlert({
            type: "model_health",
            severity: hasPII ? "error" : "warning",
            agentId: ctx.agentId,
            message,
            data: {
              selectedModel: decision.model,
              hasPII,
              providerStatus: healthState.status,
              providerCircuit: healthState.circuit,
              failoverPolicy: config.healthCheck.failoverPolicy,
            },
          });
          emitAlert({
            type: "agent_error",
            severity: "error",
            agentId: ctx.agentId,
            message,
            data: {
              selectedModel: decision.model,
              hasPII,
              providerStatus: healthState.status,
            },
          });
          throw err;
        }
      }

      if (hasPII && !isLocalModel(decision.model)) {
        emitAlert({
          type: "pii_violation",
          severity: "error",
          agentId: ctx.agentId,
          message: "Blocked request: PII detected but final route resolved to cloud",
          data: {
            selectedModel: decision.model,
            piiTypes,
            reason: decision.reason,
          },
        });
        emitAlert({
          type: "agent_error",
          severity: "error",
          agentId: ctx.agentId,
          message: "Security invariant violation: PII route attempted to non-local model",
          data: {
            selectedModel: decision.model,
          },
        });
        throw new Error("Blocked sensitive request: resolved model is not local");
      }

      // Record spend after routing decision using the selected model's cost
      if (budgetTracker && !isLocalModel(decision.model)) {
        const actualEstimate = estimateRequestCost(
          decision.model,
          ESTIMATED_INPUT_TOKENS,
          ESTIMATED_OUTPUT_TOKENS,
        );
        budgetTracker.recordSpend(actualEstimate, ctx.agentId);
      }

      api.logger.info(
        `Route: ${decision.model} (${decision.reason})` +
          (dataTier ? ` [tier: ${dataTier}]` : "") +
          (hasPII ? ` [PII: ${piiTypes.join(", ")}]` : "") +
          ` [complexity: ${complexity}]` +
          ` [domain: ${domainSignals.domain}]` +
          (decision.dimension ? ` [dimension: ${decision.dimension}]` : "") +
          (healthState
            ? ` [health: ${healthState.status}/${healthState.circuit}]`
            : ""),
      );

      // Write routing decision to log
      writeLog({
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
        healthStatus: healthState?.status,
        healthCircuit: healthState?.circuit,
      });

      // Prepend routing context for the agent
      idleMonitor.recordActivity(ctx.agentId ?? "_global");
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
      const rawContent = event.content ?? event.text;
      const content = typeof rawContent === "string" ? rawContent : "";
      if (!content) return;

      const result = filterOutput(content, {
        blocklist: config.sensitivityKeywords,
      });
      if (result.redacted) {
        api.logger.warn(
          `Output filter: redacted ${result.matchCount} PII match(es) [${result.redactedTypes.join(", ")}]`,
        );
        writeLog({
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
        writeLog({
          ts: new Date().toISOString(),
          event: "tool_result_redaction",
          toolName: typeof event.toolName === "string" ? event.toolName : undefined,
          redactedTypes: result.redactedTypes,
          matchCount: result.matchCount,
        });
        return { message: { ...message, content: result.content } };
      }
    },
  );

  // Audit: log session end events for compliance trail
  api.on("agent_end", (event, ctx) => {
    idleMonitor.recordActivity(ctx.agentId ?? "_global");
    writeLog({
      ts: new Date().toISOString(),
      event: "agent_session_end",
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      success: typeof event.success === "boolean" ? event.success : undefined,
      durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
      messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
    });
  });
}

export function applyFailoverPolicy(input: {
  decision: ReturnType<typeof selectModel>;
  healthState: ProviderHealthState;
  hasPII: boolean;
  defaultModel: string;
  failoverPolicy: HealthCheckConfig["failoverPolicy"];
}): ReturnType<typeof selectModel> {
  const { decision, healthState, hasPII, defaultModel, failoverPolicy } = input;

  // Security invariant: sensitive requests fail closed when local runtime is not healthy.
  if (hasPII) {
    throw new Error(
      `Blocked sensitive request: local model provider is ${healthState.status} (${healthState.circuit})`,
    );
  }

  if (failoverPolicy === "queue") {
    // Queue infrastructure is not implemented in 2A.4.
    // Fail closed with an explicit error so operators do not assume deferred execution.
    throw new Error(
      `Queue policy is not implemented: local model provider is ${healthState.status} (${healthState.circuit})`,
    );
  }

  if (failoverPolicy === "block") {
    throw new Error(
      `Blocked request: local model provider is ${healthState.status} (${healthState.circuit})`,
    );
  }

  // failover-safe: only non-sensitive requests may go cloud.
  if (!isLocalModel(defaultModel)) {
    return {
      ...decision,
      model: defaultModel,
      reason:
        `${decision.reason}; local model unhealthy (${healthState.status}) -> failover-safe cloud fallback`,
    };
  }

  throw new Error(
    `Blocked request: failover-safe configured but default model is local (${defaultModel})`,
  );
}

interface ResolvedRouterConfig {
  defaultModel: string;
  defaultLocalModel?: string;
  rules: RoutingRule[];
  sensitivityKeywords: string[];
  logPath: string;
  priority?: RoutingDimension[];
  budget?: BudgetConfig;
  policy?: DataPolicy;
  healthCheck: HealthCheckConfig;
  alerts: ResolvedRouterAlertConfig;
}

function resolveConfig(
  pluginConfig?: Record<string, unknown>,
): ResolvedRouterConfig {
  return {
    defaultModel: typeof pluginConfig?.defaultModel === "string"
      ? pluginConfig.defaultModel : "anthropic/claude-sonnet-4-5",
    defaultLocalModel: typeof pluginConfig?.defaultLocalModel === "string"
      ? pluginConfig.defaultLocalModel : undefined,
    rules: Array.isArray(pluginConfig?.rules)
      ? (pluginConfig.rules as RoutingRule[]) : getDefaultRules(),
    sensitivityKeywords: Array.isArray(pluginConfig?.sensitivityKeywords)
      ? (pluginConfig.sensitivityKeywords as string[]) : [],
    logPath: typeof pluginConfig?.logPath === "string"
      ? pluginConfig.logPath : "/home/node/.openclaw/data/routing.jsonl",
    priority: Array.isArray(pluginConfig?.priority)
      ? (pluginConfig.priority as RoutingDimension[]) : undefined,
    budget: pluginConfig?.budget && typeof pluginConfig.budget === "object"
      ? (pluginConfig.budget as BudgetConfig) : undefined,
    policy: pluginConfig?.policy && typeof pluginConfig.policy === "object"
      ? (pluginConfig.policy as DataPolicy) : undefined,
    healthCheck: resolveHealthCheckConfig(pluginConfig?.healthCheck),
    alerts: resolveAlertConfig(pluginConfig?.alerts),
  };
}

function resolveAlertConfig(value: unknown): ResolvedRouterAlertConfig {
  if (!value || typeof value !== "object") {
    return {
      ...DEFAULT_ALERT_CONFIG,
      types: { ...DEFAULT_ALERT_CONFIG.types },
      idle: { ...DEFAULT_ALERT_CONFIG.idle },
      budget: { ...DEFAULT_ALERT_CONFIG.budget },
    };
  }
  const cfg = value as RouterAlertConfig;
  return {
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : DEFAULT_ALERT_CONFIG.enabled,
    types: {
      modelHealth: typeof cfg.types?.modelHealth === "boolean"
        ? cfg.types.modelHealth
        : DEFAULT_ALERT_CONFIG.types.modelHealth,
      budgetExceeded: typeof cfg.types?.budgetExceeded === "boolean"
        ? cfg.types.budgetExceeded
        : DEFAULT_ALERT_CONFIG.types.budgetExceeded,
      piiViolation: typeof cfg.types?.piiViolation === "boolean"
        ? cfg.types.piiViolation
        : DEFAULT_ALERT_CONFIG.types.piiViolation,
      agentError: typeof cfg.types?.agentError === "boolean"
        ? cfg.types.agentError
        : DEFAULT_ALERT_CONFIG.types.agentError,
      agentIdle: typeof cfg.types?.agentIdle === "boolean"
        ? cfg.types.agentIdle
        : DEFAULT_ALERT_CONFIG.types.agentIdle,
    },
    idle: {
      thresholdMinutes:
        typeof cfg.idle?.thresholdMinutes === "number" && cfg.idle.thresholdMinutes > 0
          ? cfg.idle.thresholdMinutes
          : DEFAULT_ALERT_CONFIG.idle.thresholdMinutes,
      cooldownMinutes:
        typeof cfg.idle?.cooldownMinutes === "number" && cfg.idle.cooldownMinutes > 0
          ? cfg.idle.cooldownMinutes
          : DEFAULT_ALERT_CONFIG.idle.cooldownMinutes,
    },
    budget: {
      cooldownMinutes:
        typeof cfg.budget?.cooldownMinutes === "number" && cfg.budget.cooldownMinutes > 0
          ? cfg.budget.cooldownMinutes
          : DEFAULT_ALERT_CONFIG.budget.cooldownMinutes,
      autoBlockOnExceeded:
        typeof cfg.budget?.autoBlockOnExceeded === "boolean"
          ? cfg.budget.autoBlockOnExceeded
          : DEFAULT_ALERT_CONFIG.budget.autoBlockOnExceeded,
    },
    notifications: {
      dashboard:
        typeof cfg.notifications?.dashboard === "boolean"
          ? cfg.notifications.dashboard
          : DEFAULT_ALERT_CONFIG.notifications.dashboard,
      slack: {
        enabled:
          typeof cfg.notifications?.slack?.enabled === "boolean"
            ? cfg.notifications.slack.enabled
            : DEFAULT_ALERT_CONFIG.notifications.slack.enabled,
        webhookUrl:
          typeof cfg.notifications?.slack?.webhookUrl === "string"
            ? cfg.notifications.slack.webhookUrl
            : DEFAULT_ALERT_CONFIG.notifications.slack.webhookUrl,
      },
      email: {
        enabled:
          typeof cfg.notifications?.email?.enabled === "boolean"
            ? cfg.notifications.email.enabled
            : DEFAULT_ALERT_CONFIG.notifications.email.enabled,
        smtpHost:
          typeof cfg.notifications?.email?.smtpHost === "string"
            ? cfg.notifications.email.smtpHost
            : DEFAULT_ALERT_CONFIG.notifications.email.smtpHost,
        smtpPort:
          typeof cfg.notifications?.email?.smtpPort === "number" && cfg.notifications.email.smtpPort > 0
            ? cfg.notifications.email.smtpPort
            : DEFAULT_ALERT_CONFIG.notifications.email.smtpPort,
        username:
          typeof cfg.notifications?.email?.username === "string"
            ? cfg.notifications.email.username
            : DEFAULT_ALERT_CONFIG.notifications.email.username,
        password:
          typeof cfg.notifications?.email?.password === "string"
            ? cfg.notifications.email.password
            : DEFAULT_ALERT_CONFIG.notifications.email.password,
        from:
          typeof cfg.notifications?.email?.from === "string"
            ? cfg.notifications.email.from
            : DEFAULT_ALERT_CONFIG.notifications.email.from,
        to:
          Array.isArray(cfg.notifications?.email?.to)
            ? cfg.notifications?.email?.to
            : DEFAULT_ALERT_CONFIG.notifications.email.to,
      },
    },
  };
}

function resolveHealthCheckConfig(value: unknown): HealthCheckConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_HEALTH_CHECK };
  }
  const cfg = value as Partial<HealthCheckConfig>;
  return {
    enabled: typeof cfg.enabled === "boolean"
      ? cfg.enabled
      : DEFAULT_HEALTH_CHECK.enabled,
    intervalSeconds: typeof cfg.intervalSeconds === "number" && cfg.intervalSeconds > 0
      ? cfg.intervalSeconds
      : DEFAULT_HEALTH_CHECK.intervalSeconds,
    timeoutSeconds: typeof cfg.timeoutSeconds === "number" && cfg.timeoutSeconds > 0
      ? cfg.timeoutSeconds
      : DEFAULT_HEALTH_CHECK.timeoutSeconds,
    staleAfterSeconds:
      typeof cfg.staleAfterSeconds === "number" && cfg.staleAfterSeconds > 0
        ? cfg.staleAfterSeconds
        : DEFAULT_HEALTH_CHECK.staleAfterSeconds,
    failoverPolicy:
      cfg.failoverPolicy === "block" ||
        cfg.failoverPolicy === "queue" ||
        cfg.failoverPolicy === "failover-safe"
        ? cfg.failoverPolicy
        : DEFAULT_HEALTH_CHECK.failoverPolicy,
    failureThreshold:
      typeof cfg.failureThreshold === "number" && cfg.failureThreshold > 0
        ? cfg.failureThreshold
        : DEFAULT_HEALTH_CHECK.failureThreshold,
    recoveryThreshold:
      typeof cfg.recoveryThreshold === "number" && cfg.recoveryThreshold > 0
        ? cfg.recoveryThreshold
        : DEFAULT_HEALTH_CHECK.recoveryThreshold,
  };
}

function collectConfiguredLocalModels(config: ResolvedRouterConfig): string[] {
  const models = new Set<string>();
  if (config.defaultLocalModel) {
    models.add(config.defaultLocalModel);
  }
  for (const rule of config.rules) {
    if (isLocalModel(rule.model)) {
      models.add(rule.model);
    }
  }
  if (config.budget?.fallbackModel && isLocalModel(config.budget.fallbackModel)) {
    models.add(config.budget.fallbackModel);
  }
  return [...models];
}

function registerProcessCleanup(monitor: ModelHealthMonitor): void {
  if (currentHealthMonitor && currentHealthMonitor !== monitor) {
    currentHealthMonitor.stop();
  }
  currentHealthMonitor = monitor;
  if (cleanupHandlersRegistered) return;

  const stop = () => {
    currentHealthMonitor?.stop();
    currentIdleMonitor?.stop();
  };
  process.once("beforeExit", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  cleanupHandlersRegistered = true;
}

let cleanupHandlersRegistered = false;
let currentHealthMonitor: ModelHealthMonitor | null = null;
let currentIdleMonitor: IdleMonitor | null = null;

let routingLogDirEnsured = false;

function ensureRoutingLogDir(logPath: string): void {
  if (!routingLogDirEnsured) {
    mkdirSync(dirname(logPath), { recursive: true });
    routingLogDirEnsured = true;
  }
}

function registerIdleCleanup(monitor: IdleMonitor): void {
  if (currentIdleMonitor && currentIdleMonitor !== monitor) {
    currentIdleMonitor.stop();
  }
  currentIdleMonitor = monitor;
}

function resetRoutingLogDirCache(): void {
  routingLogDirEnsured = false;
}

function writeRoutingLog(
  logPath: string,
  entry: RoutingLogEntry,
): void {
  try {
    ensureRoutingLogDir(logPath);
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Best-effort logging — don't crash the agent on write failure
    // Log the error so misconfigured paths are discoverable
    process.stderr.write(
      `[clawforce-router] Failed to write routing log to ${logPath}: ${String(err)}\n`,
    );
  }
}
