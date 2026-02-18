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
    expect(config.agents[0].role).toBe("inbox-analyst");
    expect(config.openclaw.default).toEqual({
      channels: {
        discord: { enabled: true },
      },
    });
    expect(config.models.cloud).toBe("anthropic/claude-sonnet-4-5");
    expect(config.models.local).toBe("ollama/llama3.3:8b");
    expect(config.models.provider_keys?.anthropic).toBe("sk-ant-test123");
    expect(config.approval?.mode).toBe("hybrid");
    expect(config.approval?.require_approval_for).toEqual([
      "browser",
      "message.send",
    ]);
    expect(config.local_model?.engine).toBe("ollama");
    expect(config.local_model?.location).toBe("container");
    expect(config.local_model?.model).toBe("llama3.3:8b");
  });

  it("should parse a minimal config", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));

    expect(config.name).toBe("minimal");
    expect(config.agents[0].role).toBe("research-agent");
    expect(config.openclaw.default).toEqual({
      channels: {
        discord: { enabled: true },
      },
    });
    expect(config.approval).toBeUndefined();
    expect(config.local_model).toBeUndefined();
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
    expect(config.models.provider_keys?.anthropic).toBe("sk-ant-expanded");
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

  it("should reject supervisor agent without supervises list", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-single-agent-supervisor.yaml")),
    ).toThrow("must define a non-empty supervises list");
  });

  it("should parse a config with supervisor agent that has supervises list", () => {
    const config = parseConfig(join(fixturesDir, "valid-default-role-supervisor.yaml"));
    const supervisor = config.agents.find((a) => a.role === "supervisor");
    expect(supervisor).toBeDefined();
    expect(supervisor?.supervises).toEqual(["worker"]);
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

  it("should parse Phase 1 config with routing, compliance, and dashboard", () => {
    const config = parseConfig(join(fixturesDir, "full-phase1-config.yaml"));

    expect(config.routing?.rules).toHaveLength(3);
    expect(config.routing?.rules?.[0].condition).toBe("pii_detected");
    expect(config.routing?.rules?.[0].model).toBe("ollama/llama3.3:8b");
    expect(config.routing?.sensitivity?.keywords).toEqual(["password", "secret"]);

    expect(config.compliance?.enabled).toBe(true);

    expect(config.dashboard?.enabled).toBe(true);
    expect(config.dashboard?.port).toBe(3001);
  });

  it("should allow config without Phase 1 fields", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
    expect(config.routing).toBeUndefined();
    expect(config.compliance).toBeUndefined();
    expect(config.dashboard).toBeUndefined();
  });

  it("should parse local_model config with SGLang engine", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.local_model?.engine).toBe("sglang");
    expect(config.local_model?.location).toBe("container");
    expect(config.local_model?.model).toBe("qwen3-32b");
    expect(config.local_model?.gpu).toBe("nvidia");
    expect(config.local_model?.quantization).toBe("fp16");
    expect(config.local_model?.port).toBe(30000);
  });

  it("should parse local_model host mode for ollama", () => {
    const config = parseConfig(join(fixturesDir, "runtime-host-ollama.yaml"));
    expect(config.local_model?.engine).toBe("ollama");
    expect(config.local_model?.location).toBe("host");
    expect(config.local_model?.host_url).toBe("http://host.docker.internal:11434");
  });

  it("should parse compliance.frameworks array", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.compliance?.frameworks).toEqual(["hipaa", "pci-dss"]);
  });

  it("should parse sensitivity threshold configuration", () => {
    const config = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    expect(config.routing?.sensitivity?.pii_detection).toBe(true);
    expect(config.routing?.sensitivity?.pii_confidence_threshold).toBe(0.8);
    expect(config.routing?.sensitivity?.pii_pattern_thresholds).toEqual({
      ip_address: 0.5,
    });
  });

  it("should carry parsed sensitivity thresholds into generated router config", () => {
    const parsed = parseConfig(join(fixturesDir, "full-5d-config.yaml"));
    const generated = generateOpenClawConfig(parsed);
    const defaultInstance = generated.get("default")!;
    const routerConfig = defaultInstance.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;

    expect(routerConfig.piiThreshold).toBe(0.8);
    expect(routerConfig.piiPatternThresholds).toEqual({
      ip_address: 0.5,
    });
  });

  it("should allow config without local_model", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
    expect(config.local_model).toBeUndefined();
    expect(config.compliance?.frameworks).toBeUndefined();
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
    expect(config.models.credential_mode).toBe("auth_profile");
    expect(config.models.auth_profile).toBe("corp-prod");
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
    expect(config.models.credential_mode).toBe("env");
    expect(config.models.provider_keys).toBeUndefined();
    expect(config.models.cloud).toBe("ollama/llama3.3:8b");
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
    expect(config.agents).toHaveLength(2);
    expect(config.agents[0].name).toBe("inbox-analyst");
    expect(config.agents[0].role).toBe("inbox-analyst");
    expect(config.agents[0].routing?.budget?.daily_limit).toBe(5.0);
    expect(config.agents[1].name).toBe("research-agent");
    expect(config.agents[1].routing?.rules).toHaveLength(1);
    expect(config.models.cloud).toBe("anthropic/claude-sonnet-4-5");
    expect(config.models.local).toBe("ollama/llama3.3:8b");
  });

  it("should parse a multi-agent config with supervisor references", () => {
    const config = parseConfig(join(fixturesDir, "multi-agent-supervisor.yaml"));

    expect(config.agents).toHaveLength(3);
    const ultron = config.agents.find((a) => a.name === "ultron");
    expect(ultron?.role).toBe("supervisor");
    expect(ultron?.supervises).toEqual(["inbox-analyst", "research-agent"]);
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

  it("should reject multi-agent config without models.cloud", () => {
    expect(() =>
      parseConfig(join(fixturesDir, "invalid-multi-agent-no-defaults.yaml")),
    ).toThrow("Config validation failed");
  });

  it("should parse single-agent configs with agents array", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
    expect(config.agents[0].role).toBe("research-agent");
    expect(config.models.cloud).toBe("anthropic/claude-sonnet-4-5");
  });
});
