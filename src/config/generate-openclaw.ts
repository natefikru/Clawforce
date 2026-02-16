import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClawforceConfig } from "./types.js";
import { resolveProfile } from "./capability-profiles.js";

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
    slack: { enabled: false },
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
      model: {
        primary: string;
        fallbacks?: string[];
      };
    };
  };
  channels: {
    slack?: {
      enabled: boolean;
      mode: string;
      appToken: string;
      botToken: string;
      groupPolicy: string;
      dm?: { policy: string };
      channels: Record<string, { requireMention: boolean }>;
    };
    telegram?: {
      enabled: boolean;
      botToken: string;
      dmPolicy: string;
      groupPolicy: string;
      allowFrom?: Array<string | number>;
    };
  };
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

  // Channel config — at least one of slack or telegram is required
  if (config.slack) {
    const slackChannels: Record<string, { requireMention: boolean }> = {};

    // Approval channel: bot responds without being mentioned
    slackChannels[config.slack.approval_channel] = { requireMention: false };

    // Allowed channels: require @mention
    for (const channelId of config.slack.allowed_channels) {
      slackChannels[channelId] = { requireMention: true };
    }

    result.channels.slack = {
      enabled: true,
      mode: "socket",
      appToken: config.slack.app_token,
      botToken: config.slack.bot_token,
      groupPolicy: "allowlist",
      dm: {
        policy: "pairing",
      },
      channels: slackChannels,
    };
  }

  if (config.telegram) {
    const dmPolicy = config.telegram.dm_policy ?? "open";
    const allowFrom = config.telegram.allow_from
      ?? (dmPolicy === "open" ? ["*"] : undefined);
    result.channels.telegram = {
      enabled: true,
      botToken: config.telegram.bot_token,
      dmPolicy,
      groupPolicy: "disabled",
      ...(allowFrom ? { allowFrom } : {}),
    };
  }

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

  // Enable plugins (router, compliance) if configured
  const pluginEntries: Record<
    string,
    { enabled: boolean; config?: Record<string, unknown> }
  > = {};

  if (config.router && config.router.enabled !== false) {
    const routerConfig: Record<string, unknown> = {
      defaultModel: config.models.primary,
      ...(config.models.local ? { defaultLocalModel: config.models.local } : {}),
      alerts: mapRouterAlertsConfig(config),
    };
    if (config.router.rules) {
      routerConfig.rules = config.router.rules;
    }
    if (config.router.sensitivity_keywords) {
      routerConfig.sensitivityKeywords = config.router.sensitivity_keywords;
    }
    if (config.router.priority) {
      routerConfig.priority = config.router.priority;
    }
    if (config.router.budget) {
      routerConfig.budget = {
        dailyLimit: config.router.budget.daily_limit,
        perRequestCap: config.router.budget.per_request_cap,
        fallbackModel: config.router.budget.fallback_model,
      };
    }
    if (config.router.health_check) {
      routerConfig.healthCheck = {
        enabled: config.router.health_check.enabled,
        intervalSeconds: config.router.health_check.interval_seconds,
        timeoutSeconds: config.router.health_check.timeout_seconds,
        staleAfterSeconds: config.router.health_check.stale_after_seconds,
        failoverPolicy: config.router.health_check.failover_policy,
        failureThreshold: config.router.health_check.failure_threshold,
        recoveryThreshold: config.router.health_check.recovery_threshold,
      };
    }
    pluginEntries["clawforce-router"] = {
      enabled: true,
      config: routerConfig,
    };
  }

  if (config.compliance && config.compliance.enabled !== false) {
    pluginEntries["clawforce-compliance"] = { enabled: true };
  }

  if (Object.keys(pluginEntries).length > 0) {
    result.plugins = {
      enabled: true,
      entries: pluginEntries,
    };
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

  return result;
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
      slack: {
        enabled:
          alerts?.notifications?.slack?.enabled
          ?? DEFAULT_ROUTER_ALERTS_CONFIG.notifications.slack.enabled,
        ...(alerts?.notifications?.slack?.webhook_url
          ? { webhookUrl: alerts.notifications.slack.webhook_url }
          : {}),
      },
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
          ? { password: alerts.notifications.email.password }
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
