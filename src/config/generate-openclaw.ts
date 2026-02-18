import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ClawforceConfig, resolveAgentOpenclawInstance } from "./types.js";
import { resolveProfile } from "./capability-profiles.js";
import { discoverPlugins } from "../plugins/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "..", "templates");

interface RouterAlertsConfig {
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
    email: {
      enabled: boolean;
      smtpHost?: string;
      smtpPort: number;
      username?: string;
      passwordEnv?: string;
      from?: string;
      to?: string[];
    };
  };
}

const ALERT_EMAIL_PASSWORD_ENV = "CLAWFORCE_ALERTS_EMAIL_PASSWORD";

const DEFAULT_ROUTER_ALERTS_CONFIG: RouterAlertsConfig = {
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
    email: { enabled: false, smtpPort: 587 },
  },
};

export interface OpenClawAgentProfile {
  id: string;
  workspace: string;
  model?: {
    primary: string;
    fallbacks?: string[];
  };
}

export interface OpenClawBinding {
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: {
      kind: "direct" | "group" | "channel" | "dm";
      id: string;
    };
    guildId?: string;
    teamId?: string;
    roles?: string[];
  };
}

export interface OpenClawConfig {
  gateway?: {
    mode: string;
    bind?: "loopback" | "lan";
  };
  agents: {
    defaults: {
      workspace: string;
      authProfile?: string;
      model: {
        primary: string;
        fallbacks?: string[];
      };
    };
    list?: OpenClawAgentProfile[];
  };
  bindings?: OpenClawBinding[];
  channels: {
  } & Record<string, unknown>;
  cron?: {
    enabled: boolean;
    store?: string;
  };
  hooks?: {
    enabled: boolean;
    token?: string;
    internal?: {
      enabled: boolean;
      entries?: Record<string, { enabled: boolean }>;
    };
  };
  plugins?: {
    enabled: boolean;
    entries?: Record<
      string,
      { enabled: boolean; config?: Record<string, unknown> }
    >;
  };
  session: {
    dmScope: string;
  };
}

export function generateOpenClawConfig(
  config: ClawforceConfig,
): Map<string, OpenClawConfig> {
  const primaryModel = config.models.cloud;
  const localModel = config.models.local;
  const credentialMode = config.models.credential_mode;
  const authProfile = config.models.auth_profile;

  const results = new Map<string, OpenClawConfig>();

  for (const [instanceName, instanceRawConfig] of Object.entries(config.openclaw)) {
    // Determine which agents are assigned to this instance
    const instanceAgents = config.agents.filter(
      (agent) => resolveAgentOpenclawInstance(agent, config) === instanceName,
    );

    const result: OpenClawConfig = {
      gateway: {
        mode: "local",
        bind: config.gateway?.bind ?? "loopback",
      },
      agents: {
        defaults: {
          workspace: "/home/node/.openclaw/workspace",
          ...(credentialMode === "auth_profile" && authProfile
            ? { authProfile }
            : {}),
          model: {
            primary: primaryModel,
            ...(localModel
              ? { fallbacks: [localModel] }
              : {}),
          },
        },
        list: instanceAgents.map((agent) => ({
          id: agent.name,
          workspace: `/home/node/.openclaw/workspace/${agent.name}`,
        })),
      },
      channels: {},
      session: {
        dmScope: "per-channel-peer",
      },
    };

    // Merge role partials for all unique roles in this instance's agents
    const roles = [...new Set(instanceAgents.map((a) => a.role))];
    for (const agentRole of roles) {
      const partialPath = join(templatesDir, "roles", agentRole, "config.partial.json");
      if (existsSync(partialPath)) {
        const roleConfig = JSON.parse(
          readFileSync(partialPath, "utf8"),
        ) as Partial<OpenClawConfig>;
        if (roleConfig.cron && !result.cron) result.cron = roleConfig.cron;
        if (roleConfig.hooks) {
          if (!result.hooks) {
            result.hooks = roleConfig.hooks;
          }
        }
      }
    }

    // Apply capability profile (after role partial, before passthrough)
    if (config.capabilities) {
      const profileConfig = resolveProfile(config.capabilities);
      mergeInto(
        result as unknown as Record<string, unknown>,
        profileConfig as Record<string, unknown>,
      );
    }

    result.plugins = {
      enabled: true,
      entries: buildPluginEntries(config),
    };
    if (result.plugins.entries && Object.keys(result.plugins.entries).length === 0) {
      result.plugins.enabled = false;
    }

    // Enable command-logger hook for audit trail
    const hooksToken = randomBytes(32).toString("hex");
    if (!result.hooks) {
      result.hooks = { enabled: true, token: hooksToken };
    } else {
      result.hooks.token = hooksToken;
    }
    result.hooks.internal = {
      enabled: true,
      entries: {
        "command-logger": { enabled: true },
      },
    };

    // OpenClaw passthrough: deep-merge user-provided instance config last
    mergeInto(
      result as unknown as Record<string, unknown>,
      instanceRawConfig as Record<string, unknown>,
    );

    results.set(instanceName, result);
  }

  return results;
}

function buildPluginEntries(
  config: ClawforceConfig,
): Record<string, { enabled: boolean; config?: Record<string, unknown> }> {
  const discovered = discoverPlugins();
  const configuredEnabled = config.plugins?.enabled;
  const enabledSet = configuredEnabled ? new Set(configuredEnabled) : undefined;
  const entries: Record<string, { enabled: boolean; config?: Record<string, unknown> }> = {};

  for (const plugin of discovered) {
    if (enabledSet && enabledSet.size > 0 && !enabledSet.has(plugin.id)) {
      continue;
    }
    if (!enabledSet || enabledSet.size === 0) {
      if (plugin.id === "clawforce-router" && !config.routing) {
        continue;
      }
      if (plugin.id === "clawforce-compliance" && config.compliance?.enabled === false) {
        continue;
      }
    }

    const pluginOverrides = config.plugins?.config?.[plugin.id];

    if (plugin.id === "clawforce-router") {
      entries[plugin.id] = {
        enabled: true,
        config: {
          ...buildRouterPluginConfig(config),
          pluginPermissions: plugin.manifest.permissions,
          ...(pluginOverrides ?? {}),
        },
      };
      continue;
    }

    entries[plugin.id] = {
      enabled: true,
      config: {
        pluginPermissions: plugin.manifest.permissions,
        ...(pluginOverrides ?? {}),
      },
    };
  }

  return entries;
}

function buildRouterPluginConfig(config: ClawforceConfig): Record<string, unknown> {
  const primaryModel = config.models.cloud;
  const localModel = config.models.local;

  const routerConfig: Record<string, unknown> = {
    defaultModel: primaryModel,
    ...(localModel ? { defaultLocalModel: localModel } : {}),
    alerts: mapRouterAlertsConfig(config),
    ...(config.routing?.policy ? { policy: normalizePolicyConfig(config.routing.policy) } : {}),
    ...(config.compliance?.frameworks
      ? { complianceFrameworks: config.compliance.frameworks }
      : {}),
  };

  if (config.routing?.rules) {
    routerConfig.rules = config.routing.rules;
  }
  if (config.routing?.sensitivity?.keywords) {
    routerConfig.sensitivityKeywords = config.routing.sensitivity.keywords;
  }
  if (config.routing?.sensitivity?.pii_detection !== undefined) {
    routerConfig.piiDetection = config.routing.sensitivity.pii_detection;
  }
  if (config.routing?.priority) {
    routerConfig.priority = config.routing.priority;
  }
  if (config.routing?.budget) {
    routerConfig.budget = {
      dailyLimit: config.routing.budget.daily_limit,
      perRequestCap: config.routing.budget.per_request_cap,
      fallbackModel: config.routing.budget.fallback_model,
    };
  }
  if (config.routing?.health_check) {
    routerConfig.healthCheck = {
      enabled: config.routing.health_check.enabled,
      intervalSeconds: config.routing.health_check.interval_seconds,
      timeoutSeconds: config.routing.health_check.timeout_seconds,
      staleAfterSeconds: config.routing.health_check.stale_after_seconds,
      failoverPolicy: config.routing.health_check.failover_policy,
      failureThreshold: config.routing.health_check.failure_threshold,
      recoveryThreshold: config.routing.health_check.recovery_threshold,
      retryAttempts: config.routing.health_check.retry_attempts,
      retryDelayMs: config.routing.health_check.retry_delay_ms,
    };
  }

  if (config.routing?.sensitivity?.pii_confidence_threshold !== undefined) {
    routerConfig.piiThreshold = config.routing.sensitivity.pii_confidence_threshold;
  }
  if (config.routing?.sensitivity?.pii_pattern_thresholds) {
    routerConfig.piiPatternThresholds = config.routing.sensitivity.pii_pattern_thresholds;
  }

  // Per-agent budgets and routing overrides
  const agentBudgets: Record<string, { dailyLimit: number; perRequestCap?: number; fallbackModel?: string }> = {};
  const agentRules: Record<string, Array<{ condition: string; model: string }>> = {};
  let hasAgentBudgets = false;
  let hasAgentRules = false;

  for (const agent of config.agents) {
    if (agent.routing?.budget?.daily_limit) {
      agentBudgets[agent.name] = {
        dailyLimit: agent.routing.budget.daily_limit,
        ...(agent.routing.budget.per_request_cap !== undefined
          ? { perRequestCap: agent.routing.budget.per_request_cap }
          : {}),
        ...(agent.routing.budget.fallback_model
          ? { fallbackModel: agent.routing.budget.fallback_model }
          : {}),
      };
      hasAgentBudgets = true;
    }
    if (agent.routing?.rules && agent.routing.rules.length > 0) {
      agentRules[agent.name] = agent.routing.rules;
      hasAgentRules = true;
    }
  }

  if (hasAgentBudgets) {
    routerConfig.agentBudgets = agentBudgets;
  }
  if (hasAgentRules) {
    routerConfig.agentRules = agentRules;
  }

  return routerConfig;
}

function normalizePolicyConfig(policy: NonNullable<NonNullable<ClawforceConfig["routing"]>["policy"]>): Record<string, unknown> {
  return {
    defaultTier: policy.default_tier,
    ...(policy.channels
      ? {
        channels: policy.channels.map((channel) => ({
          channelId: channel.channel_id,
          tier: channel.tier,
          ...(channel.description ? { description: channel.description } : {}),
        })),
      }
      : {}),
    ...(policy.users
      ? {
        users: policy.users.map((user) => ({
          userId: user.user_id,
          tier: user.tier,
        })),
      }
      : {}),
  };
}

function mapRouterAlertsConfig(config: ClawforceConfig): RouterAlertsConfig {
  const alerts = config.alerts;
  return {
    enabled: alerts?.enabled ?? DEFAULT_ROUTER_ALERTS_CONFIG.enabled,
    types: {
      modelHealth:
        alerts?.types?.model_health ?? DEFAULT_ROUTER_ALERTS_CONFIG.types.modelHealth,
      budgetExceeded:
        alerts?.types?.budget_exceeded ?? DEFAULT_ROUTER_ALERTS_CONFIG.types.budgetExceeded,
      piiViolation:
        alerts?.types?.pii_violation ?? DEFAULT_ROUTER_ALERTS_CONFIG.types.piiViolation,
      agentError:
        alerts?.types?.agent_error ?? DEFAULT_ROUTER_ALERTS_CONFIG.types.agentError,
      agentIdle:
        alerts?.types?.agent_idle ?? DEFAULT_ROUTER_ALERTS_CONFIG.types.agentIdle,
    },
    idle: {
      thresholdMinutes:
        alerts?.idle?.threshold_minutes ?? DEFAULT_ROUTER_ALERTS_CONFIG.idle.thresholdMinutes,
      cooldownMinutes:
        alerts?.idle?.cooldown_minutes ?? DEFAULT_ROUTER_ALERTS_CONFIG.idle.cooldownMinutes,
    },
    budget: {
      cooldownMinutes:
        alerts?.budget?.cooldown_minutes ?? DEFAULT_ROUTER_ALERTS_CONFIG.budget.cooldownMinutes,
      autoBlockOnExceeded:
        alerts?.budget?.auto_block_on_exceeded
        ?? DEFAULT_ROUTER_ALERTS_CONFIG.budget.autoBlockOnExceeded,
    },
    notifications: {
      dashboard:
        alerts?.notifications?.dashboard ?? DEFAULT_ROUTER_ALERTS_CONFIG.notifications.dashboard,
      email: {
        enabled:
          alerts?.notifications?.email?.enabled
          ?? DEFAULT_ROUTER_ALERTS_CONFIG.notifications.email.enabled,
        smtpPort:
          alerts?.notifications?.email?.smtp_port
          ?? DEFAULT_ROUTER_ALERTS_CONFIG.notifications.email.smtpPort,
        ...(alerts?.notifications?.email?.smtp_host
          ? { smtpHost: alerts.notifications.email.smtp_host }
          : {}),
        ...(alerts?.notifications?.email?.username
          ? { username: alerts.notifications.email.username }
          : {}),
        ...(alerts?.notifications?.email?.password
          ? { passwordEnv: ALERT_EMAIL_PASSWORD_ENV }
          : {}),
        ...(alerts?.notifications?.email?.from
          ? { from: alerts.notifications.email.from }
          : {}),
        ...(alerts?.notifications?.email?.to
          ? { to: alerts.notifications.email.to }
          : {}),
      },
    },
  };
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      mergeInto(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      target[key] = value;
    }
  }
}
