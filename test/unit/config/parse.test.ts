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
    expect(config.slack?.app_token).toBe("xapp-1-ABC123DEF456");
    expect(config.slack?.bot_token).toBe("xoxb-123456789-ABCDEFGHIJ");
    expect(config.slack?.approval_channel).toBe("C0123456789");
    expect(config.slack?.allowed_channels).toEqual(["C9876543210"]);
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
    expect(config.slack?.allowed_channels).toEqual([]);
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

  it("should parse runtime config with SGLang engine", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.runtime?.engine).toBe("sglang");
    expect(config.runtime?.model).toBe("qwen3-32b");
    expect(config.runtime?.gpu).toBe("nvidia");
    expect(config.runtime?.quantization).toBe("fp16");
    expect(config.runtime?.port).toBe(30000);
  });

  it("should parse compliance_frameworks array", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.compliance_frameworks).toEqual(["hipaa", "pci-dss"]);
  });

  it("should allow config without runtime (backward compatible)", () => {
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    expect(config.runtime).toBeUndefined();
    expect(config.compliance_frameworks).toBeUndefined();
  });

  it("should reject unsupported queue failover policy", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-queue-policy.yaml")),
    ).toThrow("queue is not implemented yet");
  });

  it("should parse alert configuration when provided", () => {
    const config = parseConfig(join(fixturesDir, "full-alerts-config.yaml"));
    expect(config.alerts?.enabled).toBe(true);
    expect(config.alerts?.types.agent_error).toBe(false);
    expect(config.alerts?.idle.threshold_minutes).toBe(45);
    expect(config.alerts?.budget.auto_block_on_exceeded).toBe(true);
    expect(config.alerts?.notifications.slack.webhook_url).toBe(
      "https://hooks.slack.com/services/T000/B000/XXXX",
    );
  });

  it("should reject alert slack notification without webhook URL when enabled", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-alerts-config.yaml")),
    ).toThrow("alerts.notifications.slack.webhook_url is required");
  });

  it("should parse explicit gateway bind override", () => {
    const config = parseConfig(join(fixturesDir, "valid-gateway-bind.yaml"));
    expect(config.gateway?.bind).toBe("lan");
  });

  it("should reject invalid gateway bind value", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-gateway-bind.yaml")),
    ).toThrow("Config validation failed");
  });

  it("should reject dashboard enabled without explicit auth policy", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-dashboard-auth-policy.yaml")),
    ).toThrow("dashboard.auth must be explicitly configured");
  });

  it("should parse auth_profile credential mode when profile is provided", () => {
    const config = parseConfig(join(fixturesDir, "valid-auth-profile-config.yaml"));
    expect(config.models.credential_mode).toBe("auth_profile");
    expect(config.models.auth_profile).toBe("corp-prod");
  });

  it("should reject auth_profile credential mode without profile", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-auth-profile-config.yaml")),
    ).toThrow("models.auth_profile is required when models.credential_mode=auth_profile");
  });
});
