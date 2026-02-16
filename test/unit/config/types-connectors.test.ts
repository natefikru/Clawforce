import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema } from "../../../src/config/types.js";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "connector-test",
    role: "research-agent",
    models: {
      primary: "anthropic/claude-sonnet-4-5",
      api_key: "sk-ant-test123",
    },
    ...overrides,
  };
}

describe("ClawforceConfigSchema — connector requirements", () => {
  it("accepts config with connector provided through openclaw.channels", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        openclaw: {
          channels: {
            discord: {
              enabled: true,
            },
          },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects config when no connector is configured", () => {
    const result = ClawforceConfigSchema.safeParse(baseConfig());
    expect(result.success).toBe(false);
  });
});
