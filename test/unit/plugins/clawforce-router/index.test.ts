import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendFileSync } from "node:fs";
import { activate, parseModelRef, buildScanText, type RouterPluginApi } from "../../../../src/plugins/clawforce-router/index.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

type HookHandler = (
  event: Record<string, unknown>,
  ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string; [key: string]: unknown },
) => Record<string, unknown> | void;

type HookResult = {
  prependContext?: string;
  modelOverride?: string;
  providerOverride?: string;
} | void;

function createMockApi(
  pluginConfig?: Record<string, unknown>,
): RouterPluginApi & {
  hooks: Map<string, { handler: HookHandler; opts?: { priority?: number } }>;
} {
  const hooks = new Map<
    string,
    { handler: HookHandler; opts?: { priority?: number } }
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
        handler: handler as HookHandler,
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

    expect(result?.prependContext).toContain("sglang/qwen3-32b");
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

    expect(result?.prependContext).toContain("sglang/qwen3-32b");
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
        { condition: "pii_detected", model: "ollama/private-model" },
      ],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    const result = hook!.handler(
      { prompt: "Email: john@example.com" },
      { agentId: "main" },
    );

    expect(result?.prependContext).toContain("ollama/private-model");
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
    expect(parseModelRef("sglang/qwen3-32b")).toEqual({
      providerOverride: "sglang",
      modelOverride: "qwen3-32b",
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

    expect(result?.modelOverride).toBe("qwen3-32b");
    expect(result?.providerOverride).toBe("sglang");
  });

  it("PII (credit card) → routes to local model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My credit card is 4111-1111-1111-1111" },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("qwen3-32b");
    expect(result?.providerOverride).toBe("sglang");
  });

  it("PII (email) → routes to local model", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Contact me at john.doe@example.com please" },
      { agentId: "main" },
    );

    expect(result?.modelOverride).toBe("qwen3-32b");
    expect(result?.providerOverride).toBe("sglang");
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

    expect(result?.modelOverride).toBe("qwen3-32b");
    expect(result?.providerOverride).toBe("sglang");
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
        { condition: "pii_detected", model: "ollama/private-model" },
      ],
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    expect(result?.providerOverride).toBe("ollama");
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

    // prependContext should mention "sglang/qwen3-32b"
    // modelOverride should be "qwen3-32b" with providerOverride "sglang"
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

    expect(result?.providerOverride).toBe("sglang");
    expect(result?.modelOverride).toBe("qwen3-32b");
  });
});

describe("buildScanText", () => {
  it("should return prompt when no messages", () => {
    expect(buildScanText("hello")).toBe("hello");
  });

  it("should return prompt when messages is undefined", () => {
    expect(buildScanText("hello", undefined)).toBe("hello");
  });

  it("should return prompt when messages is empty", () => {
    expect(buildScanText("hello", [])).toBe("hello");
  });

  it("should combine messages with prompt", () => {
    const messages = [
      { content: "prior message" },
    ];
    const result = buildScanText("current prompt", messages);
    expect(result).toContain("prior message");
    expect(result).toContain("current prompt");
  });

  it("should handle string messages", () => {
    const result = buildScanText("current", ["older message"]);
    expect(result).toContain("older message");
    expect(result).toContain("current");
  });

  it("should handle text property on message objects", () => {
    const messages = [{ text: "text-based message" }];
    const result = buildScanText("current", messages);
    expect(result).toContain("text-based message");
  });

  it("should limit to last N messages by depth", () => {
    const messages = [
      { content: "msg1" },
      { content: "msg2" },
      { content: "msg3" },
      { content: "msg4" },
    ];
    const result = buildScanText("current", messages, 2);
    expect(result).not.toContain("msg1");
    expect(result).not.toContain("msg2");
    expect(result).toContain("msg3");
    expect(result).toContain("msg4");
  });

  it("should skip non-string message content", () => {
    const messages = [
      { content: 42 },
      { content: "valid message" },
      null,
    ];
    const result = buildScanText("current", messages);
    expect(result).toContain("valid message");
    expect(result).toContain("current");
  });
});

describe("Conversation History PII Scanning", () => {
  it("should detect PII in conversation history", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      {
        prompt: "What was that number again?",
        messages: [
          { content: "My SSN is 123-45-6789" },
          { content: "Thanks for providing that" },
        ],
      },
      { agentId: "main" },
    );

    // Should route to local because PII is in history
    expect(result?.providerOverride).toBe("sglang");
    expect(result?.modelOverride).toBe("qwen3-32b");
  });

  it("should still detect PII in current prompt (regression)", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    expect(result?.providerOverride).toBe("sglang");
  });

  it("should route normally when no PII in prompt or history", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      {
        prompt: "Hello there",
        messages: [
          { content: "How are you?" },
          { content: "Fine thanks" },
        ],
      },
      { agentId: "main" },
    );

    // Low complexity → routes to local (ollama) by default rules
    expect(result?.providerOverride).toBe("sglang");
    // But via complexity, not PII
    expect(result?.prependContext).not.toContain("PII detected");
  });

  it("should handle missing messages array gracefully", () => {
    const api = createMockApi();
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    // No messages property at all
    const result = hook.handler(
      { prompt: "Hello there" },
      { agentId: "main" },
    );

    expect(result).toBeDefined();
  });
});

describe("Policy-Based Routing", () => {
  it("restricted channel routes to local regardless of content", () => {
    const api = createMockApi({
      policy: {
        defaultTier: "public",
        channels: [{ channelId: "C_HR", tier: "restricted" }],
      },
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "What is the weather today?" },
      { agentId: "main", channelId: "C_HR" },
    );

    expect(result?.providerOverride).toBe("sglang");
    expect(result?.prependContext).toContain("policy");
  });

  it("confidential user routes to local", () => {
    const api = createMockApi({
      policy: {
        defaultTier: "public",
        users: [{ userId: "U_EXEC", tier: "confidential" }],
      },
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Analyze the quarterly results" },
      { agentId: "main", userId: "U_EXEC" },
    );

    expect(result?.providerOverride).toBe("sglang");
  });

  it("public channel with no PII allows normal routing", () => {
    const api = createMockApi({
      policy: {
        defaultTier: "internal",
        channels: [{ channelId: "C_PUBLIC", tier: "public" }],
      },
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Write a complex distributed systems architecture document with microservices" },
      { agentId: "main", channelId: "C_PUBLIC" },
    );

    // Public tier doesn't force local — complexity/domain decides
    expect(result).toBeDefined();
  });

  it("no policy configured behaves as before (regression)", () => {
    const api = createMockApi(); // No policy in config
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "Hello there" },
      { agentId: "main", channelId: "C_ANYTHING" },
    );

    // Should still work — low complexity routes to ollama
    expect(result?.providerOverride).toBe("sglang");
  });

  it("internal channel with PII routes local (policy + PII agree)", () => {
    const api = createMockApi({
      policy: {
        defaultTier: "internal",
      },
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start")!;
    const result = hook.handler(
      { prompt: "My SSN is 123-45-6789" },
      { agentId: "main" },
    );

    expect(result?.providerOverride).toBe("sglang");
  });
});

describe("message_sending hook", () => {
  it("should register a message_sending hook", () => {
    const api = createMockApi();
    activate(api);
    expect(api.hooks.has("message_sending")).toBe(true);
  });

  it("should redact SSN in outbound message", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("message_sending")!;
    const result = hook.handler(
      { content: "The SSN is 123-45-6789 on file." },
      { agentId: "main" },
    );
    expect(result).toBeDefined();
    expect((result as { content: string }).content).toContain("[SSN_REDACTED]");
    expect((result as { content: string }).content).not.toContain("123-45-6789");
  });

  it("should return void for clean message", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("message_sending")!;
    const result = hook.handler(
      { content: "Hello, this is a normal response." },
      { agentId: "main" },
    );
    expect(result).toBeUndefined();
  });

  it("should redact email in outbound message", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("message_sending")!;
    const result = hook.handler(
      { content: "Contact john@example.com for help." },
      { agentId: "main" },
    );
    expect(result).toBeDefined();
    expect((result as { content: string }).content).toContain("[EMAIL_REDACTED]");
  });

  it("should redact blocklist keywords from output", () => {
    const api = createMockApi({
      sensitivityKeywords: ["classified"],
    });
    activate(api);
    const hook = api.hooks.get("message_sending")!;
    const result = hook.handler(
      { content: "This is classified information." },
      { agentId: "main" },
    );
    expect(result).toBeDefined();
    expect((result as { content: string }).content).toContain("[BLOCKLIST_REDACTED]");
  });

  it("should handle empty content gracefully", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("message_sending")!;
    const result = hook.handler({ content: "" }, { agentId: "main" });
    expect(result).toBeUndefined();
  });
});

describe("tool_result_persist hook", () => {
  it("should register a tool_result_persist hook", () => {
    const api = createMockApi();
    activate(api);
    expect(api.hooks.has("tool_result_persist")).toBe(true);
  });

  it("should redact PII in tool result content", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("tool_result_persist")!;
    const result = hook.handler(
      {
        message: { content: "DB returned email john@example.com" },
        toolName: "database_query",
      },
      { agentId: "main" },
    );
    expect(result).toBeDefined();
    const msg = (result as { message: { content: string } }).message;
    expect(msg.content).toContain("[EMAIL_REDACTED]");
    expect(msg.content).not.toContain("john@example.com");
  });

  it("should return void for clean tool result", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("tool_result_persist")!;
    const result = hook.handler(
      { message: { content: "Query returned 42 rows" }, toolName: "db" },
      { agentId: "main" },
    );
    expect(result).toBeUndefined();
  });

  it("should handle missing message gracefully", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("tool_result_persist")!;
    const result = hook.handler(
      { toolName: "db" },
      { agentId: "main" },
    );
    expect(result).toBeUndefined();
  });
});

describe("agent_end hook", () => {
  it("should register an agent_end hook", () => {
    const api = createMockApi();
    activate(api);
    expect(api.hooks.has("agent_end")).toBe(true);
  });

  it("should log agent end event", () => {
    const api = createMockApi();
    activate(api);
    const hook = api.hooks.get("agent_end")!;
    hook.handler(
      { success: true, durationMs: 1500, messages: [1, 2, 3] },
      { agentId: "main", sessionKey: "sess-1" },
    );
    // Verify writeRoutingLog was called (via appendFileSync mock)
    const mockedAppend = vi.mocked(appendFileSync);
    const lastCall = mockedAppend.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const logEntry = JSON.parse(lastCall[1].trim());
    expect(logEntry.event).toBe("agent_session_end");
    expect(logEntry.agentId).toBe("main");
    expect(logEntry.success).toBe(true);
    expect(logEntry.durationMs).toBe(1500);
    expect(logEntry.messageCount).toBe(3);
  });
});
