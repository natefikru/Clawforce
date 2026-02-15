import { describe, it, expect } from "vitest";
import { resolveProfile } from "../../../src/config/capability-profiles.js";
import { generateOpenClawConfig } from "../../../src/config/generate-openclaw.js";
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
    models: { primary: "anthropic/claude-sonnet-4-5" },
    ...overrides,
  };
}

describe("resolveProfile", () => {
  it("should resolve minimal profile", () => {
    const profile = resolveProfile("minimal");
    const tools = (profile.agents as Record<string, unknown> as { defaults: { tools: Record<string, unknown> } }).defaults.tools;
    expect(tools.web_search).toEqual({ enabled: true });
    expect(tools.memory).toEqual({ enabled: false });
    expect(tools.sandbox).toEqual({ enabled: false });
    expect(tools.browser).toEqual({ enabled: false });
    expect(tools.exec).toEqual({ enabled: false });
  });

  it("should resolve standard profile", () => {
    const profile = resolveProfile("standard");
    const tools = (profile.agents as Record<string, unknown> as { defaults: { tools: Record<string, unknown> } }).defaults.tools;
    expect(tools.web_search).toEqual({ enabled: true });
    expect(tools.memory).toEqual({ enabled: true });
    expect(tools.browser).toEqual({ enabled: true, headless: true });
    expect(tools.sandbox).toEqual({ enabled: false });
    expect(tools.exec).toEqual({ enabled: false });
  });

  it("should resolve full profile", () => {
    const profile = resolveProfile("full");
    const tools = (profile.agents as Record<string, unknown> as { defaults: { tools: Record<string, unknown> } }).defaults.tools;
    expect(tools.web_search).toEqual({ enabled: true });
    expect(tools.memory).toEqual({ enabled: true });
    expect(tools.browser).toEqual({ enabled: true, headless: true });
    expect(tools.sandbox).toEqual({ enabled: true });
    expect(tools.exec).toEqual({ enabled: true });
    expect(tools.skills).toEqual({ enabled: true });
    expect(tools.cron).toEqual({ enabled: true });
  });

  it("should return a deep copy (not a reference)", () => {
    const p1 = resolveProfile("full");
    const p2 = resolveProfile("full");
    expect(p1).toEqual(p2);
    expect(p1).not.toBe(p2);
  });
});

describe("capability profiles in config generation", () => {
  it("should apply minimal profile to generated config", () => {
    const result = generateOpenClawConfig(
      makeConfig({ capabilities: "minimal" }),
    );
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    expect(tools.web_search).toEqual({ enabled: true });
    expect(tools.browser).toEqual({ enabled: false });
  });

  it("should apply full profile to generated config", () => {
    const result = generateOpenClawConfig(
      makeConfig({ capabilities: "full" }),
    );
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    expect(tools.sandbox).toEqual({ enabled: true });
    expect(tools.exec).toEqual({ enabled: true });
  });

  it("should not add tools when no profile specified", () => {
    const result = generateOpenClawConfig(makeConfig());
    const defaults = result.agents.defaults as Record<string, unknown>;
    expect(defaults.tools).toBeUndefined();
  });

  it("should allow passthrough to override profile", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        capabilities: "minimal",
        openclaw: {
          agents: {
            defaults: {
              tools: {
                browser: { enabled: true, headless: true },
              },
            },
          },
        },
      }),
    );
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    // Passthrough overrides minimal profile's browser: false
    expect(tools.browser).toEqual({ enabled: true, headless: true });
    // But minimal's other settings remain
    expect(tools.web_search).toEqual({ enabled: true });
  });

  it("should preserve model config when profile is applied", () => {
    const result = generateOpenClawConfig(
      makeConfig({ capabilities: "standard" }),
    );
    expect(result.agents.defaults.model.primary).toBe("anthropic/claude-sonnet-4-5");
  });

  it("should preserve channel config when profile is applied", () => {
    const result = generateOpenClawConfig(
      makeConfig({ capabilities: "full" }),
    );
    expect(result.channels.slack).toBeDefined();
  });

  it("should work with both profile and router config", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        capabilities: "standard",
        router: { enabled: true },
      }),
    );
    expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    expect(tools.memory).toEqual({ enabled: true });
  });
});
