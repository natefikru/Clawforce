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
    expect(gw.image).toBe("openclaw/openclaw:latest");
    expect(gw.container_name).toBe("clawforce-test-corp-gateway");
    expect(gw.user).toBe("1000:1000");
    expect(gw.restart).toBe("unless-stopped");
    expect(gw.init).toBe(true);
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

  it("should have health check", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    const hc = parsed.services["openclaw-gateway"].healthcheck;
    expect(hc.test).toContain("http://127.0.0.1:18789/health");
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
});
