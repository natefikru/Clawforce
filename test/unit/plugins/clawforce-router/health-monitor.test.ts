import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ModelHealthMonitor,
  parseLocalProvider,
  type HealthCheckConfig,
} from "../../../../src/plugins/clawforce-router/health-monitor.js";

const BASE_CONFIG: HealthCheckConfig = {
  enabled: true,
  intervalSeconds: 1,
  timeoutSeconds: 1,
  staleAfterSeconds: 2,
  failoverPolicy: "block",
  failureThreshold: 2,
  recoveryThreshold: 2,
  retryAttempts: 0,
  retryDelayMs: 100,
};

describe("parseLocalProvider", () => {
  it("parses supported local providers", () => {
    expect(parseLocalProvider("ollama/llama3.3:8b")).toBe("ollama");
    expect(parseLocalProvider("sglang/qwen3-32b")).toBe("sglang");
    expect(parseLocalProvider("vllm/mistral-7b")).toBe("vllm");
  });

  it("returns null for cloud and unknown refs", () => {
    expect(parseLocalProvider("anthropic/claude-sonnet-4-5")).toBeNull();
    expect(parseLocalProvider("local/custom")).toBeNull();
    expect(parseLocalProvider("")).toBeNull();
  });
});

describe("ModelHealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tracks local models and reports healthy after probe", async () => {
    const monitor = new ModelHealthMonitor({ config: BASE_CONFIG });
    monitor.trackModel("ollama/llama3.3:8b");
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);

    const state = monitor.getStateForModel("ollama/llama3.3:8b");
    expect(state?.status).toBe("healthy");
    expect(state?.circuit).toBe("closed");
    expect(state?.consecutiveSuccesses).toBeGreaterThanOrEqual(1);
    monitor.stop();
  });

  it("does not probe providers until at least one model is tracked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const monitor = new ModelHealthMonitor({ config: BASE_CONFIG });
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    monitor.trackModel("ollama/llama3.3:8b");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalled();
    monitor.stop();
  });

  it("emits onState callback for each probe result", async () => {
    const onState = vi.fn();
    const monitor = new ModelHealthMonitor({ config: BASE_CONFIG, onState });
    monitor.trackModel("ollama/llama3.3:8b");
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenCalled();
    const state = onState.mock.calls[0][0] as { provider: string; status: string };
    expect(state.provider).toBe("ollama");
    expect(state.status).toBe("healthy");
    monitor.stop();
  });

  it("opens circuit after repeated probe failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const monitor = new ModelHealthMonitor({ config: BASE_CONFIG });
    monitor.trackModel("sglang/qwen3-32b");
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const state = monitor.getStateForModel("sglang/qwen3-32b");
    expect(state?.status).toBe("down");
    expect(state?.circuit).toBe("open");
    expect(state?.consecutiveFailures).toBeGreaterThanOrEqual(2);
    monitor.stop();
  });

  it("moves from open to half_open then closed on recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const monitor = new ModelHealthMonitor({ config: BASE_CONFIG });
    monitor.trackModel("ollama/llama3.3:8b");
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    let state = monitor.getStateForModel("ollama/llama3.3:8b");
    expect(state?.circuit).toBe("open");

    await vi.advanceTimersByTimeAsync(1000);
    state = monitor.getStateForModel("ollama/llama3.3:8b");
    expect(state?.circuit).toBe("half_open");
    expect(state?.status).toBe("degraded");

    await vi.advanceTimersByTimeAsync(1000);
    state = monitor.getStateForModel("ollama/llama3.3:8b");
    expect(state?.circuit).toBe("closed");
    expect(state?.status).toBe("healthy");
    monitor.stop();
  });

  it("marks state unknown when stale", async () => {
    const monitor = new ModelHealthMonitor({ config: BASE_CONFIG });
    monitor.trackModel("ollama/llama3.3:8b");
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);
    monitor.stop();

    await vi.advanceTimersByTimeAsync(3000);

    const state = monitor.getStateForModel("ollama/llama3.3:8b");
    expect(state?.status).toBe("unknown");
    expect(state?.circuit).toBe("open");
  });
});
