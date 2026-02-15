import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import { findDeployDir } from "./status.js";
import { exec } from "../docker/exec.js";

export type AuditSource = "container" | "compliance";

export async function auditCommand(
  tailLines: number,
  source: AuditSource = "container",
): Promise<void> {
  logger.header("Clawforce Audit Log");

  const deployDir = findDeployDir();
  if (!deployDir) {
    logger.error("No deployment found in current directory.");
    return;
  }

  if (source === "compliance") {
    readComplianceLog(deployDir, tailLines);
    return;
  }

  // Try reading live logs from the container first
  const containerName = getContainerName(deployDir);
  if (containerName) {
    const lines = await readContainerLogs(containerName, tailLines);
    if (lines.length > 0) {
      for (const line of lines) {
        logger.info(line);
      }
      logger.info("");
      logger.info(`Showing last ${lines.length} entries from container logs`);
      return;
    }
  }

  // Fall back to local audit.jsonl
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
    formatAndLog(line);
  }

  logger.info("");
  logger.info(`Showing last ${tail.length} of ${lines.length} entries`);
}

function getContainerName(deployDir: string): string | null {
  const composePath = join(deployDir, "docker-compose.yml");
  if (!existsSync(composePath)) return null;
  const content = readFileSync(composePath, "utf8");
  const match = content.match(/container_name:\s*(\S+)/);
  return match?.[1] ?? null;
}

async function readContainerLogs(
  containerName: string,
  tailLines: number,
): Promise<string[]> {
  try {
    // Read OpenClaw's session log from the container
    const logFiles = await exec("docker", [
      "exec", containerName, "sh", "-c",
      "ls -t /tmp/openclaw/*.log 2>/dev/null | head -1",
    ]);
    const logFile = logFiles.trim();
    if (!logFile) return [];

    const output = await exec("docker", [
      "exec", containerName, "sh", "-c",
      `tail -${tailLines * 3} '${logFile}'`,
    ]);

    // Filter to agent activity lines (tool calls, sessions, errors)
    const allLines = output.trim().split("\n").filter(Boolean);
    const relevant = allLines.filter((line) => {
      const subsystems = [
        "agent/embedded",
        "telegram",
        "slack",
      ];
      return subsystems.some((s) => line.includes(s)) &&
        (line.includes("tool start") ||
         line.includes("tool end") ||
         line.includes("run start") ||
         line.includes("run done") ||
         line.includes("starting provider") ||
         line.includes("error") ||
         line.includes("ERROR"));
    });

    return relevant.slice(-tailLines).map((line) => {
      try {
        const parsed = JSON.parse(line);
        const ts = parsed._meta?.date ?? parsed.time ?? "";
        const msg = parsed["1"] ?? "";
        return `${ts} ${msg}`;
      } catch {
        return line;
      }
    });
  } catch {
    return [];
  }
}

function readComplianceLog(deployDir: string, tailLines: number): void {
  const compliancePath = join(deployDir, "data", "compliance.jsonl");

  if (!existsSync(compliancePath)) {
    logger.warn("No compliance log found.");
    return;
  }

  const content = readFileSync(compliancePath, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    logger.info("Compliance log is empty.");
    return;
  }

  const tail = lines.slice(-tailLines);

  for (const line of tail) {
    formatComplianceEntry(line);
  }

  logger.info("");
  logger.info(`Showing last ${tail.length} of ${lines.length} compliance entries`);
}

function formatComplianceEntry(line: string): void {
  try {
    const entry = JSON.parse(line) as {
      ts: string;
      event: string;
      [key: string]: unknown;
    };
    const details = formatComplianceDetails(entry);
    logger.info(`${entry.ts} [${entry.event}] ${details}`);
  } catch {
    logger.info(line);
  }
}

function formatComplianceDetails(
  entry: Record<string, unknown>,
): string {
  switch (entry.event) {
    case "tool_call":
      return `${entry.tool} → ${entry.success ? "success" : "error"}${entry.durationMs ? ` (${entry.durationMs}ms)` : ""}`;
    case "message_received":
      return `from ${entry.from} via ${entry.channel} (${entry.contentLength} chars)`;
    case "message_sent":
      return `to ${entry.to} via ${entry.channel} (${entry.contentLength} chars, model: ${entry.model ?? "unknown"})`;
    case "routing_decision":
      return `→ ${entry.model} (${entry.reason})`;
    default:
      return JSON.stringify(entry);
  }
}

function formatAndLog(line: string): void {
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
