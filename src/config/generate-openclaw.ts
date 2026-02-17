import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ClawforceConfig, isSingleAgentConfig, isMultiAgentConfig } from "./types.js";
import { validateBindings } from "./validate-openclaw-bindings.js";
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

function getEnabledConnectors(config: ClawforceConfig): string[] {
  const channels = config.openclaw?.channels;
  if (!channels || typeof channels !== "object") return [];
  return Object.keys(channels as Record<string, unknown>).filter((key) => {
    const ch = (channels as Record<string, unknown>)[key];
    return ch && typeof ch === "object" && (ch as Record<string, unknown>).enabled !== false;
  });
}

export function generateOpenClawConfig(
  config: ClawforceConfig,
): OpenClawConfig {
  // Resolve models: single-agent uses config.models, multi-agent uses config.defaults.models
  const primaryModel = isSingleAgentConfig(config)
    ? config.models.primary
    : config.defaults!.models.cloud;
  const localModel = isSingleAgentConfig(config)
    ? config.models.local
    : config.defaults?.models.local;
  const credentialMode = isSingleAgentConfig(config)
    ? config.models.credential_mode
    : config.defaults?.models.credential_mode;
  const authProfile = isSingleAgentConfig(config)
    ? config.models.auth_profile
    : config.defaults?.models.auth_profile;

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
    },
    channels: {},
    session: {
      dmScope: "per-channel-peer",
    },
  };

  // Multi-agent: populate agents.list and bindings
  if (isMultiAgentConfig(config)) {
    result.agents.list = config.agents.map((agent) => {
      const profile: OpenClawAgentProfile = {
        id: agent.name,
        workspace: `/home/node/.openclaw/workspace/${agent.name}`,
      };
      return profile;
    });

    const connectors = getEnabledConnectors(config);

    const bindings: OpenClawBinding[] = [];
    for (const agent of config.agents) {
      if (!agent.channels) continue;
      for (const ch of agent.channels) {
        const connector = connectors[0];
        if (!connector) {
          throw new Error(
            `Agent '${agent.name}' has channel assignments but no connector is configured in openclaw.channels`,
          );
        }
        if (ch.type === "channel" && ch.channels) {
          for (const channelId of ch.channels) {
            bindings.push({
              agentId: agent.name,
              match: { channel: connector, peer: { kind: "channel", id: channelId } },
            });
          }
        }
        if (ch.type === "dm" && ch.users) {
          for (const userId of ch.users) {
            bindings.push({
              agentId: agent.name,
              match: { channel: connector, peer: { kind: "direct", id: userId } },
            });
          }
        }
      }
    }
    if (bindings.length > 0) {
      result.bindings = bindings;
    }
  }

  // Determine role(s) for template merging
  const role = isSingleAgentConfig(config) ? config.role : undefined;

  // Load and merge role-specific config partial
  const rolePartialPath = role
    ? join(templatesDir, "roles", role, "config.partial.json")
    : null;
  if (rolePartialPath && existsSync(rolePartialPath)) {
    const roleConfig = JSON.parse(
      readFileSync(rolePartialPath, "utf8"),
    ) as Partial<OpenClawConfig>;
    mergeInto(
      result as unknown as Record<string, unknown>,
      roleConfig as unknown as Record<string, unknown>,
    );
  }

  // Multi-agent: merge role partials for all unique roles
  if (!role && config.agents) {
    const roles = [...new Set(config.agents.map((a) => a.role))];
    for (const agentRole of roles) {
      const partialPath = join(templatesDir, "roles", agentRole, "config.partial.json");
      if (existsSync(partialPath)) {
        const roleConfig = JSON.parse(
          readFileSync(partialPath, "utf8"),
        ) as Partial<OpenClawConfig>;
        // Only merge cron/hooks from role partials (avoid per-agent conflicts)
        if (roleConfig.cron && !result.cron) result.cron = roleConfig.cron;
        if (roleConfig.hooks) {
          if (!result.hooks) {
            result.hooks = roleConfig.hooks;
          }
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

  // OpenClaw passthrough: deep-merge user-provided OpenClaw config last
  // This allows users to configure any OpenClaw setting not exposed by Clawforce
  if (config.openclaw) {
    mergeInto(
      result as unknown as Record<string, unknown>,
      config.openclaw as Record<string, unknown>,
    );
  }

  if (result.bindings) {
    validateBindings(result.bindings);
  }

  return result;
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
      if (plugin.id === "clawforce-router" && config.router?.enabled === false) {
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
  const primaryModel = isSingleAgentConfig(config)
    ? config.models.primary
    : config.defaults!.models.cloud;
  const localModel = isSingleAgentConfig(config)
    ? config.models.local
    : config.defaults?.models.local;

  const routerConfig: Record<string, unknown> = {
    defaultModel: primaryModel,
    ...(localModel ? { defaultLocalModel: localModel } : {}),
    alerts: mapRouterAlertsConfig(config),
    ...(config.policy ? { policy: config.policy } : {}),
    ...(config.compliance_frameworks
      ? { complianceFrameworks: config.compliance_frameworks }
      : {}),
  };

  if (config.router?.rules) {
    routerConfig.rules = config.router.rules;
  }
  if (config.router?.sensitivity_keywords) {
    routerConfig.sensitivityKeywords = config.router.sensitivity_keywords;
  }
  if (config.router?.priority) {
    routerConfig.priority = config.router.priority;
  }
  if (config.router?.budget) {
    routerConfig.budget = {
      dailyLimit: config.router.budget.daily_limit,
      perRequestCap: config.router.budget.per_request_cap,
      fallbackModel: config.router.budget.fallback_model,
    };
  }
  if (config.router?.health_check) {
    routerConfig.healthCheck = {
      enabled: config.router.health_check.enabled,
      intervalSeconds: config.router.health_check.interval_seconds,
      timeoutSeconds: config.router.health_check.timeout_seconds,
      staleAfterSeconds: config.router.health_check.stale_after_seconds,
      failoverPolicy: config.router.health_check.failover_policy,
      failureThreshold: config.router.health_check.failure_threshold,
      recoveryThreshold: config.router.health_check.recovery_threshold,
      retryAttempts: config.router.health_check.retry_attempts,
      retryDelayMs: config.router.health_check.retry_delay_ms,
    };
  }

  if (config.sensitivity?.pii_confidence_threshold !== undefined) {
    routerConfig.piiThreshold = config.sensitivity.pii_confidence_threshold;
  }
  if (config.sensitivity?.pii_pattern_thresholds) {
    routerConfig.piiPatternThresholds = config.sensitivity.pii_pattern_thresholds;
  }

  // Multi-agent: per-agent budgets and routing overrides
  if (isMultiAgentConfig(config)) {
    const agentBudgets: Record<string, { dailyLimit: number; perRequestCap?: number; fallbackModel?: string }> = {};
    const agentRules: Record<string, Array<{ condition: string; model: string }>> = {};
    let hasAgentBudgets = false;
    let hasAgentRules = false;

    for (const agent of config.agents) {
      if (agent.routing?.budget_daily) {
        agentBudgets[agent.name] = {
          dailyLimit: agent.routing.budget_daily,
          ...(agent.routing.per_request_cap !== undefined
            ? { perRequestCap: agent.routing.per_request_cap }
            : {}),
          ...(agent.routing.fallback_model
            ? { fallbackModel: agent.routing.fallback_model }
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

    // Pass defaults router config for multi-agent
    if (config.defaults.router?.rules) {
      routerConfig.rules = config.defaults.router.rules;
    }
    if (config.defaults.router?.sensitivity_keywords) {
      routerConfig.sensitivityKeywords = config.defaults.router.sensitivity_keywords;
    }
    if (config.defaults.router?.priority) {
      routerConfig.priority = config.defaults.router.priority;
    }
    if (config.defaults.router?.budget) {
      routerConfig.budget = {
        dailyLimit: config.defaults.router.budget.daily_limit,
        perRequestCap: config.defaults.router.budget.per_request_cap,
        fallbackModel: config.defaults.router.budget.fallback_model,
      };
    }
  }

  return routerConfig;
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
