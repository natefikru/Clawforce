import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClawforceConfig } from "./types.js";
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
  };
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
): OpenClawConfig {
  const result: OpenClawConfig = {
    gateway: {
      mode: "local",
      bind: config.gateway?.bind ?? "loopback",
    },
    agents: {
      defaults: {
        workspace: "/home/node/.openclaw/workspace",
        ...(config.models.credential_mode === "auth_profile" &&
        config.models.auth_profile
          ? { authProfile: config.models.auth_profile }
          : {}),
        model: {
          primary: config.models.primary,
          ...(config.models.local
            ? { fallbacks: [config.models.local] }
            : {}),
        },
      },
    },
    channels: {},
    session: {
      dmScope: "per-channel-peer",
    },
  };

  // Load and merge role-specific config partial
  const rolePartialPath = join(
    templatesDir,
    "roles",
    config.role,
    "config.partial.json",
  );
  if (existsSync(rolePartialPath)) {
    const roleConfig = JSON.parse(
      readFileSync(rolePartialPath, "utf8"),
    ) as Partial<OpenClawConfig>;
    mergeInto(
      result as unknown as Record<string, unknown>,
      roleConfig as unknown as Record<string, unknown>,
    );
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

  return result;
}

function buildPluginEntries(
  config: ClawforceConfig,
): Record<string, { enabled: boolean; config?: Record<string, unknown> }> {
  const discovered = discoverPlugins();
  const entries: Record<string, { enabled: boolean; config?: Record<string, unknown> }> = {};

  for (const plugin of discovered) {
    if (plugin.id === "clawforce-router") {
      entries[plugin.id] = {
        enabled: true,
        config: {
          ...buildRouterPluginConfig(config),
          pluginPermissions: plugin.manifest.permissions,
        },
      };
      continue;
    }

    entries[plugin.id] = {
      enabled: true,
      config: {
        pluginPermissions: plugin.manifest.permissions,
      },
    };
  }

  return entries;
}

function buildRouterPluginConfig(config: ClawforceConfig): Record<string, unknown> {
  const routerConfig: Record<string, unknown> = {
    defaultModel: config.models.primary,
    ...(config.models.local ? { defaultLocalModel: config.models.local } : {}),
    alerts: mapRouterAlertsConfig(config),
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
