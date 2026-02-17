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

const GUARANTEED_HIGH_COMPLEXITY_PROMPT =
  "Analyze the architectural trade-offs between microservices and monoliths " +
  "considering CAP theorem implications, event sourcing patterns, and CQRS " +
  "for a distributed system handling 10M requests/second with strict " +
  "consistency requirements. Compare Kubernetes orchestration vs serverless " +
  "approaches for deployment, discussing cold start latencies, resource " +
  "utilization, and cost optimization.";

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

const BUSINESS_HYBRID_CONFIG = {
  defaultModel: "anthropic/claude-sonnet-4-5",
  priority: ["sensitivity", "cost", "domain", "complexity", "policy"],
  rules: [
    { condition: "pii_detected", model: "sglang/qwen3-32b" },
    { condition: "low_complexity", model: "sglang/qwen3-32b" },
    { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
    { condition: "over_budget", model: "sglang/qwen3-32b" },
  ],
  sensitivityKeywords: ["account number", "routing number", "payroll", "tax id"],
  budget: {
    dailyLimit: 100,
    fallbackModel: "sglang/qwen3-32b",
  },
};

describe("Business mixed-mode routing integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Hybrid business scenarios (same agent switches cloud/local)", () => {
    it("finance ops: board-ready summary (non-sensitive) routes to cloud", () => {
      const pipeline = createPluginPipeline(BUSINESS_HYBRID_CONFIG);
      const result = pipeline.simulateAgentRun(
        "Create a board-ready summary of quarterly trends across revenue, margin, cash flow, and working capital. " +
          "Include a three-part risk analysis, compare alternatives, and propose an execution plan with assumptions, " +
          "trade-offs, and a prioritized recommendation set for next quarter.",
      );

      expect(result.effectiveProvider).toBe("anthropic");
      expect(result.effectiveModel).toBe("claude-sonnet-4-5");
    });

    it("finance ops: payroll reconciliation with SSN routes local", () => {
      const pipeline = createPluginPipeline(BUSINESS_HYBRID_CONFIG);
      const result = pipeline.simulateAgentRun(
        "Reconcile this payroll entry. Employee SSN 123-45-6789 and account number 123456789.",
      );

      expect(result.effectiveProvider).toBe("sglang");
      expect(result.effectiveModel).toBe("qwen3-32b");
    });

    it("support: tone rewrite routes cloud; sensitive ticket routes local", () => {
      const pipeline = createPluginPipeline(BUSINESS_HYBRID_CONFIG);

      const rewrite = pipeline.simulateAgentRun(
        "Rewrite this customer outage response to be clearer and more empathetic, preserving facts. " +
          "Provide three alternative versions for enterprise, SMB, and regulated customers, each with risk notes, " +
          "escalation language, and explicit next-step actions. " +
          GUARANTEED_HIGH_COMPLEXITY_PROMPT,
      );
      expect(rewrite.effectiveProvider).toBe("anthropic");

      const sensitive = pipeline.simulateAgentRun(
        "Triage this ticket and keep fields: customer email jane@corp.com, phone 555-123-4567, account number 123456789.",
      );
      expect(sensitive.effectiveProvider).toBe("sglang");
    });

    it("research: public synthesis routes cloud; sensitive internal notes route local", () => {
      const pipeline = createPluginPipeline(BUSINESS_HYBRID_CONFIG);

      const publicSynthesis = pipeline.simulateAgentRun(
        "Synthesize these public market reports into an executive one-page brief. " +
          "Compare methodology quality, identify conflicts, build a confidence-weighted thesis, and provide " +
          "a scenario matrix with explicit assumptions and downside risks.",
      );
      expect(publicSynthesis.effectiveProvider).toBe("anthropic");

      const internalNotes = pipeline.simulateAgentRun(
        "Summarize these internal notes: customer email ap@corp.com, tax id 12-3456789, routing number 021000021.",
      );
      expect(internalNotes.effectiveProvider).toBe("sglang");
    });
  });

  describe("Mode behavior assertions", () => {
    it("local-only profile keeps both simple and complex prompts local", () => {
      const pipeline = createPluginPipeline({
        defaultModel: "sglang/qwen3-32b",
        rules: [
          { condition: "low_complexity", model: "sglang/qwen3-32b" },
          { condition: "high_complexity", model: "sglang/qwen3-32b" },
          { condition: "pii_detected", model: "sglang/qwen3-32b" },
          { condition: "over_budget", model: "sglang/qwen3-32b" },
        ],
      });

      const simple = pipeline.simulateAgentRun("Hello!");
      const complex = pipeline.simulateAgentRun(
        "Analyze architectural trade-offs between event-driven and request-response microservices for a high-scale distributed system.",
      );

      expect(simple.effectiveProvider).toBe("sglang");
      expect(complex.effectiveProvider).toBe("sglang");
    });

    it("hybrid profile uses cloud for complex clean prompt and local for PII prompt", () => {
      const pipeline = createPluginPipeline(BUSINESS_HYBRID_CONFIG);

      const cloudCase = pipeline.simulateAgentRun(
        "Compare three enterprise integration architectures and propose a phased migration plan with trade-offs. " +
          "Include sequencing constraints, dependency mapping, rollback strategy, risk scoring, and cost/schedule sensitivity analysis.",
      );
      const localCase = pipeline.simulateAgentRun(
        "Process this record containing SSN 123-45-6789 and account number 123456789.",
      );

      expect(cloudCase.effectiveProvider).toBe("anthropic");
      expect(localCase.effectiveProvider).toBe("sglang");
    });

    it("cloud-first profile still enforces local routing on PII", () => {
      const pipeline = createPluginPipeline({
        defaultModel: "anthropic/claude-sonnet-4-5",
        rules: [
          { condition: "low_complexity", model: "anthropic/claude-sonnet-4-5" },
          { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
          { condition: "pii_detected", model: "anthropic/claude-sonnet-4-5" },
        ],
      });

      const piiPrompt = pipeline.simulateAgentRun("My SSN is 123-45-6789");

      // Hard invariant in router: PII is never routed to cloud.
      expect(["anthropic", "openai", "google"]).not.toContain(piiPrompt.effectiveProvider);
    });
  });
});

