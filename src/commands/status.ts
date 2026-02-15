import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
  } catch {
    logger.error("Failed to get container status. Is Docker running?");
  }
}
