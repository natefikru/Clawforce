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
} | void;

function createApi(pluginConfig?: Record<string, unknown>) {
  const hooks = new Map<
    string,
    (
      event: Record<string, unknown>,
      ctx: { agentId?: string; sessionKey?: string; channelId?: string; userId?: string },
    ) => HookResult
  >();

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
    on: (hookName, handler) => {
      hooks.set(hookName, handler);
    },
  };

  activate(api);
  return { hooks };
}

describe("model health failover integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("failover-safe sends non-sensitive request to cloud when local is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { hooks } = createApi({
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

    const hook = hooks.get("before_agent_start");
    const result = hook?.(
      { prompt: "hello there" },
      { agentId: "main" },
    ) as Exclude<HookResult, void>;

    expect(result.providerOverride).toBe("anthropic");
    expect(result.modelOverride).toBe("claude-sonnet-4-5");
  });

  it("blocks sensitive request when local is down even in failover-safe mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { hooks } = createApi({
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

    const hook = hooks.get("before_agent_start");
    expect(() =>
      hook?.(
        { prompt: "my ssn is 123-45-6789" },
        { agentId: "main" },
      )
    ).toThrow("Blocked sensitive request");
  });
});
