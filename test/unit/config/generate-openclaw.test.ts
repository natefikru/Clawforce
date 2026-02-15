import { describe, it, expect } from "vitest";
import {
  generateOpenClawConfig,
  type OpenClawConfig,
} from "../../../src/config/generate-openclaw.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    role: "inbox-analyst",
    slack: {
      app_token: "xapp-1-TEST",
      bot_token: "xoxb-TEST",
      approval_channel: "C0123456789",
      allowed_channels: ["C9876543210"],
    },
    models: {
      primary: "anthropic/claude-sonnet-4-5",
      local: "ollama/llama3.3:8b",
    },
    ...overrides,
  };
}

describe("generateOpenClawConfig", () => {
  it("should set the primary model", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.agents.defaults.model.primary).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  it("should set local model as fallback", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.agents.defaults.model.fallbacks).toEqual([
      "ollama/llama3.3:8b",
    ]);
  });

  it("should omit fallbacks when no local model", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        models: { primary: "anthropic/claude-sonnet-4-5" },
      }),
    );
    expect(result.agents.defaults.model.fallbacks).toBeUndefined();
  });

  it("should configure Slack channels correctly", () => {
    const result = generateOpenClawConfig(makeConfig());
    const slack = result.channels.slack!;

    expect(slack.enabled).toBe(true);
    expect(slack.mode).toBe("socket");
    expect(slack.appToken).toBe("xapp-1-TEST");
    expect(slack.botToken).toBe("xoxb-TEST");
    // Approval channel should not require mention
    expect(slack.channels["C0123456789"].requireMention).toBe(false);
    // Allowed channels require mention
    expect(slack.channels["C9876543210"].requireMention).toBe(true);
  });

  it("should set workspace path", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.agents.defaults.workspace).toBe(
      "/home/node/.openclaw/workspace",
    );
  });

  it("should set session dmScope", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.session.dmScope).toBe("per-channel-peer");
  });

  it("should enable cron for inbox-analyst role", () => {
    const result = generateOpenClawConfig(makeConfig({ role: "inbox-analyst" }));
    expect(result.cron?.enabled).toBe(true);
  });

  it("should enable cron for process-automator role", () => {
    const result = generateOpenClawConfig(
      makeConfig({ role: "process-automator" }),
    );
    expect(result.cron?.enabled).toBe(true);
  });

  it("should not enable cron for research-agent role", () => {
    const result = generateOpenClawConfig(
      makeConfig({ role: "research-agent" }),
    );
    expect(result.cron?.enabled).toBeUndefined();
  });

  it("should enable hooks with command-logger", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.hooks?.enabled).toBe(true);
    expect(result.hooks?.internal?.enabled).toBe(true);
    expect(
      result.hooks?.internal?.entries?.["command-logger"].enabled,
    ).toBe(true);
  });

  it("should handle empty allowed_channels", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        slack: {
          app_token: "xapp-1-TEST",
          bot_token: "xoxb-TEST",
          approval_channel: "C0123456789",
          allowed_channels: [],
        },
      }),
    );
    const channels = result.channels.slack!.channels;
    expect(Object.keys(channels)).toHaveLength(1);
    expect(channels["C0123456789"]).toBeDefined();
  });
});
