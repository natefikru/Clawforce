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

function createPluginPipeline(pluginConfig?: Record<string, unknown>) {
  const registeredHooks: Array<{
    hookName: string;
    handler: (
      event: { prompt: string; messages?: unknown[] },
      ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string },
    ) => HookResult | void;
    priority: number;
  }> = [];

  const api: RouterPluginApi = {
    id: "clawforce-router",
    pluginConfig: {
      pluginPermissions: [
        "hooks:before_agent_start",
        "hooks:message_sending",
        "hooks:tool_result_persist",
        "hooks:agent_end",
        "storage:write",
        "alerts:dispatch",
      ],
      ...pluginConfig,
    },
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
          ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string },
        ) => HookResult | void,
        priority: opts?.priority ?? 0,
      });
    },
  };

  activate(api);

  function simulateAgentRun(
    prompt: string,
    ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string } = { agentId: "main" },
    messages?: unknown[],
  ) {
    const defaultProvider = "anthropic";
    const defaultModel = "claude-sonnet-4-5";

    const hooks = registeredHooks
      .filter((h) => h.hookName === "before_agent_start")
      .sort((a, b) => b.priority - a.priority);

    let hookResult: HookResult | void = undefined;
    for (const hook of hooks) {
      const result = hook.handler({ prompt, messages }, ctx);
      if (result) hookResult = result;
    }

    return {
      hookResult,
      effectiveProvider: hookResult?.providerOverride ?? defaultProvider,
      effectiveModel: hookResult?.modelOverride ?? defaultModel,
    };
  }

  return { simulateAgentRun };
}

const COMPLEX_PROMPT =
  "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, " +
  "event sourcing patterns, and CQRS for a distributed system handling 10M requests/second with strict consistency requirements. " +
  "Compare Kubernetes orchestration vs serverless approaches for deployment, discussing cold start latencies, resource utilization, and cost optimization.";

describe("Manual validation plan automation (route matrix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Phase 1 equivalent: cloud profile routing expectations", () => {
    it("clean prompt can route to local for low complexity", () => {
      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
      });

      const result = pipeline.simulateAgentRun("safe validation prompt");
      // Default rules route low-complexity prompts to local cost-efficient model.
      expect(["sglang", "ollama", "vllm"]).toContain(result.effectiveProvider);
    });

    it("PII prompt never routes to cloud", () => {
      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
      });

      const pii = pipeline.simulateAgentRun("my SSN is 123-45-6789");
      expect(["anthropic", "openai", "google"]).not.toContain(pii.effectiveProvider);
    });
  });

  describe("Phase 6 equivalent: local-only behavior", () => {
    const LOCAL_ONLY_CONFIG = {
      defaultModel: "ollama/llama3.3:8b",
      rules: [
        { condition: "pii_detected", model: "ollama/llama3.3:8b" },
        { condition: "low_complexity", model: "ollama/llama3.3:8b" },
        { condition: "high_complexity", model: "ollama/llama3.3:8b" },
        { condition: "over_budget", model: "ollama/llama3.3:8b" },
      ],
    };

    it("simple, complex, and PII prompts all route local", () => {
      const pipeline = createPluginPipeline(LOCAL_ONLY_CONFIG);

      const simple = pipeline.simulateAgentRun("hello");
      const complex = pipeline.simulateAgentRun(COMPLEX_PROMPT);
      const pii = pipeline.simulateAgentRun("my SSN is 123-45-6789");

      expect(simple.effectiveProvider).toBe("ollama");
      expect(complex.effectiveProvider).toBe("ollama");
      expect(pii.effectiveProvider).toBe("ollama");
    });
  });

  describe("Phase 7 equivalent: hybrid matrix", () => {
    const HYBRID_CONFIG = {
      defaultModel: "anthropic/claude-sonnet-4-5",
      rules: [
        { condition: "pii_detected", model: "ollama/llama3.3:8b" },
        { condition: "low_complexity", model: "ollama/llama3.3:8b" },
        { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
        { condition: "over_budget", model: "ollama/llama3.3:8b" },
      ],
      budget: {
        dailyLimit: 0.001,
        fallbackModel: "ollama/llama3.3:8b",
      },
    };

    it("low complexity -> local, high complexity -> cloud, pii -> local", () => {
      const pipeline = createPluginPipeline({
        ...HYBRID_CONFIG,
        budget: { dailyLimit: 100, fallbackModel: "ollama/llama3.3:8b" },
      });

      const low = pipeline.simulateAgentRun("safe low complexity prompt");
      const high = pipeline.simulateAgentRun(COMPLEX_PROMPT);
      const pii = pipeline.simulateAgentRun("my SSN is 123-45-6789");

      expect(low.effectiveProvider).toBe("ollama");
      expect(high.effectiveProvider).toBe("anthropic");
      expect(pii.effectiveProvider).toBe("ollama");
    });

    it("over-budget routes to fallback local model", () => {
      const pipeline = createPluginPipeline(HYBRID_CONFIG);
      const overBudget = pipeline.simulateAgentRun(COMPLEX_PROMPT);

      expect(overBudget.effectiveProvider).toBe("ollama");
      expect(overBudget.effectiveModel).toBe("llama3.3:8b");
    });
  });
});

