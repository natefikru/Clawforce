import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { activate, type RouterPluginApi } from "../../../../src/plugins/clawforce-router/index.js";

type HookHandler = (
  event: Record<string, unknown>,
  ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string },
) => Record<string, unknown> | void;

function createMockApi(
  pluginConfig?: Record<string, unknown>,
): RouterPluginApi & {
  hooks: Map<string, HookHandler>;
} {
  const hooks = new Map<string, HookHandler>();
  const defaultWriter = {
    writeAlert: vi.fn(),
    writeRoutingDecision: vi.fn(),
    writeModelHealthState: vi.fn(),
  };
  return {
    id: "clawforce-router",
    pluginConfig: {
      healthCheck: { enabled: false },
      storageWriter: defaultWriter,
      ...pluginConfig,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: vi.fn((hookName: string, handler: unknown) => {
      hooks.set(hookName, handler as HookHandler);
    }),
    hooks,
  };
}

describe("router alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits budget_exceeded with cooldown", () => {
    vi.useFakeTimers();
    const writer = {
      writeAlert: vi.fn(),
      writeRoutingDecision: vi.fn(),
      writeModelHealthState: vi.fn(),
    };
    const api = createMockApi({
      defaultModel: "anthropic/claude-sonnet-4-5",
      budget: {
        dailyLimit: 0,
        fallbackModel: "sglang/qwen3-32b",
      },
      alerts: {
        budget: {
          cooldownMinutes: 10,
        },
      },
      storageWriter: writer,
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    expect(hook).toBeDefined();

    hook!({ prompt: "hello" }, { agentId: "a-1" });
    hook!({ prompt: "hello again" }, { agentId: "a-1" });
    expect(writer.writeAlert).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000 + 1);
    hook!({ prompt: "hello once more" }, { agentId: "a-1" });
    expect(writer.writeAlert).toHaveBeenCalledTimes(2);
  });

  it("blocks and emits pii_violation when PII resolves to non-local model", () => {
    const writer = {
      writeAlert: vi.fn(),
      writeRoutingDecision: vi.fn(),
      writeModelHealthState: vi.fn(),
    };
    const api = createMockApi({
      defaultModel: "anthropic/claude-sonnet-4-5",
      defaultLocalModel: "anthropic/claude-sonnet-4-5",
      rules: [{ condition: "pii_detected", model: "openai/gpt-4o" }],
      alerts: {
        types: {
          piiViolation: true,
        },
      },
      storageWriter: writer,
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    expect(() =>
      hook!({ prompt: "my ssn is 123-45-6789" }, { agentId: "a-1" })
    ).toThrow("Blocked sensitive request");

    expect(writer.writeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pii_violation" }),
    );
  });

  it("blocks with agent_error when budget auto-block is enabled", () => {
    const writer = {
      writeAlert: vi.fn(),
      writeRoutingDecision: vi.fn(),
      writeModelHealthState: vi.fn(),
    };
    const api = createMockApi({
      defaultModel: "anthropic/claude-sonnet-4-5",
      budget: {
        dailyLimit: 0,
        fallbackModel: "sglang/qwen3-32b",
      },
      alerts: {
        budget: {
          autoBlockOnExceeded: true,
        },
      },
      storageWriter: writer,
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    expect(() => hook!({ prompt: "hello" }, { agentId: "a-1" })).toThrow(
      "Blocked request: budget exceeded and auto-block is enabled",
    );
    expect(writer.writeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_error" }),
    );
  });

  it("emits agent_idle after threshold with cooldown", () => {
    vi.useFakeTimers();
    const writer = {
      writeAlert: vi.fn(),
      writeRoutingDecision: vi.fn(),
      writeModelHealthState: vi.fn(),
    };
    const api = createMockApi({
      alerts: {
        idle: {
          thresholdMinutes: 1,
          cooldownMinutes: 30,
        },
      },
      storageWriter: writer,
    });
    activate(api);

    const hook = api.hooks.get("before_agent_start");
    hook!({ prompt: "hello" }, { agentId: "agent-idle" });

    vi.advanceTimersByTime(61_000);
    expect(writer.writeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_idle" }),
    );
  });
});
