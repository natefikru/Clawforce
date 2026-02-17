import { z } from "zod";

const localModelPrefixes = ["ollama/", "local/", "sglang/", "vllm/"] as const;

function getModelProvider(model: string): string | undefined {
  const slashIndex = model.indexOf("/");
  if (slashIndex <= 0) return undefined;
  return model.slice(0, slashIndex).toLowerCase();
}

function modelRequiresProviderApiKey(model: string): boolean {
  const provider = getModelProvider(model);
  if (!provider) return false;
  return !localModelPrefixes.some((prefix) => model.startsWith(prefix));
}

const alertTypesSchema = z.object({
  model_health: z.boolean().default(true),
  budget_exceeded: z.boolean().default(true),
  pii_violation: z.boolean().default(true),
  agent_error: z.boolean().default(true),
  agent_idle: z.boolean().default(true),
}).default({});

const alertIdleSchema = z.object({
  threshold_minutes: z.number().int().positive().default(60),
  cooldown_minutes: z.number().int().positive().default(30),
}).default({});

const alertBudgetSchema = z.object({
  cooldown_minutes: z.number().int().positive().default(60),
  auto_block_on_exceeded: z.boolean().default(false),
}).default({});

const alertEmailNotificationsSchema = z.object({
  enabled: z.boolean().default(false),
  smtp_host: z.string().min(1).optional(),
  smtp_port: z.number().int().positive().default(587),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  from: z.string().email().optional(),
  to: z.array(z.string().email()).optional(),
}).superRefine((value, ctx) => {
  if (!value.enabled) return;
  if (!value.smtp_host) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "alerts.notifications.email.smtp_host is required when email is enabled",
      path: ["smtp_host"],
    });
  }
  if (!value.username) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "alerts.notifications.email.username is required when email is enabled",
      path: ["username"],
    });
  }
  if (!value.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "alerts.notifications.email.password is required when email is enabled",
      path: ["password"],
    });
  }
  if (!value.from) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "alerts.notifications.email.from is required when email is enabled",
      path: ["from"],
    });
  }
  if (!value.to || value.to.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "alerts.notifications.email.to must include at least one recipient when email is enabled",
      path: ["to"],
    });
  }
  if (value.smtp_port !== 465 && value.smtp_port !== 587) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "alerts.notifications.email.smtp_port must be 465 or 587",
      path: ["smtp_port"],
    });
  }
});

const alertNotificationsSchema = z.object({
  dashboard: z.boolean().default(true),
  email: alertEmailNotificationsSchema.default({}),
}).default({});

const alertsSchema = z.object({
  enabled: z.boolean().default(true),
  types: alertTypesSchema,
  idle: alertIdleSchema,
  budget: alertBudgetSchema,
  notifications: alertNotificationsSchema,
}).default({});

// -- Routing rule condition enum (shared between top-level router and per-agent overrides) --

const routingConditionEnum = z.enum([
  "pii_detected",
  "low_complexity",
  "high_complexity",
  "domain_code",
  "domain_writing",
  "domain_analysis",
  "domain_data",
  "over_budget",
]);

const routingRuleSchema = z.object({
  condition: routingConditionEnum,
  model: z.string(),
});

const routingPriorityEnum = z.enum(["policy", "sensitivity", "cost", "domain", "complexity"]);

// -- Multi-agent schemas --

const ChannelAssignmentSchema = z.object({
  type: z.enum(["channel", "dm"]),
  channels: z.array(z.string().min(1)).optional(),
  users: z.array(z.string().min(1)).optional(),
}).superRefine((data, ctx) => {
  if (data.type === "channel" && (!data.channels || data.channels.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "channels is required when type is 'channel'",
      path: ["channels"],
    });
  }
  if (data.type === "dm" && (!data.users || data.users.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "users is required when type is 'dm'",
      path: ["users"],
    });
  }
});

const AgentRoutingOverrideSchema = z.object({
  budget_daily: z.number().positive().optional(),
  per_request_cap: z.number().positive().optional(),
  fallback_model: z.string().optional(),
  rules: z.array(routingRuleSchema).optional(),
  sensitivity_keywords: z.array(z.string()).optional(),
  priority: z.array(routingPriorityEnum).optional(),
});

const AgentConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Agent name must be lowercase alphanumeric with hyphens"),
  role: z.enum(["inbox-analyst", "research-agent", "process-automator"]),
  channels: z.array(ChannelAssignmentSchema).optional(),
  routing: AgentRoutingOverrideSchema.optional(),
  skills: z.array(z.string()).optional(),
  supervises: z.array(z.string()).optional(),
  sandbox: z
    .object({
      mode: z.enum(["off", "non-main", "all"]).default("off"),
    })
    .optional(),
});

const healthCheckSchema = z
  .object({
    enabled: z.boolean().default(true),
    interval_seconds: z.number().int().positive().default(10),
    timeout_seconds: z.number().int().positive().default(3),
    stale_after_seconds: z.number().int().positive().default(30),
    failover_policy: z.enum(["block", "queue", "failover-safe"]).default("block"),
    failure_threshold: z.number().int().positive().default(3),
    recovery_threshold: z.number().int().positive().default(2),
    retry_attempts: z.number().int().min(0).max(5).default(2),
    retry_delay_ms: z.number().int().min(0).max(5000).default(500),
  })
  .superRefine((value, ctx) => {
    if (value.failover_policy === "queue") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "router.health_check.failover_policy=queue is not implemented yet; use block or failover-safe",
      });
    }
  });

const routerSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.array(routingRuleSchema).optional(),
  sensitivity_keywords: z.array(z.string()).optional(),
  priority: z.array(routingPriorityEnum).optional(),
  budget: z
    .object({
      daily_limit: z.number().positive(),
      per_request_cap: z.number().positive().optional(),
      fallback_model: z.string(),
    })
    .optional(),
  health_check: healthCheckSchema.optional(),
});

const dashboardSchema = z
  .object({
    enabled: z.boolean().default(true),
    port: z.number().default(3000),
    auth: z
      .object({
        enabled: z.boolean().default(false),
        username: z.string().min(1).optional(),
        password: z.string().min(8).optional(),
      })
      .refine(
        (val) => !val.enabled || (val.username && val.password),
        { message: "username and password are required when auth is enabled" },
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled !== false && value.auth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "dashboard.auth must be explicitly configured when dashboard is enabled; set auth.enabled=false to opt out",
        path: ["auth"],
      });
    }
  });

const DefaultsSchema = z.object({
  models: z.object({
    cloud: z.string().min(1),
    local: z.string().optional(),
    provider_keys: z.record(z.string(), z.string().min(1)).optional(),
    credential_mode: z.enum(["env", "auth_profile"]).optional(),
    auth_profile: z.string().min(1).optional(),
  }),
  router: routerSchema.optional(),
  dashboard: dashboardSchema.optional(),
});

// -- Top-level config schema --

export const ClawforceConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),

  // Single-agent mode (backward compatible)
  role: z.enum(["inbox-analyst", "research-agent", "process-automator"]).optional(),

  // Multi-agent mode
  agents: z.array(AgentConfigSchema).min(1).optional(),
  defaults: DefaultsSchema.optional(),

  // Single-agent models (required for single-agent, absent for multi-agent)
  models: z.object({
    primary: z.string().min(1),
    local: z.string().optional(),
    provider_keys: z.record(z.string(), z.string().min(1)).optional(),
    credential_mode: z.enum(["env", "auth_profile"]).optional(),
    auth_profile: z.string().min(1).optional(),
  }).optional(),

  plugins: z
    .object({
      enabled: z.array(z.string().min(1)).optional(),
      config: z.record(z.string(), z.record(z.unknown())).optional(),
    })
    .optional(),

  gateway: z
    .object({
      bind: z.enum(["loopback", "lan"]).default("loopback"),
    })
    .optional(),

  approval: z
    .object({
      mode: z.enum(["autonomous", "human-in-the-loop", "hybrid"]),
      require_approval_for: z.array(z.string()).optional(),
    })
    .optional(),

  sensitivity: z
    .object({
      blocklist: z.array(z.string()).optional(),
      pii_detection: z.boolean().optional(),
      pii_confidence_threshold: z.number().min(0).max(1).optional(),
      pii_pattern_thresholds: z.record(z.string(), z.number().min(0).max(1)).optional(),
    })
    .optional(),

  runtime: z
    .object({
      engine: z.string().min(1).default("sglang"),
      location: z.enum(["container", "host"]).default("container"),
      host_url: z.string().url().optional(),
      model: z.string().default("qwen3-32b"),
      gpu: z.enum(["nvidia", "amd", "none"]).optional(),
      quantization: z.enum(["fp16", "int8", "int4", "awq", "gptq"]).optional(),
      port: z.number().default(30000),
      options: z.record(z.unknown()).optional(),
    })
    .optional(),

  router: routerSchema.optional(),

  policy: z
    .object({
      default_tier: z
        .enum(["restricted", "confidential", "internal", "public"])
        .default("internal"),
      channels: z
        .array(
          z.object({
            channel_id: z.string(),
            tier: z.enum(["restricted", "confidential", "internal", "public"]),
            description: z.string().optional(),
          }),
        )
        .optional(),
      users: z
        .array(
          z.object({
            user_id: z.string(),
            tier: z.enum(["restricted", "confidential", "internal", "public"]),
          }),
        )
        .optional(),
    })
    .optional(),

  compliance: z
    .object({
      enabled: z.boolean().default(true),
    })
    .optional(),

  compliance_frameworks: z
    .array(z.enum(["hipaa", "pci-dss", "gdpr", "ccpa", "sox"]))
    .optional(),

  dashboard: dashboardSchema.optional(),

  alerts: alertsSchema.optional(),

  capabilities: z.enum(["minimal", "standard", "full"]).optional(),

  openclaw: z.record(z.unknown()).optional(),
}).superRefine((data, ctx) => {
  const hasRole = !!data.role;
  const hasAgents = !!data.agents && data.agents.length > 0;

  // 1. Mutual exclusivity: role XOR agents
  if (hasRole && hasAgents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Config must use EITHER 'role' (single-agent) OR 'agents' (multi-agent), not both",
      path: ["agents"],
    });
    return;
  }

  if (!hasRole && !hasAgents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Config must specify either 'role' (single-agent) or 'agents' (multi-agent)",
      path: ["role"],
    });
    return;
  }

  // 2. Single-agent validation
  if (hasRole) {
    if (!data.models) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "models is required for single-agent configs",
        path: ["models"],
      });
      return;
    }

    // Credential mode validation
    const credentialMode = data.models.credential_mode ?? "env";
    if (credentialMode === "auth_profile" && !data.models.auth_profile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "models.auth_profile is required when models.credential_mode=auth_profile",
        path: ["models", "auth_profile"],
      });
    }
    if (
      credentialMode === "env" &&
      modelRequiresProviderApiKey(data.models.primary)
    ) {
      const provider = getModelProvider(data.models.primary);
      const providerKey = provider ? data.models.provider_keys?.[provider] : undefined;
      if (!provider || !providerKey) {
        const providerLabel = provider ?? "<provider>";
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `models.provider_keys.${providerLabel} is required when models.credential_mode=env and models.primary is a cloud provider model`,
          path: ["models", "provider_keys", providerLabel],
        });
      }
    }

    // Connector requirement for single-agent
    const openclaw = data.openclaw;
    if (!openclaw || typeof openclaw !== "object") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one connector must be configured via openclaw.channels",
        path: ["openclaw"],
      });
      return;
    }
    const channels = (openclaw as Record<string, unknown>).channels;
    if (
      !channels ||
      typeof channels !== "object" ||
      Object.keys(channels as Record<string, unknown>).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one connector must be configured via openclaw.channels",
        path: ["openclaw", "channels"],
      });
    }
  }

  // 3. Multi-agent validation
  if (hasAgents) {
    // defaults.models.cloud is required
    if (!data.defaults?.models?.cloud) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaults.models.cloud is required for multi-agent configs",
        path: ["defaults", "models", "cloud"],
      });
    }

    // Credential mode validation for multi-agent
    if (data.defaults?.models) {
      const credentialMode = data.defaults.models.credential_mode ?? "env";
      if (credentialMode === "auth_profile" && !data.defaults.models.auth_profile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "defaults.models.auth_profile is required when defaults.models.credential_mode=auth_profile",
          path: ["defaults", "models", "auth_profile"],
        });
      }
      if (
        credentialMode === "env" &&
        modelRequiresProviderApiKey(data.defaults.models.cloud)
      ) {
        const provider = getModelProvider(data.defaults.models.cloud);
        const providerKey = provider ? data.defaults.models.provider_keys?.[provider] : undefined;
        if (!provider || !providerKey) {
          const providerLabel = provider ?? "<provider>";
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `defaults.models.provider_keys.${providerLabel} is required for cloud model when defaults.models.credential_mode=env`,
            path: ["defaults", "models", "provider_keys", providerLabel],
          });
        }
      }
    }

    // Unique agent names
    const agentNames = data.agents!.map((a) => a.name);
    const seen = new Set<string>();
    for (const name of agentNames) {
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate agent name '${name}' — agent names must be unique`,
          path: ["agents"],
        });
        break;
      }
      seen.add(name);
    }

    // Supervisor references must point to existing agents (not self)
    const nameSet = new Set(agentNames);
    for (let i = 0; i < data.agents!.length; i++) {
      const agent = data.agents![i];
      if (agent.supervises) {
        for (const supervisedName of agent.supervises) {
          if (supervisedName === agent.name) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Agent '${agent.name}' cannot supervise itself`,
              path: ["agents", i, "supervises"],
            });
            continue;
          }
          if (!nameSet.has(supervisedName)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Agent '${agent.name}' supervises '${supervisedName}', but no agent with that name exists`,
              path: ["agents", i, "supervises"],
            });
          }
        }
      }
    }

    // At least one connector: agents with channels OR openclaw.channels
    const hasAgentChannels = data.agents!.some(
      (a) => a.channels && a.channels.length > 0,
    );
    const hasOpenclawChannels = (() => {
      const openclaw = data.openclaw;
      if (!openclaw || typeof openclaw !== "object") return false;
      const channels = (openclaw as Record<string, unknown>).channels;
      return !!(
        channels &&
        typeof channels === "object" &&
        Object.keys(channels as Record<string, unknown>).length > 0
      );
    })();

    if (!hasAgentChannels && !hasOpenclawChannels) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one agent must have channels configured, or openclaw.channels must be set",
        path: ["agents"],
      });
    }
  }
});

export type ClawforceConfig = z.infer<typeof ClawforceConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type DefaultsConfig = z.infer<typeof DefaultsSchema>;

/** Returns true if the config is in single-agent mode (has `role`). */
export function isSingleAgentConfig(config: ClawforceConfig): config is ClawforceConfig & {
  role: string;
  models: NonNullable<ClawforceConfig["models"]>;
} {
  return !!config.role;
}

/** Returns true if the config is in multi-agent mode (has `agents`). */
export function isMultiAgentConfig(config: ClawforceConfig): config is ClawforceConfig & {
  agents: NonNullable<ClawforceConfig["agents"]>;
  defaults: NonNullable<ClawforceConfig["defaults"]>;
} {
  return !!config.agents && config.agents.length > 0 && !!config.defaults;
}
