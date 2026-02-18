import { describe, it, expect } from "vitest";
import { generateEnv } from "../../../src/config/generate-env.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    agents: [{ name: "test-agent", role: "inbox-analyst" }],
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
    },
    models: {
      cloud: "anthropic/claude-sonnet-4-5",
      provider_keys: {
        anthropic: "sk-ant-test123",
      },
    },
    ...overrides,
  };
}

describe("generateEnv", () => {
  it("should reject unsupported host runtime engines", () => {
    expect(() =>
      generateEnv(
        makeConfig({
          local_model: {
            engine: "custom-engine",
            location: "host",
            model: "custom/model",
            port: 9999,
          },
        }),
      ),
    ).toThrow('Unsupported runtime engine "custom-engine"');
  });

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

  it("should include provider API keys", () => {
    const env = generateEnv(makeConfig());
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test123");
  });

  it("should omit provider API key in auth_profile mode", () => {
    const env = generateEnv(
      makeConfig({
        models: {
          cloud: "anthropic/claude-sonnet-4-5",
          credential_mode: "auth_profile",
          auth_profile: "corp-prod",
          provider_keys: {
            anthropic: "sk-ant-should-not-be-used",
          },
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
          cloud: "anthropic/claude-sonnet-4-5",
          credential_mode: "env",
          auth_profile: "corp-prod",
          provider_keys: {
            anthropic: "sk-ant-test123",
          },
        },
      }),
    );
    expect(env).toContain("credential_mode=env");
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test123");
  });

  it("should handle missing provider keys", () => {
    const env = generateEnv(
      makeConfig({ models: { cloud: "anthropic/claude-sonnet-4-5" } }),
    );
    expect(env).not.toContain("ANTHROPIC_API_KEY=");
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

    expect(env).toContain("CLAWFORCE_ALERTS_EMAIL_PASSWORD=super-secret");
  });

  it("should export OLLAMA_HOST for host runtime mode", () => {
    const env = generateEnv(
      makeConfig({
        local_model: {
          engine: "ollama",
          location: "host",
          host_url: "http://host.docker.internal:11434",
          model: "llama3.3:8b",
          port: 11434,
        },
      }),
    );

    expect(env).toContain("OLLAMA_HOST=http://host.docker.internal:11434");
  });

  it("should default host runtime endpoint when host_url is omitted", () => {
    const env = generateEnv(
      makeConfig({
        local_model: {
          engine: "sglang",
          location: "host",
          model: "qwen3-32b",
          port: 30000,
        },
      }),
    );

    expect(env).toContain("SGLANG_HOST=http://host.docker.internal:30000");
  });
});
