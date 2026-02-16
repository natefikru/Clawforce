/**
 * Layer 4: Integration Test — Router Pipeline Dimension Tests
 *
 * Validates each of the 5 routing dimensions (policy, sensitivity, cost,
 * domain, complexity) through the full activate() → before_agent_start hook
 * chain using the createPluginPipeline() pattern.
 *
 * These tests exercise the complete decision chain: prompt → PII detection →
 * data policy → budget check → domain detection → complexity analysis →
 * dimension priority loop → model selection → health gate → override returned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
 * Creates a full plugin pipeline that wires activate() → hook registration →
 * simulateAgentRun(), matching the pattern from router-enforcement.test.ts.
 */
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

    let hookResult: HookResult | void = undefined;
    for (const hook of hooks) {
      const result = hook.handler({ prompt, messages }, ctx);
      if (result) {
        hookResult = result;
      }
    }

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

// Complex prompt that reliably triggers "high_complexity" routing to cloud
const COMPLEX_PROMPT =
  "Analyze the architectural trade-offs between microservices and monoliths " +
  "considering CAP theorem implications, event sourcing patterns, and CQRS " +
  "for a distributed system handling 10M requests/second with strict " +
  "consistency requirements. Compare Kubernetes orchestration vs serverless " +
  "approaches for deployment, discussing cold start latencies, resource " +
  "utilization, and cost optimization.";

describe("Router Pipeline Dimensions (Layer 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Data Policy Dimension ─────────────────────────────────────────────

  describe("Data policy dimension — full pipeline", () => {
    const POLICY_CONFIG = {
      policy: {
        defaultTier: "public",
        channels: [
          { channelId: "C_HR", tier: "restricted" },
          { channelId: "C_FINANCE", tier: "confidential" },
          { channelId: "C_INTERNAL", tier: "internal" },
          { channelId: "C_PUBLIC", tier: "public" },
        ],
        users: [
          { userId: "U_EXEC", tier: "confidential" },
          { userId: "U_INTERN", tier: "public" },
        ],
      },
    };

    it("restricted channel forces local even for simple clean prompts", () => {
      const pipeline = createPluginPipeline(POLICY_CONFIG);
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "What is the weather today?",
        { agentId: "main", channelId: "C_HR" },
      );

      expect(effectiveProvider).not.toBe("anthropic");
      expect(effectiveProvider).not.toBe("openai");
      expect(effectiveProvider).not.toBe("google");
    });

    it("confidential user forces local even for complex prompts", () => {
      const pipeline = createPluginPipeline(POLICY_CONFIG);
      const { effectiveProvider } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
        { agentId: "main", userId: "U_EXEC" },
      );

      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("internal tier does NOT force local for clean prompts", () => {
      const pipeline = createPluginPipeline(POLICY_CONFIG);
      const { effectiveProvider } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
        { agentId: "main", channelId: "C_INTERNAL" },
      );

      // internal tier falls through to other dimensions —
      // complex prompt should route to cloud
      expect(effectiveProvider).toBe("anthropic");
    });

    it("public tier allows cloud routing for complex prompts", () => {
      const pipeline = createPluginPipeline(POLICY_CONFIG);
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
        { agentId: "main", channelId: "C_PUBLIC" },
      );

      expect(effectiveProvider).toBe("anthropic");
      expect(effectiveModel).toBe("claude-sonnet-4-5");
    });

    it("channel policy overrides user policy (restricted channel + public user = local)", () => {
      const pipeline = createPluginPipeline(POLICY_CONFIG);
      const { effectiveProvider } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
        { agentId: "main", channelId: "C_HR", userId: "U_INTERN" },
      );

      // restricted channel should win over public user
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("no policy config = no policy-based routing (regression)", () => {
      // Pipeline without policy config
      const pipeline = createPluginPipeline();
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
        { agentId: "main", channelId: "C_HR" },
      );

      // Without policy config, channel ID is irrelevant — route by complexity
      expect(effectiveProvider).toBe("anthropic");
      expect(effectiveModel).toBe("claude-sonnet-4-5");
    });
  });

  // ─── Budget Dimension ──────────────────────────────────────────────────

  describe("Budget dimension — full pipeline", () => {
    it("budget exhausted forces local for cloud-eligible prompt", () => {
      const pipeline = createPluginPipeline({
        budget: {
          dailyLimit: 0.001, // Effectively zero budget
          fallbackModel: "sglang/qwen3-32b",
        },
      });

      // First call with a complex prompt exhausts the near-zero budget
      // estimateRequestCost for anthropic/claude-sonnet-4-5 with 500 input + 1000 output tokens:
      // (500/1M * 3.0) + (1000/1M * 15.0) = 0.0015 + 0.015 = 0.0165
      // 0.0165 > 0.001 daily limit => over budget
      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
      );

      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });

    it("budget available allows cloud routing", () => {
      const pipeline = createPluginPipeline({
        budget: {
          dailyLimit: 100.0, // Generous budget
          fallbackModel: "sglang/qwen3-32b",
        },
      });

      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
      );

      expect(effectiveProvider).toBe("anthropic");
      expect(effectiveModel).toBe("claude-sonnet-4-5");
    });

    it("per-request cap exceeded forces local", () => {
      const pipeline = createPluginPipeline({
        budget: {
          dailyLimit: 100.0,
          perRequestCap: 0.001, // Very low per-request cap
          fallbackModel: "sglang/qwen3-32b",
        },
      });

      const { effectiveProvider } = pipeline.simulateAgentRun(COMPLEX_PROMPT);

      // Per-request cap exceeded → budget dimension forces local
      expect(effectiveProvider).toBe("sglang");
    });

    it("budget nearly exhausted (request would exceed limit) forces local", () => {
      const pipeline = createPluginPipeline({
        budget: {
          dailyLimit: 0.02, // Just barely above single request cost
          fallbackModel: "sglang/qwen3-32b",
        },
      });

      // First complex prompt should succeed (0.0165 < 0.02)
      const first = pipeline.simulateAgentRun(COMPLEX_PROMPT);
      expect(first.effectiveProvider).toBe("anthropic");

      // Second should fail (already spent 0.0165, remaining 0.0035 < 0.0165)
      const second = pipeline.simulateAgentRun(COMPLEX_PROMPT);
      expect(second.effectiveProvider).toBe("sglang");
    });

    it("concurrent agents have isolated budget tracking", () => {
      const pipeline = createPluginPipeline({
        budget: {
          dailyLimit: 0.02,
          fallbackModel: "sglang/qwen3-32b",
        },
      });

      // Agent A depletes budget
      pipeline.simulateAgentRun(COMPLEX_PROMPT, { agentId: "agent-a" });
      const agentASecond = pipeline.simulateAgentRun(COMPLEX_PROMPT, { agentId: "agent-a" });
      expect(agentASecond.effectiveProvider).toBe("sglang"); // exhausted

      // Agent B should still have budget
      const agentBFirst = pipeline.simulateAgentRun(COMPLEX_PROMPT, { agentId: "agent-b" });
      expect(agentBFirst.effectiveProvider).toBe("anthropic"); // fresh budget
    });
  });

  // ─── Health Failover ───────────────────────────────────────────────────

  describe("Health failover in full router pipeline", () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("local model down + failover-safe + no PII = falls back to cloud", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
        healthCheck: {
          enabled: true,
          intervalSeconds: 10,
          timeoutSeconds: 1,
          staleAfterSeconds: 30,
          failoverPolicy: "failover-safe",
          failureThreshold: 1,
          recoveryThreshold: 1,
        },
      });

      // Let the health poller run and detect failure
      await vi.advanceTimersByTimeAsync(0);

      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Hi there!", // Simple clean prompt — would normally go local
      );

      // Health failover routes to cloud default
      expect(effectiveProvider).toBe("anthropic");
      expect(effectiveModel).toBe("claude-sonnet-4-5");
    });

    it("local model down + failover-safe + PII = throws (blocked)", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
        healthCheck: {
          enabled: true,
          intervalSeconds: 10,
          timeoutSeconds: 1,
          staleAfterSeconds: 30,
          failoverPolicy: "failover-safe",
          failureThreshold: 1,
          recoveryThreshold: 1,
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(() =>
        pipeline.simulateAgentRun("My SSN is 123-45-6789"),
      ).toThrow("Blocked sensitive request");
    });

    it("local model down + block policy = throws regardless of PII", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
        healthCheck: {
          enabled: true,
          intervalSeconds: 10,
          timeoutSeconds: 1,
          staleAfterSeconds: 30,
          failoverPolicy: "block",
          failureThreshold: 1,
          recoveryThreshold: 1,
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(() =>
        pipeline.simulateAgentRun("Hi there!"),
      ).toThrow("Blocked request");
    });

    it("local model healthy = normal routing (no failover applied)", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
        healthCheck: {
          enabled: true,
          intervalSeconds: 10,
          timeoutSeconds: 1,
          staleAfterSeconds: 30,
          failoverPolicy: "failover-safe",
          failureThreshold: 1,
          recoveryThreshold: 1,
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        "Hi there!",
      );

      // Simple prompt → local model (normal routing, no failover)
      expect(effectiveProvider).toBe("sglang");
      expect(effectiveModel).toBe("qwen3-32b");
    });
  });

  // ─── Dimension Priority Ordering ───────────────────────────────────────

  describe("Dimension priority ordering", () => {
    it("default priority [policy, sensitivity, cost, domain, complexity] works", () => {
      const pipeline = createPluginPipeline({
        policy: {
          defaultTier: "restricted",
          channels: [],
          users: [],
        },
      });

      // restricted default tier → policy dimension fires first → local
      const { effectiveProvider } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
      );

      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("custom priority reordering changes routing behavior", () => {
      // With cost as highest priority and over-budget, cost dimension should fire first
      const pipeline = createPluginPipeline({
        priority: ["cost", "sensitivity", "policy", "domain", "complexity"],
        budget: {
          dailyLimit: 0.001,
          fallbackModel: "ollama/budget-model",
        },
        rules: [
          { condition: "over_budget", model: "ollama/budget-model" },
          { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
        ],
      });

      const { effectiveProvider, effectiveModel } = pipeline.simulateAgentRun(
        COMPLEX_PROMPT,
      );

      // Cost dimension fires first due to priority ordering
      expect(effectiveProvider).toBe("ollama");
      expect(effectiveModel).toBe("budget-model");
    });

    it("PII safety invariant overrides even when sensitivity is low priority", () => {
      // Put sensitivity last — PII should still be caught by post-routing invariant
      const pipeline = createPluginPipeline({
        priority: ["cost", "domain", "complexity", "policy", "sensitivity"],
      });

      const { effectiveProvider } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789. " + COMPLEX_PROMPT,
      );

      // Even though complexity would route to cloud, PII invariant forces local
      expect(effectiveProvider).not.toBe("anthropic");
      expect(effectiveProvider).not.toBe("openai");
      expect(effectiveProvider).not.toBe("google");
    });

    it("empty priority array falls through to defaultModel (PII invariant still catches)", () => {
      const pipeline = createPluginPipeline({
        priority: [],
      });

      // No PII: should use defaultModel since no dimensions evaluate
      const clean = pipeline.simulateAgentRun(COMPLEX_PROMPT);
      expect(clean.effectiveProvider).toBe("anthropic");
      expect(clean.effectiveModel).toBe("claude-sonnet-4-5");

      // With PII: post-routing invariant still catches cloud → forces local
      const pii = pipeline.simulateAgentRun("My SSN is 123-45-6789");
      expect(pii.effectiveProvider).not.toBe("anthropic");
    });
  });
});
