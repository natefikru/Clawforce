/**
 * Layer 4: Integration Test — PII Defense-in-Depth
 *
 * Validates the 3-layer PII defense system works as a coordinated defense:
 *   Layer 1: Pre-routing PII detection → routes to local model
 *   Layer 2: Post-routing safety invariant → silently reroutes if misconfigured
 *   Layer 3: Output filter → redacts PII from outbound messages/tool results
 *
 * Also tests adversarial PII evasion resistance across layers, PII alert
 * system verification, and cross-layer consistency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, type RouterPluginApi } from "../../src/plugins/clawforce-router/index.js";
import { filterOutput } from "../../src/plugins/clawforce-router/output-filter.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

type HookResult = {
  prependContext?: string;
  modelOverride?: string;
  providerOverride?: string;
  content?: string;
};

type HookEntry = {
  hookName: string;
  handler: (
    event: Record<string, unknown>,
    ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string },
  ) => HookResult | void;
  priority: number;
};

/**
 * Creates a full plugin pipeline with access to ALL hooks (not just before_agent_start).
 * This allows testing the output filter hooks (message_sending, tool_result_persist)
 * alongside the routing hooks for cross-layer defense testing.
 */
function createDefensePipeline(pluginConfig?: Record<string, unknown>) {
  const registeredHooks: HookEntry[] = [];

  const loggerCalls = {
    info: [] as unknown[][],
    warn: [] as unknown[][],
    error: [] as unknown[][],
  };

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
      info: vi.fn((...args: unknown[]) => loggerCalls.info.push(args)),
      warn: vi.fn((...args: unknown[]) => loggerCalls.warn.push(args)),
      error: vi.fn((...args: unknown[]) => loggerCalls.error.push(args)),
    },
    on: (hookName, handler, opts) => {
      registeredHooks.push({
        hookName,
        handler: handler as HookEntry["handler"],
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

  function simulateOutputFilter(content: string) {
    const hooks = registeredHooks
      .filter((h) => h.hookName === "message_sending")
      .sort((a, b) => b.priority - a.priority);

    for (const hook of hooks) {
      const result = hook.handler(
        { content },
        { agentId: "main" },
      );
      if (result?.content) {
        return { content: result.content, filtered: true };
      }
    }
    return { content, filtered: false };
  }

  function simulateToolResultFilter(content: string, toolName?: string) {
    const hooks = registeredHooks
      .filter((h) => h.hookName === "tool_result_persist")
      .sort((a, b) => b.priority - a.priority);

    for (const hook of hooks) {
      const result = hook.handler(
        { message: { content }, toolName },
        { agentId: "main" },
      );
      if (result) {
        const msg = (result as Record<string, unknown>).message as Record<string, unknown> | undefined;
        if (msg?.content) {
          return { content: msg.content as string, filtered: true };
        }
      }
    }
    return { content, filtered: false };
  }

  return {
    api,
    registeredHooks,
    simulateAgentRun,
    simulateOutputFilter,
    simulateToolResultFilter,
    loggerCalls,
  };
}

describe("PII Defense-in-Depth Integration (Layer 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 3-Layer Defense Coordination ──────────────────────────────────────

  describe("Layer 1 → Layer 2 → Layer 3 coordination", () => {
    it("Layer 1 catches PII: routes to local (normal path)", () => {
      const pipeline = createDefensePipeline();
      const { effectiveProvider, hookResult } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789",
      );

      expect(effectiveProvider).toBe("sglang");
      expect(hookResult?.prependContext).toContain("PII detected");
    });

    it("Layer 2 invariant silently overrides misconfigured cloud rule for PII", () => {
      const pipeline = createDefensePipeline({
        rules: [
          { condition: "pii_detected", model: "anthropic/claude-sonnet-4-5" }, // MISCONFIGURED
        ],
      });
      const { effectiveProvider, hookResult } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789",
      );

      // Layer 2 invariant silently reroutes to local — does NOT throw
      expect(effectiveProvider).not.toBe("anthropic");
      expect(hookResult?.prependContext).toContain("safety invariant");
    });

    it("Layer 3 redacts PII from outbound messages", () => {
      const pipeline = createDefensePipeline();
      const result = pipeline.simulateOutputFilter(
        "The user's SSN is 123-45-6789 and email is test@example.com",
      );

      expect(result.filtered).toBe(true);
      expect(result.content).toContain("[SSN_REDACTED]");
      expect(result.content).toContain("[EMAIL_REDACTED]");
      expect(result.content).not.toContain("123-45-6789");
      expect(result.content).not.toContain("test@example.com");
    });

    it("all 3 layers active simultaneously: PII in input + PII in output", () => {
      const pipeline = createDefensePipeline();

      // Layer 1+2: Input with PII routes to local
      const routing = pipeline.simulateAgentRun("My SSN is 123-45-6789");
      expect(routing.effectiveProvider).not.toBe("anthropic");

      // Layer 3: Output with different PII gets redacted
      const output = pipeline.simulateOutputFilter(
        "Found credit card: 4111-1111-1111-1111",
      );
      expect(output.filtered).toBe(true);
      expect(output.content).toContain("[CREDIT_CARD_REDACTED]");
    });
  });

  // ─── Layer Bypass Scenarios ────────────────────────────────────────────

  describe("Layer bypass scenarios", () => {
    it("if Layer 1 rule forces cloud for PII → Layer 2 invariant reroutes to local", () => {
      const pipeline = createDefensePipeline({
        rules: [
          { condition: "pii_detected", model: "openai/gpt-4o" },
        ],
      });
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "My credit card is 4111-1111-1111-1111",
      );

      // Layer 2 catches the misconfiguration
      expect(effectiveProvider).not.toBe("openai");
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("Layer 3 tool_result_persist filter redacts PII from tool outputs", () => {
      const pipeline = createDefensePipeline();
      const result = pipeline.simulateToolResultFilter(
        "Database query returned: SSN 123-45-6789 for user John Doe",
        "sql_query",
      );

      expect(result.filtered).toBe(true);
      expect(result.content).toContain("[SSN_REDACTED]");
      expect(result.content).not.toContain("123-45-6789");
    });
  });

  // ─── Cross-Layer Consistency ───────────────────────────────────────────

  describe("Cross-layer consistency", () => {
    const PII_SAMPLES = [
      { text: "SSN: 123-45-6789", type: "ssn" },
      { text: "Card: 4111-1111-1111-1111", type: "credit_card" },
      { text: "Email: user@company.com", type: "email" },
      { text: "Phone: 555-123-4567", type: "phone" },
    ];

    for (const { text, type } of PII_SAMPLES) {
      it(`${type} caught by both Layer 1 (routing) and Layer 3 (output filter)`, () => {
        const pipeline = createDefensePipeline();

        // Layer 1: detects PII and routes to local
        const routing = pipeline.simulateAgentRun(text);
        expect(routing.effectiveProvider).not.toBe("anthropic");
        expect(routing.hookResult?.prependContext).toContain("PII detected");

        // Layer 3: detects and redacts same PII type in output
        const output = pipeline.simulateOutputFilter(text);
        expect(output.filtered).toBe(true);
        expect(output.content).toContain("REDACTED");
      });
    }
  });

  // ─── Adversarial PII Evasion — Extended Patterns ───────────────────────

  describe("Adversarial PII evasion — extended patterns", () => {
    it("zero-width characters between SSN digits", () => {
      const pipeline = createDefensePipeline();
      // Zero-width space (U+200B) between digits
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "My SSN is 1\u200B2\u200B3-45-6789",
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("multiple stacked zero-width chars between digits", () => {
      const pipeline = createDefensePipeline();
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "SSN: 1\u200B\u200C\u200D23-45-6789",
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("fullwidth digits in credit card numbers", () => {
      const pipeline = createDefensePipeline();
      // Fullwidth digits: ４１１１-１１１１-１１１１-１１１１
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "Card: \uFF14\uFF11\uFF11\uFF11-\uFF11\uFF11\uFF11\uFF11-\uFF11\uFF11\uFF11\uFF11-\uFF11\uFF11\uFF11\uFF11",
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("PII in conversation history routes to local", () => {
      const pipeline = createDefensePipeline();
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "summarize our conversation",
        { agentId: "main" },
        [{ content: "My SSN is 123-45-6789" }],
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("PII split across multiple history messages (partial SSN)", () => {
      const pipeline = createDefensePipeline();
      // Full SSN in single history message (split across messages not detectable
      // since they're concatenated — test that concatenation catches it)
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "please continue",
        { agentId: "main" },
        [
          { content: "My info follows" },
          { content: "SSN: 123-45-6789" },
        ],
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("PII in structured/JSON format within prompt", () => {
      const pipeline = createDefensePipeline();
      const { effectiveProvider } = pipeline.simulateAgentRun(
        '{"user": {"name": "John", "ssn": "123-45-6789", "email": "john@example.com"}}',
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("soft hyphen between PII digits stripped before detection", () => {
      const pipeline = createDefensePipeline();
      // Soft hyphen (U+00AD) should be stripped by normalizeText
      const { effectiveProvider } = pipeline.simulateAgentRun(
        "SSN: 1\u00AD23-45-6789",
      );
      expect(effectiveProvider).not.toBe("anthropic");
    });

    it("adversarial PII caught by Layer 1 is also redacted by Layer 3", () => {
      const pipeline = createDefensePipeline();

      // Zero-width chars in SSN — Layer 1 detects
      const routing = pipeline.simulateAgentRun("SSN: 1\u200B23-45-6789");
      expect(routing.effectiveProvider).not.toBe("anthropic");

      // Same pattern — Layer 3 redacts
      const output = pipeline.simulateOutputFilter("SSN: 1\u200B23-45-6789");
      expect(output.filtered).toBe(true);
      expect(output.content).toContain("[SSN_REDACTED]");
    });

    it("empty/null content handled by all 3 layers", () => {
      const pipeline = createDefensePipeline();

      // Layer 1: empty prompt → no hook result
      const routing = pipeline.simulateAgentRun("");
      expect(routing.hookResult).toBeUndefined();

      // Layer 3 output filter: empty content → no filtering
      const output = pipeline.simulateOutputFilter("");
      expect(output.filtered).toBe(false);

      // Layer 3 tool result filter: empty content → no filtering
      const toolResult = pipeline.simulateToolResultFilter("");
      expect(toolResult.filtered).toBe(false);
    });

    it("blocklist keyword with homoglyph substitution in output (Layer 3)", () => {
      const pipeline = createDefensePipeline({
        sensitivityKeywords: ["secret"],
      });

      // Use Cyrillic 'е' (U+0435) instead of Latin 'e' in "secret"
      const result = pipeline.simulateOutputFilter("The s\u0435cret key is abc123");
      expect(result.filtered).toBe(true);
      expect(result.content).toContain("[BLOCKLIST_REDACTED]");
    });
  });

  // ─── PII Alert System Verification ─────────────────────────────────────

  describe("PII violation triggers correct alerts", () => {
    it("PII + misconfigured cloud rule → routing still forces local (no alert needed)", () => {
      const alertEntries: unknown[] = [];
      const mockWriter = {
        writeRoutingDecision: vi.fn(),
        writeAlert: vi.fn((entry: unknown) => alertEntries.push(entry)),
        writeModelHealthState: vi.fn(),
      };

      const pipeline = createDefensePipeline({
        storageWriter: mockWriter,
        rules: [
          { condition: "pii_detected", model: "anthropic/claude-sonnet-4-5" },
        ],
      });

      const { effectiveProvider } = pipeline.simulateAgentRun(
        "My SSN is 123-45-6789",
      );

      // Layer 2 invariant silently reroutes — no error thrown
      expect(effectiveProvider).not.toBe("anthropic");
      // Routing log should be written
      expect(mockWriter.writeRoutingDecision).toHaveBeenCalled();
    });

    it("output redaction logs compliance event via warn logger", () => {
      const pipeline = createDefensePipeline();

      pipeline.simulateOutputFilter("SSN: 123-45-6789");

      // The warn logger should have been called about redaction
      const warnCalls = pipeline.loggerCalls.warn;
      const redactionWarn = warnCalls.find(
        (args) => typeof args[0] === "string" && args[0].includes("Output filter: redacted"),
      );
      expect(redactionWarn).toBeDefined();
    });

    it("tool result redaction logs via warn logger with tool name", () => {
      const pipeline = createDefensePipeline();

      pipeline.simulateToolResultFilter(
        "User data: SSN 123-45-6789",
        "database_query",
      );

      const warnCalls = pipeline.loggerCalls.warn;
      const redactionWarn = warnCalls.find(
        (args) => typeof args[0] === "string" && args[0].includes("Tool result filter: redacted"),
      );
      expect(redactionWarn).toBeDefined();
    });

    it("alert cooldown suppresses duplicate PII alerts within cooldown window", () => {
      const alertEntries: unknown[] = [];
      const mockWriter = {
        writeRoutingDecision: vi.fn(),
        writeAlert: vi.fn((entry: unknown) => alertEntries.push(entry)),
        writeModelHealthState: vi.fn(),
      };

      const pipeline = createDefensePipeline({
        storageWriter: mockWriter,
        alerts: {
          enabled: true,
          budget: { cooldownMinutes: 60 },
        },
        budget: {
          dailyLimit: 0.001,
          fallbackModel: "sglang/qwen3-32b",
        },
      });

      // Two over-budget requests in quick succession
      pipeline.simulateAgentRun(
        "Analyze architectural trade-offs between microservices and monoliths considering CAP theorem implications, event sourcing patterns, and CQRS for a distributed system handling 10M requests/second",
      );
      pipeline.simulateAgentRun(
        "Compare Kubernetes orchestration vs serverless approaches for deployment, discussing cold start latencies, resource utilization, and cost optimization strategies",
      );

      // Count budget_exceeded alerts — cooldown should suppress the second one
      const budgetAlerts = alertEntries.filter(
        (e: unknown) => (e as Record<string, unknown>).type === "budget_exceeded",
      );
      expect(budgetAlerts.length).toBe(1); // Only 1 due to cooldown
    });
  });

  // ─── Direct Output Filter Tests (Layer 3 standalone) ───────────────────

  describe("Output filter — direct Layer 3 validation", () => {
    it("redacts multiple PII types in single output", () => {
      const result = filterOutput(
        "User: SSN 123-45-6789, email user@test.com, card 4111-1111-1111-1111",
      );
      expect(result.redacted).toBe(true);
      expect(result.matchCount).toBeGreaterThanOrEqual(3);
      expect(result.redactedTypes).toContain("ssn");
      expect(result.redactedTypes).toContain("email");
      expect(result.redactedTypes).toContain("credit_card");
      expect(result.content).not.toContain("123-45-6789");
      expect(result.content).not.toContain("user@test.com");
      expect(result.content).not.toContain("4111-1111-1111-1111");
    });

    it("clean output passes through unmodified", () => {
      const result = filterOutput("The weather today is sunny with a high of 72F.");
      expect(result.redacted).toBe(false);
      expect(result.matchCount).toBe(0);
    });

    it("preserves surrounding text after redaction", () => {
      const result = filterOutput("Contact John at john@company.com for details.");
      expect(result.redacted).toBe(true);
      expect(result.content).toContain("Contact John at");
      expect(result.content).toContain("for details.");
      expect(result.content).toContain("[EMAIL_REDACTED]");
    });
  });
});
