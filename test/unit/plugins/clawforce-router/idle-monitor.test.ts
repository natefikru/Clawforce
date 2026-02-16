import { describe, it, expect, vi } from "vitest";
import { IdleMonitor } from "../../../../src/plugins/clawforce-router/idle-monitor.js";

describe("IdleMonitor", () => {
  it("emits idle event when threshold is exceeded", () => {
    const onIdle = vi.fn();
    const monitor = new IdleMonitor({
      thresholdMinutes: 10,
      cooldownMinutes: 30,
      onIdle,
    });

    const start = new Date("2026-02-15T00:00:00.000Z").getTime();
    monitor.recordActivity("agent-1", start);
    monitor.check(start + 11 * 60_000);

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        idleMinutes: 11,
      }),
    );
  });

  it("respects cooldown between idle alerts", () => {
    const onIdle = vi.fn();
    const monitor = new IdleMonitor({
      thresholdMinutes: 10,
      cooldownMinutes: 30,
      onIdle,
    });

    const start = new Date("2026-02-15T00:00:00.000Z").getTime();
    monitor.recordActivity("agent-1", start);

    monitor.check(start + 11 * 60_000);
    monitor.check(start + 20 * 60_000);
    monitor.check(start + 41 * 60_000);

    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it("does not emit when activity is within threshold", () => {
    const onIdle = vi.fn();
    const monitor = new IdleMonitor({
      thresholdMinutes: 10,
      cooldownMinutes: 30,
      onIdle,
    });

    const start = new Date("2026-02-15T00:00:00.000Z").getTime();
    monitor.recordActivity("agent-1", start);
    monitor.check(start + 5 * 60_000);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
