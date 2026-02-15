import { describe, it, expect } from "vitest";
import { generateCompose } from "../../../src/config/generate-compose.js";
import { parse as parseYaml } from "yaml";
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

describe("generateCompose", () => {
  it("should generate valid YAML", () => {
    const yaml = generateCompose(makeConfig());
    const parsed = parseYaml(yaml);
    expect(parsed).toBeDefined();
    expect(parsed.services).toBeDefined();
  });

  it("should have gateway service", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    const gw = parsed.services["openclaw-gateway"];
    expect(gw).toBeDefined();
    expect(gw.image).toBe("openclaw:local");
    expect(gw.container_name).toBe("clawforce-test-corp-gateway");
    expect(gw.restart).toBe("unless-stopped");
    expect(gw.init).toBe(true);
    expect(gw.command).toContain("gateway");
  });

  it("should mount correct volumes", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    const volumes = parsed.services["openclaw-gateway"].volumes;
    expect(volumes).toContain("./config:/home/node/.openclaw");
    expect(volumes).toContain("./workspace:/home/node/.openclaw/workspace");
    expect(volumes).toContain("./data:/home/node/.openclaw/data");
  });

  it("should expose port 18789", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    expect(parsed.services["openclaw-gateway"].ports).toContain("18789:18789");
  });

  it("should have correct environment variables", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    const env = parsed.services["openclaw-gateway"].environment;
    expect(env).toContain("HOME=/home/node");
    expect(env).toContain("OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}");
    expect(env).toContain("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
  });

  it("should not include ollama when disabled", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    expect(parsed.services.ollama).toBeUndefined();
    expect(parsed.volumes).toBeUndefined();
  });

  it("should include ollama when enabled", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ ollama: { enabled: true, model: "llama3.3:8b" } })),
    );
    expect(parsed.services.ollama).toBeDefined();
    expect(parsed.services.ollama.image).toBe("ollama/ollama:latest");
    expect(parsed.services.ollama.container_name).toBe("clawforce-test-corp-ollama");
  });

  it("should add ollama dependency to gateway when ollama enabled", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ ollama: { enabled: true } })),
    );
    expect(
      parsed.services["openclaw-gateway"].depends_on.ollama.condition,
    ).toBe("service_healthy");
  });

  it("should add OLLAMA_HOST env var when ollama enabled", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ ollama: { enabled: true } })),
    );
    expect(parsed.services["openclaw-gateway"].environment).toContain(
      "OLLAMA_HOST=http://ollama:11434",
    );
  });

  it("should create named volume for ollama data", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ ollama: { enabled: true } })),
    );
    expect(parsed.volumes["test-corp-ollama-data"]).toBeDefined();
  });

  it("should use deployment name in container names", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ name: "acme", ollama: { enabled: true } })),
    );
    expect(parsed.services["openclaw-gateway"].container_name).toBe(
      "clawforce-acme-gateway",
    );
    expect(parsed.services.ollama.container_name).toBe("clawforce-acme-ollama");
  });

  it("should include dashboard service when enabled", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ dashboard: { enabled: true, port: 3000 } })),
    );
    expect(parsed.services.dashboard).toBeDefined();
    expect(parsed.services.dashboard.image).toBe("clawforce-dashboard:local");
    expect(parsed.services.dashboard.container_name).toBe(
      "clawforce-test-corp-dashboard",
    );
    expect(parsed.services.dashboard.ports).toContain("3000:3000");
  });

  it("should use custom dashboard port", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ dashboard: { enabled: true, port: 3001 } })),
    );
    expect(parsed.services.dashboard.ports).toContain("3001:3000");
  });

  it("should mount data and config as read-only in dashboard", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ dashboard: { enabled: true, port: 3000 } })),
    );
    expect(parsed.services.dashboard.volumes).toContain("./data:/data:ro");
    expect(parsed.services.dashboard.volumes).toContain("./config:/config:ro");
  });

  it("should not include dashboard when not configured", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    expect(parsed.services.dashboard).toBeUndefined();
  });

  it("should not include dashboard when explicitly disabled", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ dashboard: { enabled: false, port: 3000 } })),
    );
    expect(parsed.services.dashboard).toBeUndefined();
  });
});
