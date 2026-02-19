import { describe, it, expect } from "vitest";
import { resolveProfile } from "../../../src/config/capability-profiles.js";
import { generateOpenClawConfig } from "../../../src/config/generate-openclaw.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw" }],
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
    const results = generateOpenClawConfig(
      makeConfig({ capabilities: "minimal" }),
    );
    const result = results.get("default")!;
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    expect(tools.web_search).toEqual({ enabled: true });
    expect(tools.browser).toEqual({ enabled: false });
  });

  it("should apply full profile to generated config", () => {
    const results = generateOpenClawConfig(
      makeConfig({ capabilities: "full" }),
    );
    const result = results.get("default")!;
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    expect(tools.sandbox).toEqual({ enabled: true });
    expect(tools.exec).toEqual({ enabled: true });
  });

  it("should not add tools when no profile specified", () => {
    const results = generateOpenClawConfig(makeConfig());
    const result = results.get("default")!;
    const defaults = result.agents.defaults as Record<string, unknown>;
    expect(defaults.tools).toBeUndefined();
  });

  it("should allow passthrough to override profile", () => {
    const results = generateOpenClawConfig(
      makeConfig({
        capabilities: "minimal",
        openclaw: {
          default: {
            agents: {
              defaults: {
                tools: {
                  browser: { enabled: true, headless: true },
                },
              },
            },
          },
        },
      }),
    );
    const result = results.get("default")!;
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    // Passthrough overrides minimal profile's browser: false
    expect(tools.browser).toEqual({ enabled: true, headless: true });
    // But minimal's other settings remain
    expect(tools.web_search).toEqual({ enabled: true });
  });

  it("should not set model in defaults when no models configured", () => {
    const results = generateOpenClawConfig(
      makeConfig({ capabilities: "standard" }),
    );
    const result = results.get("default")!;
    expect(result.agents.defaults.model).toBeUndefined();
  });

  it("should preserve channel config when profile is applied", () => {
    const results = generateOpenClawConfig(
      makeConfig({ capabilities: "full" }),
    );
    const result = results.get("default")!;
    expect((result.channels as Record<string, unknown>).discord).toBeDefined();
  });

  it("should work with both profile and routing config", () => {
    const results = generateOpenClawConfig(
      makeConfig({
        capabilities: "standard",
        routing: {},
      }),
    );
    const result = results.get("default")!;
    expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
    const defaults = result.agents.defaults as Record<string, unknown>;
    const tools = defaults.tools as Record<string, unknown>;
    expect(tools.memory).toEqual({ enabled: true });
  });
});
