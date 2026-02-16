import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema } from "../../../src/config/types.js";

function baseConfig(alertsOverride?: Record<string, unknown>) {
  return {
    name: "alerts-test",
    role: "research-agent",
    openclaw: {
      channels: {
        discord: { enabled: true },
      },
    },
    models: {
      primary: "anthropic/claude-sonnet-4-5",
      api_key: "sk-ant-test123",
    },
    alerts: alertsOverride,
  };
}

describe("ClawforceConfigSchema — alerts", () => {
  it("accepts alerts block with defaults", () => {
    const result = ClawforceConfigSchema.safeParse(baseConfig({ enabled: true }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.alerts?.idle.threshold_minutes).toBe(60);
    expect(result.data.alerts?.budget.cooldown_minutes).toBe(60);
    expect(result.data.alerts?.notifications.dashboard).toBe(true);
  });

  it("rejects enabled email notifications without recipients", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        notifications: {
          email: {
            enabled: true,
            smtp_host: "smtp.example.com",
            username: "alerts@example.com",
            password: "secret",
            from: "alerts@example.com",
            to: [],
          },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects email notifier ports outside TLS-safe set", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        notifications: {
          email: {
            enabled: true,
            smtp_host: "smtp.example.com",
            smtp_port: 2525,
            username: "alerts@example.com",
            password: "secret",
            from: "alerts@example.com",
            to: ["ops@example.com"],
          },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("strips connector-specific keys from notifications", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        notifications: {
          dashboard: true,
          email: { enabled: false },
          unsupported_connector: { enabled: true, endpoint: "https://example.com/hook" },
        },
      }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data.alerts?.notifications as Record<string, unknown>).unsupported_connector).toBeUndefined();
  });
});
