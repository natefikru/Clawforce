export interface ComplianceEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

export interface ToolCallEntry extends ComplianceEntry {
  event: "tool_call";
  agentId?: string;
  tool?: string;
  success?: boolean;
  durationMs?: number;
}

export interface MessageReceivedEntry extends ComplianceEntry {
  event: "message_received";
  channel?: string;
  from?: string;
  contentLength?: number;
}

export interface MessageSentEntry extends ComplianceEntry {
  event: "message_sent";
  channel?: string;
  to?: string;
  contentLength?: number;
  model?: string;
}

export interface RoutingDecisionEntry extends ComplianceEntry {
  event: "routing_decision";
  model?: string;
  reason?: string;
  hasPII?: boolean;
  complexity?: string;
}

export type TypedComplianceEntry =
  | ToolCallEntry
  | MessageReceivedEntry
  | MessageSentEntry
  | RoutingDecisionEntry
  | ComplianceEntry;

export function parseJsonl(content: string): ComplianceEntry[] {
  if (!content.trim()) return [];
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ComplianceEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ComplianceEntry => entry !== null);
}

export function filterByEvent(
  entries: ComplianceEntry[],
  event: string,
): ComplianceEntry[] {
  return entries.filter((e) => e.event === event);
}

export function filterByTimeRange(
  entries: ComplianceEntry[],
  start: Date,
  end: Date,
): ComplianceEntry[] {
  return entries.filter((e) => {
    const ts = new Date(e.ts);
    return ts >= start && ts <= end;
  });
}

export function getLatestEntries(
  entries: ComplianceEntry[],
  count: number,
): ComplianceEntry[] {
  return entries.slice(-count);
}

export function countByEvent(
  entries: ComplianceEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.event] = (counts[entry.event] ?? 0) + 1;
  }
  return counts;
}

export function getModelUsage(
  entries: ComplianceEntry[],
): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.event === "routing_decision" && typeof entry.model === "string") {
      usage[entry.model] = (usage[entry.model] ?? 0) + 1;
    }
    if (entry.event === "message_sent" && typeof entry.model === "string") {
      usage[entry.model] = (usage[entry.model] ?? 0) + 1;
    }
  }
  return usage;
}
