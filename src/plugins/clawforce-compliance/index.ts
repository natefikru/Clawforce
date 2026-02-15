/**
 * Clawforce Compliance Logger Plugin for OpenClaw.
 *
 * Captures structured JSONL logs for all agent activity:
 * - Tool calls (name, success, duration)
 * - Messages received (channel, sender, content length)
 * - Messages sent (channel, recipient, content length, model)
 *
 * Logs are written to a configurable path (default: data/compliance.jsonl)
 * and consumed by the Clawforce dashboard and audit command.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseJsonl } from "../../shared/jsonl.js";

export interface ComplianceEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

export interface CompliancePluginApi {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  on: (
    hookName: string,
    handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => void,
    opts?: { priority?: number },
  ) => void;
}

export function activate(api: CompliancePluginApi): void {
  const logPath = typeof api.pluginConfig?.logPath === "string"
    ? api.pluginConfig.logPath
    : "/home/node/.openclaw/data/compliance.jsonl";

  api.logger.info(`Compliance logger activated (log: ${logPath})`);

  // Log tool calls
  api.on("after_tool_call", (event, ctx) => {
    writeEntry(logPath, {
      ts: new Date().toISOString(),
      event: "tool_call",
      agentId: ctx.agentId as string | undefined,
      tool: event.toolName as string | undefined,
      success: event.success as boolean | undefined,
      durationMs: event.durationMs as number | undefined,
    });
  });

  // Log received messages
  api.on("message_received", (event, ctx) => {
    const content = event.content ?? event.text ?? "";
    writeEntry(logPath, {
      ts: new Date().toISOString(),
      event: "message_received",
      channel: ctx.messageProvider as string | undefined,
      from: event.from as string | undefined,
      contentLength: typeof content === "string" ? content.length : 0,
    });
  });

  // Log sent messages
  api.on("message_sent", (event, ctx) => {
    const content = event.content ?? event.text ?? "";
    writeEntry(logPath, {
      ts: new Date().toISOString(),
      event: "message_sent",
      channel: ctx.messageProvider as string | undefined,
      to: event.to as string | undefined,
      contentLength: typeof content === "string" ? content.length : 0,
      model: event.model as string | undefined,
    });
  });
}

let complianceLogDirEnsured = false;

function ensureComplianceLogDir(logPath: string): void {
  if (!complianceLogDirEnsured) {
    mkdirSync(dirname(logPath), { recursive: true });
    complianceLogDirEnsured = true;
  }
}

/** Reset the directory-ensured flag. Exported for testing only. */
export function resetLogDirCache(): void {
  complianceLogDirEnsured = false;
}

export function writeEntry(
  logPath: string,
  entry: ComplianceEntry,
): void {
  try {
    ensureComplianceLogDir(logPath);
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Best-effort logging — don't crash the agent
    process.stderr.write(
      `[clawforce-compliance] Failed to write log to ${logPath}: ${String(err)}\n`,
    );
  }
}

export function parseComplianceLog(content: string): ComplianceEntry[] {
  return parseJsonl<ComplianceEntry>(content);
}
