import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema } from "../../../src/config/types.js";

function baseConfig(dashboardOverride?: Record<string, unknown>) {
  return {
    name: "test-corp",
    role: "inbox-analyst",
    slack: {
      app_token: "xapp-1-TEST",
      bot_token: "xoxb-TEST",
      approval_channel: "C0123456789",
      allowed_channels: [],
    },
    models: {
      primary: "anthropic/claude-sonnet-4-5",
      api_key: "sk-ant-test123",
    },
    dashboard: dashboardOverride,
  };
}

describe("ClawforceConfigSchema — dashboard.auth", () => {
  it("rejects dashboard enabled without explicit auth policy", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({ enabled: true, port: 3000 }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts auth.enabled: false without username/password", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        enabled: true,
        port: 3000,
        auth: { enabled: false },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts dashboard disabled without auth policy", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({ enabled: false, port: 3000 }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts auth.enabled: true with username and password", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        enabled: true,
        port: 3000,
        auth: { enabled: true, username: "admin", password: "test12345" },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects auth.enabled: true without username", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        enabled: true,
        port: 3000,
        auth: { enabled: true, password: "test12345" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects auth.enabled: true without password", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        enabled: true,
        port: 3000,
        auth: { enabled: true, username: "admin" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        enabled: true,
        port: 3000,
        auth: { enabled: true, username: "admin", password: "short" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty username", () => {
    const result = ClawforceConfigSchema.safeParse(
      baseConfig({
        enabled: true,
        port: 3000,
        auth: { enabled: true, username: "", password: "test12345" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts config without dashboard field at all", () => {
    const result = ClawforceConfigSchema.safeParse(baseConfig(undefined));
    expect(result.success).toBe(true);
  });
});
