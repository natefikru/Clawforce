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
    openclaw: {
      channels: {
        discord: {
          enabled: true,
          token: "discord-bot-token",
        },
      },
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

  it("should preserve openclaw.channels passthrough", () => {
    const result = generateOpenClawConfig(makeConfig());
    const channels = result.channels as Record<string, unknown>;
    expect(channels.discord).toEqual({
      enabled: true,
      token: "discord-bot-token",
    });
  });

  it("should set workspace path", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.agents.defaults.workspace).toBe(
      "/home/node/.openclaw/workspace",
    );
  });

  it("should set authProfile when credential mode is auth_profile", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        models: {
          primary: "anthropic/claude-sonnet-4-5",
          credential_mode: "auth_profile",
          auth_profile: "corp-prod",
        },
      }),
    );
    expect(result.agents.defaults.authProfile).toBe("corp-prod");
  });

  it("should not set authProfile when credential mode is env", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        models: {
          primary: "anthropic/claude-sonnet-4-5",
          credential_mode: "env",
          auth_profile: "corp-prod",
        },
      }),
    );
    expect(result.agents.defaults.authProfile).toBeUndefined();
  });

  it("should set session dmScope", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.session.dmScope).toBe("per-channel-peer");
  });

  it("should default gateway bind to loopback", () => {
    const result = generateOpenClawConfig(makeConfig());
    const gateway = result.gateway as Record<string, unknown>;
    expect(gateway.bind).toBe("loopback");
  });

  it("should allow explicit gateway bind override", () => {
    const result = generateOpenClawConfig(
      makeConfig({ gateway: { bind: "lan" } }),
    );
    const gateway = result.gateway as Record<string, unknown>;
    expect(gateway.bind).toBe("lan");
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

  it("should allow connector-only config through openclaw.channels", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        openclaw: {
          channels: {
            discord: {
              enabled: true,
              token: "discord-bot-token",
            },
          },
        },
      }),
    );
    const channels = result.channels as Record<string, unknown>;
    expect(channels.discord).toEqual({
      enabled: true,
      token: "discord-bot-token",
    });
  });

  it("should enable router plugin when router config present", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        router: {
          enabled: true,
          rules: [
            { condition: "pii_detected", model: "ollama/llama3.3:8b" },
          ],
          sensitivity_keywords: ["password"],
        },
      }),
    );
    expect(result.plugins?.enabled).toBe(true);
    expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
    expect(result.plugins?.entries?.["clawforce-router"].enabled).toBe(true);
    expect(result.plugins?.entries?.["clawforce-router"].config?.rules).toEqual([
      { condition: "pii_detected", model: "ollama/llama3.3:8b" },
    ]);
    expect(
      result.plugins?.entries?.["clawforce-router"].config?.sensitivityKeywords,
    ).toEqual(["password"]);
  });

  it("should set defaultModel from primary model in router config", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        router: { enabled: true },
      }),
    );
    expect(
      result.plugins?.entries?.["clawforce-router"].config?.defaultModel,
    ).toBe("anthropic/claude-sonnet-4-5");
  });

  it("should pass defaultLocalModel from models.local into router config", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        router: { enabled: true },
        models: {
          primary: "anthropic/claude-sonnet-4-5",
          local: "ollama/llama3.3:8b",
        },
      }),
    );
    expect(
      result.plugins?.entries?.["clawforce-router"].config?.defaultLocalModel,
    ).toBe("ollama/llama3.3:8b");
  });

  it("should enable compliance plugin when compliance config present", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        compliance: { enabled: true },
      }),
    );
    expect(result.plugins?.entries?.["clawforce-compliance"]).toBeDefined();
    expect(result.plugins?.entries?.["clawforce-compliance"].enabled).toBe(true);
  });

  it("should include discovered plugins section by default", () => {
    const result = generateOpenClawConfig(makeConfig());
    expect(result.plugins?.enabled).toBe(true);
    expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
    expect(result.plugins?.entries?.["clawforce-compliance"]).toBeDefined();
  });

  it("should still include router plugin when router toggle is disabled", () => {
    const result = generateOpenClawConfig(
      makeConfig({
        router: { enabled: false },
      }),
    );
    expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
    expect(result.plugins?.entries?.["clawforce-router"].enabled).toBe(true);
  });

  describe("OpenClaw passthrough", () => {
    it("should deep-merge passthrough into generated config", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            agents: {
              defaults: {
                tools: {
                  sandbox: { enabled: true },
                },
              },
            },
          },
        }),
      );
      const agents = result.agents as Record<string, unknown>;
      const defaults = agents.defaults as Record<string, unknown>;
      const tools = defaults.tools as Record<string, unknown>;
      expect(tools.sandbox).toEqual({ enabled: true });
    });

    it("should override generated values with passthrough", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            agents: {
              defaults: {
                model: {
                  primary: "openai/gpt-4o",
                },
              },
            },
          },
        }),
      );
      expect(result.agents.defaults.model.primary).toBe("openai/gpt-4o");
    });

    it("should deep-merge nested objects", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            agents: {
              defaults: {
                tools: {
                  browser: { enabled: true, headless: true },
                  memory: { enabled: true },
                },
              },
            },
          },
        }),
      );
      const defaults = result.agents.defaults as Record<string, unknown>;
      const tools = defaults.tools as Record<string, unknown>;
      expect(tools.browser).toEqual({ enabled: true, headless: true });
      expect(tools.memory).toEqual({ enabled: true });
    });

    it("should not affect config when passthrough is absent", () => {
      const result = generateOpenClawConfig(makeConfig());
      expect(result.agents.defaults.model.primary).toBe("anthropic/claude-sonnet-4-5");
    });

    it("should not break channel config with passthrough", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            channels: {
              discord: {
                enabled: true,
                token: "discord-bot-token",
              },
            },
            cron: { enabled: true, store: "sqlite" },
          },
        }),
      );
      const channels = result.channels as Record<string, unknown>;
      expect(channels.discord).toBeDefined();
      const cron = result.cron as Record<string, unknown>;
      expect(cron.enabled).toBe(true);
      expect(cron.store).toBe("sqlite");
    });

    it("should allow array values in passthrough", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            agents: {
              defaults: {
                model: {
                  fallbacks: ["openai/gpt-4o", "openai/gpt-4o-mini"],
                },
              },
            },
          },
        }),
      );
      expect(result.agents.defaults.model.fallbacks).toEqual([
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
      ]);
    });

    it("should not break plugin config with passthrough", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: { enabled: true },
          openclaw: {
            agents: {
              defaults: {
                tools: { exec: { enabled: true } },
              },
            },
          },
        }),
      );
      expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
      const defaults = result.agents.defaults as Record<string, unknown>;
      const tools = defaults.tools as Record<string, unknown>;
      expect(tools.exec).toEqual({ enabled: true });
    });

    it("should pass router priority through to plugin config", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: {
            enabled: true,
            priority: ["domain", "sensitivity", "complexity"],
          },
        }),
      );
      expect(
        result.plugins?.entries?.["clawforce-router"].config?.priority,
      ).toEqual(["domain", "sensitivity", "complexity"]);
    });

    it("should pass router budget through to plugin config", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: {
            enabled: true,
            budget: {
              daily_limit: 10,
              per_request_cap: 0.5,
              fallback_model: "ollama/llama3.3:8b",
            },
          },
        }),
      );
      const budget = result.plugins?.entries?.["clawforce-router"].config?.budget as Record<string, unknown>;
      expect(budget.dailyLimit).toBe(10);
      expect(budget.perRequestCap).toBe(0.5);
      expect(budget.fallbackModel).toBe("ollama/llama3.3:8b");
    });

    it("should pass sensitivity thresholds through to router plugin config", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: { enabled: true },
          sensitivity: {
            pii_detection: true,
            pii_confidence_threshold: 0.9,
            pii_pattern_thresholds: {
              ip_address: 0.5,
            },
          },
        }),
      );

      const pluginConfig = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
      expect(pluginConfig.piiThreshold).toBe(0.9);
      expect(pluginConfig.piiPatternThresholds).toEqual({
        ip_address: 0.5,
      });
    });

    it("should pass router health_check through to plugin config", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: {
            enabled: true,
            health_check: {
              enabled: true,
              interval_seconds: 5,
              timeout_seconds: 2,
              stale_after_seconds: 20,
              failover_policy: "failover-safe",
              failure_threshold: 4,
              recovery_threshold: 2,
              retry_attempts: 2,
              retry_delay_ms: 500,
            },
          },
        }),
      );

      const health = result.plugins?.entries?.["clawforce-router"].config
        ?.healthCheck as Record<string, unknown>;
      expect(health.enabled).toBe(true);
      expect(health.intervalSeconds).toBe(5);
      expect(health.timeoutSeconds).toBe(2);
      expect(health.staleAfterSeconds).toBe(20);
      expect(health.failoverPolicy).toBe("failover-safe");
      expect(health.failureThreshold).toBe(4);
      expect(health.recoveryThreshold).toBe(2);
      expect(health.retryAttempts).toBe(2);
      expect(health.retryDelayMs).toBe(500);
    });

    it("should include default alerts config in router plugin config when alerts are omitted", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: { enabled: true },
        }),
      );
      const alerts = result.plugins?.entries?.["clawforce-router"].config
        ?.alerts as Record<string, unknown>;
      expect(alerts.enabled).toBe(true);
      expect(alerts.types).toEqual({
        modelHealth: true,
        budgetExceeded: true,
        piiViolation: true,
        agentError: true,
        agentIdle: true,
      });
      expect(alerts.idle).toEqual({
        thresholdMinutes: 60,
        cooldownMinutes: 30,
      });
    });

    it("should pass configured alerts into router plugin config", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: { enabled: true },
          alerts: {
            enabled: true,
            types: {
              model_health: true,
              budget_exceeded: true,
              pii_violation: true,
              agent_error: false,
              agent_idle: true,
            },
            idle: {
              threshold_minutes: 45,
              cooldown_minutes: 10,
            },
            budget: {
              cooldown_minutes: 120,
              auto_block_on_exceeded: true,
            },
            notifications: {
              dashboard: true,
              email: {
                enabled: true,
                smtp_host: "smtp.example.com",
                smtp_port: 2525,
                username: "alerts@example.com",
                password: "secret",
                from: "alerts@example.com",
                to: ["ops@example.com"],
              },
            },
          },
        }),
      );

      const alerts = result.plugins?.entries?.["clawforce-router"].config
        ?.alerts as Record<string, unknown>;
      expect(alerts.enabled).toBe(true);
      expect(alerts.types).toEqual({
        modelHealth: true,
        budgetExceeded: true,
        piiViolation: true,
        agentError: false,
        agentIdle: true,
      });
      expect(alerts.idle).toEqual({
        thresholdMinutes: 45,
        cooldownMinutes: 10,
      });
      expect(alerts.budget).toEqual({
        cooldownMinutes: 120,
        autoBlockOnExceeded: true,
      });
      expect(alerts.notifications).toEqual({
        dashboard: true,
        email: {
          enabled: true,
          smtpHost: "smtp.example.com",
          smtpPort: 2525,
          username: "alerts@example.com",
          passwordEnv: "CLAWFORCE_ALERTS_EMAIL_PASSWORD",
          from: "alerts@example.com",
          to: ["ops@example.com"],
        },
      });
    });

    it("should not include unsupported notification keys", () => {
      const result = generateOpenClawConfig(
        makeConfig({
          router: { enabled: true },
          alerts: {
            enabled: true,
            notifications: {
              dashboard: true,
              email: { enabled: false, smtp_port: 587 },
            },
          } as any,
        }),
      );

      const alerts = result.plugins?.entries?.["clawforce-router"].config
        ?.alerts as Record<string, unknown>;
      const notifications = alerts.notifications as Record<string, unknown>;
      expect(notifications.unsupportedConnectorA).toBeUndefined();
      expect(notifications.unsupportedConnectorB).toBeUndefined();
      expect(notifications.webhook_url).toBeUndefined();
    });
  });
});
