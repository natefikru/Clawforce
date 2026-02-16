import { describe, expect, it } from "vitest";
import { normalizeConnectorContext } from "../../../src/connectors/normalize-context.js";

describe("normalizeConnectorContext", () => {
  it("normalizes provider, conversation, and actor from ctx-first fields", () => {
    const result = normalizeConnectorContext(
      { from: "event-user" },
      {
        messageProvider: "slack",
        channelId: "C123",
        userId: "U123",
        sessionKey: "s-1",
      },
    );

    expect(result.provider).toBe("slack");
    expect(result.conversationId).toBe("C123");
    expect(result.actorId).toBe("U123");
    expect(result.sessionKey).toBe("s-1");
  });

  it("falls back to event fields when ctx values are missing", () => {
    const result = normalizeConnectorContext(
      {
        provider: "telegram",
        conversationId: "tg-chat-1",
        actorId: "tg-user-1",
      },
      {},
    );

    expect(result.provider).toBe("telegram");
    expect(result.conversationId).toBe("tg-chat-1");
    expect(result.actorId).toBe("tg-user-1");
  });
});

