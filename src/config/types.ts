import { z } from "zod";

const localModelPrefixes = ["ollama/", "local/", "sglang/", "vllm/"] as const;

function modelRequiresProviderApiKey(model: string): boolean {
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

export const ClawforceConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),

  role: z.enum(["inbox-analyst", "research-agent", "process-automator"]),

  models: z.object({
    primary: z.string().min(1),
    local: z.string().optional(),
    api_key: z.string().optional(),
    credential_mode: z.enum(["env", "auth_profile"]).optional(),
    auth_profile: z.string().min(1).optional(),
  }).superRefine((value, ctx) => {
    const credentialMode = value.credential_mode ?? "env";
    if (credentialMode === "auth_profile" && !value.auth_profile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "models.auth_profile is required when models.credential_mode=auth_profile",
        path: ["auth_profile"],
      });
    }
    if (
      credentialMode === "env" &&
      modelRequiresProviderApiKey(value.primary) &&
      !value.api_key
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "models.api_key is required when models.credential_mode=env and models.primary is a cloud provider model",
        path: ["api_key"],
      });
    }
  }),

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
    })
    .optional(),

  ollama: z
    .object({
      enabled: z.boolean(),
      model: z.string().optional(),
      gpu: z.enum(["nvidia", "amd", "none"]).optional(),
    })
    .optional(),

  runtime: z
    .object({
      engine: z.enum(["ollama", "sglang", "vllm"]).default("sglang"),
      model: z.string().default("qwen3-32b"),
      gpu: z.enum(["nvidia", "amd", "none"]).optional(),
      quantization: z.enum(["fp16", "int8", "int4", "awq", "gptq"]).optional(),
      port: z.number().default(30000),
      options: z.record(z.unknown()).optional(),
    })
    .optional(),

  router: z
    .object({
      enabled: z.boolean().default(true),
      rules: z
        .array(
          z.object({
            condition: z.enum([
              "pii_detected",
              "low_complexity",
              "high_complexity",
              "domain_code",
              "domain_writing",
              "domain_analysis",
              "domain_data",
              "over_budget",
            ]),
            model: z.string(),
          }),
        )
        .optional(),
      sensitivity_keywords: z.array(z.string()).optional(),
      priority: z
        .array(z.enum(["policy", "sensitivity", "cost", "domain", "complexity"]))
        .optional(),
      budget: z
        .object({
          daily_limit: z.number().positive(),
          per_request_cap: z.number().positive().optional(),
          fallback_model: z.string(),
        })
        .optional(),
      health_check: z
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
        })
        .optional(),
    })
    .optional(),

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

  dashboard: z
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
    })
    .optional(),

  alerts: alertsSchema.optional(),

  capabilities: z.enum(["minimal", "standard", "full"]).optional(),

  openclaw: z.record(z.unknown()).optional(),
}).refine(
  (data) => {
    const openclaw = data.openclaw;
    if (!openclaw || typeof openclaw !== "object") return false;
    const channels = (openclaw as Record<string, unknown>).channels;
    return !!(
      channels &&
      typeof channels === "object" &&
      Object.keys(channels as Record<string, unknown>).length > 0
    );
  },
  {
    message:
      "At least one connector must be configured via openclaw.channels",
  },
);

export type ClawforceConfig = z.infer<typeof ClawforceConfigSchema>;
