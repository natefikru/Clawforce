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
  const logPath =
    (api.pluginConfig?.logPath as string) ??
    "/home/node/.openclaw/data/compliance.jsonl";

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

export function writeEntry(
  logPath: string,
  entry: ComplianceEntry,
): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Best-effort logging — don't crash the agent
  }
}

export function parseComplianceLog(content: string): ComplianceEntry[] {
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
