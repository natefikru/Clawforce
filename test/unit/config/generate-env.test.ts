import { describe, it, expect } from "vitest";
import { generateEnv } from "../../../src/config/generate-env.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
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
    ...overrides,
  };
}

describe("generateEnv", () => {
  it("should include gateway token", () => {
    const env = generateEnv(makeConfig());
    expect(env).toContain("GATEWAY_TOKEN=");
  });

  it("should generate a 64-char hex gateway token", () => {
    const env = generateEnv(makeConfig());
    const match = env.match(/GATEWAY_TOKEN=([a-f0-9]+)/);
    expect(match).toBeTruthy();
    expect(match![1]).toHaveLength(64);
  });

  it("should include API key", () => {
    const env = generateEnv(makeConfig());
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test123");
  });

  it("should omit provider API key in auth_profile mode", () => {
    const env = generateEnv(
      makeConfig({
        models: {
          primary: "anthropic/claude-sonnet-4-5",
          credential_mode: "auth_profile",
          auth_profile: "corp-prod",
          api_key: "sk-ant-should-not-be-used",
        },
      }),
    );
    expect(env).not.toContain("ANTHROPIC_API_KEY=");
    expect(env).toContain("OPENCLAW_AUTH_PROFILE=corp-prod");
  });

  it("should include warning comment when auth_profile exists in env mode", () => {
    const env = generateEnv(
      makeConfig({
        models: {
          primary: "anthropic/claude-sonnet-4-5",
          credential_mode: "env",
          auth_profile: "corp-prod",
          api_key: "sk-ant-test123",
        },
      }),
    );
    expect(env).toContain("credential_mode=env");
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test123");
  });

  it("should handle missing API key", () => {
    const env = generateEnv(
      makeConfig({ models: { primary: "anthropic/claude-sonnet-4-5" } }),
    );
    expect(env).toContain("ANTHROPIC_API_KEY=");
  });

  it("should include deployment name comment", () => {
    const env = generateEnv(makeConfig());
    expect(env).toContain("# Deployment: test-corp");
  });

  it("should include do-not-commit warning", () => {
    const env = generateEnv(makeConfig());
    expect(env).toContain("DO NOT COMMIT");
  });

  it("should generate unique tokens on each call", () => {
    const env1 = generateEnv(makeConfig());
    const env2 = generateEnv(makeConfig());
    const token1 = env1.match(/GATEWAY_TOKEN=([a-f0-9]+)/)![1];
    const token2 = env2.match(/GATEWAY_TOKEN=([a-f0-9]+)/)![1];
    expect(token1).not.toBe(token2);
  });

  it("should export alert secrets when configured", () => {
    const env = generateEnv(
      makeConfig({
        alerts: {
          enabled: true,
          types: {
            model_health: true,
            budget_exceeded: true,
            pii_violation: true,
            agent_error: true,
            agent_idle: true,
          },
          idle: {
            threshold_minutes: 60,
            cooldown_minutes: 30,
          },
          budget: {
            cooldown_minutes: 60,
            auto_block_on_exceeded: false,
          },
          notifications: {
            dashboard: true,
            slack: {
              enabled: true,
              webhook_url: "https://hooks.slack.com/services/T000/B000/TEST",
            },
            email: {
              enabled: true,
              smtp_host: "smtp.example.com",
              smtp_port: 587,
              username: "alerts@example.com",
              password: "super-secret",
              from: "alerts@example.com",
              to: ["ops@example.com"],
            },
          },
        },
      }),
    );

    expect(env).toContain(
      "CLAWFORCE_ALERTS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/TEST",
    );
    expect(env).toContain("CLAWFORCE_ALERTS_EMAIL_PASSWORD=super-secret");
  });
});
