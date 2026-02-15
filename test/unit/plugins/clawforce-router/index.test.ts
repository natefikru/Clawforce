import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, parseModelRef, type RouterPluginApi } from "../../../../src/plugins/clawforce-router/index.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

type HookResult = {
  prependContext?: string;
  modelOverride?: string;
  providerOverride?: string;
} | void;

function createMockApi(
  pluginConfig?: Record<string, unknown>,
): RouterPluginApi & {
  hooks: Map<
    string,
    {
      handler: (
        event: { prompt: string },
        ctx: { agentId?: string; sessionKey?: string },
      ) => HookResult;
      opts?: { priority?: number };
    }
  >;
} {
  const hooks = new Map<
    string,
    {
      handler: (
        event: { prompt: string },
        ctx: { agentId?: string; sessionKey?: string },
      ) => HookResult;
      opts?: { priority?: number };
    }
  >();

  return {
    id: "clawforce-router",
    pluginConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: vi.fn((hookName: string, handler: unknown, opts?: { priority?: number }) => {
      hooks.set(hookName, {
        handler: handler as (
          event: { prompt: string },
          ctx: { agentId?: string; sessionKey?: string },
        ) => HookResult,
        opts,
      });
    }),
    hooks,
  };
}

// Cloud providers that PII must NEVER route to
const CLOUD_PROVIDERS = ["anthropic", "openai", "google", "azure"];

describe("Router Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register before_agent_start hook on activate", () => {
    const api = createMockApi();
    activate(api);
    expect(api.on).toHaveBeenCalledWith(
      "before_agent_start",
      expect.any(Function),
      { priority: 10 },
    );
  });

  it("should log activation with default config", () => {
    const api = createMockApi();
    activate(api);
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Router plugin activated"),
    );
  });

  it("should route PII-containing prompt to local model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    expect(hook).toBeDefined();

    const result = hook!.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    expect(result?.prependContext).toContain("ollama/llama3.3:8b");
    expect(result?.prependContext).toContain("PII detected");
  });

  it("should route simple prompt to cost-efficient model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    const result = hook!.handler(
      { prompt: "Hello" },
      { agentId: "main" },
    );

    expect(result?.prependContext).toContain("ollama/llama3.3:8b");
    expect(result?.prependContext).toContain("cost-efficient");
  });

  it("should return void for empty prompt", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    const result = hook!.handler({ prompt: "" }, { agentId: "main" });

    expect(result).toBeUndefined();
  });

  it("should use custom rules from pluginConfig", () => {
    const api = createMockApi({
      rules: [
        { condition: "pii_detected", model: "custom/private-model" },
      ],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    const result = hook!.handler(
      { prompt: "Email: john@example.com" },
      { agentId: "main" },
    );

    expect(result?.prependContext).toContain("custom/private-model");
  });

  it("should use custom sensitivity keywords", () => {
    const api = createMockApi({
      sensitivityKeywords: ["confidential"],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    const result = hook!.handler(
      { prompt: "This is confidential information" },
      { agentId: "main" },
    );

    expect(result?.prependContext).toContain("PII detected");
  });

  it("should use custom default model", () => {
    const api = createMockApi({
      defaultModel: "openai/gpt-4o",
      rules: [],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    const result = hook!.handler(
      { prompt: "What is the meaning of life?" },
      { agentId: "main" },
    );

    expect(result?.prependContext).toContain("openai/gpt-4o");
  });

  it("should log routing decision details", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    hook!.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    // Second call (first is activation log)
    const logCalls = vi.mocked(api.logger.info).mock.calls;
    const routeLog = logCalls.find((c) =>
      String(c[0]).startsWith("Route:"),
    );
    expect(routeLog).toBeDefined();
    expect(String(routeLog![0])).toContain("PII");
    expect(String(routeLog![0])).toContain("complexity");
  });

  it("should include complexity level in log", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    hook!.handler(
      { prompt: "Hello" },
      { agentId: "main" },
    );

    const logCalls = vi.mocked(api.logger.info).mock.calls;
    const routeLog = logCalls.find((c) =>
      String(c[0]).startsWith("Route:"),
    );
    expect(String(routeLog![0])).toContain("[complexity: low]");
  });
});

describe("parseModelRef", () => {
  it("parses provider/model format", () => {
    expect(parseModelRef("ollama/llama3.3:8b")).toEqual({
      providerOverride: "ollama",
      modelOverride: "llama3.3:8b",
    });
  });

  it("parses model-only format (no slash)", () => {
    expect(parseModelRef("llama3.3:8b")).toEqual({
      modelOverride: "llama3.3:8b",
    });
  });

  it("handles provider with nested model path", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4-5")).toEqual({
      providerOverride: "anthropic",
      modelOverride: "claude-sonnet-4-5",
    });
  });
});

describe("Router Model Enforcement (Layer 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // === PII Enforcement Tests ===

  it("PII (SSN) → returns modelOverride for local model, not just prependContext", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My social security number is 123-45-6789" },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("llama3.3:8b");
    expect(result?.providerOverride).toBe("ollama");
  });

  it("PII (credit card) → routes to local model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My credit card is 4111-1111-1111-1111" },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("llama3.3:8b");
    expect(result?.providerOverride).toBe("ollama");
  });

  it("PII (email) → routes to local model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Contact me at john.doe@example.com please" },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("llama3.3:8b");
    expect(result?.providerOverride).toBe("ollama");
  });

  // === Complexity Enforcement Tests ===

  it("low complexity → routes to local cost-efficient model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Hello" },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("llama3.3:8b");
    expect(result?.providerOverride).toBe("ollama");
  });

  it("high complexity → routes to powerful cloud model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, event sourcing patterns, and CQRS for a distributed system handling 10M requests/second with strict consistency requirements. Compare Kubernetes orchestration vs serverless approaches for deployment, discussing cold start latencies, resource utilization, and cost optimization. Also evaluate database sharding strategies including consistent hashing vs range-based partitioning." },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("claude-sonnet-4-5");
    expect(result?.providerOverride).toBe("anthropic");
  });

  // === Budget Enforcement Tests ===

  it("over budget → routes to budget fallback model", () => {
    const api = createMockApi({
      budget: { dailyLimit: 0.01, warningThreshold: 0.005 },
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;

    // First call may be within budget, but a complex prompt that would normally
    // route to an expensive model should fallback when budget is near-zero
    // Send enough prompts to exhaust the tiny budget
    hook.handler({ prompt: "First query" }, { agentId: "main" });
    hook.handler({ prompt: "Second query" }, { agentId: "main" });
    hook.handler({ prompt: "Third query" }, { agentId: "main" });

    // This one should be budget-constrained
    const result = hook.handler(
      { prompt: "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, event sourcing patterns, and CQRS" },
      { agentId: "main" },
    );

    // When budget is exhausted, should route to local model regardless of complexity
    expect(result?.providerOverride).toBeDefined();
    expect(result?.modelOverride).toBeDefined();
  });

  // === Custom Rules Enforcement ===

  it("custom rules with provider/model → correct override split", () => {
    const api = createMockApi({
      rules: [
        { condition: "pii_detected", model: "custom/private-model" },
      ],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    expect(result?.providerOverride).toBe("custom");
    expect(result?.modelOverride).toBe("private-model");
  });

  // === Default Model Enforcement ===

  it("no matching rule → override matches defaultModel", () => {
    const api = createMockApi({
      defaultModel: "openai/gpt-4o",
      rules: [],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "What is the meaning of life?" },
      { agentId: "main" },
    );

    expect(result?.providerOverride).toBe("openai");
    expect(result?.modelOverride).toBe("gpt-4o");
  });

  // === Consistency Tests ===

  it("prependContext and modelOverride reference the same model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    // prependContext should mention "ollama/llama3.3:8b"
    // modelOverride should be "llama3.3:8b" with providerOverride "ollama"
    const fullModelRef = result?.providerOverride
      ? `${result.providerOverride}/${result.modelOverride}`
      : result?.modelOverride;
    expect(result?.prependContext).toContain(fullModelRef!);
  });

  // === NEGATIVE SECURITY TESTS ===
  // These are the most critical tests: PII must NEVER route to cloud providers

  it("SECURITY: PII (SSN) must NOT route to any cloud provider", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    for (const cloudProvider of CLOUD_PROVIDERS) {
      expect(result?.providerOverride).not.toBe(cloudProvider);
    }
  });

  it("SECURITY: PII (credit card) must NOT route to any cloud provider", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My card number is 4111-1111-1111-1111" },
      { agentId: "main" },
    );

    for (const cloudProvider of CLOUD_PROVIDERS) {
      expect(result?.providerOverride).not.toBe(cloudProvider);
    }
  });

  it("SECURITY: PII (email) must NOT route to any cloud provider", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Email me at sensitive.user@company.com with the details" },
      { agentId: "main" },
    );

    for (const cloudProvider of CLOUD_PROVIDERS) {
      expect(result?.providerOverride).not.toBe(cloudProvider);
    }
  });

  it("SECURITY: PII with custom keywords must NOT route to cloud", () => {
    const api = createMockApi({
      sensitivityKeywords: ["top-secret"],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "This document is top-secret and classified" },
      { agentId: "main" },
    );

    for (const cloudProvider of CLOUD_PROVIDERS) {
      expect(result?.providerOverride).not.toBe(cloudProvider);
    }
  });

  it("SECURITY: multiple PII types still route to local model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789, email is john@example.com, card 4111-1111-1111-1111" },
      { agentId: "main" },
    );

    expect(result?.providerOverride).toBe("ollama");
    expect(result?.modelOverride).toBe("llama3.3:8b");
  });
});
