import { describe, it, expect } from "vitest";
import { ClawforceConfigSchema, resolveAgentOpenclawInstance } from "../../../src/config/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const fixturesDir = join(import.meta.dirname, "../../fixtures/v2");

function loadFixture(name: string): unknown {
  const raw = readFileSync(join(fixturesDir, name), "utf8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  // Expand env vars inline for testing
  return JSON.parse(
    JSON.stringify(parsed).replace(/\$\{ANTHROPIC_API_KEY\}/g, "sk-ant-test123"),
  );
}

describe("ClawforceConfigSchema (v2)", () => {
  describe("valid configs", () => {
    it("should parse a minimal config", () => {
      const result = ClawforceConfigSchema.safeParse(loadFixture("minimal-config.yaml"));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.name).toBe("minimal");
      expect(result.data.models.cloud).toBe("anthropic/claude-sonnet-4-5");
      expect(result.data.agents).toHaveLength(1);
      expect(result.data.agents[0].name).toBe("my-agent");
      expect(result.data.agents[0].role).toBe("research-agent");
      expect(result.data.openclaw).toHaveProperty("default");
    });

    it("should parse a multi-agent config with supervisor", () => {
      const result = ClawforceConfigSchema.safeParse(loadFixture("multi-agent-supervisor.yaml"));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.agents).toHaveLength(3);
      const ultron = result.data.agents.find((a) => a.name === "ultron");
      expect(ultron?.role).toBe("supervisor");
      expect(ultron?.supervises).toEqual(["inbox-analyst", "research-agent"]);
      expect(ultron?.openclaw).toBe("support-instance");
    });

    it("should parse full routing config", () => {
      const result = ClawforceConfigSchema.safeParse(loadFixture("full-routing-config.yaml"));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.routing?.rules).toHaveLength(5);
      expect(result.data.routing?.priority).toEqual(["policy", "sensitivity", "cost", "domain", "complexity"]);
      expect(result.data.routing?.budget?.daily_limit).toBe(10.0);
      expect(result.data.routing?.sensitivity?.keywords).toEqual(["password", "secret"]);
      expect(result.data.routing?.sensitivity?.pii_confidence_threshold).toBe(0.8);
      expect(result.data.routing?.policy?.default_tier).toBe("internal");
      expect(result.data.routing?.health_check?.failover_policy).toBe("failover-safe");
    });

    it("should parse local_model config", () => {
      const result = ClawforceConfigSchema.safeParse(loadFixture("full-routing-config.yaml"));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.local_model?.engine).toBe("sglang");
      expect(result.data.local_model?.model).toBe("qwen3-32b");
      expect(result.data.local_model?.gpu).toBe("nvidia");
      expect(result.data.local_model?.quantization).toBe("fp16");
    });

    it("should parse compliance with frameworks", () => {
      const result = ClawforceConfigSchema.safeParse(loadFixture("full-routing-config.yaml"));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.compliance?.frameworks).toEqual(["hipaa", "pci-dss"]);
    });

    it("should allow single openclaw instance without agent openclaw reference", () => {
      const result = ClawforceConfigSchema.safeParse(loadFixture("minimal-config.yaml"));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.agents[0].openclaw).toBeUndefined();
    });
  });

  describe("validation errors", () => {
    it("should reject empty openclaw", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", provider_keys: { anthropic: "key" } },
        agents: [{ name: "a", role: "inbox-analyst" }],
        openclaw: {},
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("at least one named instance"))).toBe(true);
    });

    it("should reject missing agent openclaw ref when multiple instances exist", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", provider_keys: { anthropic: "key" } },
        agents: [{ name: "a", role: "inbox-analyst" }],
        openclaw: { one: { channels: {} }, two: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("must specify 'openclaw'"))).toBe(true);
    });

    it("should reject invalid openclaw instance reference", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", provider_keys: { anthropic: "key" } },
        agents: [{ name: "a", role: "inbox-analyst", openclaw: "nonexistent" }],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("no instance with that name exists"))).toBe(true);
    });

    it("should reject duplicate agent names", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", provider_keys: { anthropic: "key" } },
        agents: [
          { name: "dup", role: "inbox-analyst" },
          { name: "dup", role: "research-agent" },
        ],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("Duplicate agent name"))).toBe(true);
    });

    it("should reject supervisor without supervises", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", provider_keys: { anthropic: "key" } },
        agents: [{ name: "sup", role: "supervisor" }],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("non-empty supervises list"))).toBe(true);
    });

    it("should reject self-supervision", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", provider_keys: { anthropic: "key" } },
        agents: [{ name: "sup", role: "supervisor", supervises: ["sup"] }],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("cannot supervise itself"))).toBe(true);
    });

    it("should reject missing provider key for cloud model", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5" },
        agents: [{ name: "a", role: "inbox-analyst" }],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("provider_keys.anthropic is required"))).toBe(true);
    });

    it("should reject auth_profile mode without profile name", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "anthropic/claude-sonnet-4-5", credential_mode: "auth_profile" },
        agents: [{ name: "a", role: "inbox-analyst" }],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.errors.some((e) => e.message.includes("auth_profile is required"))).toBe(true);
    });

    it("should allow local-only model without provider keys", () => {
      const result = ClawforceConfigSchema.safeParse({
        name: "test",
        models: { cloud: "ollama/llama3.3:8b" },
        agents: [{ name: "a", role: "inbox-analyst" }],
        openclaw: { default: { channels: {} } },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("resolveAgentOpenclawInstance", () => {
    it("should return the only instance when agent has no explicit reference", () => {
      const config = ClawforceConfigSchema.parse({
        name: "test",
        models: { cloud: "ollama/llama3.3:8b" },
        agents: [{ name: "a", role: "inbox-analyst" }],
        openclaw: { default: { channels: {} } },
      });
      expect(resolveAgentOpenclawInstance(config.agents[0], config)).toBe("default");
    });

    it("should return the explicit reference when specified", () => {
      const config = ClawforceConfigSchema.parse({
        name: "test",
        models: { cloud: "ollama/llama3.3:8b" },
        agents: [{ name: "a", role: "inbox-analyst", openclaw: "my-instance" }],
        openclaw: { "my-instance": { channels: {} } },
      });
      expect(resolveAgentOpenclawInstance(config.agents[0], config)).toBe("my-instance");
    });
  });
});
