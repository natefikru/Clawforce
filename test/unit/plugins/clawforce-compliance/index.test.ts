import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendFileSync, mkdirSync } from "node:fs";
import {
  activate,
  writeEntry,
  parseComplianceLog,
  resetLogDirCache,
  type CompliancePluginApi,
  type ComplianceEntry,
} from "../../../../src/plugins/clawforce-compliance/index.js";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const mockedAppendFileSync = vi.mocked(appendFileSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

function createMockApi(
  pluginConfig?: Record<string, unknown>,
): CompliancePluginApi & {
  hooks: Map<
    string,
    (event: Record<string, unknown>, ctx: Record<string, unknown>) => void
  >;
} {
  const hooks = new Map<
    string,
    (event: Record<string, unknown>, ctx: Record<string, unknown>) => void
  >();

  return {
    id: "clawforce-compliance",
    pluginConfig: {
      pluginPermissions: [
        "hooks:after_tool_call",
        "hooks:message_received",
        "hooks:message_sent",
        "storage:write",
      ],
      ...pluginConfig,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: vi.fn(
      (
        hookName: string,
        handler: (
          event: Record<string, unknown>,
          ctx: Record<string, unknown>,
        ) => void,
      ) => {
        hooks.set(hookName, handler);
      },
    ),
    hooks,
  };
}

describe("Compliance Logger Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register three hooks on activate", () => {
    const api = createMockApi();
    activate(api);
    expect(api.on).toHaveBeenCalledTimes(3);
    expect(api.hooks.has("after_tool_call")).toBe(true);
    expect(api.hooks.has("message_received")).toBe(true);
    expect(api.hooks.has("message_sent")).toBe(true);
  });

  it("should fail activation when required hook permission is missing", () => {
    const api = createMockApi({
      pluginPermissions: ["hooks:after_tool_call", "hooks:message_sent"],
    });
    expect(() => activate(api)).toThrow(
      'cannot register hook "message_received" without permission "hooks:message_received"',
    );
  });

  it("should fail activation when storage permission is missing", () => {
    const api = createMockApi({
      pluginPermissions: [
        "hooks:after_tool_call",
        "hooks:message_received",
        "hooks:message_sent",
      ],
    });
    expect(() => activate(api)).toThrow(
      'cannot write compliance logs without permission "storage:write"',
    );
  });

  it("should log activation message", () => {
    const api = createMockApi();
    activate(api);
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Compliance logger activated"),
    );
  });

  it("should log tool call events", () => {
    const api = createMockApi();
    activate(api);

    const handler = api.hooks.get("after_tool_call")!;
    handler(
      { toolName: "exec", success: true, durationMs: 150 },
      { agentId: "main" },
    );

    expect(mockedAppendFileSync).toHaveBeenCalled();
    const logged = JSON.parse(
      (mockedAppendFileSync.mock.calls[0][1] as string).trim(),
    ) as ComplianceEntry;
    expect(logged.event).toBe("tool_call");
    expect(logged.agentId).toBe("main");
    expect(logged.tool).toBe("exec");
    expect(logged.success).toBe(true);
    expect(logged.durationMs).toBe(150);
  });

  it("should log message received events", () => {
    const api = createMockApi();
    activate(api);

    const handler = api.hooks.get("message_received")!;
    handler(
      { from: "user123", content: "Hello world" },
      { messageProvider: "telegram", agentId: "main" },
    );

    expect(mockedAppendFileSync).toHaveBeenCalled();
    const logged = JSON.parse(
      (mockedAppendFileSync.mock.calls[0][1] as string).trim(),
    ) as ComplianceEntry;
    expect(logged.event).toBe("message_received");
    expect(logged.agentId).toBe("main");
    expect(logged.provider).toBe("telegram");
    expect(logged.conversationId).toBeUndefined();
    expect(logged.actorId).toBe("user123");
    expect(logged.from).toBe("user123");
    expect(logged.contentLength).toBe(11);
  });

  it("should log message sent events", () => {
    const api = createMockApi();
    activate(api);

    const handler = api.hooks.get("message_sent")!;
    handler(
      { to: "user123", content: "Hi there!", model: "claude-sonnet-4-5" },
      { messageProvider: "telegram", agentId: "main" },
    );

    expect(mockedAppendFileSync).toHaveBeenCalled();
    const logged = JSON.parse(
      (mockedAppendFileSync.mock.calls[0][1] as string).trim(),
    ) as ComplianceEntry;
    expect(logged.event).toBe("message_sent");
    expect(logged.agentId).toBe("main");
    expect(logged.provider).toBe("telegram");
    expect(logged.to).toBe("user123");
    expect(logged.contentLength).toBe(9);
    expect(logged.model).toBe("claude-sonnet-4-5");
  });

  it("should use custom log path from pluginConfig", () => {
    const api = createMockApi({ logPath: "/custom/path/compliance.jsonl" });
    activate(api);

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("/custom/path/compliance.jsonl"),
    );
  });

  it("should handle missing content in message events", () => {
    const api = createMockApi();
    activate(api);

    const handler = api.hooks.get("message_received")!;
    handler({ from: "user123" }, { messageProvider: "slack" });

    const logged = JSON.parse(
      (mockedAppendFileSync.mock.calls[0][1] as string).trim(),
    ) as ComplianceEntry;
    expect(logged.contentLength).toBe(0);
    expect(logged.agentId).toBe("_global");
  });

  it("should use text field as fallback for content", () => {
    const api = createMockApi();
    activate(api);

    const handler = api.hooks.get("message_received")!;
    handler({ from: "user123", text: "hello" }, { messageProvider: "slack" });

    const logged = JSON.parse(
      (mockedAppendFileSync.mock.calls[0][1] as string).trim(),
    ) as ComplianceEntry;
    expect(logged.contentLength).toBe(5);
  });

  it("should normalize blank agent IDs to _global", () => {
    const api = createMockApi();
    activate(api);

    const handler = api.hooks.get("after_tool_call")!;
    handler(
      { toolName: "exec", success: true, durationMs: 10 },
      { agentId: "   " },
    );

    const logged = JSON.parse(
      (mockedAppendFileSync.mock.calls[0][1] as string).trim(),
    ) as ComplianceEntry;
    expect(logged.agentId).toBe("_global");
  });
});

describe("writeEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLogDirCache();
  });

  it("should write JSON entry with newline", () => {
    const entry: ComplianceEntry = {
      ts: "2026-02-15T00:00:00Z",
      event: "test",
    };
    writeEntry("/path/to/log.jsonl", entry);

    expect(mockedAppendFileSync).toHaveBeenCalledWith(
      "/path/to/log.jsonl",
      expect.stringContaining('"event":"test"'),
      "utf8",
    );
  });

  it("should create parent directory", () => {
    writeEntry("/path/to/log.jsonl", { ts: "now", event: "test" });
    expect(mockedMkdirSync).toHaveBeenCalledWith("/path/to", {
      recursive: true,
    });
  });

  it("should only call mkdirSync once across multiple writes", () => {
    writeEntry("/path/to/log.jsonl", { ts: "1", event: "first" });
    writeEntry("/path/to/log.jsonl", { ts: "2", event: "second" });
    writeEntry("/path/to/log.jsonl", { ts: "3", event: "third" });
    expect(mockedMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockedAppendFileSync).toHaveBeenCalledTimes(3);
  });

  it("should not throw on write failure", () => {
    mockedAppendFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() =>
      writeEntry("/path/to/log.jsonl", { ts: "now", event: "test" }),
    ).not.toThrow();
  });

  it("should write error to stderr on write failure", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockedAppendFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });

    writeEntry("/path/to/log.jsonl", { ts: "now", event: "test" });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[clawforce-compliance] Failed to write log"),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("disk full"),
    );
    stderrSpy.mockRestore();
  });
});

describe("parseComplianceLog", () => {
  it("should parse valid JSONL", () => {
    const content = [
      '{"ts":"2026-02-15T00:00:00Z","event":"tool_call","tool":"exec"}',
      '{"ts":"2026-02-15T00:01:00Z","event":"message_sent","to":"user"}',
    ].join("\n");

    const entries = parseComplianceLog(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].event).toBe("tool_call");
    expect(entries[1].event).toBe("message_sent");
  });

  it("should skip malformed lines", () => {
    const content = [
      '{"ts":"2026-02-15T00:00:00Z","event":"tool_call"}',
      "not json",
      '{"ts":"2026-02-15T00:01:00Z","event":"message_sent"}',
    ].join("\n");

    const entries = parseComplianceLog(content);
    expect(entries).toHaveLength(2);
  });

  it("should return empty array for empty content", () => {
    expect(parseComplianceLog("")).toEqual([]);
  });

  it("should return empty array for whitespace-only content", () => {
    expect(parseComplianceLog("   \n  \n  ")).toEqual([]);
  });

  it("should handle single entry", () => {
    const entries = parseComplianceLog(
      '{"ts":"2026-02-15T00:00:00Z","event":"test"}',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("test");
  });
});
