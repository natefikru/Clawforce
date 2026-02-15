/**
 * Layer 4: Integration Test — End-to-End Router Enforcement
 *
 * Wires the router plugin into a mock OpenClaw plugin API and verifies
 * the complete flow: prompt → PII detection → rule match → model selection
 * → override returned.
 *
 * This tests the full decision chain without needing a running OpenClaw instance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, type RouterPluginApi } from "../../src/plugins/clawforce-router/index.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

type HookResult = {
  prependContext?: string;
  modelOverride?: string;
  providerOverride?: string;
};

/**
 * Simulates the OpenClaw plugin registration and hook execution pipeline.
 * Captures hook registrations and provides a method to invoke them as
 * OpenClaw would during an agent run.
 */
function createPluginPipeline(pluginConfig?: Record<string, unknown>) {
  const registeredHooks: Array<{
    hookName: string;
    handler: (
      event: { prompt: string; messages?: unknown[] },
      ctx: { agentId?: string; sessionKey?: string },
    ) => HookResult | void;
    priority: number;
  }> = [];

  const api: RouterPluginApi = {
    id: "clawforce-router",
    pluginConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: (hookName, handler, opts) => {
      registeredHooks.push({
        hookName,
        handler: handler as (
          event: { prompt: string; messages?: unknown[] },
          ctx: { agentId?: string; sessionKey?: string },
        ) => HookResult | void,
        priority: opts?.priority ?? 0,
      });
    },
  };

  // Activate the plugin, registering hooks
  activate(api);

  /**
   * Simulate what OpenClaw does when processing a message:
   * 1. Call the before_agent_start hook with the prompt
   * 2. Extract modelOverride/providerOverride
   * 3. These would be passed to resolveModel() in OpenClaw
   */
  function simulateAgentRun(
    prompt: string,
    ctx: { agentId?: string; sessionKey?: string } = { agentId: "main" },
    messages?: unknown[],
  ): {
    hookResult: HookResult | void;
    effectiveProvider: string;
    effectiveModel: string;
  } {
    const defaultProvider = "anthropic";
    const defaultModel = "claude-sonnet-4-5";

    const hooks = registeredHooks
      .filter((h) => h.hookName === "before_agent_start")
      .sort((a, b) => b.priority - a.priority);

    let hookResult: HookResult | void;
    for (const hook of hooks) {
      const result = hook.handler({ prompt, messages }, ctx);
      if (result) {
        hookResult = result;
      }
    }

    // Apply overrides as OpenClaw's run.ts would
    let effectiveProvider = defaultProvider;
    let effectiveModel = defaultModel;

    if (hookResult?.providerOverride) {
      effectiveProvider = hookResult.providerOverride;
    }
    if (hookResult?.modelOverride) {
      effectiveModel = hookResult.modelOverride;
    }

    return { hookResult, effectiveProvider, effectiveModel };
  }

  return { api, registeredHooks, simulateAgentRun };
}

describe("Router Enforcement Integration (Layer 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PII → local model routing (full chain)", () => {
    it("SSN in prompt → SGLang local model", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Please help me with my tax return. My SSN is 123-45-6789.",
      );

      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });

    it("credit card in prompt → SGLang local model", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Charge the following card: 4111-1111-1111-1111",
      );

      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });

    it("email address in prompt → SGLang local model", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Send the report to jane.doe@company.com",
      );

      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });
  });

  describe("complexity-based routing (full chain)", () => {
    it("simple greeting → local cost-efficient model", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Hi there!",
      );

      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });

    it("complex analysis request → cloud model", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, event sourcing patterns, and CQRS for a distributed system handling 10M requests/second with strict consistency requirements. Compare Kubernetes orchestration vs serverless approaches for deployment, discussing cold start latencies, resource utilization, and cost optimization.",
      );

      expect(effectiveProvider).toBe("anthropic");
      expect(effectiveModel).toBe("claude-sonnet-4-5");
    });
  });

  describe("custom configuration routing (full chain)", () => {
    it("custom rules route PII to custom local provider", () => {
      const pipeline = createPluginPipeline({
        rules: [
          { condition: "pii_detected", model: "ollama/secure-llm-v2" },
        ],
      });

      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789",
      );

      // PII must always route to local model (safety invariant)
      expect(effectiveProvider).toBe("ollama");
      expect(effectiveModel).toBe("secure-llm-v2");
    });

    it("custom default model used when no rules match", () => {
      const pipeline = createPluginPipeline({
        defaultModel: "google/gemini-pro",
        rules: [],
      });

      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "What is the weather today?",
      );

      expect(effectiveProvider).toBe("google");
      expect(effectiveModel).toBe("gemini-pro");
    });
  });

  describe("PII overrides complexity (priority enforcement)", () => {
    it("complex prompt WITH PII → routes to local model (PII wins)", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Analyze the architectural trade-offs between microservices and monoliths for my project. My SSN is 123-45-6789. Consider CAP theorem, event sourcing, CQRS for distributed systems with 10M req/s.",
      );

      // PII should take priority over complexity, routing to local model
      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });
  });

  describe("empty/whitespace prompts (edge cases)", () => {
    it("empty prompt → no hook result, defaults preserved", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel, hookResult } =
        pipeline.simulateAgentRun("");

      // Hook returns void for empty prompts
      expect(hookResult).toBeUndefined();
      // Defaults are preserved
      expect(effectiveProvider).toBe("anthropic");
      expect(effectiveModel).toBe("claude-sonnet-4-5");
    });

    it("whitespace-only prompt → no hook result, defaults preserved", () => {
      const pipeline = createPluginPipeline();
      const { hookResult } = pipeline.simulateAgentRun("   ");

      expect(hookResult).toBeUndefined();
    });
  });

  describe("SECURITY: cloud provider exclusion for PII", () => {
    const CLOUD_PROVIDERS = ["anthropic", "openai", "google", "azure"];
    const PII_PROMPTS = [
      "My SSN is 123-45-6789",
      "Credit card: 4111-1111-1111-1111",
      "Email me at john@example.com",
      "Call me at 555-123-4567",
      "My passport number is AB1234567",
    ];

    for (const prompt of PII_PROMPTS) {
      it(`PII prompt "${prompt.slice(0, 40)}..." never routes to cloud`, () => {
        const pipeline = createPluginPipeline();
        const { effectiveProvider } = pipeline.simulateAgentRun(prompt);

        for (const cloud of CLOUD_PROVIDERS) {
          expect(effectiveProvider).not.toBe(cloud);
        }
      });
    }
  });

  describe("conversation history PII scanning (full chain)", () => {
    it("PII in conversation history routes to local model", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "summarize the conversation",
        { agentId: "main" },
        [{ content: "My SSN is 123-45-6789" }],
      );

      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("clean history with clean prompt routes to cloud", () => {
      const pipeline = createPluginPipeline();
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, event sourcing patterns, and CQRS for a distributed system handling 10M requests/second with strict consistency requirements.",
        { agentId: "main" },
        [{ content: "Let's discuss system architecture" }],
      );

      expect(effectiveProvider).toBe("anthropic");
    });
  });

  describe("context injection consistency", () => {
    it("prependContext model name matches actual override", () => {
      const pipeline = createPluginPipeline();
      const { hookResult, effectiveProvider, effectiveModel } =
        pipeline.simulateAgentRun("My SSN is 123-45-6789");

      const fullRef = `${effectiveProvider}/${effectiveModel}`;
      expect(hookResult?.prependContext).toContain(fullRef);
    });

    it("prependContext includes PII warning when PII detected", () => {
      const pipeline = createPluginPipeline();
      const { hookResult } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789",
      );

      expect(hookResult?.prependContext).toContain("PII detected");
    });

    it("prependContext does NOT include PII warning for clean prompt", () => {
      const pipeline = createPluginPipeline();
      const { hookResult } = pipeline.simulateAgentRun("Hello world");

      expect(hookResult?.prependContext).not.toContain("PII detected");
    });
  });

  describe("resolveConfig type safety (full chain)", () => {
    it("handles invalid config types gracefully using defaults", () => {
      // Pass wrong types for all config fields
      const pipeline = createPluginPipeline({
        defaultModel: 42,
        rules: "not-an-array",
        sensitivityKeywords: true,
        logPath: 123,
        priority: "invalid",
      });

      // Should still work with defaults — no crash
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789",
      );

      // PII detected → local model (using default rules)
      expect(effectiveProvider).not.toBe("anthropic");
      expect(effectiveModel).toBeDefined();
    });
  });
});
