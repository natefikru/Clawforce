import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema } from "../../../src/config/types.js";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "connector-test",
    agents: [{ name: "test-agent", role: "research-agent" }],
    models: {
      cloud: "anthropic/claude-sonnet-4-5",
      provider_keys: {
        anthropic: "sk-ant-test123",
      },
    },
    ...overrides,
  };
}

describe("ClawforceConfigSchema — connector requirements", () => {
  it("accepts config with connector provided through openclaw named instance", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        openclaw: {
          default: {
            channels: {
              discord: {
                enabled: true,
              },
            },
          },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects config when openclaw has no named instances", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({ openclaw: {} }),
    );
    expect(result.success).toBe(false);
  });
});
