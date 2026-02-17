import { z } from "zod";

/**
 * OpenClaw BindingsSchema (ported from Zod v4 → v3).
 * Source: openclaw/src/config/zod-schema.agents.ts:14-44
 * Keep in sync when upgrading OpenClaw.
 */
export const OpenClawBindingsSchema = z
  .array(
    z.object({
      agentId: z.string(),
      match: z.object({
        channel: z.string(),
        accountId: z.string().optional(),
        peer: z
          .object({
            kind: z.union([
              z.literal("direct"),
              z.literal("group"),
              z.literal("channel"),
              z.literal("dm"),
            ]),
            id: z.string(),
          })
          .strict()
          .optional(),
        guildId: z.string().optional(),
        teamId: z.string().optional(),
        roles: z.array(z.string()).optional(),
      }).strict(),
    }).strict(),
  )
  .optional();

export function validateBindings(bindings: unknown): void {
  const result = OpenClawBindingsSchema.safeParse(bindings);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Generated OpenClaw bindings are invalid: ${issues}`);
  }
}
