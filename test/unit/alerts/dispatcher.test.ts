import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAlertNotifications } from "../../../src/alerts/dispatcher.js";
import type { AlertEntry } from "../../../src/storage/types.js";

describe("dispatchAlertNotifications", () => {
  const alert: AlertEntry = {
    ts: "2026-02-15T00:00:00.000Z",
    severity: "warning",
    type: "budget_exceeded",
    message: "Budget exceeded",
    agentId: "agent-1",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw if Slack notifier fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    await expect(
      dispatchAlertNotifications(alert, {
        slack: {
          enabled: true,
          webhookUrl: "https://hooks.slack.com/services/T/B/X",
        },
        email: {
          enabled: false,
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("returns when all channels are disabled", async () => {
    await expect(
      dispatchAlertNotifications(alert, {
        slack: { enabled: false },
        email: { enabled: false },
      }),
    ).resolves.toBeUndefined();
  });
});
