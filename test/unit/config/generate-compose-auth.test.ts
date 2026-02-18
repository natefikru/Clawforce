import { describe, it, expect } from "vitest";
import { generateCompose } from "../../../src/config/generate-compose.js";
import { parse as parseYaml } from "yaml";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    agents: [{ name: "test-agent", role: "inbox-analyst", runtime: "openclaw" }],
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
    },
    ...overrides,
  };
}

describe("generateCompose — dashboard auth", () => {
  it("includes AUTH_SECRET and AUTH_TRUST_HOST when auth enabled", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          dashboard: {
            enabled: true,
            port: 3000,
            auth: { enabled: true, username: "admin", password: "test12345" },
          },
        }),
      ),
    );
    const env = parsed.services.dashboard.environment;
    expect(env).toContain("AUTH_SECRET=${AUTH_SECRET}");
    expect(env).toContain("AUTH_TRUST_HOST=true");
  });

  it("does not include auth env vars when auth not configured", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({ dashboard: { enabled: true, port: 3000 } }),
      ),
    );
    const env = parsed.services.dashboard.environment;
    expect(env).not.toContain("AUTH_SECRET=${AUTH_SECRET}");
    expect(env).not.toContain("AUTH_TRUST_HOST=true");
  });

  it("does not include auth env vars when auth disabled", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          dashboard: {
            enabled: true,
            port: 3000,
            auth: { enabled: false },
          },
        }),
      ),
    );
    const env = parsed.services.dashboard.environment;
    expect(env).not.toContain("AUTH_SECRET=${AUTH_SECRET}");
  });

  it("does not pass DASHBOARD_ADMIN_USERNAME/PASSWORD to container", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          dashboard: {
            enabled: true,
            port: 3000,
            auth: { enabled: true, username: "admin", password: "test12345" },
          },
        }),
      ),
    );
    const env = parsed.services.dashboard.environment as string[];
    const hasAdminUser = env.some((e: string) =>
      e.includes("DASHBOARD_ADMIN_USERNAME"),
    );
    const hasAdminPass = env.some((e: string) =>
      e.includes("DASHBOARD_ADMIN_PASSWORD"),
    );
    expect(hasAdminUser).toBe(false);
    expect(hasAdminPass).toBe(false);
  });

  it("preserves existing dashboard env vars with auth", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          dashboard: {
            enabled: true,
            port: 3000,
            auth: { enabled: true, username: "admin", password: "test12345" },
          },
        }),
      ),
    );
    const env = parsed.services.dashboard.environment;
    expect(env).toContain("DATA_DIR=/data");
    expect(env).toContain("OPENCLAW_GATEWAY_URL=ws://openclaw-gateway:18789");
    expect(env).toContain("OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}");
  });
});
