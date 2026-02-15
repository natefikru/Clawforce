import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, type RouterPluginApi } from "../../../../src/plugins/clawforce-router/index.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

function createMockApi(
  pluginConfig?: Record<string, unknown>,
): RouterPluginApi & {
  hooks: Map<
    string,
    {
      handler: (
        event: { prompt: string },
        ctx: { agentId?: string; sessionKey?: string },
      ) => { prependContext?: string } | void;
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
      ) => { prependContext?: string } | void;
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
        ) => { prependContext?: string } | void,
        opts,
      });
    }),
    hooks,
  };
}

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
