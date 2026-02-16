/**
 * Shared types for the Clawforce storage layer.
 *
 * Row types match SQLite table schemas exactly.
 * Input types match what plugins write to storage.
 */

import type { ComplianceEntry } from "../plugins/clawforce-compliance/index.js";

export interface StorageConfig {
  dbPath: string;
  complianceLogPath: string;
  routingLogPath: string;
}

/** Raw SQL row from compliance_events table. */
export interface ComplianceEventRow {
  id: number;
  ts: string;
  event: string;
  agent_id: string | null;
  channel: string | null;
  data: string;
  created_at: string;
}

/** Typed input for routing log entries (matches what router plugin writes). */
export interface RoutingLogEntry {
  ts: string;
  event: string;
  agentId?: string;
  sessionKey?: string;
  model?: string;
  reason?: string;
  hasPII?: boolean;
  piiTypes?: string[];
  complexity?: string;
  domain?: string;
  domainConfidence?: number;
  dimension?: string;
  matchedCondition?: string;
  dataTier?: string;
  budgetSpent?: number;
  budgetRemaining?: number;
  redactedTypes?: string[];
  matchCount?: number;
  toolName?: string;
  success?: boolean;
  durationMs?: number;
  messageCount?: number;
}

/** Raw SQL row from routing_decisions table. */
export interface RoutingDecisionRow {
  id: number;
  ts: string;
  agent_id: string | null;
  selected_model: string;
  selected_provider: string | null;
  has_pii: number;
  pii_types: string | null;
  complexity: string | null;
  domain: string | null;
  data_tier: string | null;
  is_local: number;
  estimated_cost: number;
  data: string;
  created_at: string;
}

/** Raw SQL row from usage_metrics table. */
export interface UsageMetricRow {
  id: number;
  ts: string;
  agent_id: string | null;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  is_local: number;
  created_at: string;
}

/** Raw SQL row from budget_state table. */
export interface BudgetStateRow {
  agent_id: string;
  date: string;
  spent: number;
  request_count: number;
  updated_at: string;
}

/** Raw SQL row from alerts table. */
export interface AlertRow {
  id: number;
  ts: string;
  severity: string;
  type: string;
  agent_id: string | null;
  message: string;
  acknowledged: number;
  data: string | null;
  created_at: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  localRequests: number;
  cloudRequests: number;
  modelBreakdown: Record<string, { count: number; cost: number }>;
}

export interface ModelDistribution {
  model: string;
  count: number;
  percentage: number;
}

export interface DailySpend {
  date: string;
  spent: number;
  requestCount: number;
}

export type { ComplianceEntry };
