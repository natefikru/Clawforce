import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema } from "../../../src/config/types.js";

function baseConfig(alertsOverride?: Record<string, unknown>) {
  return {
    name: "alerts-test",
    role: "research-agent",
    slack: {
      app_token: "xapp-1-TEST",
      bot_token: "xoxb-TEST",
      approval_channel: "C0123456789",
      allowed_channels: [],
    },
    models: { primary: "anthropic/claude-sonnet-4-5" },
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

  it("rejects enabled slack notifications without webhook_url", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        notifications: {
          slack: { enabled: true },
        },
      }),
    );
    expect(result.success).toBe(false);
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
});
