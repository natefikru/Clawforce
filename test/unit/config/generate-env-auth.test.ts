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

describe("generateEnv — dashboard auth", () => {
  it("includes AUTH_SECRET when dashboard auth enabled", () => {
    const env = generateEnv(
      makeConfig({
        dashboard: {
          enabled: true,
          port: 3000,
          auth: { enabled: true, username: "admin", password: "test12345" },
        },
      }),
    );
    expect(env).toContain("AUTH_SECRET=");
    const match = env.match(/AUTH_SECRET=([a-f0-9]+)/);
    expect(match).toBeTruthy();
    expect(match![1]).toHaveLength(64);
  });

  it("includes DASHBOARD_ADMIN_USERNAME and PASSWORD", () => {
    const env = generateEnv(
      makeConfig({
        dashboard: {
          enabled: true,
          port: 3000,
          auth: { enabled: true, username: "myadmin", password: "secretpass" },
        },
      }),
    );
    expect(env).toContain("DASHBOARD_ADMIN_USERNAME=myadmin");
    expect(env).toContain("DASHBOARD_ADMIN_PASSWORD=secretpass");
  });

  it("omits auth vars when dashboard auth not configured", () => {
    const env = generateEnv(
      makeConfig({ dashboard: { enabled: true, port: 3000 } }),
    );
    expect(env).not.toContain("AUTH_SECRET");
    expect(env).not.toContain("DASHBOARD_ADMIN_USERNAME");
  });

  it("omits auth vars when dashboard auth disabled", () => {
    const env = generateEnv(
      makeConfig({
        dashboard: {
          enabled: true,
          port: 3000,
          auth: { enabled: false },
        },
      }),
    );
    expect(env).not.toContain("AUTH_SECRET");
  });

  it("omits auth vars when no dashboard at all", () => {
    const env = generateEnv(makeConfig());
    expect(env).not.toContain("AUTH_SECRET");
  });

  it("generates unique AUTH_SECRET on each call", () => {
    const config = makeConfig({
      dashboard: {
        enabled: true,
        port: 3000,
        auth: { enabled: true, username: "admin", password: "test12345" },
      },
    });
    const env1 = generateEnv(config);
    const env2 = generateEnv(config);
    const secret1 = env1.match(/AUTH_SECRET=([a-f0-9]+)/)![1];
    const secret2 = env2.match(/AUTH_SECRET=([a-f0-9]+)/)![1];
    expect(secret1).not.toBe(secret2);
  });
});
