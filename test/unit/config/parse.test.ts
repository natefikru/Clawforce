import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseConfig } from "../../../src/config/parse.js";
import { join } from "node:path";

const fixturesDir = join(import.meta.dirname, "../../fixtures");

describe("parseConfig", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("should parse a valid config with all fields", () => {
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));

    expect(config.name).toBe("test-corp");
    expect(config.role).toBe("inbox-analyst");
    expect(config.slack.app_token).toBe("xapp-1-ABC123DEF456");
    expect(config.slack.bot_token).toBe("xoxb-123456789-ABCDEFGHIJ");
    expect(config.slack.approval_channel).toBe("C0123456789");
    expect(config.slack.allowed_channels).toEqual(["C9876543210"]);
    expect(config.models.primary).toBe("anthropic/claude-sonnet-4-5");
    expect(config.models.local).toBe("ollama/llama3.3:8b");
    expect(config.models.api_key).toBe("sk-ant-test123");
    expect(config.approval?.mode).toBe("hybrid");
    expect(config.approval?.require_approval_for).toEqual([
      "browser",
      "message.send",
    ]);
    expect(config.ollama?.enabled).toBe(true);
    expect(config.ollama?.model).toBe("llama3.3:8b");
  });

  it("should parse a minimal config", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));

    expect(config.name).toBe("minimal");
    expect(config.role).toBe("research-agent");
    expect(config.slack.allowed_channels).toEqual([]);
    expect(config.approval).toBeUndefined();
    expect(config.ollama).toBeUndefined();
  });

  it("should expand environment variables", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-expanded";
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    expect(config.models.api_key).toBe("sk-ant-expanded");
  });

  it("should throw on missing env var", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => parseConfig(join(fixturesDir, "valid-config.yaml"))).toThrow(
      "ANTHROPIC_API_KEY",
    );
  });

  it("should reject invalid role", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-role.yaml")),
    ).toThrow("Config validation failed");
  });

  it("should reject invalid channel ID", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-channel.yaml")),
    ).toThrow("Config validation failed");
  });

  it("should throw on missing config file", () => {
    expect(() => parseConfig("/nonexistent/config.yaml")).toThrow(
      "Config file not found",
    );
  });

  it("should parse Phase 1 config with router, compliance, and dashboard", () => {
    const config = parseConfig(join(fixturesDir, "full-phase1-config.yaml"));

    expect(config.router?.enabled).toBe(true);
    expect(config.router?.rules).toHaveLength(3);
    expect(config.router?.rules?.[0].condition).toBe("pii_detected");
    expect(config.router?.rules?.[0].model).toBe("ollama/llama3.3:8b");
    expect(config.router?.sensitivity_keywords).toEqual(["password", "secret"]);

    expect(config.compliance?.enabled).toBe(true);

    expect(config.dashboard?.enabled).toBe(true);
    expect(config.dashboard?.port).toBe(3001);
  });

  it("should allow config without Phase 1 fields (backward compatible)", () => {
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    expect(config.router).toBeUndefined();
    expect(config.compliance).toBeUndefined();
    expect(config.dashboard).toBeUndefined();
  });
});
