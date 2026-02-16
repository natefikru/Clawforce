import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exec } from "../docker/exec.js";
import { logger } from "../utils/logger.js";

/**
 * Find the deployment directory (clawforce-*) in the current working directory.
 */
export function findDeployDir(): string | null {
  const entries = readdirSync(".", { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith("clawforce-") &&
      existsSync(resolve(entry.name, "docker-compose.yml"))
    ) {
      return resolve(entry.name);
    }
  }
  return null;
}

export async function statusCommand(): Promise<void> {
  logger.header("Clawforce Status");

  const deployDir = findDeployDir();
  if (!deployDir) {
    logger.error("No deployment found in current directory.");
    logger.info("Run 'clawforce deploy' first.");
    return;
  }

  try {
    const output = await exec(
      "docker",
      ["compose", "ps", "--format", "json"],
      { cwd: deployDir },
    );

    const lines = output.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      logger.warn("No containers found.");
      return;
    }

    for (const line of lines) {
      const container = JSON.parse(line) as {
        Name: string;
        State: string;
        Status: string;
      };
      const icon = container.State === "running" ? "●" : "○";
      const color = container.State === "running" ? "green" : "red";
      logger.info(
        `${color === "green" ? "\x1b[32m" : "\x1b[31m"}${icon}\x1b[0m ${container.Name} (${container.Status})`,
      );
    }

    const health = readModelHealth(resolveHealthDbPathCandidates(deployDir));
    if (health.length > 0) {
      logger.info("");
      logger.info("Model health:");
      for (const item of health) {
        const icon = item.status === "down" ? "○" : "●";
        const color = item.status === "down" ? "red" : "green";
        logger.info(
          `${color === "green" ? "\x1b[32m" : "\x1b[31m"}${icon}\x1b[0m ${item.provider} (${item.status}/${item.circuit})`,
        );
      }
    }
  } catch {
    logger.error("Failed to get container status. Is Docker running?");
  }
}

interface ModelHealthSummary {
  provider: string;
  status: string;
  circuit: string;
}

function resolveHealthDbPathCandidates(deployDir: string): string[] {
  const paths: string[] = [];
  if (process.env.DATA_DIR) {
    paths.push(resolve(process.env.DATA_DIR, "clawforce.db"));
  }
  paths.push(resolve(deployDir, "data", "clawforce.db"));
  paths.push("/data/clawforce.db");
  return paths;
}

function readModelHealth(dbPaths: string[]): ModelHealthSummary[] {
  for (const dbPath of dbPaths) {
    if (!existsSync(dbPath)) continue;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const stateRows = db
        .prepare(
          `SELECT provider, status, circuit
           FROM model_health_state
           ORDER BY updated_at DESC`,
        )
        .all() as { provider: string; status: string; circuit: string }[];
      if (stateRows.length > 0) {
        return stateRows.map((row) => ({
          provider: row.provider,
          status: row.status,
          circuit: row.circuit,
        }));
      }
      const fallback = readModelHealthFromAlerts(db);
      if (fallback.length > 0) return fallback;
    } catch {
      // Fallback to transition-alert based inference for older schemas.
      const fallback = readModelHealthFromAlerts(db);
      if (fallback.length > 0) return fallback;
    } finally {
      db.close();
    }
  }
  return [];
}

function readModelHealthFromAlerts(db: DatabaseSync): ModelHealthSummary[] {
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

    const byProvider = new Map<string, ModelHealthSummary>();
    for (const row of rows) {
      if (!row.data) continue;
      try {
        const parsed = JSON.parse(row.data) as {
          provider?: string;
          currentStatus?: string;
          currentCircuit?: string;
        };
        if (!parsed.provider || byProvider.has(parsed.provider)) continue;
        byProvider.set(parsed.provider, {
          provider: parsed.provider,
          status: parsed.currentStatus ?? "unknown",
          circuit: parsed.currentCircuit ?? "closed",
        });
      } catch {
        // Ignore malformed alert payload rows.
      }
    }
    return [...byProvider.values()];
  } catch {
    return [];
  }
}
