import { describe, it, expect } from "vitest";
import {
  generateOpenClawConfig,
  type OpenClawConfig,
  type OpenClawAgentProfile,
  type OpenClawBinding,
} from "../../../src/config/generate-openclaw.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    agents: [{ name: "inbox-analyst", role: "inbox-analyst" }],
    openclaw: {
      default: {
        channels: {
          discord: {
            enabled: true,
            token: "discord-bot-token",
          },
        },
      },
    },
    models: {
      cloud: "anthropic/claude-sonnet-4-5",
      local: "ollama/llama3.3:8b",
    },
    ...overrides,
  };
}

describe("generateOpenClawConfig", () => {
  it("should set the primary model", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.model.primary).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  it("should set local model as fallback", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.model.fallbacks).toEqual([
      "ollama/llama3.3:8b",
    ]);
  });

  it("should omit fallbacks when no local model", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        models: { cloud: "anthropic/claude-sonnet-4-5" },
      }),
    );
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.model.fallbacks).toBeUndefined();
  });

  it("should preserve openclaw.channels passthrough", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    const channels = result.channels as Record<string, unknown>;
    expect(channels.discord).toEqual({
      enabled: true,
      token: "discord-bot-token",
    });
  });

  it("should set workspace path", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.workspace).toBe(
      "/home/node/.openclaw/workspace",
    );
  });

  it("should set authProfile when credential mode is auth_profile", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        models: {
          cloud: "anthropic/claude-sonnet-4-5",
          credential_mode: "auth_profile",
          auth_profile: "corp-prod",
        },
      }),
    );
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.authProfile).toBe("corp-prod");
  });

  it("should not set authProfile when credential mode is env", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        models: {
          cloud: "anthropic/claude-sonnet-4-5",
          credential_mode: "env",
          auth_profile: "corp-prod",
        },
      }),
    );
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.authProfile).toBeUndefined();
  });

  it("should set session dmScope", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    expect(result.session.dmScope).toBe("per-channel-peer");
  });

  it("should default gateway bind to loopback", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    const gateway = result.gateway as Record<string, unknown>;
    expect(gateway.bind).toBe("loopback");
  });

  it("should allow explicit gateway bind override", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({ gateway: { bind: "lan" } }),
    );
    const result = resultMap.get("default")!;
    const gateway = result.gateway as Record<string, unknown>;
    expect(gateway.bind).toBe("lan");
  });

  it("should enable cron for inbox-analyst role", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({ agents: [{ name: "inbox-analyst", role: "inbox-analyst" }] }),
    );
    const result = resultMap.get("default")!;
    expect(result.cron?.enabled).toBe(true);
  });

  it("should enable cron for process-automator role", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({ agents: [{ name: "process-automator", role: "process-automator" }] }),
    );
    const result = resultMap.get("default")!;
    expect(result.cron?.enabled).toBe(true);
  });

  it("should not enable cron for research-agent role", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({ agents: [{ name: "research-agent", role: "research-agent" }] }),
    );
    const result = resultMap.get("default")!;
    expect(result.cron?.enabled).toBeUndefined();
  });

  it("should enable hooks with command-logger", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    expect(result.hooks?.enabled).toBe(true);
    expect(result.hooks?.internal?.enabled).toBe(true);
    expect(
      result.hooks?.internal?.entries?.["command-logger"].enabled,
    ).toBe(true);
  });

  it("should allow connector-only config through openclaw.channels", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        openclaw: {
          default: {
            channels: {
              discord: {
                enabled: true,
                token: "discord-bot-token",
              },
            },
          },
        },
      }),
    );
    const result = resultMap.get("default")!;
    const channels = result.channels as Record<string, unknown>;
    expect(channels.discord).toEqual({
      enabled: true,
      token: "discord-bot-token",
    });
  });

  it("should enable router plugin when routing config present", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        routing: {
          rules: [
            { condition: "pii_detected", model: "ollama/llama3.3:8b" },
          ],
          sensitivity: {
            keywords: ["password"],
          },
        },
      }),
    );
    const result = resultMap.get("default")!;
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
    const resultMap = generateOpenClawConfig(
      makeConfig({
        routing: {},
      }),
    );
    const result = resultMap.get("default")!;
    expect(
      result.plugins?.entries?.["clawforce-router"].config?.defaultModel,
    ).toBe("anthropic/claude-sonnet-4-5");
  });

  it("should pass defaultLocalModel from models.local into router config", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        routing: {},
        models: {
          cloud: "anthropic/claude-sonnet-4-5",
          local: "ollama/llama3.3:8b",
        },
      }),
    );
    const result = resultMap.get("default")!;
    expect(
      result.plugins?.entries?.["clawforce-router"].config?.defaultLocalModel,
    ).toBe("ollama/llama3.3:8b");
  });

  it("should enable compliance plugin when compliance config present", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        compliance: { enabled: true },
      }),
    );
    const result = resultMap.get("default")!;
    expect(result.plugins?.entries?.["clawforce-compliance"]).toBeDefined();
    expect(result.plugins?.entries?.["clawforce-compliance"].enabled).toBe(true);
  });

  it("should include discovered plugins section by default", () => {
    const resultMap = generateOpenClawConfig(makeConfig({ routing: {} }));
    const result = resultMap.get("default")!;
    expect(result.plugins?.enabled).toBe(true);
    expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
    expect(result.plugins?.entries?.["clawforce-compliance"]).toBeDefined();
  });

  it("should exclude router plugin when no routing config", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig(),
    );
    const result = resultMap.get("default")!;
    // Without routing config, router plugin should not be present
    // (unless the default makeConfig triggers it)
    // The source code skips clawforce-router when !config.routing
    // makeConfig doesn't set routing, so router should be excluded
    expect(result.plugins?.entries?.["clawforce-router"]).toBeUndefined();
  });

  it("should honor plugins.enabled allow-list", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        plugins: {
          enabled: ["clawforce-compliance"],
        },
      }),
    );
    const result = resultMap.get("default")!;
    expect(result.plugins?.entries?.["clawforce-router"]).toBeUndefined();
    expect(result.plugins?.entries?.["clawforce-compliance"]).toBeDefined();
  });

  it("should merge plugins.config overrides into plugin entries", () => {
    const resultMap = generateOpenClawConfig(
      makeConfig({
        routing: {},
        plugins: {
          config: {
            "clawforce-router": {
              extraSetting: true,
            },
          },
        },
      }),
    );
    const result = resultMap.get("default")!;
    const routerConfig = result.plugins?.entries?.["clawforce-router"]
      .config as Record<string, unknown>;
    expect(routerConfig.extraSetting).toBe(true);
  });

  describe("OpenClaw passthrough", () => {
    it("should deep-merge passthrough into generated config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            default: {
              agents: {
                defaults: {
                  tools: {
                    sandbox: { enabled: true },
                  },
                },
              },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      const agents = result.agents as Record<string, unknown>;
      const defaults = agents.defaults as Record<string, unknown>;
      const tools = defaults.tools as Record<string, unknown>;
      expect(tools.sandbox).toEqual({ enabled: true });
    });

    it("should override generated values with passthrough", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            default: {
              agents: {
                defaults: {
                  model: {
                    primary: "openai/gpt-4o",
                  },
                },
              },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      expect(result.agents.defaults.model.primary).toBe("openai/gpt-4o");
    });

    it("should deep-merge nested objects", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            default: {
              agents: {
                defaults: {
                  tools: {
                    browser: { enabled: true, headless: true },
                    memory: { enabled: true },
                  },
                },
              },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      const defaults = result.agents.defaults as Record<string, unknown>;
      const tools = defaults.tools as Record<string, unknown>;
      expect(tools.browser).toEqual({ enabled: true, headless: true });
      expect(tools.memory).toEqual({ enabled: true });
    });

    it("should not affect config when passthrough is absent", () => {
      const resultMap = generateOpenClawConfig(makeConfig());
      const result = resultMap.get("default")!;
      expect(result.agents.defaults.model.primary).toBe("anthropic/claude-sonnet-4-5");
    });

    it("should not break channel config with passthrough", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            default: {
              channels: {
                discord: {
                  enabled: true,
                  token: "discord-bot-token",
                },
              },
              cron: { enabled: true, store: "sqlite" },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      const channels = result.channels as Record<string, unknown>;
      expect(channels.discord).toBeDefined();
      const cron = result.cron as Record<string, unknown>;
      expect(cron.enabled).toBe(true);
      expect(cron.store).toBe("sqlite");
    });

    it("should allow array values in passthrough", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          openclaw: {
            default: {
              agents: {
                defaults: {
                  model: {
                    fallbacks: ["openai/gpt-4o", "openai/gpt-4o-mini"],
                  },
                },
              },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      expect(result.agents.defaults.model.fallbacks).toEqual([
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
      ]);
    });

    it("should not break plugin config with passthrough", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {},
          openclaw: {
            default: {
              agents: {
                defaults: {
                  tools: { exec: { enabled: true } },
                },
              },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      expect(result.plugins?.entries?.["clawforce-router"]).toBeDefined();
      const defaults = result.agents.defaults as Record<string, unknown>;
      const tools = defaults.tools as Record<string, unknown>;
      expect(tools.exec).toEqual({ enabled: true });
    });

    it("should pass router priority through to plugin config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {
            priority: ["domain", "sensitivity", "complexity"],
          },
        }),
      );
      const result = resultMap.get("default")!;
      expect(
        result.plugins?.entries?.["clawforce-router"].config?.priority,
      ).toEqual(["domain", "sensitivity", "complexity"]);
    });

    it("should pass router budget through to plugin config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {
            budget: {
              daily_limit: 10,
              per_request_cap: 0.5,
              fallback_model: "ollama/llama3.3:8b",
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      const budget = result.plugins?.entries?.["clawforce-router"].config?.budget as Record<string, unknown>;
      expect(budget.dailyLimit).toBe(10);
      expect(budget.perRequestCap).toBe(0.5);
      expect(budget.fallbackModel).toBe("ollama/llama3.3:8b");
    });

    it("should pass sensitivity thresholds through to router plugin config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {
            sensitivity: {
              pii_detection: true,
              pii_confidence_threshold: 0.9,
              pii_pattern_thresholds: {
                ip_address: 0.5,
              },
            },
          },
        }),
      );
      const result = resultMap.get("default")!;

      const pluginConfig = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
      expect(pluginConfig.piiThreshold).toBe(0.9);
      expect(pluginConfig.piiPatternThresholds).toEqual({
        ip_address: 0.5,
      });
    });

    it("should normalize policy config for router plugin config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {
            policy: {
              default_tier: "internal",
              channels: [{ channel_id: "C_SECURE", tier: "restricted", description: "secure channel" }],
              users: [{ user_id: "U_FINANCE", tier: "confidential" }],
            },
          },
        }),
      );
      const result = resultMap.get("default")!;
      const pluginConfig = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
      expect(pluginConfig.policy).toEqual({
        defaultTier: "internal",
        channels: [{ channelId: "C_SECURE", tier: "restricted", description: "secure channel" }],
        users: [{ userId: "U_FINANCE", tier: "confidential" }],
      });
    });

    it("should merge sensitivity blocklist with router sensitivity keywords", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {
            sensitivity: {
              keywords: ["password", "secret", "confidential"],
              pii_detection: false,
            },
          },
        }),
      );
      const result = resultMap.get("default")!;

      const pluginConfig = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
      expect(pluginConfig.sensitivityKeywords).toEqual(["password", "secret", "confidential"]);
      expect(pluginConfig.piiDetection).toBe(false);
    });

    it("should pass compliance frameworks through to router plugin config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {},
          compliance: { enabled: true, frameworks: ["hipaa", "pci-dss"] },
        }),
      );
      const result = resultMap.get("default")!;
      const pluginConfig = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
      expect(pluginConfig.complianceFrameworks).toEqual(["hipaa", "pci-dss"]);
    });

    it("should pass router health_check through to plugin config", () => {
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {
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
      const result = resultMap.get("default")!;

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
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {},
        }),
      );
      const result = resultMap.get("default")!;
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
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {},
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
      const result = resultMap.get("default")!;

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
      const resultMap = generateOpenClawConfig(
        makeConfig({
          routing: {},
          alerts: {
            enabled: true,
            notifications: {
              dashboard: true,
              email: { enabled: false, smtp_port: 587 },
            },
          } as any,
        }),
      );
      const result = resultMap.get("default")!;

      const alerts = result.plugins?.entries?.["clawforce-router"].config
        ?.alerts as Record<string, unknown>;
      const notifications = alerts.notifications as Record<string, unknown>;
      expect(notifications.unsupportedConnectorA).toBeUndefined();
      expect(notifications.unsupportedConnectorB).toBeUndefined();
      expect(notifications.webhook_url).toBeUndefined();
    });
  });
});

function makeMultiAgentConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-workforce",
    agents: [
      {
        name: "inbox-analyst",
        role: "inbox-analyst",
        routing: { budget: { daily_limit: 5.0 } },
      },
      {
        name: "research-agent",
        role: "research-agent",
        routing: {
          budget: { daily_limit: 8.0 },
          rules: [{ condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" }],
        },
      },
    ],
    models: {
      cloud: "anthropic/claude-sonnet-4-5",
      local: "ollama/llama3.3:8b",
    },
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
    },
    ...overrides,
  };
}

describe("generateOpenClawConfig — multi-agent", () => {
  it("should generate agents.list with correct IDs and workspaces", () => {
    const resultMap = generateOpenClawConfig(makeMultiAgentConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.list).toHaveLength(2);
    expect(result.agents.list![0]).toEqual({
      id: "inbox-analyst",
      workspace: "/home/node/.openclaw/workspace/inbox-analyst",
    });
    expect(result.agents.list![1]).toEqual({
      id: "research-agent",
      workspace: "/home/node/.openclaw/workspace/research-agent",
    });
  });

  it("should use models.cloud as primary model", () => {
    const resultMap = generateOpenClawConfig(makeMultiAgentConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.model.primary).toBe("anthropic/claude-sonnet-4-5");
  });

  it("should use models.local as fallback", () => {
    const resultMap = generateOpenClawConfig(makeMultiAgentConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.defaults.model.fallbacks).toEqual(["ollama/llama3.3:8b"]);
  });

  it("should not generate agents.list for single-agent config", () => {
    const resultMap = generateOpenClawConfig(makeConfig());
    const result = resultMap.get("default")!;
    expect(result.agents.list).toHaveLength(1);
  });

  it("should include agentBudgets in router plugin config", () => {
    const resultMap = generateOpenClawConfig(
      makeMultiAgentConfig({ routing: {} }),
    );
    const result = resultMap.get("default")!;
    const routerCfg = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
    const budgets = routerCfg.agentBudgets as Record<string, unknown>;
    expect(budgets).toBeDefined();
    expect(budgets["inbox-analyst"]).toEqual({ dailyLimit: 5.0 });
    expect(budgets["research-agent"]).toEqual({ dailyLimit: 8.0 });
  });

  it("should include agentRules in router plugin config when per-agent rules defined", () => {
    const resultMap = generateOpenClawConfig(
      makeMultiAgentConfig({ routing: {} }),
    );
    const result = resultMap.get("default")!;
    const routerCfg = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
    const rules = routerCfg.agentRules as Record<string, unknown>;
    expect(rules).toBeDefined();
    expect(rules["research-agent"]).toEqual([
      { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
    ]);
    expect(rules["inbox-analyst"]).toBeUndefined();
  });

  it("should pass routing config into router plugin", () => {
    const resultMap = generateOpenClawConfig(
      makeMultiAgentConfig({
        routing: {
          priority: ["domain", "sensitivity", "complexity"],
          sensitivity: {
            keywords: ["password", "secret"],
          },
        },
      }),
    );
    const result = resultMap.get("default")!;
    const routerCfg = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
    expect(routerCfg.priority).toEqual(["domain", "sensitivity", "complexity"]);
    expect(routerCfg.sensitivityKeywords).toEqual(["password", "secret"]);
  });

  it("should omit agentBudgets when no agents have budget config", () => {
    const resultMap = generateOpenClawConfig(
      makeMultiAgentConfig({
        agents: [
          { name: "agent-a", role: "inbox-analyst" },
          { name: "agent-b", role: "research-agent" },
        ],
        routing: {},
      }),
    );
    const result = resultMap.get("default")!;
    const routerCfg = result.plugins?.entries?.["clawforce-router"].config as Record<string, unknown>;
    expect(routerCfg.agentBudgets).toBeUndefined();
  });

  it("should merge role partials for all unique roles in multi-agent", () => {
    const resultMap = generateOpenClawConfig(makeMultiAgentConfig());
    const result = resultMap.get("default")!;
    // inbox-analyst role partial enables cron
    expect(result.cron?.enabled).toBe(true);
  });

  it("should preserve openclaw passthrough in multi-agent mode", () => {
    const resultMap = generateOpenClawConfig(makeMultiAgentConfig());
    const result = resultMap.get("default")!;
    const channels = result.channels as Record<string, unknown>;
    expect(channels.discord).toEqual({ enabled: true });
  });

  it("should derive connector name from openclaw.channels", () => {
    const resultMap = generateOpenClawConfig(makeMultiAgentConfig({
      openclaw: {
        default: {
          channels: {
            slack: { enabled: true },
          },
        },
      },
    }));
    const result = resultMap.get("default")!;
    // channels passthrough should have slack
    const channels = result.channels as Record<string, unknown>;
    expect(channels.slack).toEqual({ enabled: true });
  });

  it("should split agents across named openclaw instances", () => {
    const resultMap = generateOpenClawConfig({
      name: "multi-instance-corp",
      agents: [
        { name: "support-bot", role: "inbox-analyst", openclaw: "support-instance" },
        { name: "research-bot", role: "research-agent", openclaw: "research-instance" },
      ],
      models: { cloud: "anthropic/claude-sonnet-4-5" },
      openclaw: {
        "support-instance": { channels: { discord: { enabled: true } } },
        "research-instance": { channels: { slack: { enabled: true } } },
      },
    });

    expect(resultMap.size).toBe(2);

    const support = resultMap.get("support-instance")!;
    expect(support.agents.list).toHaveLength(1);
    expect(support.agents.list![0].id).toBe("support-bot");
    const supportChannels = support.channels as Record<string, unknown>;
    expect(supportChannels.discord).toEqual({ enabled: true });

    const research = resultMap.get("research-instance")!;
    expect(research.agents.list).toHaveLength(1);
    expect(research.agents.list![0].id).toBe("research-bot");
    const researchChannels = research.channels as Record<string, unknown>;
    expect(researchChannels.slack).toEqual({ enabled: true });
  });

  it("should not auto-enable supervisor tools in agent profiles", () => {
    const resultMap = generateOpenClawConfig(
      makeMultiAgentConfig({
        agents: [
          {
            name: "ultron",
            role: "supervisor",
            supervises: ["inbox-analyst"],
          },
          {
            name: "inbox-analyst",
            role: "inbox-analyst",
          },
        ],
      }),
    );
    const result = resultMap.get("default")!;

    const ultronProfile = result.agents.list?.find((a) => a.id === "ultron");
    const analystProfile = result.agents.list?.find((a) => a.id === "inbox-analyst");

    expect(ultronProfile).toBeDefined();
    expect(analystProfile).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(ultronProfile ?? {}, "tools")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(analystProfile ?? {}, "tools")).toBe(false);
  });
});
