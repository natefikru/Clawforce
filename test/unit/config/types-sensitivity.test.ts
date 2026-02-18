import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema } from "../../../src/config/types.js";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "sensitivity-test",
    agents: [{ name: "test-agent", role: "research-agent" }],
    models: {
      cloud: "anthropic/claude-sonnet-4-5",
      provider_keys: {
        anthropic: "sk-ant-test123",
      },
    },
    openclaw: {
      default: {
        channels: {
          discord: {
            enabled: true,
          },
        },
      },
    },
    ...overrides,
  };
}

describe("ClawforceConfigSchema — sensitivity thresholds", () => {
  it("accepts valid global and pattern threshold values", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        routing: {
          sensitivity: {
            pii_detection: true,
            pii_confidence_threshold: 0.9,
            pii_pattern_thresholds: {
              ip_address: 0.5,
              email: 0.95,
            },
          },
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts boundary global threshold values", () => {
    const min = ClawforceConfigSchema.safeParse(
      baseConfig({
        routing: {
          sensitivity: { pii_confidence_threshold: 0 },
        },
      }),
    );
    const max = ClawforceConfigSchema.safeParse(
      baseConfig({
        routing: {
          sensitivity: { pii_confidence_threshold: 1 },
        },
      }),
    );

    expect(min.success).toBe(true);
    expect(max.success).toBe(true);
  });

  it("rejects global threshold below range", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        routing: {
          sensitivity: {
            pii_confidence_threshold: -0.01,
          },
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects global threshold above range", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        routing: {
          sensitivity: {
            pii_confidence_threshold: 1.01,
          },
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects pattern threshold outside range", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        routing: {
          sensitivity: {
            pii_pattern_thresholds: {
              ip_address: 1.1,
            },
          },
        },
      }),
    );

    expect(result.success).toBe(false);
  });
});
