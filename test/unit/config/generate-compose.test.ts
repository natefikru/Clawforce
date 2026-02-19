import { describe, it, expect } from "vitest";
import { generateCompose } from "../../../src/config/generate-compose.js";
import { parse as parseYaml } from "yaml";
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
    models: [
      { name: "claude", id: "anthropic/claude-sonnet-4-5", type: "cloud", api_key: "sk-ant-test123" },
    ],
    ...overrides,
  };
}

describe("generateCompose", () => {
  it("should reject unsupported runtime engines", () => {
    expect(() =>
      generateCompose(
        makeConfig({
          models: [
            { name: "custom", id: "custom-engine/model", type: "local", engine: { runtime: "custom-engine", location: "container", model: "custom/model", port: 9999 } },
          ],
        }),
      ),
    ).toThrow('Unsupported runtime engine "custom-engine"');
  });

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

  it("should mount per-agent workspace volumes", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    const volumes = parsed.services["openclaw-gateway"].volumes;
    expect(volumes).toContain(
      "./workspaces/test-agent:/home/node/.openclaw/workspace/test-agent",
    );
  });

  it("should mount multiple agent workspace volumes", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          agents: [
            { name: "inbox-bot", workspace: "/abs/path/inbox-bot", runtime: "openclaw" },
            { name: "research-bot", workspace: "/abs/path/research-bot", runtime: "openclaw" },
          ],
        }),
      ),
    );
    const volumes = parsed.services["openclaw-gateway"].volumes;
    expect(volumes).toContain(
      "/abs/path/inbox-bot:/home/node/.openclaw/workspace/inbox-bot",
    );
    expect(volumes).toContain(
      "/abs/path/research-bot:/home/node/.openclaw/workspace/research-bot",
    );
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
    expect(env).toContain("OPENCLAW_GATEWAY_BIND=loopback");
    expect(env).toContain("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
  });

  it("should pass alert secret env vars to gateway when configured", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          alerts: {
            enabled: true,
            types: {
              model_health: true,
              budget_exceeded: true,
              pii_violation: true,
              agent_error: true,
              agent_idle: true,
            },
            idle: {
              threshold_minutes: 60,
              cooldown_minutes: 30,
            },
            budget: {
              cooldown_minutes: 60,
              auto_block_on_exceeded: false,
            },
            notifications: {
              dashboard: true,
              email: {
                enabled: true,
                smtp_host: "smtp.example.com",
                smtp_port: 587,
                username: "alerts@example.com",
                password: "super-secret",
                from: "alerts@example.com",
                to: ["ops@example.com"],
              },
            },
          },
        }),
      ),
    );
    const env = parsed.services["openclaw-gateway"].environment;
    expect(env).toContain(
      "CLAWFORCE_ALERTS_EMAIL_PASSWORD=${CLAWFORCE_ALERTS_EMAIL_PASSWORD}",
    );
  });

  it("should omit provider API key in auth_profile credential mode", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          auth_profile: "corp-prod",
          models: undefined,
        }),
      ),
    );
    const env = parsed.services["openclaw-gateway"].environment;
    expect(env).not.toContain("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
    expect(env).toContain("OPENCLAW_AUTH_PROFILE=${OPENCLAW_AUTH_PROFILE}");
  });

  it("should default gateway bind to loopback", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    const cmd = parsed.services["openclaw-gateway"].command;
    const bindIdx = cmd.indexOf("--bind");
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(cmd[bindIdx + 1]).toBe("loopback");
  });

  it("should allow explicit lan gateway bind override", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ gateway: { bind: "lan", port: 18789 } })),
    );
    const env = parsed.services["openclaw-gateway"].environment;
    const cmd = parsed.services["openclaw-gateway"].command;
    const bindIdx = cmd.indexOf("--bind");
    expect(env).toContain("OPENCLAW_GATEWAY_BIND=lan");
    expect(cmd[bindIdx + 1]).toBe("lan");
  });

  it("should not include ollama when disabled", () => {
    const parsed = parseYaml(generateCompose(makeConfig()));
    expect(parsed.services.ollama).toBeUndefined();
    expect(parsed.volumes).toBeUndefined();
  });

  it("should include ollama when enabled", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          models: [
            { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
          ],
        }),
      ),
    );
    expect(parsed.services.ollama).toBeDefined();
    expect(parsed.services.ollama.image).toBe("ollama/ollama:latest");
    expect(parsed.services.ollama.container_name).toBe("clawforce-test-corp-ollama");
  });

  it("should add ollama dependency to gateway when ollama enabled", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          models: [
            { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
          ],
        }),
      ),
    );
    expect(
      parsed.services["openclaw-gateway"].depends_on.ollama.condition,
    ).toBe("service_healthy");
  });

  it("should add OLLAMA_HOST env var when ollama enabled", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          models: [
            { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
          ],
        }),
      ),
    );
    expect(parsed.services["openclaw-gateway"].environment).toContain(
      "OLLAMA_HOST=http://ollama:11434",
    );
  });

  it("should create named volume for ollama data", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          models: [
            { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
          ],
        }),
      ),
    );
    expect(parsed.volumes["test-corp-ollama-data"]).toBeDefined();
  });

  it("should use deployment name in container names", () => {
    const parsed = parseYaml(
      generateCompose(
        makeConfig({
          name: "acme",
          models: [
            { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
          ],
        }),
      ),
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

  it("should configure dashboard with gateway URL and token", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ dashboard: { enabled: true, port: 3000 } })),
    );
    const env = parsed.services.dashboard.environment;
    expect(env).toContain("OPENCLAW_GATEWAY_URL=ws://openclaw-gateway:18789");
    expect(env).toContain("OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}");
  });

  it("should have dashboard depend on gateway", () => {
    const parsed = parseYaml(
      generateCompose(makeConfig({ dashboard: { enabled: true, port: 3000 } })),
    );
    expect(
      parsed.services.dashboard.depends_on["openclaw-gateway"].condition,
    ).toBe("service_started");
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

  describe("GPU passthrough", () => {
    it("should add nvidia GPU config to ollama service", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", gpu: "nvidia", port: 11434 } },
            ],
          }),
        ),
      );
      const deploy = parsed.services.ollama.deploy;
      expect(deploy).toBeDefined();
      expect(deploy.resources.reservations.devices).toHaveLength(1);
      expect(deploy.resources.reservations.devices[0].driver).toBe("nvidia");
      expect(deploy.resources.reservations.devices[0].count).toBe("all");
      expect(deploy.resources.reservations.devices[0].capabilities).toContain("gpu");
    });

    it("should add AMD device mappings to ollama service", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", gpu: "amd", port: 11434 } },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama.devices).toContain("/dev/kfd");
      expect(parsed.services.ollama.devices).toContain("/dev/dri");
    });

    it("should not add GPU config when gpu is none", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", gpu: "none", port: 11434 } },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama.deploy).toBeUndefined();
      expect(parsed.services.ollama.devices).toBeUndefined();
    });

    it("should not add GPU config when gpu is not specified", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama.deploy).toBeUndefined();
      expect(parsed.services.ollama.devices).toBeUndefined();
    });

    it("should not add nvidia deploy field to non-GPU ollama", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama.deploy).toBeUndefined();
    });

    it("should not have GPU config when ollama is disabled", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig()),
      );
      expect(parsed.services.ollama).toBeUndefined();
    });

    it("should combine nvidia GPU with other ollama settings", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", gpu: "nvidia", port: 11434 } },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama.deploy).toBeDefined();
      expect(parsed.services.ollama.healthcheck).toBeDefined();
      expect(parsed.services.ollama.container_name).toBe("clawforce-test-corp-ollama");
    });

    it("should combine AMD GPU with other ollama settings", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              { name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", gpu: "amd", port: 11434 } },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama.devices).toContain("/dev/kfd");
      expect(parsed.services.ollama.healthcheck).toBeDefined();
    });
  });

  describe("local_model: SGLang", () => {
    it("should generate sglang service with correct image", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "sglang/qwen3-32b", type: "local", engine: { runtime: "sglang", location: "container", model: "qwen3-32b", port: 30000 } }] })),
      );
      expect(parsed.services.sglang).toBeDefined();
      expect(parsed.services.sglang.image).toBe("lmsysorg/sglang:latest");
    });

    it("should set correct sglang command", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "sglang/qwen3-32b", type: "local", engine: { runtime: "sglang", location: "container", model: "qwen3-32b", port: 30000 } }] })),
      );
      const cmd = parsed.services.sglang.command;
      expect(cmd).toContain("--model-path");
      expect(cmd).toContain("qwen3-32b");
      expect(cmd).toContain("--port");
      expect(cmd).toContain("30000");
    });

    it("should include quantization flag when specified", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "sglang/qwen3-32b", type: "local", engine: { runtime: "sglang", location: "container", model: "qwen3-32b", quantization: "fp16", port: 30000 } }] })),
      );
      const cmd = parsed.services.sglang.command;
      expect(cmd).toContain("--quantization");
      expect(cmd).toContain("fp16");
    });

    it("should map port correctly", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "sglang/qwen3-32b", type: "local", engine: { runtime: "sglang", location: "container", model: "qwen3-32b", port: 31000 } }] })),
      );
      expect(parsed.services.sglang.ports).toContain("31000:31000");
    });

    it("should add nvidia GPU config", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "sglang/qwen3-32b", type: "local", engine: { runtime: "sglang", location: "container", model: "qwen3-32b", gpu: "nvidia", port: 30000 } }] })),
      );
      expect(parsed.services.sglang.deploy.resources.reservations.devices[0].driver).toBe("nvidia");
    });

    it("should set SGLANG_HOST env var on gateway", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "sglang/qwen3-32b", type: "local", engine: { runtime: "sglang", location: "container", model: "qwen3-32b", port: 30000 } }] })),
      );
      expect(parsed.services["openclaw-gateway"].environment).toContain("SGLANG_HOST=http://sglang:30000");
    });

    it("should support host runtime mode without creating sglang service", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              {
                name: "qwen",
                id: "sglang/qwen3-32b",
                type: "local",
                engine: {
                  runtime: "sglang",
                  location: "host",
                  host_url: "http://host.docker.internal:30000",
                  model: "qwen3-32b",
                  port: 30000,
                },
              },
            ],
          }),
        ),
      );
      expect(parsed.services.sglang).toBeUndefined();
      expect(parsed.services["openclaw-gateway"].depends_on).toBeUndefined();
      expect(parsed.services["openclaw-gateway"].environment).toContain(
        "SGLANG_HOST=http://host.docker.internal:30000",
      );
    });
  });

  describe("local_model: vLLM", () => {
    it("should generate vllm service with correct image", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "vllm/qwen3-32b", type: "local", engine: { runtime: "vllm", location: "container", model: "qwen3-32b", port: 8000 } }] })),
      );
      expect(parsed.services.vllm).toBeDefined();
      expect(parsed.services.vllm.image).toBe("vllm/vllm-openai:latest");
    });

    it("should set correct vllm command", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "vllm/qwen3-32b", type: "local", engine: { runtime: "vllm", location: "container", model: "qwen3-32b", port: 8000 } }] })),
      );
      const cmd = parsed.services.vllm.command;
      expect(cmd).toContain("--model");
      expect(cmd).toContain("qwen3-32b");
      expect(cmd).toContain("--port");
      expect(cmd).toContain("8000");
    });

    it("should set VLLM_HOST env var on gateway", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "qwen", id: "vllm/qwen3-32b", type: "local", engine: { runtime: "vllm", location: "container", model: "qwen3-32b", port: 8000 } }] })),
      );
      expect(parsed.services["openclaw-gateway"].environment).toContain("VLLM_HOST=http://vllm:8000");
    });

    it("should support host runtime mode without creating vllm service", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              {
                name: "qwen",
                id: "vllm/qwen3-32b",
                type: "local",
                engine: {
                  runtime: "vllm",
                  location: "host",
                  host_url: "http://host.docker.internal:8000",
                  model: "qwen3-32b",
                  port: 8000,
                },
              },
            ],
          }),
        ),
      );
      expect(parsed.services.vllm).toBeUndefined();
      expect(parsed.services["openclaw-gateway"].depends_on).toBeUndefined();
      expect(parsed.services["openclaw-gateway"].environment).toContain(
        "VLLM_HOST=http://host.docker.internal:8000",
      );
    });
  });

  describe("local_model: ollama (via models array)", () => {
    it("should fall back to ollama service when engine is ollama", () => {
      const parsed = parseYaml(
        generateCompose(makeConfig({ models: [{ name: "llama", id: "ollama/llama3.3:8b", type: "local", engine: { runtime: "ollama", location: "container", model: "llama3.3:8b", port: 11434 } }] })),
      );
      expect(parsed.services.ollama).toBeDefined();
      expect(parsed.services.ollama.image).toBe("ollama/ollama:latest");
    });

    it("should support host runtime mode without creating ollama service", () => {
      const parsed = parseYaml(
        generateCompose(
          makeConfig({
            models: [
              {
                name: "llama",
                id: "ollama/llama3.3:8b",
                type: "local",
                engine: {
                  runtime: "ollama",
                  location: "host",
                  host_url: "http://host.docker.internal:11434",
                  model: "llama3.3:8b",
                  port: 11434,
                },
              },
            ],
          }),
        ),
      );
      expect(parsed.services.ollama).toBeUndefined();
      expect(parsed.services["openclaw-gateway"].depends_on).toBeUndefined();
      expect(parsed.services["openclaw-gateway"].environment).toContain(
        "OLLAMA_HOST=http://host.docker.internal:11434",
      );
      expect(parsed.services["openclaw-gateway"].extra_hosts).toContain(
        "host.docker.internal:host-gateway",
      );
    });
  });
});
