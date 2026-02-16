/**
 * Shared utility for querying Docker container status.
 * Used by both the status API route and the SSE status poller.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AgentStatus {
  containerName: string;
  status: "running" | "stopped" | "unknown";
  uptime?: string;
  model?: string;
  channel?: string;
  modelHealth?: Record<string, { status: string; circuit: string }>;
}

export async function getContainerStatus(): Promise<AgentStatus[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        "name=clawforce",
        "--format",
        "{{.Names}}|{{.Status}}",
      ],
      { encoding: "utf8", timeout: 5000 },
    );

    if (!stdout.trim()) return [];

    const modelHealth = readModelHealthSummary(process.env.DATA_DIR ?? "/data");
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, status] = line.split("|");
        return {
          containerName: name,
          status: status?.includes("Up")
            ? ("running" as const)
            : ("stopped" as const),
          uptime: status,
          modelHealth,
        };
      });
  } catch {
    return [];
  }
}

function readModelHealthSummary(
  dataDir: string,
): Record<string, { status: string; circuit: string }> {
  const candidates = [
    `${dataDir}/clawforce.db`,
    "/data/clawforce.db",
  ];

  for (const dbPath of candidates) {
    if (!existsSync(dbPath)) continue;
    const db = new DatabaseSync(dbPath, { readonly: true });
    try {
      const stateRows = db
        .prepare(
          `SELECT provider, status, circuit
           FROM model_health_state
           ORDER BY updated_at DESC`,
        )
        .all() as { provider: string; status: string; circuit: string }[];

      if (stateRows.length > 0) {
        const summary: Record<string, { status: string; circuit: string }> = {};
        for (const row of stateRows) {
          summary[row.provider] = {
            status: row.status,
            circuit: row.circuit,
          };
        }
        return summary;
      }
      const fallback = readModelHealthSummaryFromAlerts(db);
      if (Object.keys(fallback).length > 0) {
        return fallback;
      }
    } catch {
      // Fallback to transition-alert based inference for older schema versions.
      const fallback = readModelHealthSummaryFromAlerts(db);
      if (Object.keys(fallback).length > 0) {
        return fallback;
      }
    } finally {
      db.close();
    }
  }
  return {};
}

function readModelHealthSummaryFromAlerts(
  db: DatabaseSync,
): Record<string, { status: string; circuit: string }> {
  try {
    const rows = db
      .prepare(
        `SELECT data
         FROM alerts
         WHERE type = 'model_health'
         ORDER BY ts DESC
         LIMIT 100`,
      )
      .all() as { data: string | null }[];

    const summary: Record<string, { status: string; circuit: string }> = {};
    for (const row of rows) {
      if (!row.data) continue;
      try {
        const parsed = JSON.parse(row.data) as {
          provider?: string;
          currentStatus?: string;
          currentCircuit?: string;
        };
        if (!parsed.provider || summary[parsed.provider]) continue;
        summary[parsed.provider] = {
          status: parsed.currentStatus ?? "unknown",
          circuit: parsed.currentCircuit ?? "closed",
        };
      } catch {
        // Ignore malformed JSON payloads.
      }
    }
    return summary;
  } catch {
    return {};
  }
}
