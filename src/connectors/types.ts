export interface ConnectorContext {
  provider?: string;
  conversationId?: string;
  actorId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
}

