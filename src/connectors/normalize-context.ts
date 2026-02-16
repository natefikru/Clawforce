import type { ConnectorContext } from "./types.js";

export function normalizeConnectorContext(
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
): ConnectorContext {
  const provider =
    typeof ctx.messageProvider === "string"
      ? ctx.messageProvider
      : typeof event.provider === "string"
      ? event.provider
      : undefined;

  const conversationId =
    typeof ctx.channelId === "string"
      ? ctx.channelId
      : typeof ctx.conversationId === "string"
      ? ctx.conversationId
      : typeof event.channelId === "string"
      ? event.channelId
      : typeof event.conversationId === "string"
      ? event.conversationId
      : undefined;

  const actorId =
    typeof ctx.userId === "string"
      ? ctx.userId
      : typeof event.from === "string"
      ? event.from
      : typeof event.actorId === "string"
      ? event.actorId
      : undefined;

  const sessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey : undefined;

  return {
    provider,
    conversationId,
    actorId,
    sessionKey,
    metadata: {
      channelId: ctx.channelId,
      userId: ctx.userId,
      messageProvider: ctx.messageProvider,
    },
  };
}

