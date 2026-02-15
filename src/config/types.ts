import { z } from "zod";

const slackChannelId = z.string().regex(/^C[A-Z0-9]+$/, "Invalid Slack channel ID");

export const ClawforceConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),

  role: z.enum(["inbox-analyst", "research-agent", "process-automator"]),

  slack: z.object({
    app_token: z.string().startsWith("xapp-", "Slack app token must start with xapp-"),
    bot_token: z.string().startsWith("xoxb-", "Slack bot token must start with xoxb-"),
    approval_channel: slackChannelId,
    allowed_channels: z.array(slackChannelId),
  }).optional(),

  telegram: z.object({
    bot_token: z.string().min(1, "Telegram bot token is required"),
    dm_policy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional(),
    allow_from: z.array(z.union([z.string(), z.number()])).optional(),
  }).optional(),

  models: z.object({
    primary: z.string().min(1),
    local: z.string().optional(),
    api_key: z.string().optional(),
  }),

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
    })
    .optional(),
}).refine(
  (data) => data.slack || data.telegram,
  { message: "At least one channel (slack or telegram) must be configured" },
);

export type ClawforceConfig = z.infer<typeof ClawforceConfigSchema>;
