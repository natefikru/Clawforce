export const DEFAULT_AGENT_ID = "_global";

export function normalizeAgentId(agentId: string | null | undefined): string | undefined {
  if (typeof agentId !== "string") return undefined;
  const trimmed = agentId.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

export function buildAgentSqlFilter(agentId: string | undefined): {
  clause: string;
  params: (string | number)[];
} {
  if (!agentId) return { clause: "", params: [] };
  if (agentId === DEFAULT_AGENT_ID) {
    return {
      clause: "(agent_id = ? OR agent_id IS NULL)",
      params: [agentId],
    };
  }
  return {
    clause: "agent_id = ?",
    params: [agentId],
  };
}

export function matchesAgentFilter(entry: Record<string, unknown>, agentId?: string): boolean {
  const normalized = normalizeAgentId(agentId);
  if (!normalized) return true;
  const entryAgentId = typeof entry.agentId === "string" ? entry.agentId : undefined;
  if (normalized === DEFAULT_AGENT_ID) {
    return !entryAgentId || entryAgentId === DEFAULT_AGENT_ID;
  }
  return entryAgentId === normalized;
}
