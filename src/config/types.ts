import { z } from "zod";

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

// -- Model schemas (flat list of routing targets) --

const modelEngineSchema = z.object({
  runtime: z.string().min(1),
  location: z.enum(["container", "host"]).default("container"),
  host_url: z.string().url().optional(),
  model: z.string().optional(),
  gpu: z.enum(["nvidia", "amd", "none"]).optional(),
  quantization: z.enum(["fp16", "int8", "int4", "awq", "gptq"]).optional(),
  port: z.number().default(30000),
  options: z.record(z.unknown()).optional(),
});

const modelEntrySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Model name must be lowercase alphanumeric with hyphens"),
  id: z.string().min(1),
  type: z.enum(["local", "cloud"]),
  api_key: z.string().min(1).optional(),
  engine: modelEngineSchema.optional(),
});

// -- Agent schema --

const AgentConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Agent name must be lowercase alphanumeric with hyphens"),
  role: z.enum(["inbox-analyst", "research-agent", "process-automator", "supervisor"]),
  runtime: z.enum(["openclaw"]).default("openclaw"),
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

// -- Compliance schema (unchanged) --

const complianceSchema = z.object({
  enabled: z.boolean().default(true),
  frameworks: z
    .array(z.enum(["hipaa", "pci-dss", "gdpr", "ccpa", "sox"]))
    .optional(),
});

// -- Top-level config schema --

export const ClawforceConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),

  agents: z.array(AgentConfigSchema).min(1),

  // Flat list of routing targets — only needed when routing rules exist
  models: z.array(modelEntrySchema).optional(),

  // Optional: enterprise OpenClaw credential profile (replaces per-model api_keys)
  auth_profile: z.string().min(1).optional(),

  routing: routingSchema.optional(),

  // Named map of openclaw configs — each key is an instance name, value is raw passthrough
  openclaw: z.record(z.string(), z.record(z.unknown())),

  compliance: complianceSchema.optional(),

  dashboard: dashboardSchema.optional(),

  alerts: alertsSchema.optional(),

  gateway: z
    .object({
      bind: z.enum(["loopback", "lan"]).default("loopback"),
      port: z.number().int().positive().default(18789),
    })
    .optional(),

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
  const models = data.models ?? [];
  const agents = data.agents;
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

  // 2. Model list validation
  const modelNames = new Set<string>();
  for (let i = 0; i < models.length; i++) {
    const model = models[i];

    // Duplicate model names
    if (modelNames.has(model.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate model name '${model.name}' — model names must be unique`,
        path: ["models", i, "name"],
      });
    }
    modelNames.add(model.name);

    // Cloud models require api_key when auth_profile is not set
    if (model.type === "cloud" && !model.api_key && !data.auth_profile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Cloud model '${model.name}' requires api_key when auth_profile is not set`,
        path: ["models", i, "api_key"],
      });
    }

    // Local models require engine config
    if (model.type === "local" && !model.engine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Local model '${model.name}' requires engine configuration`,
        path: ["models", i, "engine"],
      });
    }
  }

  // 3. Routing rules must reference defined model names
  const validateModelRef = (modelRef: string, path: (string | number)[]) => {
    if (models.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Routing references model '${modelRef}' but no models are defined`,
        path,
      });
    } else if (!modelNames.has(modelRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Routing references model '${modelRef}', but no model with that name exists in models list`,
        path,
      });
    }
  };

  if (data.routing?.rules) {
    for (let i = 0; i < data.routing.rules.length; i++) {
      validateModelRef(data.routing.rules[i].model, ["routing", "rules", i, "model"]);
    }
  }

  if (data.routing?.budget?.fallback_model) {
    validateModelRef(data.routing.budget.fallback_model, ["routing", "budget", "fallback_model"]);
  }

  // Validate per-agent routing rule model references
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (agent.routing?.rules) {
      for (let j = 0; j < agent.routing.rules.length; j++) {
        validateModelRef(
          agent.routing.rules[j].model,
          ["agents", i, "routing", "rules", j, "model"],
        );
      }
    }
    if (agent.routing?.budget?.fallback_model) {
      validateModelRef(
        agent.routing.budget.fallback_model,
        ["agents", i, "routing", "budget", "fallback_model"],
      );
    }
  }

  // 4. PII safety: if routing exists with PII detection, require at least one local model
  const piiEnabled = data.routing?.sensitivity?.pii_detection !== false;
  if (data.routing && piiEnabled && models.length > 0) {
    const hasLocal = models.some((m) => m.type === "local");
    if (!hasLocal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Routing with PII detection enabled requires at least one model with type=local",
        path: ["models"],
      });
    }
  }

  // 5. Unique agent names
  const agentNames = agents.map((a) => a.name);
  const seenAgents = new Set<string>();
  for (const name of agentNames) {
    if (seenAgents.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate agent name '${name}' — agent names must be unique`,
        path: ["agents"],
      });
      break;
    }
    seenAgents.add(name);
  }

  // 6. OpenClaw instance references
  const instanceSet = new Set(openclawInstanceNames);

  if (openclawInstanceNames.length > 1) {
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

  // 7. Supervisor validation
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
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ModelEngine = z.infer<typeof modelEngineSchema>;
export type AgentRuntime = "openclaw";

export function resolveAgentRuntime(agent: AgentConfig): AgentRuntime {
  return agent.runtime ?? "openclaw";
}

export function resolveAgentOpenclawInstance(
  agent: AgentConfig,
  config: ClawforceConfig,
): string {
  if (agent.openclaw) return agent.openclaw;
  const instanceNames = Object.keys(config.openclaw);
  return instanceNames[0];
}

export function findModelByName(
  config: ClawforceConfig,
  name: string,
): ModelEntry | undefined {
  return config.models?.find((m) => m.name === name);
}

export function getLocalModels(config: ClawforceConfig): ModelEntry[] {
  return config.models?.filter((m) => m.type === "local") ?? [];
}

export function getFirstLocalModel(config: ClawforceConfig): ModelEntry | undefined {
  return config.models?.find((m) => m.type === "local");
}

export function getLocalModelEngine(config: ClawforceConfig): ModelEngine | undefined {
  return config.models?.find((m) => m.engine)?.engine;
}
