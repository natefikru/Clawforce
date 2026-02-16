import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStatusPoller } from "../status-poller";

// Mock container-status module
vi.mock("../container-status", () => ({
  getContainerStatus: vi.fn(),
}));

import { getContainerStatus } from "../container-status";

const mockGetContainerStatus = vi.mocked(getContainerStatus);

describe("createStatusPoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits status event when containers found", async () => {
    mockGetContainerStatus.mockResolvedValue([
      { containerName: "clawforce-agent", status: "running", uptime: "Up 2 hours" },
    ]);

    const poller = createStatusPoller();
    const result = await poller.poll();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe("status");
    const data = JSON.parse(result.events[0].data);
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].containerName).toBe("clawforce-agent");
  });

  it("does not emit when status unchanged", async () => {
    const containers = [
      { containerName: "clawforce-agent", status: "running" as const, uptime: "Up 2 hours" },
    ];
    mockGetContainerStatus.mockResolvedValue(containers);

    const poller = createStatusPoller();

    const r1 = await poller.poll();
    expect(r1.events).toHaveLength(1);

    const r2 = await poller.poll();
    expect(r2.events).toHaveLength(0);
  });

  it("emits when status changes", async () => {
    mockGetContainerStatus.mockResolvedValue([
      { containerName: "clawforce-agent", status: "running", uptime: "Up 2 hours" },
    ]);

    const poller = createStatusPoller();
    await poller.poll(); // First poll

    mockGetContainerStatus.mockResolvedValue([
      { containerName: "clawforce-agent", status: "stopped", uptime: "Exited (0)" },
    ]);

    const r2 = await poller.poll();
    expect(r2.events).toHaveLength(1);
    const data = JSON.parse(r2.events[0].data);
    expect(data.agents[0].status).toBe("stopped");
  });

  it("handles errors gracefully", async () => {
    mockGetContainerStatus.mockRejectedValue(new Error("docker not found"));

    const poller = createStatusPoller();
    const result = await poller.poll();

    expect(result.events).toHaveLength(0);
  });

  it("implements backoff after consecutive failures", async () => {
    vi.useFakeTimers();
    mockGetContainerStatus.mockRejectedValue(new Error("docker error"));

    const poller = createStatusPoller();

    // 3 consecutive failures
    await poller.poll();
    await poller.poll();
    await poller.poll();

    // Now the poller should skip (backoff active)
    mockGetContainerStatus.mockResolvedValue([
      { containerName: "clawforce-agent", status: "running", uptime: "Up 1 hour" },
    ]);

    const r4 = await poller.poll();
    // getContainerStatus should NOT have been called again (backoff)
    expect(mockGetContainerStatus).toHaveBeenCalledTimes(3);
    expect(r4.events).toHaveLength(0);

    // Advance past backoff period
    vi.advanceTimersByTime(61_000);

    const r5 = await poller.poll();
    expect(mockGetContainerStatus).toHaveBeenCalledTimes(4);
    expect(r5.events).toHaveLength(1);

    vi.useRealTimers();
  });

  it("has correct PollSource metadata", () => {
    const poller = createStatusPoller();
    expect(poller.name).toBe("status");
    expect(poller.intervalMs).toBe(10_000);
  });

  it("emits when containers appear or disappear", async () => {
    mockGetContainerStatus.mockResolvedValue([]);

    const poller = createStatusPoller();
    const r1 = await poller.poll();
    expect(r1.events).toHaveLength(1); // Initial empty state

    // Container appears
    mockGetContainerStatus.mockResolvedValue([
      { containerName: "clawforce-agent", status: "running", uptime: "Up 1 min" },
    ]);

    const r2 = await poller.poll();
    expect(r2.events).toHaveLength(1);
  });
});
