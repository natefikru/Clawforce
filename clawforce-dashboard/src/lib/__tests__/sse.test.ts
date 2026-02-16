import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatSSE,
  formatComment,
  createPollingStream,
  type SSEMessage,
  type PollSource,
} from "../sse";

describe("formatSSE", () => {
  it("formats a message with all fields", () => {
    const msg: SSEMessage = { id: "42", event: "activity", data: '{"foo":1}' };
    expect(formatSSE(msg)).toBe('id: 42\nevent: activity\ndata: {"foo":1}\n\n');
  });

  it("formats a message with only data", () => {
    expect(formatSSE({ data: "hello" })).toBe("data: hello\n\n");
  });

  it("formats a message with id and data (no event)", () => {
    expect(formatSSE({ id: "1", data: "x" })).toBe("id: 1\ndata: x\n\n");
  });

  it("formats a message with event and data (no id)", () => {
    expect(formatSSE({ event: "cost", data: "{}" })).toBe(
      "event: cost\ndata: {}\n\n",
    );
  });

  it("handles empty string id", () => {
    expect(formatSSE({ id: "", data: "x" })).toBe("id: \ndata: x\n\n");
  });
});

describe("formatComment", () => {
  it("formats a heartbeat comment", () => {
    expect(formatComment("heartbeat")).toBe(": heartbeat\n\n");
  });
});

describe("createPollingStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends retry directive and initial messages", async () => {
    const controller = new AbortController();
    const initial: SSEMessage[] = [
      { id: "1", event: "activity", data: '{"ts":"2025-01-01"}' },
      { id: "2", event: "activity", data: '{"ts":"2025-01-02"}' },
    ];

    const stream = createPollingStream([], controller.signal, {
      initialMessages: initial,
      retryMs: 5000,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // Read initial chunks
    const { value: v1 } = await reader.read();
    chunks.push(decoder.decode(v1));
    const { value: v2 } = await reader.read();
    chunks.push(decoder.decode(v2));
    const { value: v3 } = await reader.read();
    chunks.push(decoder.decode(v3));

    controller.abort();
    reader.releaseLock();

    const output = chunks.join("");
    expect(output).toContain("retry: 5000\n\n");
    expect(output).toContain("id: 1\n");
    expect(output).toContain("id: 2\n");
    expect(output).toContain("event: activity\n");
  });

  it("polls sources at configured intervals", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let callCount = 0;

    const source: PollSource = {
      name: "test",
      intervalMs: 100,
      poll() {
        callCount++;
        return {
          events: [{ id: String(callCount), event: "test", data: "ok" }],
        };
      },
    };

    createPollingStream([source], controller.signal, {
      heartbeatMs: 60_000,
    });

    // Wait for intervals to fire
    await vi.advanceTimersByTimeAsync(350);
    expect(callCount).toBe(3); // 100ms, 200ms, 300ms

    controller.abort();
  });

  it("sends heartbeat at configured interval", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const stream = createPollingStream([], controller.signal, {
      heartbeatMs: 100,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    // Read retry directive first
    await reader.read();

    // Advance past heartbeat interval
    await vi.advanceTimersByTimeAsync(150);

    // Read heartbeat
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toBe(": heartbeat\n\n");

    controller.abort();
    reader.releaseLock();
  });

  it("cleans up intervals on abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let pollCount = 0;

    const source: PollSource = {
      name: "test",
      intervalMs: 50,
      poll() {
        pollCount++;
        return { events: [] };
      },
    };

    createPollingStream([source], controller.signal, {
      heartbeatMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(100);
    const countBeforeAbort = pollCount;

    controller.abort();

    await vi.advanceTimersByTimeAsync(200);
    expect(pollCount).toBe(countBeforeAbort);
  });

  it("handles async poll sources", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const source: PollSource = {
      name: "async-test",
      intervalMs: 100,
      async poll() {
        return {
          events: [{ event: "status", data: '{"running":true}' }],
        };
      },
    };

    const stream = createPollingStream([source], controller.signal, {
      heartbeatMs: 60_000,
    });
    const reader = stream.getReader();

    // Read retry directive
    await reader.read();

    // Advance timer
    await vi.advanceTimersByTimeAsync(150);

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: status\n");

    controller.abort();
    reader.releaseLock();
  });

  it("does not leak intervals when poll throws", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let callCount = 0;

    const source: PollSource = {
      name: "error-test",
      intervalMs: 50,
      poll() {
        callCount++;
        if (callCount === 1) throw new Error("poll error");
        return { events: [] };
      },
    };

    createPollingStream([source], controller.signal, {
      heartbeatMs: 60_000,
    });

    // Should not throw despite poll error
    await vi.advanceTimersByTimeAsync(200);
    expect(callCount).toBeGreaterThan(1); // Continues polling after error

    controller.abort();
  });
});
