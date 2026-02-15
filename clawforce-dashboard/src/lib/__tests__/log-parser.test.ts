import { describe, it, expect } from "vitest";
import {
  parseJsonl,
  filterByEvent,
  filterByTimeRange,
  getLatestEntries,
  countByEvent,
  getModelUsage,
} from "../log-parser";

describe("parseJsonl", () => {
  it("should parse valid JSONL content", () => {
    const content = [
      '{"ts":"2026-02-15T00:00:00Z","event":"tool_call","tool":"exec"}',
      '{"ts":"2026-02-15T00:01:00Z","event":"message_sent","to":"user"}',
    ].join("\n");

    const entries = parseJsonl(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].event).toBe("tool_call");
    expect(entries[1].event).toBe("message_sent");
  });

  it("should skip malformed JSON lines", () => {
    const content = [
      '{"ts":"2026-02-15T00:00:00Z","event":"tool_call"}',
      "not-json",
      '{"ts":"2026-02-15T00:01:00Z","event":"test"}',
    ].join("\n");

    const entries = parseJsonl(content);
    expect(entries).toHaveLength(2);
  });

  it("should return empty array for empty string", () => {
    expect(parseJsonl("")).toEqual([]);
  });

  it("should return empty array for whitespace-only", () => {
    expect(parseJsonl("  \n\n  ")).toEqual([]);
  });

  it("should handle single line", () => {
    const entries = parseJsonl('{"ts":"now","event":"test"}');
    expect(entries).toHaveLength(1);
  });

  it("should handle trailing newline", () => {
    const entries = parseJsonl('{"ts":"now","event":"test"}\n');
    expect(entries).toHaveLength(1);
  });

  it("should preserve extra fields", () => {
    const entries = parseJsonl(
      '{"ts":"now","event":"tool_call","tool":"exec","success":true}',
    );
    expect(entries[0].tool).toBe("exec");
    expect(entries[0].success).toBe(true);
  });
});

describe("filterByEvent", () => {
  const entries = [
    { ts: "1", event: "tool_call" },
    { ts: "2", event: "message_sent" },
    { ts: "3", event: "tool_call" },
    { ts: "4", event: "message_received" },
  ];

  it("should filter entries by event type", () => {
    const filtered = filterByEvent(entries, "tool_call");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.event === "tool_call")).toBe(true);
  });

  it("should return empty for non-matching event", () => {
    expect(filterByEvent(entries, "routing_decision")).toEqual([]);
  });

  it("should return empty for empty input", () => {
    expect(filterByEvent([], "tool_call")).toEqual([]);
  });
});

describe("filterByTimeRange", () => {
  const entries = [
    { ts: "2026-02-15T00:00:00Z", event: "a" },
    { ts: "2026-02-15T06:00:00Z", event: "b" },
    { ts: "2026-02-15T12:00:00Z", event: "c" },
    { ts: "2026-02-15T18:00:00Z", event: "d" },
  ];

  it("should filter entries within time range", () => {
    const start = new Date("2026-02-15T05:00:00Z");
    const end = new Date("2026-02-15T13:00:00Z");
    const filtered = filterByTimeRange(entries, start, end);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].event).toBe("b");
    expect(filtered[1].event).toBe("c");
  });

  it("should return empty when no entries in range", () => {
    const start = new Date("2026-02-16T00:00:00Z");
    const end = new Date("2026-02-16T23:59:59Z");
    expect(filterByTimeRange(entries, start, end)).toEqual([]);
  });

  it("should include boundary entries", () => {
    const start = new Date("2026-02-15T00:00:00Z");
    const end = new Date("2026-02-15T00:00:00Z");
    const filtered = filterByTimeRange(entries, start, end);
    expect(filtered).toHaveLength(1);
  });
});

describe("getLatestEntries", () => {
  const entries = [
    { ts: "1", event: "a" },
    { ts: "2", event: "b" },
    { ts: "3", event: "c" },
    { ts: "4", event: "d" },
    { ts: "5", event: "e" },
  ];

  it("should return last N entries", () => {
    const latest = getLatestEntries(entries, 3);
    expect(latest).toHaveLength(3);
    expect(latest[0].event).toBe("c");
    expect(latest[2].event).toBe("e");
  });

  it("should return all entries when count exceeds length", () => {
    expect(getLatestEntries(entries, 10)).toHaveLength(5);
  });

  it("should return empty for empty input", () => {
    expect(getLatestEntries([], 5)).toEqual([]);
  });
});

describe("countByEvent", () => {
  it("should count entries by event type", () => {
    const entries = [
      { ts: "1", event: "tool_call" },
      { ts: "2", event: "message_sent" },
      { ts: "3", event: "tool_call" },
      { ts: "4", event: "tool_call" },
      { ts: "5", event: "message_received" },
    ];

    const counts = countByEvent(entries);
    expect(counts.tool_call).toBe(3);
    expect(counts.message_sent).toBe(1);
    expect(counts.message_received).toBe(1);
  });

  it("should return empty object for empty input", () => {
    expect(countByEvent([])).toEqual({});
  });
});

describe("getModelUsage", () => {
  it("should count model usage from routing decisions", () => {
    const entries = [
      { ts: "1", event: "routing_decision", model: "ollama/llama3.3:8b" },
      { ts: "2", event: "routing_decision", model: "anthropic/claude-sonnet-4-5" },
      { ts: "3", event: "routing_decision", model: "ollama/llama3.3:8b" },
    ];

    const usage = getModelUsage(entries);
    expect(usage["ollama/llama3.3:8b"]).toBe(2);
    expect(usage["anthropic/claude-sonnet-4-5"]).toBe(1);
  });

  it("should count model usage from message_sent events", () => {
    const entries = [
      { ts: "1", event: "message_sent", model: "claude-sonnet-4-5" },
      { ts: "2", event: "message_sent", model: "claude-sonnet-4-5" },
    ];

    const usage = getModelUsage(entries);
    expect(usage["claude-sonnet-4-5"]).toBe(2);
  });

  it("should ignore entries without model field", () => {
    const entries = [
      { ts: "1", event: "tool_call", tool: "exec" },
      { ts: "2", event: "message_received", from: "user" },
    ];

    expect(getModelUsage(entries)).toEqual({});
  });

  it("should return empty for empty input", () => {
    expect(getModelUsage([])).toEqual({});
  });
});
