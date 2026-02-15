import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClawforceConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "..", "templates");

export interface OpenClawConfig {
  gateway?: {
    mode: string;
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

  // Enable plugins (router, compliance) if configured
  const pluginEntries: Record<
    string,
    { enabled: boolean; config?: Record<string, unknown> }
  > = {};

  if (config.router && config.router.enabled !== false) {
    const routerConfig: Record<string, unknown> = {
      defaultModel: config.models.primary,
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

  return result;
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
