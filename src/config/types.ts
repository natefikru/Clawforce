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

// -- Alert schemas (unchanged) --

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

// -- Routing schemas (unified: rules + sensitivity + policy + budget + health_check) --

const routingConditionEnum = z.enum([
  "pii_detected",
  "low_complexity",
  "medium_complexity",
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

const routingSensitivitySchema = z.object({
  keywords: z.array(z.string()).optional(),
  pii_detection: z.boolean().optional(),
  pii_confidence_threshold: z.number().min(0).max(1).optional(),
  pii_pattern_thresholds: z.record(z.string(), z.number().min(0).max(1)).optional(),
});

const routingPolicySchema = z.object({
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
});

const routingBudgetSchema = z.object({
  daily_limit: z.number().positive(),
  per_request_cap: z.number().positive().optional(),
  fallback_model: z.string(),
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
          "routing.health_check.failover_policy=queue is not implemented yet; use block or failover-safe",
      });
    }
  });

const routingSchema = z.object({
  rules: z.array(routingRuleSchema).optional(),
  priority: z.array(routingPriorityEnum).optional(),
  budget: routingBudgetSchema.optional(),
  sensitivity: routingSensitivitySchema.optional(),
  policy: routingPolicySchema.optional(),
  health_check: healthCheckSchema.optional(),
});

// -- Per-agent routing overrides (same nested shape as global routing) --

const agentRoutingSchema = z.object({
  budget: z.object({
    daily_limit: z.number().positive().optional(),
    per_request_cap: z.number().positive().optional(),
    fallback_model: z.string().optional(),
  }).optional(),
  rules: z.array(routingRuleSchema).optional(),
  sensitivity: routingSensitivitySchema.optional(),
  priority: z.array(routingPriorityEnum).optional(),
});

// -- Agent schema --

const AgentConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Agent name must be lowercase alphanumeric with hyphens"),
  role: z.enum(["inbox-analyst", "research-agent", "process-automator", "supervisor"]),
  openclaw: z.string().min(1).optional(),
  routing: agentRoutingSchema.optional(),
  skills: z.array(z.string()).optional(),
  supervises: z.array(z.string()).optional(),
  sandbox: z
    .object({
      mode: z.enum(["off", "non-main", "all"]).default("off"),
    })
    .optional(),
});

// -- Models schema (unified: always top-level) --

const modelsSchema = z.object({
  cloud: z.string().min(1),
  local: z.string().optional(),
  provider_keys: z.record(z.string(), z.string().min(1)).optional(),
  credential_mode: z.enum(["env", "auth_profile"]).optional(),
  auth_profile: z.string().min(1).optional(),
});

// -- Dashboard schema (unchanged) --

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

// -- Compliance schema (merged: enabled + frameworks) --

const complianceSchema = z.object({
  enabled: z.boolean().default(true),
  frameworks: z
    .array(z.enum(["hipaa", "pci-dss", "gdpr", "ccpa", "sox"]))
    .optional(),
});

// -- Local model schema (renamed from runtime) --

const localModelSchema = z.object({
  engine: z.string().min(1).default("sglang"),
  location: z.enum(["container", "host"]).default("container"),
  host_url: z.string().url().optional(),
  model: z.string().default("qwen3-32b"),
  gpu: z.enum(["nvidia", "amd", "none"]).optional(),
  quantization: z.enum(["fp16", "int8", "int4", "awq", "gptq"]).optional(),
  port: z.number().default(30000),
  options: z.record(z.unknown()).optional(),
});

// -- Deployment schema (unchanged) --

const deploymentSchema = z.object({
  agent_runtime: z.enum(["openclaw"]).default("openclaw"),
});

// -- Top-level config schema --

export const ClawforceConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),

  models: modelsSchema,

  agents: z.array(AgentConfigSchema).min(1),

  routing: routingSchema.optional(),

  // Named map of openclaw configs — each key is an instance name, value is raw passthrough
  openclaw: z.record(z.string(), z.record(z.unknown())),

  local_model: localModelSchema.optional(),

  compliance: complianceSchema.optional(),

  dashboard: dashboardSchema.optional(),

  alerts: alertsSchema.optional(),

  gateway: z
    .object({
      bind: z.enum(["loopback", "lan"]).default("loopback"),
    })
    .optional(),

  deployment: deploymentSchema.optional(),

  plugins: z
    .object({
      enabled: z.array(z.string().min(1)).optional(),
      config: z.record(z.string(), z.record(z.unknown())).optional(),
    })
    .optional(),

  approval: z
    .object({
      mode: z.enum(["autonomous", "human-in-the-loop", "hybrid"]),
      require_approval_for: z.array(z.string()).optional(),
    })
    .optional(),

  capabilities: z.enum(["minimal", "standard", "full"]).optional(),

}).superRefine((data, ctx) => {
  const models = data.models as z.infer<typeof modelsSchema>;
  const agents = data.agents as z.infer<typeof AgentConfigSchema>[];
  const openclaw = data.openclaw as Record<string, Record<string, unknown>>;

  // 1. OpenClaw must have at least one instance
  const openclawInstanceNames = Object.keys(openclaw);
  if (openclawInstanceNames.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "openclaw must have at least one named instance",
      path: ["openclaw"],
    });
    return;
  }

  // 2. Credential mode validation
  const credentialMode = models.credential_mode ?? "env";
  if (credentialMode === "auth_profile" && !models.auth_profile) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "models.auth_profile is required when models.credential_mode=auth_profile",
      path: ["models", "auth_profile"],
    });
  }
  if (credentialMode === "env" && modelRequiresProviderApiKey(models.cloud)) {
    const provider = getModelProvider(models.cloud);
    const providerKey = provider ? models.provider_keys?.[provider] : undefined;
    if (!provider || !providerKey) {
      const providerLabel = provider ?? "<provider>";
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `models.provider_keys.${providerLabel} is required when models.credential_mode=env and models.cloud is a cloud provider model`,
        path: ["models", "provider_keys", providerLabel],
      });
    }
  }

  // 3. Unique agent names
  const agentNames = agents.map((a) => a.name);
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

  // 4. OpenClaw instance references
  const instanceSet = new Set(openclawInstanceNames);

  if (openclawInstanceNames.length > 1) {
    // Multiple instances: every agent must specify openclaw reference
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      if (!agent.openclaw) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agent '${agent.name}' must specify 'openclaw' when multiple openclaw instances are defined`,
          path: ["agents", i, "openclaw"],
        });
      } else if (!instanceSet.has(agent.openclaw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agent '${agent.name}' references openclaw instance '${agent.openclaw}', but no instance with that name exists`,
          path: ["agents", i, "openclaw"],
        });
      }
    }
  } else if (openclawInstanceNames.length === 1) {
    // Single instance: validate any explicit references
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      if (agent.openclaw && !instanceSet.has(agent.openclaw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agent '${agent.name}' references openclaw instance '${agent.openclaw}', but no instance with that name exists`,
          path: ["agents", i, "openclaw"],
        });
      }
    }
  }

  // 5. Supervisor validation
  const nameSet = new Set(agentNames);
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (agent.role === "supervisor" && (!agent.supervises || agent.supervises.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Supervisor agent '${agent.name}' must define a non-empty supervises list`,
        path: ["agents", i, "supervises"],
      });
    }
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
});

export type ClawforceConfig = z.infer<typeof ClawforceConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AgentRuntime = z.infer<typeof deploymentSchema>["agent_runtime"];

export function resolveAgentRuntime(config: ClawforceConfig): AgentRuntime {
  return config.deployment?.agent_runtime ?? "openclaw";
}

/**
 * Resolves which openclaw instance each agent is assigned to.
 * If only one instance exists, all agents are assigned to it.
 */
export function resolveAgentOpenclawInstance(
  agent: AgentConfig,
  config: ClawforceConfig,
): string {
  if (agent.openclaw) return agent.openclaw;
  const instanceNames = Object.keys(config.openclaw);
  return instanceNames[0];
}
