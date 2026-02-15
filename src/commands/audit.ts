import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import { findDeployDir } from "./status.js";

export function auditCommand(tailLines: number): void {
  logger.header("Clawforce Audit Log");

  const deployDir = findDeployDir();
  if (!deployDir) {
    logger.error("No deployment found in current directory.");
    return;
  }

  const auditPath = join(deployDir, "data", "audit.jsonl");

  if (!existsSync(auditPath)) {
    logger.warn("No audit log found.");
    return;
  }

  const content = readFileSync(auditPath, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    logger.info("Audit log is empty.");
    return;
  }

  const tail = lines.slice(-tailLines);

  for (const line of tail) {
    try {
      const entry = JSON.parse(line) as {
        ts: string;
        agent: string;
        action: string;
        result: string;
      };
      logger.info(
        `${entry.ts} [${entry.agent}] ${entry.action} → ${entry.result}`,
      );
    } catch {
      logger.info(line);
    }
  }

  logger.info("");
  logger.info(`Showing last ${tail.length} of ${lines.length} entries`);
}
