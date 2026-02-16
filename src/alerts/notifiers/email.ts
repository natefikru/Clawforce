import { spawn } from "node:child_process";
import nodemailer from "nodemailer";
import type { AlertEntry } from "../../storage/types.js";

export interface EmailNotifierConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  username?: string;
  password?: string;
  from?: string;
  to?: string[];
}

export async function sendEmailAlert(
  config: EmailNotifierConfig,
  alert: AlertEntry,
): Promise<void> {
  if (!config.enabled) return;
  if (!config.from || !config.to || config.to.length === 0) return;

  if (
    config.smtpHost &&
    config.username &&
    config.password &&
    typeof config.smtpPort === "number"
  ) {
    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      requireTLS: true,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    await transport.sendMail({
      from: config.from,
      to: config.to.join(", "),
      subject: `[clawforce][${alert.severity}] ${alert.type}`,
      text: [
        `Timestamp: ${alert.ts}`,
        `Type: ${alert.type}`,
        `Severity: ${alert.severity}`,
        `Agent: ${alert.agentId ?? "_global"}`,
        "",
        alert.message,
        "",
        alert.data ? JSON.stringify(alert.data, null, 2) : "",
      ].join("\n"),
    });
    return;
  }

  // Local fallback transport when SMTP credentials are not provided.
  const payload = [
    `From: ${config.from}`,
    `To: ${config.to.join(", ")}`,
    `Subject: [clawforce][${alert.severity}] ${alert.type}`,
    "",
    `Timestamp: ${alert.ts}`,
    `Type: ${alert.type}`,
    `Severity: ${alert.severity}`,
    `Agent: ${alert.agentId ?? "_global"}`,
    "",
    alert.message,
    "",
    alert.data ? JSON.stringify(alert.data, null, 2) : "",
    "",
  ].join("\n");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("sendmail", ["-t", "-i"]);
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `sendmail exited with code ${String(code)}`));
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}
