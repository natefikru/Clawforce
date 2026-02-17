import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseConfig } from "../../../src/config/parse.js";
import { generateOpenClawConfig } from "../../../src/config/generate-openclaw.js";
import { resolveAgentRuntime } from "../../../src/config/types.js";
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
    expect(config.openclaw?.channels).toEqual({
      discord: { enabled: true },
    });
    expect(config.models!.primary).toBe("anthropic/claude-sonnet-4-5");
    expect(config.models!.local).toBe("ollama/llama3.3:8b");
    expect(config.models!.provider_keys?.anthropic).toBe("sk-ant-test123");
    expect(config.approval?.mode).toBe("hybrid");
    expect(config.approval?.require_approval_for).toEqual([
      "browser",
      "message.send",
    ]);
    expect(config.runtime?.engine).toBe("ollama");
    expect(config.runtime?.location).toBe("container");
    expect(config.runtime?.model).toBe("llama3.3:8b");
  });

  it("should parse a minimal config", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));

    expect(config.name).toBe("minimal");
    expect(config.role).toBe("research-agent");
    expect(config.openclaw?.channels).toEqual({
      discord: { enabled: true },
    });
    expect(config.approval).toBeUndefined();
    expect(config.runtime).toBeUndefined();
  });

  it("should parse deployment.agent_runtime when explicitly configured", () => {
    const config = parseConfig(join(fixturesDir, "valid-deployment-agent-runtime.yaml"));
    expect(config.deployment?.agent_runtime).toBe("openclaw");
    expect(resolveAgentRuntime(config)).toBe("openclaw");
  });

  it("should default deployment.agent_runtime to openclaw when omitted", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
    expect(config.deployment).toBeUndefined();
    expect(resolveAgentRuntime(config)).toBe("openclaw");
  });

  it("should default deployment.agent_runtime to openclaw when deployment is empty", () => {
    const config = parseConfig(join(fixturesDir, "valid-deployment-empty.yaml"));
    expect(config.deployment?.agent_runtime).toBe("openclaw");
    expect(resolveAgentRuntime(config)).toBe("openclaw");
  });

  it("should reject unsupported deployment.agent_runtime values", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-deployment-agent-runtime.yaml")),
    ).toThrow("Config validation failed");
  });

  it("should expand environment variables", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-expanded";
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    expect(config.models!.provider_keys?.anthropic).toBe("sk-ant-expanded");
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

  it("should reject supervisor role in single-agent mode", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-single-agent-supervisor.yaml")),
    ).toThrow("role=supervisor is only supported in multi-agent mode");
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

  it("should allow config without Phase 1 fields", () => {
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    expect(config.router).toBeUndefined();
    expect(config.compliance).toBeUndefined();
    expect(config.dashboard).toBeUndefined();
  });

  it("should parse runtime config with SGLang engine", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.runtime?.engine).toBe("sglang");
    expect(config.runtime?.location).toBe("container");
    expect(config.runtime?.model).toBe("qwen3-32b");
    expect(config.runtime?.gpu).toBe("nvidia");
    expect(config.runtime?.quantization).toBe("fp16");
    expect(config.runtime?.port).toBe(30000);
  });

  it("should parse runtime host mode for ollama", () => {
    const config = parseConfig(join(fixturesDir, "runtime-host-ollama.yaml"));
    expect(config.runtime?.engine).toBe("ollama");
    expect(config.runtime?.location).toBe("host");
    expect(config.runtime?.host_url).toBe("http://host.docker.internal:11434");
  });

  it("should parse compliance_frameworks array", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.compliance_frameworks).toEqual(["hipaa", "pci-dss"]);
  });

  it("should parse sensitivity threshold configuration", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.sensitivity?.pii_detection).toBe(true);
    expect(config.sensitivity?.pii_confidence_threshold).toBe(0.8);
    expect(config.sensitivity?.pii_pattern_thresholds).toEqual({
      ip_address: 0.5,
    });
  });

  it("should carry parsed sensitivity thresholds into generated router config", () => {
    const parsed = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    const generated = generateOpenClawConfig(parsed);
    const routerConfig = generated.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;

    expect(routerConfig.piiThreshold).toBe(0.8);
    expect(routerConfig.piiPatternThresholds).toEqual({
      ip_address: 0.5,
    });
  });

  it("should allow config without runtime", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
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
    expect(config.alerts?.notifications.email.smtp_host).toBe("smtp.example.com");
  });

  it("should reject alerts config with invalid email notification configuration", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-alerts-config.yaml")),
    ).toThrow("alerts.notifications.email.smtp_host is required");
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
    expect(config.models!.credential_mode).toBe("auth_profile");
    expect(config.models!.auth_profile).toBe("corp-prod");
  });

  it("should reject auth_profile credential mode without profile", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-auth-profile-config.yaml")),
    ).toThrow("models.auth_profile is required when models.credential_mode=auth_profile");
  });

  it("should reject env credential mode without provider key for cloud models", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-env-cloud-without-api-key.yaml")),
    ).toThrow("models.provider_keys.anthropic is required when models.credential_mode=env");
  });

  it("should allow env credential mode without provider key for local models", () => {
    const config = parseConfig(join(fixturesDir, "valid-env-local-without-api-key.yaml"));
    expect(config.models!.credential_mode).toBe("env");
    expect(config.models!.provider_keys).toBeUndefined();
    expect(config.models!.primary).toBe("ollama/llama3.3:8b");
  });
});

describe("parseConfig — multi-agent", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("should parse a multi-agent config with 2 agents", () => {
    const config = parseConfig(join(fixturesDir, "multi-agent-basic.yaml"));

    expect(config.name).toBe("test-workforce");
    expect(config.role).toBeUndefined();
    expect(config.models).toBeUndefined();
    expect(config.agents).toHaveLength(2);
    expect(config.agents![0].name).toBe("inbox-analyst");
    expect(config.agents![0].role).toBe("inbox-analyst");
    expect(config.agents![0].routing?.budget_daily).toBe(5.0);
    expect(config.agents![1].name).toBe("research-agent");
    expect(config.agents![1].routing?.rules).toHaveLength(1);
    expect(config.defaults?.models.cloud).toBe("anthropic/claude-sonnet-4-5");
    expect(config.defaults?.models.local).toBe("ollama/llama3.3:8b");
  });

  it("should parse a multi-agent config with supervisor references", () => {
    const config = parseConfig(join(fixturesDir, "multi-agent-supervisor.yaml"));

    expect(config.agents).toHaveLength(3);
    const ultron = config.agents!.find((a) => a.name === "ultron");
    expect(ultron?.role).toBe("supervisor");
    expect(ultron?.supervises).toEqual(["inbox-analyst", "research-agent"]);
  });

  it("should reject config with both role and agents", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-multi-agent-both-role-and-agents.yaml")),
    ).toThrow("EITHER 'role' (single-agent) OR 'agents' (multi-agent)");
  });

  it("should reject config with duplicate agent names", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-multi-agent-duplicate-names.yaml")),
    ).toThrow("Duplicate agent name");
  });

  it("should reject config with invalid supervisor references", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-multi-agent-bad-supervisor-ref.yaml")),
    ).toThrow("supervises 'nonexistent-agent', but no agent with that name exists");
  });

  it("should reject supervisor agents without supervises", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-multi-agent-supervisor-no-supervises.yaml")),
    ).toThrow("must define a non-empty supervises list");
  });

  it("should reject multi-agent config without defaults.models.cloud", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-multi-agent-no-defaults.yaml")),
    ).toThrow("defaults.models.cloud is required");
  });

  it("should preserve backward compatibility with single-agent configs", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
    expect(config.role).toBe("research-agent");
    expect(config.models!.primary).toBe("anthropic/claude-sonnet-4-5");
    expect(config.agents).toBeUndefined();
    expect(config.defaults).toBeUndefined();
  });
});
